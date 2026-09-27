/**
 * Tour store — caches the active tour so the app can start offline.
 * The full API payload is kept in payloadJson.
 */

import { getDatabase, withWriteTransaction } from './database';
import { Tour } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'TourStore';

/** Replace the cached active tour (single active tour per device). */
export async function saveActiveTour(tour: Tour): Promise<void> {
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM tour WHERE tourId != ?', [tour.tourId]);
    await db.runAsync(
      `INSERT OR REPLACE INTO tour
        (tourId, name, status, startDate, endDate, description, lastSyncedAt, payloadJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tour.tourId,
        tour.name,
        tour.status,
        tour.startDate ?? null,
        tour.endDate ?? null,
        tour.description ?? null,
        new Date().toISOString(),
        JSON.stringify(tour),
      ],
    );
  });
}

/** Remove the cached active tour (the server reported no active tour). */
export async function clearCachedActiveTour(): Promise<void> {
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM tour');
  });
}

/** The cached active tour, or null when none was cached yet. */
export async function getCachedActiveTour(): Promise<Tour | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ payloadJson: string | null }>(
    'SELECT payloadJson FROM tour ORDER BY lastSyncedAt DESC LIMIT 1',
  );
  if (!row?.payloadJson) return null;
  try {
    return JSON.parse(row.payloadJson) as Tour;
  } catch (error) {
    logger.warn(TAG, 'Cached tour payload is corrupt', error);
    return null;
  }
}
