/**
 * Event sync service — pushes queued event operations (activity record
 * create/cancel) from pending_operations to the backend. Check-in operations
 * are never touched here (they belong to syncService.ts).
 *
 * - One serial queue: the ~3 s loop and interactive "send now" calls never run
 *   concurrently, and an interactive call first flushes older queued event ops
 *   so prerequisites reach the server in scan order.
 * - Transient failures (network, timeout, 401, 5xx, malformed) keep the op
 *   queued and stop the batch; the loop is the retry (apiClient retries = 0).
 * - Expected API rejections follow docs/DataIntegrationDesign.md § Event Outbound Sync.
 */

import {
  cancelActivityRecord,
  createActivityRecord,
  EventApiError,
} from '../api/eventsApi';
import {
  CancelEventRecordPayload,
  CreateEventRecordPayload,
  dropOperation,
  enqueueEventRecordCancel,
  enqueueEventRecordCreate,
  getPendingOperation,
  getPendingOperations,
  markAttemptFailed,
  markFailed as markOpFailed,
  markSynced as markOpSynced,
  markSyncing,
  OperationType,
  PendingOperation,
} from '../database/pendingStore';
import {
  deleteEventRecord,
  getEventRecordByLocalId,
  incrementEventRecordRetry,
  insertLocalEventRecord,
  LocalEventActivityRecord,
  markEventRecordCancelled,
  markEventRecordFailed,
  markEventRecordSynced,
  NewLocalEventActivityRecord,
} from '../database/eventRecordStore';
import { resetStuckOperations } from '../database/database';
import { CreateActivityRecordRequest } from '../../types/api';
import { ActivityOutcome } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'EventSync';

export const EVENT_OUTBOUND_POLL_INTERVAL_MS = 3_000;

const EVENT_OPERATION_TYPES: readonly OperationType[] = [
  'CREATE_EVENT_ACTIVITY_RECORD',
  'CANCEL_EVENT_ACTIVITY_RECORD',
];

const SEND_OPTIONS = { maxRetries: 0 };

export type EventOperationResult =
  | { status: 'synced'; isFlagged: boolean }
  /** Create rejected as DUPLICATE_ACTIVITY_RECORD on its first attempt; removed locally */
  | { status: 'duplicate'; error: EventApiError }
  | { status: 'rejected'; error: EventApiError }
  /** Transient failure; still queued */
  | { status: 'queued'; reason: string }
  /** Not pending any more (already processed or removed) */
  | { status: 'skipped' };

