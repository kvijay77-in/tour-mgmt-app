/**
 * Event activity record store — write-local-first capture of event scans.
 * Each local record is paired with a pending_operations entry (same localId)
 * that the event sync service pushes to the backend. On web (always online,
 * nothing queued) only the records the server accepted in this browser session
 * are kept, in memory (see database.web.ts).
 */

import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY } from './database';
import { ActivityOutcome, EventRecordMethod } from '../../types/models';

export type EventRecordSyncStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface LocalEventActivityRecord {
  localId: string;
  /** Server recordId, known once synced */
  recordId: string | null;
  occurrenceId: string;
  eventId: string;
  activityId: string;
  activityName: string;
  riderId: string;
  typeCode: string | null;
  bagLabel: string | null;
  outcome: ActivityOutcome;
  variantSelected: string | null;
  method: EventRecordMethod;
  timestamp: string;
  isFlagged: boolean;
  isCancelled: boolean;
  isLocal: boolean;
  syncStatus: EventRecordSyncStatus;
  syncError: string | null;
  retryCount: number;
  createdAt: string;
}

export type NewLocalEventActivityRecord = Omit<
  LocalEventActivityRecord,
  'recordId' | 'isFlagged' | 'isCancelled' | 'isLocal' | 'syncStatus' | 'syncError' | 'retryCount' | 'createdAt'
>;

const memoryRecords = new Map<string, LocalEventActivityRecord>();
registerSessionMemoryReset(() => memoryRecords.clear());

/** Newest first, like the SQL `ORDER BY timestamp DESC`. */
function memoryRecordsWhere(match: (record: LocalEventActivityRecord) => boolean): LocalEventActivityRecord[] {
  return [...memoryRecords.values()]
    .filter(match)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function updateMemoryRecord(localId: string, patch: Partial<LocalEventActivityRecord>): void {
  const record = memoryRecords.get(localId);
  if (record) memoryRecords.set(localId, { ...record, ...patch });
}

export async function insertLocalEventRecord(record: NewLocalEventActivityRecord): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memoryRecords.set(record.localId, {
      ...record,
      recordId: null,
      isFlagged: false,
      isCancelled: false,
      isLocal: true,
      syncStatus: 'PENDING',
      syncError: null,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO event_activity_records
      (localId, occurrenceId, eventId, activityId, activityName, riderId, typeCode, bagLabel,
       outcome, variantSelected, method, timestamp, isLocal, syncStatus, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'PENDING', ?)`,
    [
      record.localId,
      record.occurrenceId,
      record.eventId,
      record.activityId,
      record.activityName,
      record.riderId,
      record.typeCode,
      record.bagLabel,
      record.outcome,
      record.variantSelected,
      record.method,
      record.timestamp,
      new Date().toISOString(),
    ],
  );
}

/** Newest first. */
export async function getEventRecordsByOccurrence(
  occurrenceId: string,
  limit?: number,
): Promise<LocalEventActivityRecord[]> {
  if (USE_SESSION_MEMORY) {
    const records = memoryRecordsWhere((record) => record.occurrenceId === occurrenceId);
    return typeof limit === 'number' ? records.slice(0, limit) : records;
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM event_activity_records
     WHERE occurrenceId = ?
     ORDER BY timestamp DESC
     ${typeof limit === 'number' ? 'LIMIT ?' : ''}`,
    typeof limit === 'number' ? [occurrenceId, limit] : [occurrenceId],
  );
  return rows.map(mapRowToRecord);
}

export async function getEventRecordByLocalId(localId: string): Promise<LocalEventActivityRecord | null> {
  if (USE_SESSION_MEMORY) return memoryRecords.get(localId) ?? null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM event_activity_records WHERE localId = ?',
    [localId],
  );
  return row ? mapRowToRecord(row) : null;
}

/** Local duplicate pre-check (this device's non-cancelled, non-failed records only). */
export async function findActiveEventRecord(
  occurrenceId: string,
  riderId: string,
  activityId: string,
): Promise<LocalEventActivityRecord | null> {
  if (USE_SESSION_MEMORY) {
    return memoryRecordsWhere((record) =>
      record.occurrenceId === occurrenceId && record.riderId === riderId && record.activityId === activityId &&
      !record.isCancelled && record.syncStatus !== 'FAILED')[0] ?? null;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM event_activity_records
     WHERE occurrenceId = ? AND riderId = ? AND activityId = ?
       AND isCancelled = 0 AND syncStatus != 'FAILED'
     LIMIT 1`,
    [occurrenceId, riderId, activityId],
  );
  return row ? mapRowToRecord(row) : null;
}

/** This device's non-cancelled, non-failed records for one rider (rider progress). */
export async function getActiveEventRecordsByRider(riderId: string): Promise<LocalEventActivityRecord[]> {
  if (USE_SESSION_MEMORY) {
    return memoryRecordsWhere((record) =>
      record.riderId === riderId && !record.isCancelled && record.syncStatus !== 'FAILED');
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM event_activity_records
     WHERE riderId = ? AND isCancelled = 0 AND syncStatus != 'FAILED'
     ORDER BY timestamp DESC`,
    [riderId],
  );
  return rows.map(mapRowToRecord);
}

