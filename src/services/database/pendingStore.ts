/**
 * Pending operations store — manages the queue for async backend sync.
 * 
 * Per design (§4.3): offline writes flow through this queue and the
 * outbound sync service drains it in FIFO order. Every operation records
 * the user who captured it (ownerUserId) so it is only sent under that
 * user's session, and a nextAttemptAt for exponential backoff.
 */

import { getDatabase } from './database';
import { CheckInRequest, CreateActivityRecordRequest } from '../../types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperationType =
  | 'CHECK_IN'
  | 'CREATE_EVENT_ACTIVITY_RECORD'
  | 'CANCEL_EVENT_ACTIVITY_RECORD';
export type PendingStatus = 'PENDING' | 'SYNCING' | 'FAILED';

export interface CreateEventRecordPayload {
  eventId: string;
  occurrenceId: string;
  request: CreateActivityRecordRequest;
}

export interface CancelEventRecordPayload {
  eventId: string;
  occurrenceId: string;
  recordId: string;
  /** localId of the event_activity_records row being cancelled */
  recordLocalId: string;
  cancelReason?: string;
}

export interface PendingOperation {
  localId: string;
  operationType: OperationType;
  payload: string;
  createdAt: string;
  syncStatus: PendingStatus;
  syncError: string | null;
  retryCount: number;
  lastAttemptAt: string | null;
  /** Earliest time the next retry may run (null = immediately) */
  nextAttemptAt: string | null;
  /** Cognito sub of the user who captured the operation (null = legacy row) */
  ownerUserId: string | null;
}

export interface OperationCounts {
  pending: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/**
 * Add a check-in operation to the pending queue.
 */
export async function enqueueCheckIn(
  localId: string,
  checkInRequest: CheckInRequest,
  ownerUserId: string | null,
): Promise<void> {
  await enqueueOperation(localId, 'CHECK_IN', checkInRequest, ownerUserId);
}

/**
 * Queue an event activity record create; localId matches the event_activity_records row.
 */
export async function enqueueEventRecordCreate(
  localId: string,
  payload: CreateEventRecordPayload,
  ownerUserId: string | null,
): Promise<void> {
  await enqueueOperation(localId, 'CREATE_EVENT_ACTIVITY_RECORD', payload, ownerUserId);
}

export async function enqueueEventRecordCancel(
  localId: string,
  payload: CancelEventRecordPayload,
  ownerUserId: string | null,
): Promise<void> {
  await enqueueOperation(localId, 'CANCEL_EVENT_ACTIVITY_RECORD', payload, ownerUserId);
}

async function enqueueOperation(
  localId: string,
  operationType: OperationType,
  payload: unknown,
  ownerUserId: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pending_operations
      (localId, operationType, payload, createdAt, syncStatus, ownerUserId)
     VALUES (?, ?, ?, ?, 'PENDING', ?)`,
    [localId, operationType, JSON.stringify(payload), new Date().toISOString(), ownerUserId],
  );
}

/**
 * Get pending operations in FIFO order (oldest first), optionally limited to
 * some types and to operations the given user may send (own + legacy rows).
 */
export async function getPendingOperations(
  operationTypes?: readonly OperationType[],
  ownerUserId?: string | null,
): Promise<PendingOperation[]> {
  const db = await getDatabase();
  const params: string[] = [];
  let filter = '';
  if (operationTypes && operationTypes.length > 0) {
    filter += ` AND operationType IN (${operationTypes.map(() => '?').join(', ')})`;
    params.push(...operationTypes);
  }
  if (ownerUserId) {
    filter += ' AND (ownerUserId IS NULL OR ownerUserId = ?)';
    params.push(ownerUserId);
  }
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM pending_operations
     WHERE syncStatus = 'PENDING'${filter}
     ORDER BY createdAt ASC, rowid ASC`,
    params,
  );
  return rows.map(mapRowToOperation);
}

export async function getPendingOperation(localId: string): Promise<PendingOperation | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM pending_operations WHERE localId = ?',
    [localId],
  );
  return row ? mapRowToOperation(row) : null;
}

/**
 * Remove an operation without syncing it (e.g. an unsynced event record cancelled locally).
 */
export async function dropOperation(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM pending_operations WHERE localId = ?', [localId]);
}

/**
 * Get count of pending operations.
 */
