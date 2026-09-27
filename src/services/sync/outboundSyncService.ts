/**
 * Outbound sync engine — the single queue that sends offline-captured data
 * (ride check-ins, event activity records and cancels) from
 * pending_operations to the backend. See docs/DataIntegrationDesign.md §4.
 *
 * - One serial queue: batches, interactive "send now", retry and discard never
 *   run concurrently, so an operation is never sent twice at the same time.
 * - Operation handlers are registered per operation type and grouped into
 *   families. Order is kept within a family (FIFO); a family whose oldest
 *   operation is waiting for a retry does not block other families.
 * - Transient failures back off exponentially with jitter (nextAttemptAt).
 *   A server-side failure that keeps repeating moves the operation to FAILED
 *   after `maxSyncAttempts`, so it shows in Sync status and stops blocking
 *   newer data. Loss of connectivity never moves data to FAILED.
 * - Event-driven, no polling (battery): runs on enqueue, reconnect,
 *   foreground and "Sync now", plus one timer for the next due retry. It only
 *   runs while enabled (online, app in foreground, signed in online).
 * - Only operations captured by the signed-in user (or legacy rows without an
 *   owner) are sent.
 */

import { isNetworkError } from '../api/apiClient';
import {
  clearPendingBackoff,
  dropOperation,
  getFailedOperations,
  getPendingOperation,
  getPendingOperations,
  markAttemptFailed,
  markFailed,
  markSynced,
  markSyncing,
  OperationType,
  PendingOperation,
  requeueFailed,
} from '../database/pendingStore';
import { resetStuckOperations } from '../database/database';
import { computeRetryDelayMs, hasExhaustedAttempts } from './backoff';
import { getSyncSettings } from './syncSettingsService';
import { logger } from '../../utils/logger';

const TAG = 'OutboundSync';

/** Operations whose order matters relative to each other. */
export type OperationFamily = 'CHECK_IN' | 'EVENT';

export interface OperationContext {
  tourId: string;
  /** True when the user is waiting on the result (online capture) */
  interactive: boolean;
}

export type HandlerResult =
  /** Accepted by the server (or already there); the operation is removed */
  | { kind: 'synced'; detail?: unknown }
  /** Removed without syncing (e.g. duplicate or interactive rejection shown to the user) */
  | { kind: 'dropped'; reason: 'duplicate' | 'rejected' | 'invalid'; error?: unknown }
  /** Business rejection: kept as FAILED for the user to review */
  | { kind: 'rejected'; message: string; error?: unknown }
  /** Could not be sent now; retried later */
  | { kind: 'transient'; reason: string; networkDown?: boolean };

export type OperationResult = HandlerResult | { kind: 'skipped' } | { kind: 'queued'; reason: string };

export interface OperationHandler {
  family: OperationFamily;
  /** Send the operation. Throwing counts as a transient failure. */
  process(op: PendingOperation, context: OperationContext): Promise<HandlerResult>;
  /** The operation became FAILED (rejected or retries exhausted). */
  onFailed?(op: PendingOperation, message: string): Promise<void>;
  /** A transient failure was recorded and the operation stays queued. */
  onRetryScheduled?(op: PendingOperation): Promise<void>;
  /** A FAILED operation was put back in the queue by the user. */
  onRequeued?(op: PendingOperation): Promise<void>;
  /** The user discarded the operation; remove its local data. */
  onDiscarded?(op: PendingOperation): Promise<void>;
}

export interface OutboundSyncStatus {
  isEnabled: boolean;
  isRunning: boolean;
  lastRunAt: string | null;
  /** Last connectivity/server error seen by a batch (cleared by a successful send) */
  lastError: string | null;
  /** When the next automatic retry is scheduled, if any */
  nextRetryAt: string | null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const handlers = new Map<OperationType, OperationHandler>();

/** Register the handler for an operation type (called once at module load). */
export function registerOperationHandler(type: OperationType, handler: OperationHandler): void {
  handlers.set(type, handler);
}

function typesOfFamily(family?: OperationFamily): OperationType[] {
  return [...handlers.entries()]
    .filter(([, handler]) => !family || handler.family === family)
    .map(([type]) => type);
}

// ---------------------------------------------------------------------------
// Session + status
// ---------------------------------------------------------------------------

interface SessionState {
  userId: string | null;
  tourId: string | null;
  enabled: boolean;
}

let session: SessionState = { userId: null, tourId: null, enabled: false };
let status: OutboundSyncStatus = {
  isEnabled: false,
  isRunning: false,
  lastRunAt: null,
  lastError: null,
  nextRetryAt: null,
};
let stuckOpsReset = false;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notified whenever the queue or the engine status changes. */
export function subscribeOutboundSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.warn(TAG, 'Sync listener failed', error);
    }
  });
}

function updateStatus(patch: Partial<OutboundSyncStatus>): void {
  status = { ...status, ...patch };
  notify();
}

export function getOutboundSyncStatus(): OutboundSyncStatus {
  return status;
}

