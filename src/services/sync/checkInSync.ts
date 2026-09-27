/**
 * Ride check-in sync — write-local-first capture of ride check-ins and the
 * outbound handler that sends them via the shared sync engine
 * (outboundSyncService.ts). See docs/DataIntegrationDesign.md §4.3.
 *
 * - Offline (or when the server cannot be reached) a check-in is stored in
 *   SQLite (check_ins, isLocal=1) and queued in pending_operations with its
 *   capture time, so the backend records when it actually happened.
 * - The handler is idempotent: on a retry it first looks for the check-in on
 *   the server (an earlier attempt may have reached it before the connection
 *   dropped), and a duplicate on a retry counts as sent.
 * - Business rejections (ride closed, rider quit, …) become FAILED and are
 *   shown in Sync status for the user to review; nothing is dropped silently.
 */

import { ApiError } from '../api/apiClient';
import { createCheckIn, listCheckIns } from '../api/checkInApi';
import {
  deleteLocalCheckIn,
  insertLocalCheckIn,
  markCheckInFailed,
  markCheckInPending,
  replaceLocalWithServerCheckIn,
} from '../database/checkInStore';
import { enqueueCheckIn, PendingOperation } from '../database/pendingStore';
import { recordSentCheckIn } from '../database/sentCheckInStore';
import {
  flushFamilyNow,
  getOutboundSyncStatus,
  HandlerResult,
  notifyQueueChanged,
  registerOperationHandler,
  subscribeOutboundSync,
} from './outboundSyncService';
import { publishDashboardRefreshEvent } from '../dashboard/dashboardEvents';
import { CheckInRequest } from '../../types/api';
import { CheckIn, CheckInMethod } from '../../types/models';
import { isServerCopyOfRequest } from '../../utils/checkInValidation';
import { logger } from '../../utils/logger';

const TAG = 'CheckInSync';

const SEND_OPTIONS = { maxRetries: 0 };

/** Stage number stored on local Quit Riding rows (not tied to a stage). */
export const LOCAL_QUIT_RIDING_STAGE_NUMBER = -1;

/** Server error codes meaning the same check-in already exists. */
const DUPLICATE_CODES = new Set(['DUPLICATE_CHECKIN', 'DUPLICATE_NOT_RIDING']);

