/**
 * SQLite database initialisation and schema management.
 * 
 * Uses expo-sqlite for local data storage.
 * Schema matches the design in docs/DataIntegrationDesign.md §4.2 and is
 * versioned through ordered migrations (see migrations.ts).
 */

import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

// ---------------------------------------------------------------------------
// Database instance
// ---------------------------------------------------------------------------

const DB_NAME = 'poc_app.db';

/** Native stores use SQLite; database.web.ts sets this for session-only memory on web. */
export const USE_SESSION_MEMORY = false;

/** Web only (see database.web.ts); stores never hold session memory on native. */
export function registerSessionMemoryReset(_reset: () => void): void {}

let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

/**
 * Get the database instance (lazy initialised, migrated once).
 * Concurrent first callers share one open/migrate promise.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = openAndMigrate().catch((error: unknown) => {
      _dbPromise = null;
      throw error;
    });
  }
  return _dbPromise;
}

let _transactionChain: Promise<unknown> = Promise.resolve();

/**
 * Run bulk writes in one transaction (PERF-03). Transactions are serialised
 * because expo-sqlite shares a single connection and cannot nest BEGIN.
 */
export function withWriteTransaction(
  work: (db: SQLite.SQLiteDatabase) => Promise<void>,
): Promise<void> {
  const run = async () => {
    const db = await getDatabase();
    await db.withTransactionAsync(() => work(db));
  };
  const next = _transactionChain.then(run, run);
  _transactionChain = next.catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Maintenance utilities
// ---------------------------------------------------------------------------

/**
 * Run VACUUM to reclaim unused space.
 * Should be called during idle time, not at startup.
 */
export async function vacuumDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('VACUUM;');
}

export interface PurgeResult {
  checkIns: number;
  eventRecords: number;
  occurrences: number;
  snapshots: number;
  roomAllocations: number;
  sentCheckIns: number;
}

/**
 * Retention (DES-05): delete synced data of past rides/events that is no
 * longer needed offline. Never touches unsynced rows or anything referenced
 * by a queued operation.
 *
 * @param cutoffDate  YYYY-MM-DD — rides/occurrences/stays before this date
 * @param cutoffIso   ISO time — records/snapshots older than this
 */
export async function purgeExpiredLocalData(cutoffDate: string, cutoffIso: string): Promise<PurgeResult> {
  const result: PurgeResult = { checkIns: 0, eventRecords: 0, occurrences: 0, snapshots: 0, roomAllocations: 0, sentCheckIns: 0 };
  await withWriteTransaction(async (db) => {
    result.checkIns = (await db.runAsync(
      `DELETE FROM check_ins
       WHERE isLocal = 0 AND syncStatus = 'SYNCED'
         AND rideId IN (SELECT rideId FROM rides WHERE date < ?)`,
      [cutoffDate],
    )).changes;
    result.eventRecords = (await db.runAsync(
      `DELETE FROM event_activity_records
       WHERE syncStatus = 'SYNCED' AND isLocal = 0 AND timestamp < ?
         AND NOT EXISTS (
           SELECT 1 FROM pending_operations p
           WHERE p.localId = event_activity_records.localId
              OR instr(p.payload, event_activity_records.localId) > 0
         )`,
      [cutoffIso],
    )).changes;
    result.occurrences = (await db.runAsync(
      `DELETE FROM event_occurrences
       WHERE date < ?
         AND NOT EXISTS (
           SELECT 1 FROM event_activity_records r WHERE r.occurrenceId = event_occurrences.occurrenceId
         )`,
      [cutoffDate],
    )).changes;
    result.snapshots = (await db.runAsync(
      'DELETE FROM event_dashboard_snapshots WHERE fetchedAt < ?',
      [cutoffIso],
    )).changes;
    result.roomAllocations = (await db.runAsync(
      'DELETE FROM room_allocations WHERE stayDate < ?',
      [cutoffDate],
    )).changes;
    result.sentCheckIns = (await db.runAsync(
      'DELETE FROM sent_check_ins WHERE sentAt < ?',
      [cutoffIso],
    )).changes;
  });
  return result;
}

/**
 * Reset any operations stuck in SYNCING state (e.g. after app crash).
 * Called at app startup.
 */
export async function resetStuckOperations(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE pending_operations SET syncStatus = 'PENDING' WHERE syncStatus = 'SYNCING'`,
  );
  await db.runAsync(
    `UPDATE check_ins SET syncStatus = 'PENDING' WHERE syncStatus = 'SYNCING'`,
  );
}

/**
 * Delete queued operations (and their unsynced local records) captured by
 * anyone other than `userId`. Only called after the signed-in user explicitly
 * confirms discarding another user's unsynced data.
 */
export async function discardQueuedDataOwnedByOthers(userId: string): Promise<number> {
  let discarded = 0;
  await withWriteTransaction(async (db) => {
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pending_operations WHERE ownerUserId IS NOT NULL AND ownerUserId != ?',
      [userId],
    );
    discarded = row?.n ?? 0;
    await db.runAsync(
      `DELETE FROM event_activity_records WHERE isLocal = 1 AND localId IN
         (SELECT localId FROM pending_operations WHERE ownerUserId IS NOT NULL AND ownerUserId != ?)`,
      [userId],
    );
    await db.runAsync(
      'DELETE FROM check_ins WHERE isLocal = 1 AND ownerUserId IS NOT NULL AND ownerUserId != ?',
      [userId],
    );
    await db.runAsync(
      'DELETE FROM pending_operations WHERE ownerUserId IS NOT NULL AND ownerUserId != ?',
      [userId],
    );
  });
  return discarded;
}

/**
 * Clear cached server data when a different user signs in on this device, so
 * the new user never sees the previous user's cached data. Unsynced local
 * records are kept (they are protected by the user-switch check).
 */
export async function clearUserScopedCache(): Promise<void> {
  await withWriteTransaction(async (db) => {
    await db.execAsync(`
      DELETE FROM check_ins WHERE isLocal = 0;
      DELETE FROM event_activity_records WHERE isLocal = 0 AND localId NOT IN (SELECT localId FROM pending_operations);
      DELETE FROM sync_meta;
      DELETE FROM rider_names;
      DELETE FROM app_user_names;
      DELETE FROM my_tour_assignment;
      DELETE FROM event_dashboard_snapshots;
      DELETE FROM notifications_inbox;
    `);
  });
}
