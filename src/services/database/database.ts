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
    `);
  });
}