function canRun(): boolean {
  return session.enabled && Boolean(session.userId) && Boolean(session.tourId);
}

/**
 * Set who is signed in, the active tour and whether sending is allowed
 * (online, foreground, online session). Enabling triggers a batch.
 */
export function configureOutboundSync(next: SessionState): void {
  const changed =
    next.userId !== session.userId || next.tourId !== session.tourId || next.enabled !== session.enabled;
  session = { ...next };
  if (!changed) return;

  if (!canRun()) {
    clearRetryTimer();
    updateStatus({ isEnabled: false, nextRetryAt: null });
    return;
  }
  updateStatus({ isEnabled: true });
  if (!stuckOpsReset) {
    stuckOpsReset = true;
    // Operations left SYNCING by a crash/kill are requeued once per app session.
    void serialize(() => resetStuckOperations()).catch((error) =>
      logger.warn(TAG, 'Resetting stuck operations failed', error),
    );
  }
  requestOutboundSync({ resetBackoff: true });
}

// ---------------------------------------------------------------------------
// Serial queue
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

/** Run work in the outbound queue (never concurrently with sending). */
export function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Operation processing
// ---------------------------------------------------------------------------

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function processOperation(op: PendingOperation, interactive: boolean): Promise<OperationResult> {
  const handler = handlers.get(op.operationType);
  const tourId = session.tourId;
  if (!handler || !tourId) return { kind: 'skipped' };

  // Re-read: the operation may have been processed or discarded since the list was read.
  const fresh = await getPendingOperation(op.localId);
  if (!fresh || fresh.syncStatus !== 'PENDING') return { kind: 'skipped' };

  await markSyncing(fresh.localId);
  let result: HandlerResult;
  try {
    result = await handler.process(fresh, { tourId, interactive });
  } catch (error) {
    result = { kind: 'transient', reason: describe(error), networkDown: isNetworkError(error) };
  }

  const attempts = fresh.retryCount + 1;
  switch (result.kind) {
    case 'synced':
    case 'dropped':
      await markSynced(fresh.localId);
      break;
    case 'rejected':
      await markFailed(fresh.localId, result.message);
      await handler.onFailed?.(fresh, result.message);
      logger.info(TAG, 'Operation rejected by server', { localId: fresh.localId, type: fresh.operationType });
      break;
    case 'transient': {
      const settings = getSyncSettings();
      if (!result.networkDown && hasExhaustedAttempts(attempts, settings.maxSyncAttempts)) {
        const message = `Not sent after ${attempts} attempts: ${result.reason}`;
        await markFailed(fresh.localId, message);
        await handler.onFailed?.(fresh, message);
        logger.warn(TAG, 'Operation moved to FAILED after repeated errors', {
          localId: fresh.localId,
          attempts,
        });
      } else {
        const delayMs = computeRetryDelayMs(attempts, settings.maxBackoffMinutes);
        await markAttemptFailed(fresh.localId, result.reason, new Date(Date.now() + delayMs).toISOString());
        await handler.onRetryScheduled?.(fresh);
      }
      break;
    }
    default:
      break;
  }
  notify();
  return result;
}

interface BatchSummary {
  synced: number;
  blockedFamilies: Set<OperationFamily>;
  /** Earliest nextAttemptAt among operations waiting on backoff */
  earliestDueAt: number | null;
  lastError: string | null;
}

