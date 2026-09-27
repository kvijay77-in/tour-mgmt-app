/**
 * Check-in data store — SQLite operations for check-in caching
 * and offline check-in capture.
 * 
 * Per design (§4.3): All check-ins write to SQLite first.
 * The pending_operations queue handles async push to backend.
 */

import { getDatabase, withWriteTransaction } from './database';
import type { SQLiteBindValue } from 'expo-sqlite';
import { CheckIn, CheckInMethod } from '../../types/models';

// ---------------------------------------------------------------------------
// Read operations (Dashboard reads from here)
// ---------------------------------------------------------------------------

/**
 * Get all check-ins for a ride (from local cache).
 */
export async function getCheckInsByRide(rideId: string): Promise<CheckIn[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM check_ins WHERE rideId = ? ORDER BY timestamp',
    [rideId],
  );
  return rows.map(mapRowToCheckIn);
}

/**
 * Get check-ins for a specific rider in a ride.
 */
export async function getCheckInsByRider(
  riderId: string,
  rideId: string,
): Promise<CheckIn[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM check_ins WHERE riderId = ? AND rideId = ? ORDER BY stageNumber',
    [riderId, rideId],
  );
  return rows.map(mapRowToCheckIn);
}

/**
 * Check if a check-in already exists for a rider at a specific stage.
 * Used for duplicate detection before queuing.
 */
export async function checkInExists(
  riderId: string,
  rideId: string,
  stageNumber: number,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT 1 FROM check_ins
     WHERE riderId = ? AND rideId = ? AND stageNumber = ? AND (status IS NULL OR status != 'CANCELLED')`,
    [riderId, rideId, stageNumber],
  );
  return row !== null;
}

/**
 * Check-ins captured on this device that the backend has not accepted yet
 * (PENDING / SYNCING / FAILED) for a ride.
 */
export async function getUnsyncedCheckInsByRide(rideId: string): Promise<CheckIn[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM check_ins WHERE rideId = ? AND isLocal = 1 ORDER BY timestamp',
    [rideId],
  );
  return rows.map(mapRowToCheckIn);
}

/** Count of this device's check-ins that are not yet on the backend. */
export async function countUnsyncedCheckIns(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM check_ins WHERE isLocal = 1');
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a locally captured check-in into SQLite.
 * Called for both online and offline check-ins (unified path per §4.3).
 */
export async function insertLocalCheckIn(
  checkIn: CheckIn,
  scope: { ownerUserId: string; tourId: string | null },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO check_ins
      (checkInId, riderId, rideId, stageNumber, stageId, timestamp, checkedInBy,
       method, isNotRiding, isQuitRiding, isFloat, floatNo, isManualEntry, notes, locationLat, locationLng,
       isLocal, syncStatus, createdAt, ownerUserId, tourId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, ?, ?)`,
    [
      checkIn.checkInId,
      checkIn.riderId,
      checkIn.rideId,
      checkIn.stageNumber,
      checkIn.stageId,
      checkIn.timestamp,
      checkIn.checkedInBy,
      checkIn.method,
      checkIn.isNotRiding ? 1 : 0,
      checkIn.isQuitRiding ? 1 : 0,
      checkIn.isFloat ? 1 : 0,
      checkIn.floatNo ?? null,
      checkIn.isManualEntry ? 1 : 0,
      checkIn.notes ?? null,
      checkIn.location?.latitude ?? null,
      checkIn.location?.longitude ?? null,
      new Date().toISOString(),
      scope.ownerUserId,
      scope.tourId,
    ],
  );
}

const API_UPSERT_SQL = `INSERT INTO check_ins
  (checkInId, riderId, rideId, stageNumber, stageId, timestamp, checkedInBy,
   method, isNotRiding, isQuitRiding, isFloat, floatNo, isManualEntry, notes,
   cancelledAt, cancelledBy, status, prevStatus, tourId,
   isLocal, syncStatus, lastSyncedAt)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'SYNCED', ?)
 ON CONFLICT(checkInId) DO UPDATE SET
   isNotRiding = excluded.isNotRiding,
   isQuitRiding = excluded.isQuitRiding,
   isFloat = excluded.isFloat,
   floatNo = excluded.floatNo,
   notes = excluded.notes,
   cancelledAt = excluded.cancelledAt,
   cancelledBy = excluded.cancelledBy,
   status = excluded.status,
   prevStatus = excluded.prevStatus,
   tourId = COALESCE(excluded.tourId, check_ins.tourId),
   lastSyncedAt = excluded.lastSyncedAt
 WHERE check_ins.isLocal = 0`;

