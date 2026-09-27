/**
 * Event sync — outbound handlers for event operations (activity record
 * create/cancel) on the shared outbound sync engine (outboundSyncService.ts),
 * plus the write-local-first queue helpers used by EventScanScreen.
 *
 * - Interactive "send now" (scan/cancel while online) goes through the engine
 *   queue, which first flushes older queued event operations so the server
 *   sees them in scan order.
 * - Transient failures (network, timeout, 401, 5xx, malformed) keep the op
 *   queued with backoff; the engine moves repeated server failures to FAILED.
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
  enqueueEventRecordCancel,
  enqueueEventRecordCreate,
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
  markEventRecordPending,
  markEventRecordSynced,
  NewLocalEventActivityRecord,
} from '../database/eventRecordStore';
import {
  discardOperation,
  getOutboundSyncStatus,
  HandlerResult,
  notifyQueueChanged,
  OperationResult,
  registerOperationHandler,
  sendOperationNow,
  subscribeOutboundSync,
} from './outboundSyncService';
import { CreateActivityRecordRequest } from '../../types/api';
import { ActivityOutcome } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'EventSync';

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
// Change notifications
// ---------------------------------------------------------------------------

/** Notified whenever queued data or the sync status changes (all operation types). */
export function subscribeEventSync(listener: () => void): () => void {
  return subscribeOutboundSync(listener);
}

type BatchListener = () => void;
const batchListeners = new Set<BatchListener>();
let syncedInBackground = false;

/**
 * Notified once after a background batch sent at least one event operation
 * (EventSessionContext then refreshes the dashboard cache).
 */
export function subscribeEventBatchSynced(listener: BatchListener): () => void {
  batchListeners.add(listener);
  return () => {
    batchListeners.delete(listener);
  };
}

subscribeOutboundSync(() => {
  if (!syncedInBackground || getOutboundSyncStatus().isRunning) return;
  syncedInBackground = false;
  batchListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.warn(TAG, 'Batch listener failed', error);
    }
  });
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function parsePayload<T>(op: PendingOperation): T | null {
  try {
    return JSON.parse(op.payload) as T;
  } catch {
    return null;
  }
}

async function processCreate(op: PendingOperation, tourId: string, interactive: boolean): Promise<HandlerResult> {
  const payload = parsePayload<CreateEventRecordPayload>(op);
  if (!payload) {
    return { kind: 'rejected', message: 'Corrupt queued payload' };
  }

  const outcome = await createActivityRecord(
    tourId,
    payload.eventId,
    payload.occurrenceId,
    payload.request,
    SEND_OPTIONS,
  );

  if (outcome.kind === 'success') {
    const isFlagged = Boolean(outcome.data.isFlagged);
    await markEventRecordSynced(op.localId, { recordId: outcome.data.recordId, isFlagged });
    if (!interactive) syncedInBackground = true;
    return { kind: 'synced', detail: { isFlagged } };
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
      logger.info(TAG, 'Retried record already on server; marked synced', { localId: op.localId });
      if (!interactive) syncedInBackground = true;
      return { kind: 'synced', detail: { isFlagged: false } };
    }
    await deleteEventRecord(op.localId);
    return { kind: 'dropped', reason: 'duplicate', error };
  }

  logger.info(TAG, 'Event record rejected', { code: error.code, interactive });
  if (interactive) {
    // The scanner sees the message immediately; nothing is kept for later review.
    await deleteEventRecord(op.localId);
    return { kind: 'dropped', reason: 'rejected', error };
  }
  return { kind: 'rejected', message: error.message, error };
}

async function processCancel(op: PendingOperation, tourId: string): Promise<HandlerResult> {
  const payload = parsePayload<CancelEventRecordPayload>(op);
  if (!payload) {
    logger.warn(TAG, 'Dropping cancel op with corrupt payload', { localId: op.localId });
    return { kind: 'dropped', reason: 'invalid' };
  }

  const outcome = await cancelActivityRecord(
    tourId,
    payload.eventId,
    payload.occurrenceId,
    payload.recordId,
    payload.cancelReason ? { cancelReason: payload.cancelReason } : {},
    SEND_OPTIONS,
  );

  if (outcome.kind === 'success' || outcome.error.code === 'RECORD_ALREADY_CANCELLED') {
    await markEventRecordCancelled(payload.recordLocalId, true);
    return { kind: 'synced', detail: { isFlagged: false } };
  }

  logger.warn(TAG, 'Cancel rejected; record restored', {
    code: outcome.error.code,
    recordLocalId: payload.recordLocalId,
  });
  await markEventRecordCancelled(payload.recordLocalId, false);
  return { kind: 'dropped', reason: 'rejected', error: outcome.error };
}

