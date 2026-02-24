/**
 * SQLite database service for offline storage.
 *
 * Provides CRUD helpers for all locally cached entities:
 *  - riders         – synced from backend (read-only in app)
 *  - rides          – synced from backend (read-only in app)
 *  - check_ins      – synced check-in records
 *  - pending_check_ins – locally created check-ins awaiting upload
 *
 * Uses expo-sqlite v16 async API.
 */

import * as SQLite from 'expo-sqlite';
import { DB_NAME, DB_INIT_STATEMENTS } from '../../config/database';
import { Rider, Ride, CheckIn, Stage, CheckInStatus } from '../../types/models';
import { CheckInRequest, PendingCheckIn } from '../../types/api';

// Singleton DB handle
let _db: SQLite.SQLiteDatabase | null = null;

// ============================================================================
// Initialisation
// ============================================================================

/**
 * Open (or reuse) the database and create all tables.
 * Call once on app startup before using any other method.
 */
export const initDatabase = async (): Promise<void> => {
  if (_db) return; // already initialised
  _db = await SQLite.openDatabaseAsync(DB_NAME);
  await _db.execAsync(DB_INIT_STATEMENTS);
};

/** Return the open DB handle (throws if not initialised). */
const getDb = (): SQLite.SQLiteDatabase => {
  if (!_db) throw new Error('Database not initialised. Call initDatabase() first.');
  return _db;
};

// ============================================================================
// Riders
// ============================================================================

/** Upsert a list of riders (replaces existing rows by primary key). */
export const saveRiders = async (riders: Rider[]): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const r of riders) {
      await db.runAsync(
        `INSERT OR REPLACE INTO riders
          (rider_id, name, email, phone, emergency_contact_name, emergency_contact_phone,
           qr_code_data, metadata, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.riderId,
          r.name,
          r.email ?? null,
          r.phone ?? null,
          r.emergencyContactName ?? null,
          r.emergencyContactPhone ?? null,
          r.qrCodeData,
          r.metadata ? JSON.stringify(r.metadata) : null,
          now,
        ]
      );
    }
  });
};

/** Return all locally cached riders. */
export const getLocalRiders = async (): Promise<Rider[]> => {
  const db = getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM riders ORDER BY rider_id');
  return rows.map(rowToRider);
};

/** Return one rider by ID, or null when not found. */
export const getLocalRiderById = async (riderId: string): Promise<Rider | null> => {
  const db = getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM riders WHERE rider_id = ?',
    [riderId]
  );
  return row ? rowToRider(row) : null;
};

// ============================================================================
// Rides
// ============================================================================

/** Upsert a ride record (stages serialised as JSON). */
export const saveRide = async (ride: Ride): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR REPLACE INTO rides
      (ride_id, date, name, start_location, finish_location, total_distance,
       stages_json, status, started_at, completed_at, closed_at, notes, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ride.rideId,
      ride.date,
      ride.name,
      ride.startLocation,
      ride.finishLocation,
      ride.totalDistance,
      JSON.stringify(ride.stages),
      ride.status,
      ride.startedAt ?? null,
      ride.completedAt ?? null,
      ride.closedAt ?? null,
      ride.notes ?? null,
      now,
    ]
  );
};

/** Return a ride for the given date, or null when not found. */
export const getLocalRideByDate = async (date: string): Promise<Ride | null> => {
  const db = getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM rides WHERE date = ?',
    [date]
  );
  return row ? rowToRide(row) : null;
};

/** Return all locally cached rides ordered by date descending. */
export const getLocalRides = async (): Promise<Ride[]> => {
  const db = getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM rides ORDER BY date DESC');
  return rows.map(rowToRide);
};

// ============================================================================
// Check-ins
// ============================================================================

/** Upsert a list of synced check-in records. */
export const saveCheckIns = async (checkIns: CheckIn[]): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const ci of checkIns) {
      await db.runAsync(
        `INSERT OR REPLACE INTO check_ins
          (check_in_id, rider_id, ride_id, stage_id, status, timestamp,
           checked_in_by, method, notes, latitude, longitude, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ci.checkInId,
          ci.riderId,
          ci.rideId,
          ci.stageId,
          ci.status,
          ci.timestamp,
          ci.checkedInBy,
          ci.method,
          ci.notes ?? null,
          ci.location?.latitude ?? null,
          ci.location?.longitude ?? null,
          now,
        ]
      );
    }
  });
};

/** Return all check-ins for a given ride (optionally filtered by riderId). */
export const getLocalCheckIns = async (rideId: string, riderId?: string): Promise<CheckIn[]> => {
  const db = getDb();
  let rows: Record<string, unknown>[];
  if (riderId) {
    rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM check_ins WHERE ride_id = ? AND rider_id = ? ORDER BY timestamp',
      [rideId, riderId]
    );
  } else {
    rows = await db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM check_ins WHERE ride_id = ? ORDER BY timestamp',
      [rideId]
    );
  }
  return rows.map(rowToCheckIn);
};