export async function getUnsyncedEventRecordCount(occurrenceId?: string): Promise<number> {
  if (USE_SESSION_MEMORY) {
    return memoryRecordsWhere((record) =>
      record.syncStatus === 'PENDING' && (!occurrenceId || record.occurrenceId === occurrenceId)).length;
  }

  const db = await getDatabase();
  const row = occurrenceId
    ? await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM event_activity_records WHERE syncStatus = 'PENDING' AND occurrenceId = ?`,
        [occurrenceId],
      )
    : await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM event_activity_records WHERE syncStatus = 'PENDING'`,
      );
  return row?.count ?? 0;
}

/** Count of records the server rejected (COUNT query for banners). */
export async function getFailedEventRecordCount(): Promise<number> {
  if (USE_SESSION_MEMORY) return memoryRecordsWhere((record) => record.syncStatus === 'FAILED').length;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM event_activity_records WHERE syncStatus = 'FAILED'`,
  );
  return row?.count ?? 0;
}

/** Failed records of one occurrence, newest first, at most `limit`. */
export async function getFailedEventRecords(
  occurrenceId: string,
  limit = 50,
): Promise<LocalEventActivityRecord[]> {
  if (USE_SESSION_MEMORY) {
    return memoryRecordsWhere((record) =>
      record.syncStatus === 'FAILED' && record.occurrenceId === occurrenceId).slice(0, limit);
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM event_activity_records WHERE syncStatus = 'FAILED' AND occurrenceId = ?
     ORDER BY timestamp DESC LIMIT ?`,
    [occurrenceId, limit],
  );
  return rows.map(mapRowToRecord);
}

/** Put a failed record back to PENDING when the user retries it. */
export async function markEventRecordPending(localId: string): Promise<void> {
  if (USE_SESSION_MEMORY) {
    if (memoryRecords.get(localId)?.syncStatus === 'FAILED') {
      updateMemoryRecord(localId, { syncStatus: 'PENDING', syncError: null });
    }
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE event_activity_records SET syncStatus = 'PENDING', syncError = NULL WHERE localId = ? AND syncStatus = 'FAILED'`,
    [localId],
  );
}

export async function markEventRecordSynced(
  localId: string,
  result: { recordId: string; isFlagged: boolean },
): Promise<void> {
  if (USE_SESSION_MEMORY) {
    updateMemoryRecord(localId, {
      recordId: result.recordId,
      isFlagged: result.isFlagged,
      isLocal: false,
      syncStatus: 'SYNCED',
      syncError: null,
    });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE event_activity_records
     SET recordId = ?, isFlagged = ?, isLocal = 0, syncStatus = 'SYNCED', syncError = NULL, lastSyncedAt = ?
     WHERE localId = ?`,
    [result.recordId, result.isFlagged ? 1 : 0, new Date().toISOString(), localId],
  );
}

export async function markEventRecordFailed(localId: string, error: string): Promise<void> {
  if (USE_SESSION_MEMORY) {
    const retryCount = (memoryRecords.get(localId)?.retryCount ?? 0) + 1;
    updateMemoryRecord(localId, { syncStatus: 'FAILED', syncError: error, retryCount });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE event_activity_records
     SET syncStatus = 'FAILED', syncError = ?, retryCount = retryCount + 1
     WHERE localId = ?`,
    [error, localId],
  );
}

export async function incrementEventRecordRetry(localId: string): Promise<void> {
  if (USE_SESSION_MEMORY) {
    updateMemoryRecord(localId, { retryCount: (memoryRecords.get(localId)?.retryCount ?? 0) + 1 });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    'UPDATE event_activity_records SET retryCount = retryCount + 1 WHERE localId = ?',
    [localId],
  );
}

/** Set optimistically when a cancel is queued; reverted if the server rejects it. */
export async function markEventRecordCancelled(localId: string, isCancelled = true): Promise<void> {
  if (USE_SESSION_MEMORY) {
    updateMemoryRecord(localId, { isCancelled });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    'UPDATE event_activity_records SET isCancelled = ? WHERE localId = ?',
    [isCancelled ? 1 : 0, localId],
  );
}

/** Removes an unsynced record (its pending operation must be dropped by the caller). */
export async function deleteEventRecord(localId: string): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memoryRecords.delete(localId);
    return;
  }

  const db = await getDatabase();
  await db.runAsync('DELETE FROM event_activity_records WHERE localId = ?', [localId]);
}

function mapRowToRecord(row: Record<string, unknown>): LocalEventActivityRecord {
  return {
    localId: row.localId as string,
    recordId: (row.recordId as string | null) ?? null,
    occurrenceId: row.occurrenceId as string,
    eventId: row.eventId as string,
    activityId: row.activityId as string,
    activityName: row.activityName as string,
    riderId: row.riderId as string,
    typeCode: (row.typeCode as string | null) ?? null,
    bagLabel: (row.bagLabel as string | null) ?? null,
    outcome: row.outcome as ActivityOutcome,
    variantSelected: (row.variantSelected as string | null) ?? null,
    method: row.method as EventRecordMethod,
    timestamp: row.timestamp as string,
    isFlagged: (row.isFlagged as number) === 1,
    isCancelled: (row.isCancelled as number) === 1,
    isLocal: (row.isLocal as number) === 1,
    syncStatus: row.syncStatus as EventRecordSyncStatus,
    syncError: (row.syncError as string | null) ?? null,
    retryCount: (row.retryCount as number) ?? 0,
    createdAt: row.createdAt as string,
  };
}