// ---------------------------------------------------------------------------
// Change notifications (EventSessionContext reloads counts/records)
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeEventSync(listener: Listener): () => void {
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

// ---------------------------------------------------------------------------
// Serial queue
// ---------------------------------------------------------------------------

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Operation processing
// ---------------------------------------------------------------------------

function describeTransient(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function processOperation(
  tourId: string,
  op: PendingOperation,
  interactive: boolean,
): Promise<EventOperationResult> {
  // Re-read: the op may have been processed or dropped since the list was fetched.
  const fresh = await getPendingOperation(op.localId);
  if (!fresh || fresh.syncStatus !== 'PENDING') {
    return { status: 'skipped' };
  }

  await markSyncing(fresh.localId);
  if (fresh.operationType === 'CREATE_EVENT_ACTIVITY_RECORD') {
    return processCreate(tourId, fresh, interactive);
  }
  return processCancel(tourId, fresh);
}

function parsePayload<T>(op: PendingOperation): T | null {
  try {
    return JSON.parse(op.payload) as T;
  } catch {
    return null;
  }
}

async function processCreate(
  tourId: string,
  op: PendingOperation,
  interactive: boolean,
): Promise<EventOperationResult> {
  const payload = parsePayload<CreateEventRecordPayload>(op);
  if (!payload) {
    await markOpFailed(op.localId, 'Corrupt queued payload');
    await markEventRecordFailed(op.localId, 'Corrupt queued payload');
    return { status: 'skipped' };
  }

  let outcome;
  try {
    outcome = await createActivityRecord(
      tourId,
      payload.eventId,
      payload.occurrenceId,
      payload.request,
      SEND_OPTIONS,
    );
  } catch (error) {
    const reason = describeTransient(error);
    await markAttemptFailed(op.localId, reason);
    await incrementEventRecordRetry(op.localId);
    return { status: 'queued', reason };
  }

  if (outcome.kind === 'success') {
    await markEventRecordSynced(op.localId, {
      recordId: outcome.data.recordId,
      isFlagged: Boolean(outcome.data.isFlagged),
    });
    await markOpSynced(op.localId);
    return { status: 'synced', isFlagged: Boolean(outcome.data.isFlagged) };
  }

  const { error } = outcome;
  if (error.code === 'DUPLICATE_ACTIVITY_RECORD') {
    if (op.retryCount > 0) {
      // An earlier attempt most likely reached the server; recordId is <riderId>#<activityId>#<timestamp>.
      const { riderId, activityId, timestamp } = payload.request;
      await markEventRecordSynced(op.localId, {
        recordId: `${riderId}#${activityId}#${timestamp}`,
        isFlagged: false,
      });
      await markOpSynced(op.localId);
      logger.info(TAG, 'Retried record already on server; marked synced', { localId: op.localId });
      return { status: 'synced', isFlagged: false };
    }
    await dropOperation(op.localId);
    await deleteEventRecord(op.localId);
    return { status: 'duplicate', error };
  }

  if (interactive) {
    // The scanner sees the message immediately; nothing is kept for later review.
    await dropOperation(op.localId);
    await deleteEventRecord(op.localId);
  } else {
    await markOpFailed(op.localId, error.message);
    await markEventRecordFailed(op.localId, error.message);
  }
  logger.info(TAG, 'Event record rejected', { code: error.code, interactive });
  return { status: 'rejected', error };
}

async function processCancel(tourId: string, op: PendingOperation): Promise<EventOperationResult> {
  const payload = parsePayload<CancelEventRecordPayload>(op);
  if (!payload) {
    logger.warn(TAG, 'Dropping cancel op with corrupt payload', { localId: op.localId });
    await dropOperation(op.localId);
    return { status: 'skipped' };
  }

  let outcome;
  try {
    outcome = await cancelActivityRecord(
      tourId,
      payload.eventId,
      payload.occurrenceId,
      payload.recordId,
      payload.cancelReason ? { cancelReason: payload.cancelReason } : {},
      SEND_OPTIONS,
    );
  } catch (error) {
    const reason = describeTransient(error);
    await markAttemptFailed(op.localId, reason);
    return { status: 'queued', reason };
  }

  if (outcome.kind === 'success' || outcome.error.code === 'RECORD_ALREADY_CANCELLED') {
    await markEventRecordCancelled(payload.recordLocalId, true);
    await markOpSynced(op.localId);
    return { status: 'synced', isFlagged: false };
  }

  logger.warn(TAG, 'Cancel rejected; record restored', {
    code: outcome.error.code,
    recordLocalId: payload.recordLocalId,
  });
  await markEventRecordCancelled(payload.recordLocalId, false);
  await dropOperation(op.localId);
  return { status: 'rejected', error: outcome.error };
}

// ---------------------------------------------------------------------------
// Batch + interactive entry points
// ---------------------------------------------------------------------------

interface BatchSummary {
  synced: number;
  stoppedOnTransient: boolean;
}

async function runBatch(tourId: string, stopAtLocalId?: string): Promise<BatchSummary> {
  const pending = await getPendingOperations(EVENT_OPERATION_TYPES);
  const summary: BatchSummary = { synced: 0, stoppedOnTransient: false };

  for (const op of pending) {
    if (op.localId === stopAtLocalId) break;
    const result = await processOperation(tourId, op, false);
    if (result.status === 'synced') summary.synced += 1;
    if (result.status !== 'skipped') notify();
    if (result.status === 'queued') {
      summary.stoppedOnTransient = true;
      break;
    }
  }
  return summary;
}

/**
 * Send one queued operation now (scan/cancel while online). Older queued event
 * operations are sent first so the server sees them in order.
 */
export function processEventOperationNow(tourId: string, localId: string): Promise<EventOperationResult> {
  return serialize(async () => {
    const earlier = await runBatch(tourId, localId);
    if (earlier.stoppedOnTransient) {
      return { status: 'queued', reason: 'Earlier queued scans could not be sent' } as EventOperationResult;
    }
    const op = await getPendingOperation(localId);
    if (!op) return { status: 'skipped' } as EventOperationResult;
    const result = await processOperation(tourId, op, true);
    notify();
    return result;
  });
}

// ---------------------------------------------------------------------------
// Loop lifecycle (EventSessionContext starts/stops with tour + connectivity)
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let batchQueued = false;
let stuckOpsReset = false;

function scheduleBatch(tourId: string, onBatchSynced: () => void): void {
  if (batchQueued) return;
  batchQueued = true;
  void serialize(() => runBatch(tourId))
    .then((summary) => {
      if (summary.synced > 0) onBatchSynced();
    })
    .catch((error) => logger.warn(TAG, 'Outbound event batch failed', error))
    .finally(() => {
      batchQueued = false;
    });
}

export function startEventSync(tourId: string, onBatchSynced: () => void): void {
  stopEventSync();

  if (!stuckOpsReset) {
    stuckOpsReset = true;
    // Ops left SYNCING by a crash/kill are requeued once per app session.
    void serialize(() => resetStuckOperations())
      .catch((error) => logger.warn(TAG, 'Resetting stuck ops failed', error));
  }
  scheduleBatch(tourId, onBatchSynced);
  timer = setInterval(() => scheduleBatch(tourId, onBatchSynced), EVENT_OUTBOUND_POLL_INTERVAL_MS);
}

export function stopEventSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Removes a local record that never reached the server, with its queued create.
 * Runs in the serial queue so it cannot race an in-flight send.
 */
export function discardUnsyncedEventRecord(localId: string): Promise<boolean> {
  return serialize(async () => {
    const record = await getEventRecordByLocalId(localId);
    if (!record || record.syncStatus === 'SYNCED') return false;
    await dropOperation(localId);
    await deleteEventRecord(localId);
    notify();
    return true;
  });
}

function createLocalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** ISO UTC without milliseconds, matching server recordId timestamps. */
export function toRecordTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type NewEventScan = Omit<NewLocalEventActivityRecord, 'localId'>;

/** Write-local-first: stores the record and queues its create. Returns the localId. */
export async function queueEventRecord(scan: NewEventScan): Promise<string> {
  const localId = createLocalId();
  const request: CreateActivityRecordRequest = {
    activityId: scan.activityId,
    riderId: scan.riderId,
    method: scan.method,
    timestamp: scan.timestamp,
    outcome: scan.outcome === ActivityOutcome.OPTED_OUT ? ActivityOutcome.OPTED_OUT : ActivityOutcome.COMPLETED,
  };
  if (scan.outcome !== ActivityOutcome.OPTED_OUT && scan.typeCode) request.typeCode = scan.typeCode;
  if (scan.variantSelected) request.variantSelected = scan.variantSelected;

  await insertLocalEventRecord({ ...scan, localId });
  await enqueueEventRecordCreate(localId, {
    eventId: scan.eventId,
    occurrenceId: scan.occurrenceId,
    request,
  });
  notify();
  return localId;
}

/** Marks a synced record cancelled locally and queues the server cancel. Returns the op localId. */
export async function queueEventRecordCancel(
  record: LocalEventActivityRecord,
  cancelReason?: string,
): Promise<string | null> {
  if (!record.recordId) return null;
  const localId = createLocalId();
  await markEventRecordCancelled(record.localId, true);
  await enqueueEventRecordCancel(localId, {
    eventId: record.eventId,
    occurrenceId: record.occurrenceId,
    recordId: record.recordId,
    recordLocalId: record.localId,
    cancelReason: cancelReason?.trim() || undefined,
  });
  notify();
  return localId;
}
