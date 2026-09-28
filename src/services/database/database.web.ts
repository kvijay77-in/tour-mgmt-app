/**
 * Web build of database.ts (Metro picks this file for web).
 *
 * Web has no offline support and always works online (docs/Requirements.md §
 * Offline, docs/SolutionDesign.md § Offline). SQLite is therefore not bundled:
 * the stores keep the data fetched from the API in memory for the browser
 * session only (cleared on reload, on sign-out and when a different user signs in), and
 * nothing is queued on the device.
 */

import type * as SQLite from 'expo-sqlite';
import type { PurgeResult } from './database';

export type { PurgeResult } from './database';

export const USE_SESSION_MEMORY = true;

const LOCAL_DATABASE_UNAVAILABLE = 'The local database is not available on web.';

const sessionMemoryResets = new Set<() => void>();

/** Stores register how to clear their in-memory session data. */
export function registerSessionMemoryReset(reset: () => void): void {
  sessionMemoryResets.add(reset);
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  throw new Error(LOCAL_DATABASE_UNAVAILABLE);
}

export async function withWriteTransaction(
  _work: (db: SQLite.SQLiteDatabase) => Promise<void>,
): Promise<void> {
  throw new Error(LOCAL_DATABASE_UNAVAILABLE);
}

export async function vacuumDatabase(): Promise<void> {}

export async function purgeExpiredLocalData(_cutoffDate: string, _cutoffIso: string): Promise<PurgeResult> {
  return { checkIns: 0, eventRecords: 0, occurrences: 0, snapshots: 0, roomAllocations: 0, sentCheckIns: 0 };
}

export async function resetStuckOperations(): Promise<void> {}

/** Nothing is queued on web. */
export async function discardQueuedDataOwnedByOthers(_userId: string): Promise<number> {
  return 0;
}

/** Called on sign-out and when a different user signs in: drops the session data. */
export async function clearUserScopedCache(): Promise<void> {
  sessionMemoryResets.forEach((reset) => reset());
}