async function runBatch(options: {
  family?: OperationFamily;
  stopAtLocalId?: string;
  interactive?: boolean;
} = {}): Promise<BatchSummary> {
  const summary: BatchSummary = { synced: 0, blockedFamilies: new Set(), earliestDueAt: null, lastError: null };
  const types = typesOfFamily(options.family);
  if (types.length === 0 || !canRun()) return summary;

  const pending = await getPendingOperations(types, session.userId);
  const now = Date.now();
  for (const op of pending) {
    if (op.localId === options.stopAtLocalId) break;
    const handler = handlers.get(op.operationType);
    if (!handler || summary.blockedFamilies.has(handler.family)) continue;
    if (!canRun()) break;

    // Interactive sends flush earlier data regardless of backoff: the user is online and waiting.
    const dueAt = op.nextAttemptAt ? Date.parse(op.nextAttemptAt) : NaN;
    if (!options.interactive && Number.isFinite(dueAt) && dueAt > now) {
      summary.blockedFamilies.add(handler.family);
      summary.earliestDueAt = Math.min(summary.earliestDueAt ?? dueAt, dueAt);
      continue;
    }

    // Earlier queued items are background data, not the item the user is waiting on:
    // keep their rejections as FAILED (Sync status) instead of dropping them.
    const result = await processOperation(op, false);
    if (result.kind === 'synced') summary.synced += 1;
    if (result.kind === 'transient') {
      summary.lastError = result.reason;
      summary.blockedFamilies.add(handler.family);
      const refreshed = await getPendingOperation(op.localId);
      const retryAt = refreshed?.nextAttemptAt ? Date.parse(refreshed.nextAttemptAt) : NaN;
      if (Number.isFinite(retryAt)) {
        summary.earliestDueAt = Math.min(summary.earliestDueAt ?? retryAt, retryAt);
      }
      // No connectivity: nothing else will get through either.
      if (result.networkDown) break;
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let batchRunning = false;
let rerunRequested = false;
let resetBackoffRequested = false;

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(dueAt: number | null): void {
  clearRetryTimer();
  if (dueAt === null || !canRun()) {
    updateStatus({ nextRetryAt: null });
    return;
  }
  const delayMs = Math.max(1_000, dueAt - Date.now());
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestOutboundSync();
  }, delayMs);
  updateStatus({ nextRetryAt: new Date(Date.now() + delayMs).toISOString() });
}

/**
 * Ask the engine to send queued data now (coalesced; no-op while disabled).
 * `resetBackoff` clears retry waits — use when connectivity has just returned
 * or the user asked to sync.
 */
export function requestOutboundSync(options: { resetBackoff?: boolean } = {}): void {
  if (options.resetBackoff) resetBackoffRequested = true;
  if (!canRun()) return;
  if (batchRunning) {
    rerunRequested = true;
    return;
  }
  batchRunning = true;
  clearRetryTimer();
  updateStatus({ isRunning: true });

  void serialize(async () => {
    let summary: BatchSummary;
    do {
      rerunRequested = false;
      if (resetBackoffRequested) {
        resetBackoffRequested = false;
        await clearPendingBackoff();
      }
      summary = await runBatch();
    } while (rerunRequested && canRun());
    return summary;
  })
    .then((summary) => {
      updateStatus({ lastRunAt: new Date().toISOString(), lastError: summary.lastError });
      scheduleRetry(summary.earliestDueAt);
    })
    .catch((error) => {
      logger.warn(TAG, 'Outbound batch failed', error);
      updateStatus({ lastError: describe(error) });
    })
    .finally(() => {
      batchRunning = false;
      updateStatus({ isRunning: false });
    });
}

/**
 * Send one queued operation now (online capture). Earlier queued operations
 * of the same family are sent first so the server sees them in order.
 */
export function sendOperationNow(localId: string): Promise<OperationResult> {
  return serialize(async (): Promise<OperationResult> => {
    const op = await getPendingOperation(localId);
    const handler = op ? handlers.get(op.operationType) : undefined;
    if (!op || !handler) return { kind: 'skipped' };
    if (!canRun()) return { kind: 'queued', reason: 'Sending is paused' };

    const earlier = await runBatch({ family: handler.family, stopAtLocalId: localId, interactive: true });
    if (earlier.blockedFamilies.has(handler.family)) {
      requestOutboundSync();
      return { kind: 'queued', reason: 'Earlier queued items could not be sent yet' };
    }
    const result = await processOperation(op, true);
    if (result.kind === 'transient') requestOutboundSync();
    return result;
  });
}

/**
 * Send every queued operation of a family now (before an online capture that
 * bypasses the queue, so the server sees earlier data first). Resolves true
 * when nothing of that family is left waiting.
 */
export function flushFamilyNow(family: OperationFamily): Promise<boolean> {
  return serialize(async () => {
    if (canRun()) {
      const summary = await runBatch({ family, interactive: true });
      if (summary.blockedFamilies.has(family)) {
        requestOutboundSync();
        return false;
      }
    }
    const remaining = await getPendingOperations(typesOfFamily(family), session.userId);
    return remaining.length === 0;
  });
}

// ---------------------------------------------------------------------------
// User actions (Sync status screen)
// ---------------------------------------------------------------------------

/**
 * Put FAILED operations back in the queue (all when no ids are given) and
 * start sending. Returns how many were re-queued.
 */
export function retryFailedOperations(localIds?: readonly string[]): Promise<number> {
  return serialize(async () => {
    const failed = await getFailedOperations();
    const selected = localIds ? failed.filter((op) => localIds.includes(op.localId)) : failed;
    for (const op of selected) {
      await requeueFailed(op.localId);
      await handlers.get(op.operationType)?.onRequeued?.(op);
    }
    notify();
    return selected.length;
  }).then((count) => {
    requestOutboundSync({ resetBackoff: true });
    return count;
  });
}

/**
 * Permanently remove a queued or failed operation and its local data.
 * Only called after the user confirms.
 */
export function discardOperation(localId: string): Promise<boolean> {
  return serialize(async () => {
    const op = await getPendingOperation(localId);
    if (!op) return false;
    await handlers.get(op.operationType)?.onDiscarded?.(op);
    await dropOperation(localId);
    logger.info(TAG, 'Queued operation discarded by user', { localId, type: op.operationType });
    notify();
    return true;
  });
}

/**
 * Notify listeners that queued data changed (after an enqueue). Pass
 * `startSync` when the caller will not send the operation itself; online
 * capture calls sendOperationNow instead so the user sees the result.
 */
export function notifyQueueChanged(startSync = false): void {
  notify();
  if (startSync) requestOutboundSync();
}
