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