function toApiParams(ci: CheckIn, tourId: string | null, now: string): SQLiteBindValue[] {
  return [
    ci.checkInId,
    ci.riderId,
    ci.rideId,
    ci.stageNumber,
    ci.stageId,
    ci.timestamp,
    ci.checkedInBy,
    ci.method,
    ci.isNotRiding ? 1 : 0,
    ci.isQuitRiding ? 1 : 0,
    ci.isFloat ? 1 : 0,
    ci.floatNo ?? null,
    ci.isManualEntry ? 1 : 0,
    ci.notes ?? null,
    ci.cancelledAt ?? null,
    ci.cancelledBy ?? null,
    ci.status ?? null,
    ci.prevStatus ?? null,
    tourId,
    now,
  ];
}

/**
 * Upsert check-ins from API response into local cache in one transaction
 * with a prepared statement (PERF-03).
 * Does NOT overwrite locally-pending check-ins (isLocal = 1).
 */
export async function upsertCheckInsFromApi(checkIns: CheckIn[], tourId?: string | null): Promise<void> {
  if (checkIns.length === 0) return;
  const now = new Date().toISOString();
  await withWriteTransaction(async (db) => {
    const statement = await db.prepareAsync(API_UPSERT_SQL);
    try {
      for (const ci of checkIns) {
        await statement.executeAsync(toApiParams(ci, tourId ?? null, now));
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}

/**
 * Replace the server copy of a ride's check-ins (keeps local unsynced rows).
 * Server rows no longer returned by the backend are removed.
 */
export async function replaceServerCheckInsForRide(
  rideId: string,
  checkIns: CheckIn[],
  tourId?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await withWriteTransaction(async (db) => {
    const statement = await db.prepareAsync(API_UPSERT_SQL);
    try {
      for (const ci of checkIns) {
        await statement.executeAsync(toApiParams(ci, tourId ?? null, now));
      }
    } finally {
      await statement.finalizeAsync();
    }
    await db.runAsync(
      'DELETE FROM check_ins WHERE rideId = ? AND isLocal = 0 AND (lastSyncedAt IS NULL OR lastSyncedAt < ?)',
      [rideId, now],
    );
  });
}

/**
 * Swap a synced local check-in for the backend record (server checkInId).
 */
export async function replaceLocalWithServerCheckIn(
  localCheckInId: string,
  serverCheckIn: CheckIn,
  tourId?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM check_ins WHERE checkInId = ? AND isLocal = 1', [localCheckInId]);
    await db.runAsync(API_UPSERT_SQL, toApiParams(serverCheckIn, tourId ?? null, now));
  });
}

/**
 * Remove a local check-in (backend rejected it online, or user discarded it).
 */
export async function deleteLocalCheckIn(localCheckInId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM check_ins WHERE checkInId = ? AND isLocal = 1', [localCheckInId]);
}

/**
 * Set a local check-in back to PENDING (e.g. user asked to retry sync).
 */
export async function markCheckInPending(checkInId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE check_ins SET syncStatus = 'PENDING', syncError = NULL WHERE checkInId = ? AND isLocal = 1`,
    [checkInId],
  );
}

/**
 * Mark a local check-in as successfully synced.
 */
export async function markCheckInSynced(checkInId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE check_ins SET isLocal = 0, syncStatus = 'SYNCED', lastSyncedAt = ? WHERE checkInId = ?`,
    [new Date().toISOString(), checkInId],
  );
}

/**
 * Mark a local check-in as failed to sync.
 */
export async function markCheckInFailed(
  checkInId: string,
  error: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE check_ins SET syncStatus = 'FAILED', syncError = ? WHERE checkInId = ?`,
    [error, checkInId],
  );
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapRowToCheckIn(row: Record<string, unknown>): CheckIn {
  const checkIn: CheckIn = {
    checkInId: row.checkInId as string,
    riderId: row.riderId as string,
    rideId: row.rideId as string,
    stageNumber: row.stageNumber as number,
    stageId: row.stageId as string,
    timestamp: row.timestamp as string,
    checkedInBy: row.checkedInBy as string,
    method: row.method as CheckInMethod,
    isNotRiding: (row.isNotRiding as number) === 1,
    isQuitRiding: (row.isQuitRiding as number) === 1,
    isFloat: !!row.isFloat,
    floatNo: (row.floatNo as number | null) ?? undefined,
    isManualEntry: (row.isManualEntry as number) === 1,
    notes: (row.notes as string | null) ?? undefined,
    cancelledAt: (row.cancelledAt as string | null) ?? undefined,
    cancelledBy: (row.cancelledBy as string | null) ?? undefined,
    status: (row.status as string | null) ?? undefined,
    prevStatus: (row.prevStatus as string | null) ?? undefined,
    createdAt: (row.createdAt as string | null) ?? undefined,
  };

  if ((row.isLocal as number) === 1) {
    checkIn.localSyncStatus = row.syncStatus === 'FAILED' ? 'FAILED' : 'PENDING';
  }

  if (row.locationLat != null && row.locationLng != null) {
    checkIn.location = {
      latitude: row.locationLat as number,
      longitude: row.locationLng as number,
    };
  }

  return checkIn;
}