export async function getPendingCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT COUNT(*) as count FROM pending_operations WHERE syncStatus IN ('PENDING', 'SYNCING')`,
  );
  return (row?.count as number) ?? 0;
}

/**
 * Pending and failed counts via COUNT(*) (PERF-07), optionally per type.
 */
export async function getOperationCounts(operationTypes?: readonly OperationType[]): Promise<OperationCounts> {
  const db = await getDatabase();
  const typeFilter = operationTypes && operationTypes.length > 0
    ? `WHERE operationType IN (${operationTypes.map(() => '?').join(', ')})`
    : '';
  const rows = await db.getAllAsync<{ syncStatus: PendingStatus; n: number }>(
    `SELECT syncStatus, COUNT(*) AS n FROM pending_operations ${typeFilter} GROUP BY syncStatus`,
    operationTypes ? [...operationTypes] : [],
  );
  const counts: OperationCounts = { pending: 0, failed: 0 };
  for (const row of rows) {
    if (row.syncStatus === 'FAILED') counts.failed += row.n;
    else counts.pending += row.n;
  }
  return counts;
}

/**
 * Creation time of the oldest unsent (PENDING/SYNCING) operation, or null.
 * Used for the stale-queue alert.
 */
export async function getOldestPendingCreatedAt(): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ createdAt: string | null }>(
    `SELECT MIN(createdAt) AS createdAt FROM pending_operations WHERE syncStatus IN ('PENDING', 'SYNCING')`,
  );
  return row?.createdAt ?? null;
}

/**
 * Count queued (pending or failed) operations captured by someone other than
 * the given user. Used to block a user switch that would strand their data.
 */
export async function countOperationsOwnedByOthers(userId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM pending_operations WHERE ownerUserId IS NOT NULL AND ownerUserId != ?',
    [userId],
  );
  return row?.n ?? 0;
}

/**
 * Mark an operation as currently syncing (optimistic lock).
 */
export async function markSyncing(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'SYNCING', lastAttemptAt = ? WHERE localId = ?`,
    [new Date().toISOString(), localId],
  );
}

/**
 * Mark an operation as successfully synced and remove from queue.
 */
export async function markSynced(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM pending_operations WHERE localId = ?',
    [localId],
  );
}

/**
 * Mark an operation as permanently failed (business rejection or retries
 * exhausted). It stops blocking later operations and is shown in Sync status.
 */
export async function markFailed(
  localId: string,
  error: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations
     SET syncStatus = 'FAILED', syncError = ?, retryCount = retryCount + 1, lastAttemptAt = ?
     WHERE localId = ?`,
    [error, new Date().toISOString(), localId],
  );
}

/**
 * Record a transient failure (network/5xx) and keep the operation queued
 * until nextAttemptAt (exponential backoff).
 */
export async function markAttemptFailed(
  localId: string,
  error: string,
  nextAttemptAt: string | null = null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations
     SET syncStatus = 'PENDING', syncError = ?, retryCount = retryCount + 1, lastAttemptAt = ?, nextAttemptAt = ?
     WHERE localId = ?`,
    [error, new Date().toISOString(), nextAttemptAt, localId],
  );
}

/**
 * Re-queue a failed operation for retry.
 */
export async function requeueFailed(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'PENDING', syncError = NULL, nextAttemptAt = NULL WHERE localId = ?`,
    [localId],
  );
}

/**
 * Re-queue every failed operation and clear any backoff (manual "Retry all" /
 * "Sync now"). Returns the number of failed operations re-queued.
 */
export async function requeueAllFailed(): Promise<number> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE pending_operations SET nextAttemptAt = NULL WHERE syncStatus = 'PENDING'`);
  const result = await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'PENDING', syncError = NULL, nextAttemptAt = NULL
     WHERE syncStatus = 'FAILED'`,
  );
  return result.changes;
}

/**
 * Get failed operations (oldest first), optionally limited to some types.
 */
export async function getFailedOperations(
  operationTypes?: readonly OperationType[],
): Promise<PendingOperation[]> {
  const db = await getDatabase();
  const typeFilter = operationTypes && operationTypes.length > 0
    ? `AND operationType IN (${operationTypes.map(() => '?').join(', ')})`
    : '';
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM pending_operations WHERE syncStatus = 'FAILED' ${typeFilter} ORDER BY createdAt ASC`,
    operationTypes ? [...operationTypes] : [],
  );
  return rows.map(mapRowToOperation);
}

/**
 * All queued operations (pending + failed), oldest first, for the Sync status screen.
 */
export async function getAllQueuedOperations(limit = 200): Promise<PendingOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM pending_operations ORDER BY createdAt ASC, rowid ASC LIMIT ?',
    [limit],
  );
  return rows.map(mapRowToOperation);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapRowToOperation(row: Record<string, unknown>): PendingOperation {
  return {
    localId: row.localId as string,
    operationType: row.operationType as OperationType,
    payload: row.payload as string,
    createdAt: row.createdAt as string,
    syncStatus: row.syncStatus as PendingStatus,
    syncError: row.syncError as string | null,
    retryCount: row.retryCount as number,
    lastAttemptAt: row.lastAttemptAt as string | null,
    nextAttemptAt: (row.nextAttemptAt as string | null) ?? null,
    ownerUserId: (row.ownerUserId as string | null) ?? null,
  };
}
