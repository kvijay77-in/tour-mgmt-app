/**
 * Local data retention (DES-05).
 *
 * Deletes synced data of past rides and events older than the
 * `retentionDays` sync setting. Unsynced data is never deleted automatically —
 * it stays visible in Sync status until it is sent or the user discards it.
 *
 * Runs at most once per RUN_INTERVAL_MS (checked on app start / foreground),
 * so it adds no background work.
 */

import { Platform } from 'react-native';
import { purgeExpiredLocalData } from '../database/database';
import { getDatasetSyncedAt, setDatasetSyncedAt } from '../database/syncMetaStore';
import { getSyncSettings } from '../sync/syncSettingsService';
import { toLocalDateString } from '../../utils/dates';
import { logger } from '../../utils/logger';

const TAG = 'RetentionService';
const LAST_RUN_KEY = 'retention:lastRun';
const RUN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let running: Promise<void> | null = null;

/** Retention cut-offs for `now` and `retentionDays` (exported for tests). */
export function computeRetentionCutoff(now: Date, retentionDays: number): { cutoffDate: string; cutoffIso: string } {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  return { cutoffDate: toLocalDateString(cutoff), cutoffIso: cutoff.toISOString() };
}

/** Run the retention job if it has not run in the last RUN_INTERVAL_MS. */
export function runRetentionIfDue(now: Date = new Date()): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (running) return running;
  running = (async () => {
    try {
      const lastRun = await getDatasetSyncedAt(LAST_RUN_KEY);
      if (lastRun && now.getTime() - Date.parse(lastRun) < RUN_INTERVAL_MS) return;
      const { cutoffDate, cutoffIso } = computeRetentionCutoff(now, getSyncSettings().retentionDays);
      const result = await purgeExpiredLocalData(cutoffDate, cutoffIso);
      await setDatasetSyncedAt(LAST_RUN_KEY, now.toISOString());
      logger.info(TAG, 'Retention completed', { cutoffDate, ...result });
    } catch (error) {
      logger.warn(TAG, 'Retention failed', error);
    } finally {
      running = null;
    }
  })();
  return running;
}