const REJECTION_MESSAGES: Record<string, string> = {
  RIDE_CLOSED: 'The ride was closed before this check-in could be sent.',
  RIDER_QUIT_RIDING: 'The rider had already quit riding.',
  RIDER_NOT_RIDING: 'The rider was marked Not Riding for this ride.',
  RIDER_NOT_IN_TOUR: 'The rider is not registered in this tour.',
};

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function createLocalCheckInId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `local-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export interface LocalCheckInCapture {
  tourId: string;
  request: CheckInRequest;
  /** Stage id for display (empty for Quit Riding) */
  stageId: string;
  /** Cognito sub of the capturing user */
  ownerUserId: string;
  /** Display name/id stored as checkedInBy until the server copy arrives */
  checkedInBy: string;
  /** Capture time; defaults to now */
  capturedAt?: Date;
}

/**
 * Store a check-in on the device and queue it for sending (write-local-first).
 * Returns the local check-in (pending sync) for immediate display.
 */
export async function captureCheckInLocally(capture: LocalCheckInCapture): Promise<CheckIn> {
  const timestamp = (capture.capturedAt ?? new Date()).toISOString();
  const request: CheckInRequest = { ...capture.request, timestamp };
  const localId = createLocalCheckInId();
  const checkIn: CheckIn = {
    checkInId: localId,
    riderId: request.riderId,
    rideId: request.rideId,
    stageNumber: request.stageNumber ?? LOCAL_QUIT_RIDING_STAGE_NUMBER,
    stageId: capture.stageId,
    timestamp,
    checkedInBy: capture.checkedInBy,
    method: request.method,
    isNotRiding: Boolean(request.isNotRiding),
    isQuitRiding: Boolean(request.isQuitRiding),
    isFloat: Boolean(request.isFloat),
    floatNo: request.floatNo,
    isManualEntry: request.method === CheckInMethod.MANUAL,
    notes: request.notes,
    localSyncStatus: 'PENDING',
  };

  await insertLocalCheckIn(checkIn, { ownerUserId: capture.ownerUserId, tourId: capture.tourId });
  try {
    await enqueueCheckIn(localId, request, capture.ownerUserId);
  } catch (error) {
    await deleteLocalCheckIn(localId).catch(() => undefined);
    throw error;
  }
  logger.info(TAG, 'Check-in saved on device', { riderId: request.riderId, stageNumber: checkIn.stageNumber });
  notifyQueueChanged(true);
  return checkIn;
}

/**
 * Send queued check-ins before an online check-in so the server receives
 * them in capture order. Resolves false when some could not be sent yet
 * (the caller should then queue the new check-in too).
 */
export function flushQueuedCheckIns(): Promise<boolean> {
  return flushFamilyNow('CHECK_IN');
}

// ---------------------------------------------------------------------------
// Outbound handler
// ---------------------------------------------------------------------------

let syncedInBackground = false;

subscribeOutboundSync(() => {
  if (!syncedInBackground || getOutboundSyncStatus().isRunning) return;
  syncedInBackground = false;
  publishDashboardRefreshEvent({ reason: 'checkins_synced' });
});

function parseRequest(op: PendingOperation): CheckInRequest | null {
  try {
    const request = JSON.parse(op.payload) as CheckInRequest;
    return request?.riderId && request.rideId ? request : null;
  } catch {
    return null;
  }
}

/** An earlier attempt may have reached the server before the connection dropped. */
async function findOnServer(tourId: string, request: CheckInRequest): Promise<CheckIn | null> {
  const existing = await listCheckIns(
    tourId,
    { rideId: request.rideId, riderId: request.riderId },
    SEND_OPTIONS,
  );
  return existing.find((checkIn) => isServerCopyOfRequest(checkIn, request)) ?? null;
}

function classifyError(error: unknown, retryCount: number): HandlerResult | null {
  if (!(error instanceof ApiError)) return null;
  const status = error.statusCode;
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) {
    return null;
  }
  const code = error.errorCode?.toUpperCase() ?? '';
  if (DUPLICATE_CODES.has(code)) {
    return retryCount > 0 ? { kind: 'synced' } : { kind: 'dropped', reason: 'duplicate', error };
  }
  if (status >= 400 && status < 500) {
    return { kind: 'rejected', message: REJECTION_MESSAGES[code] ?? error.message, error };
  }
  return null;
}

/** Log a delivered check-in for "Verify with server" (never fails the send). */
async function logSent(op: PendingOperation, tourId: string, request: CheckInRequest, serverCheckInId: string | null) {
  try {
    await recordSentCheckIn({
      localId: op.localId,
      tourId,
      rideId: request.rideId,
      riderId: request.riderId,
      request,
      serverCheckInId,
      ownerUserId: op.ownerUserId,
    });
  } catch (error) {
    logger.warn(TAG, 'Recording sent check-in failed', { localId: op.localId, error });
  }
}

async function processCheckIn(op: PendingOperation, tourId: string): Promise<HandlerResult> {
  const request = parseRequest(op);
  if (!request) return { kind: 'rejected', message: 'Corrupt queued check-in' };

  if (op.retryCount > 0 && request.timestamp) {
    const existing = await findOnServer(tourId, request);
    if (existing) {
      await replaceLocalWithServerCheckIn(op.localId, existing, tourId);
      await logSent(op, tourId, request, existing.checkInId);
      syncedInBackground = true;
      logger.info(TAG, 'Retried check-in already on server; marked synced', { localId: op.localId });
      return { kind: 'synced' };
    }
  }

  try {
    const created = await createCheckIn(tourId, request, SEND_OPTIONS);
    await replaceLocalWithServerCheckIn(op.localId, created, tourId);
    await logSent(op, tourId, request, created.checkInId);
    syncedInBackground = true;
    return { kind: 'synced' };
  } catch (error) {
    const result = classifyError(error, op.retryCount);
    if (!result) throw error;
    if (result.kind === 'synced' || result.kind === 'dropped') {
      // The server already has this check-in; the next refresh shows its copy.
      await deleteLocalCheckIn(op.localId);
      await logSent(op, tourId, request, null);
      syncedInBackground = true;
      logger.info(TAG, 'Check-in already on server; local copy removed', { localId: op.localId });
    }
    return result;
  }
}

registerOperationHandler('CHECK_IN', {
  family: 'CHECK_IN',
  process: (op, { tourId }) => processCheckIn(op, tourId),
  onFailed: (op, message) => markCheckInFailed(op.localId, message),
  onRequeued: (op) => markCheckInPending(op.localId),
  onDiscarded: (op) => deleteLocalCheckIn(op.localId),
});
