/**
 * Pending operations store — manages the queue for async backend sync.
 * 
 * Per design (§4.3): All check-ins flow through this queue, whether
 * online or offline. The sync service processes the queue independently.
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
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pending_operations
      (localId, operationType, payload, createdAt, syncStatus)
     VALUES (?, 'CHECK_IN', ?, ?, 'PENDING')`,
    [localId, JSON.stringify(checkInRequest), new Date().toISOString()],
  );
}

/**
 * Queue an event activity record create; localId matches the event_activity_records row.
 */
export async function enqueueEventRecordCreate(
  localId: string,
  payload: CreateEventRecordPayload,
): Promise<void> {
  await enqueueOperation(localId, 'CREATE_EVENT_ACTIVITY_RECORD', payload);
}

export async function enqueueEventRecordCancel(
  localId: string,
  payload: CancelEventRecordPayload,
): Promise<void> {
  await enqueueOperation(localId, 'CANCEL_EVENT_ACTIVITY_RECORD', payload);
}

async function enqueueOperation(
  localId: string,
  operationType: OperationType,
  payload: unknown,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pending_operations
      (localId, operationType, payload, createdAt, syncStatus)
     VALUES (?, ?, ?, ?, 'PENDING')`,
    [localId, operationType, JSON.stringify(payload), new Date().toISOString()],
  );
}

/**
 * Get pending operations in FIFO order (oldest first), optionally limited to some types.
 */
export async function getPendingOperations(
  operationTypes?: readonly OperationType[],
): Promise<PendingOperation[]> {
  const db = await getDatabase();
  const typeFilter = operationTypes && operationTypes.length > 0
    ? `AND operationType IN (${operationTypes.map(() => '?').join(', ')})`
    : '';
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM pending_operations
     WHERE syncStatus = 'PENDING' ${typeFilter}
     ORDER BY createdAt ASC`,
    operationTypes ? [...operationTypes] : [],
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
 * Mark an operation as failed with error details.
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
 * Record a transient failure (network/5xx) and keep the operation queued.
 */
export async function markAttemptFailed(
  localId: string,
  error: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations
     SET syncStatus = 'PENDING', syncError = ?, retryCount = retryCount + 1, lastAttemptAt = ?
     WHERE localId = ?`,
    [error, new Date().toISOString(), localId],
  );
}

/**
 * Re-queue a failed operation for retry.
 */
export async function requeueFailed(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'PENDING', syncError = NULL WHERE localId = ?`,
    [localId],
  );
}

/**
 * Get all failed operations.
 */
export async function getFailedOperations(): Promise<PendingOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM pending_operations WHERE syncStatus = 'FAILED' ORDER BY createdAt ASC`,
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
  };
}
