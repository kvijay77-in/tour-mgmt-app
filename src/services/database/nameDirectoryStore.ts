/**
 * Name directory store — offline copy of the rider-name and app-user-name
 * lookups used by Check-In, Log and event screens.
 */

import { getDatabase, withWriteTransaction } from './database';

/** Replace the cached rider names for a tour. */
export async function replaceRiderNames(
  tourId: string,
  entries: Array<{ riderId: string; name: string | null }>,
): Promise<void> {
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM rider_names');
    const statement = await db.prepareAsync(
      'INSERT OR REPLACE INTO rider_names (tourId, riderId, name) VALUES (?, ?, ?)',
    );
    try {
      for (const entry of entries) {
        await statement.executeAsync([tourId, entry.riderId, entry.name ?? null]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}

export async function getCachedRiderNames(tourId: string): Promise<Record<string, string | null>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ riderId: string; name: string | null }>(
    'SELECT riderId, name FROM rider_names WHERE tourId = ?',
    [tourId],
  );
  const map: Record<string, string | null> = {};
  for (const row of rows) map[row.riderId] = row.name;
  return map;
}

/** Replace the cached app-user (Cognito sub → name) lookup. */
export async function replaceAppUserNames(entries: Array<{ sub: string; name: string | null }>): Promise<void> {
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM app_user_names');
    const statement = await db.prepareAsync('INSERT OR REPLACE INTO app_user_names (sub, name) VALUES (?, ?)');
    try {
      for (const entry of entries) {
        await statement.executeAsync([entry.sub, entry.name ?? null]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}

export async function getCachedAppUserNames(): Promise<Record<string, string | null>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ sub: string; name: string | null }>('SELECT sub, name FROM app_user_names');
  const map: Record<string, string | null> = {};
  for (const row of rows) map[row.sub] = row.name;
  return map;
}
