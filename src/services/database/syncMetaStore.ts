/**
 * Sync metadata store — records when each readiness dataset was last
 * refreshed from the server, so the UI can show "data as of HH:MM".
 *
 * Dataset keys are built with datasetKey() (e.g. `rides:TOT-2026`).
 */

import { getDatabase } from './database';

export type ReadinessDataset =
  | 'tour'
  | 'rides'
  | 'riders'
  | 'checkins'
  | 'riderNames'
  | 'appUserNames';

/** Build a scoped dataset key (e.g. `checkins:RIDE001`). */
export function datasetKey(dataset: ReadinessDataset, scope?: string | null): string {
  return scope ? `${dataset}:${scope}` : dataset;
}

export async function setDatasetSyncedAt(key: string, syncedAt: string = new Date().toISOString()): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (dataset, lastSyncedAt) VALUES (?, ?)',
    [key, syncedAt],
  );
}

export async function getDatasetSyncedAt(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ lastSyncedAt: string }>(
    'SELECT lastSyncedAt FROM sync_meta WHERE dataset = ?',
    [key],
  );
  return row?.lastSyncedAt ?? null;
}

/**
 * Oldest refresh time across the given datasets (null if any was never synced).
 * The oldest value is what "data as of" must report.
 */
export async function getOldestSyncedAt(keys: string[]): Promise<string | null> {
  if (keys.length === 0) return null;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ dataset: string; lastSyncedAt: string }>(
    `SELECT dataset, lastSyncedAt FROM sync_meta WHERE dataset IN (${keys.map(() => '?').join(', ')})`,
    keys,
  );
  if (rows.length < keys.length) return null;
  return rows.reduce((oldest, row) => (row.lastSyncedAt < oldest ? row.lastSyncedAt : oldest), rows[0].lastSyncedAt);
}