// ============================================================================
// Pending Check-ins (offline queue)
// ============================================================================

/**
 * Enqueue a locally created check-in for later upload.
 * Returns the generated local ID.
 */
export const savePendingCheckIn = async (req: CheckInRequest): Promise<string> => {
  const db = getDb();
  // Use crypto.randomUUID() when available for collision-free IDs; fallback to timestamp+random
  const uniquePart: string =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const localId = `LOCAL_${uniquePart}`;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO pending_check_ins
      (local_id, rider_id, ride_id, stage_id, status, method,
       notes, latitude, longitude, created_at, sync_status, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0)`,
    [
      localId,
      req.riderId,
      req.rideId,
      req.stageId,
      req.status,
      req.method,
      req.notes ?? null,
      req.location?.latitude ?? null,
      req.location?.longitude ?? null,
      now,
    ]
  );
  return localId;
};

/** Return all pending check-ins whose sync_status is PENDING or FAILED. */
export const getPendingCheckIns = async (): Promise<PendingCheckIn[]> => {
  const db = getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM pending_check_ins
     WHERE sync_status IN ('PENDING', 'FAILED')
     ORDER BY created_at`
  );
  return rows.map(rowToPendingCheckIn);
};

/** Mark a pending check-in as successfully synced and save the server-generated ID. */
export const markPendingCheckInSynced = async (localId: string): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    `UPDATE pending_check_ins SET sync_status = 'SYNCED' WHERE local_id = ?`,
    [localId]
  );
};

/** Update the sync status / error info for a failed attempt. */
export const markPendingCheckInFailed = async (localId: string, error: string): Promise<void> => {
  const db = getDb();
  await db.runAsync(
    `UPDATE pending_check_ins
     SET sync_status = 'FAILED', last_error = ?, retry_count = retry_count + 1
     WHERE local_id = ?`,
    [error, localId]
  );
};

/** Remove synced entries to keep the queue tidy (called after a successful batch sync). */
export const purgeSyncedPendingCheckIns = async (): Promise<void> => {
  const db = getDb();
  await db.runAsync(`DELETE FROM pending_check_ins WHERE sync_status = 'SYNCED'`);
};

// ============================================================================
// Row → Model mappers
// ============================================================================

const rowToRider = (row: Record<string, unknown>): Rider => ({
  riderId: row['rider_id'] as string,
  name: row['name'] as string,
  email: (row['email'] as string | null) ?? undefined,
  phone: (row['phone'] as string | null) ?? undefined,
  emergencyContactName: (row['emergency_contact_name'] as string | null) ?? undefined,
  emergencyContactPhone: (row['emergency_contact_phone'] as string | null) ?? undefined,
  qrCodeData: row['qr_code_data'] as string,
  metadata: row['metadata'] ? JSON.parse(row['metadata'] as string) : undefined,
});

const rowToRide = (row: Record<string, unknown>): Ride => ({
  rideId: row['ride_id'] as string,
  date: row['date'] as string,
  name: row['name'] as string,
  startLocation: row['start_location'] as string,
  finishLocation: row['finish_location'] as string,
  totalDistance: row['total_distance'] as number,
  stages: JSON.parse(row['stages_json'] as string) as Stage[],
  status: row['status'] as Ride['status'],
  startedAt: (row['started_at'] as string | null) ?? undefined,
  completedAt: (row['completed_at'] as string | null) ?? undefined,
  closedAt: (row['closed_at'] as string | null) ?? undefined,
  notes: (row['notes'] as string | null) ?? undefined,
});

const rowToCheckIn = (row: Record<string, unknown>): CheckIn => ({
  checkInId: row['check_in_id'] as string,
  riderId: row['rider_id'] as string,
  rideId: row['ride_id'] as string,
  stageId: row['stage_id'] as string,
  status: row['status'] as CheckIn['status'],
  timestamp: row['timestamp'] as string,
  checkedInBy: row['checked_in_by'] as string,
  method: row['method'] as CheckIn['method'],
  notes: (row['notes'] as string | null) ?? undefined,
  location:
    row['latitude'] != null && row['longitude'] != null
      ? { latitude: row['latitude'] as number, longitude: row['longitude'] as number }
      : undefined,
});

const rowToPendingCheckIn = (row: Record<string, unknown>): PendingCheckIn => ({
  localId: row['local_id'] as string,
  riderId: row['rider_id'] as string,
  rideId: row['ride_id'] as string,
  stageId: row['stage_id'] as string,
  status: row['status'] as CheckInStatus,
  method: row['method'] as CheckInRequest['method'],
  notes: (row['notes'] as string | null) ?? undefined,
  location:
    row['latitude'] != null && row['longitude'] != null
      ? { latitude: row['latitude'] as number, longitude: row['longitude'] as number }
      : undefined,
  createdAt: row['created_at'] as string,
  syncStatus: row['sync_status'] as PendingCheckIn['syncStatus'],
});