registerOperationHandler('CREATE_EVENT_ACTIVITY_RECORD', {
  family: 'EVENT',
  process: (op, { tourId, interactive }) => processCreate(op, tourId, interactive),
  onFailed: (op, message) => markEventRecordFailed(op.localId, message),
  onRetryScheduled: (op) => incrementEventRecordRetry(op.localId),
  onRequeued: (op) => markEventRecordPending(op.localId),
  onDiscarded: (op) => deleteEventRecord(op.localId),
});

registerOperationHandler('CANCEL_EVENT_ACTIVITY_RECORD', {
  family: 'EVENT',
  process: (op, { tourId }) => processCancel(op, tourId),
  onFailed: async (op) => {
    // A cancel that cannot be sent is not kept: restore the record.
    const payload = parsePayload<CancelEventRecordPayload>(op);
    if (payload) await markEventRecordCancelled(payload.recordLocalId, false);
  },
  onRequeued: async (op) => {
    const payload = parsePayload<CancelEventRecordPayload>(op);
    if (payload) await markEventRecordCancelled(payload.recordLocalId, true);
  },
  onDiscarded: async (op) => {
    const payload = parsePayload<CancelEventRecordPayload>(op);
    if (payload) await markEventRecordCancelled(payload.recordLocalId, false);
  },
});

// ---------------------------------------------------------------------------
// Interactive entry point
// ---------------------------------------------------------------------------

function toEventResult(result: OperationResult): EventOperationResult {
  switch (result.kind) {
    case 'synced': {
      const detail = result.detail as { isFlagged?: boolean } | undefined;
      return { status: 'synced', isFlagged: Boolean(detail?.isFlagged) };
    }
    case 'dropped':
    case 'rejected': {
      const error = result.error as EventApiError | undefined;
      if (!error) return { status: 'skipped' };
      return result.kind === 'dropped' && result.reason === 'duplicate'
        ? { status: 'duplicate', error }
        : { status: 'rejected', error };
    }
    case 'transient':
      return { status: 'queued', reason: result.reason };
    case 'queued':
      return { status: 'queued', reason: result.reason };
    default:
      return { status: 'skipped' };
  }
}

/**
 * Send one queued operation now (scan/cancel while online). Older queued event
 * operations are sent first so the server sees them in order.
 */
export async function processEventOperationNow(localId: string): Promise<EventOperationResult> {
  return toEventResult(await sendOperationNow(localId));
}

/**
 * Removes a local record that never reached the server, with its queued create.
 * Runs in the outbound queue so it cannot race an in-flight send.
 */
export async function discardUnsyncedEventRecord(localId: string): Promise<boolean> {
  const record = await getEventRecordByLocalId(localId);
  if (!record || record.syncStatus === 'SYNCED') return false;
  const removed = await discardOperation(localId);
  if (!removed) {
    // Record without a queued op (should not happen): remove it anyway.
    const latest = await getEventRecordByLocalId(localId);
    if (!latest || latest.syncStatus === 'SYNCED') return false;
    await deleteEventRecord(localId);
    notifyQueueChanged();
  }
  return true;
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

/**
 * Write-local-first: stores the record and queues its create. Returns the localId.
 * @param ownerUserId Cognito sub of the scanning user (only they can send it)
 */
export async function queueEventRecord(scan: NewEventScan, ownerUserId: string | null): Promise<string> {
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
  }, ownerUserId);
  notifyQueueChanged();
  return localId;
}

/** Marks a synced record cancelled locally and queues the server cancel. Returns the op localId. */
export async function queueEventRecordCancel(
  record: LocalEventActivityRecord,
  ownerUserId: string | null,
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
  }, ownerUserId);
  notifyQueueChanged();
  return localId;
}
