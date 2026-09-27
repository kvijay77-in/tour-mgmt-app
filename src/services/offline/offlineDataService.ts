/**
 * Offline data service — cache-through loaders for the data a user needs to
 * keep working when connectivity drops (offline readiness).
 *
 * Each loader fetches from the API when online and writes the result to
 * SQLite (with a sync_meta timestamp). On a connectivity failure — or while
 * the app is offline — it returns the cached copy instead, so switching to
 * offline mode never needs an explicit download.
 *
 * Mobile only: on web (admin use) loaders simply call the API.
 */

import { Platform } from 'react-native';
import { getActiveTour } from '../api/tourApi';
import { listRides } from '../api/rideApi';
import { getRideRiderDetails, listRiders } from '../api/riderApi';
import { getDashboardProgress } from '../api/dashboardApi';
import { listCognitoUserNames, listTourRiderNames } from '../api/nameDirectoryApi';
import { isApiOfflineMode, isNetworkError } from '../api/apiClient';
import { clearCachedActiveTour, getCachedActiveTour, saveActiveTour } from '../database/tourStore';
import { getRidesByTour, replaceRidesForTour } from '../database/rideStore';
import { getRiderById, getRidersByTour, upsertRiders } from '../database/riderStore';
import {
  getCheckInsByRide,
  getCheckInsByRider,
  getUnsyncedCheckInsByRide,
  replaceServerCheckInsForRide,
} from '../database/checkInStore';
import {
  getCachedAppUserNames,
  getCachedRiderNames,
  replaceAppUserNames,
  replaceRiderNames,
} from '../database/nameDirectoryStore';
import { replaceRiderPersonalCodes } from '../database/riderPersonalCodeStore';
import { datasetKey, getDatasetSyncedAt, getOldestSyncedAt, setDatasetSyncedAt } from '../database/syncMetaStore';
import { CheckIn, DashboardProgressData, Ride, Rider, RiderDetailsData, Tour } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'OfflineData';

/** Offline caching is a mobile capability. */
export const OFFLINE_CACHE_ENABLED = Platform.OS !== 'web';

export interface LoadResult<T> {
  data: T;
  /** True when the data came from the device cache (server unreachable) */
  fromCache: boolean;
  /** When the cached copy was last refreshed from the server */
  syncedAt: string | null;
}

// ---------------------------------------------------------------------------
// Change notifications (readiness indicator)
// ---------------------------------------------------------------------------

const updateListeners = new Set<() => void>();

/** Notified after any offline dataset was refreshed from the server. */
export function subscribeOfflineDataUpdated(listener: () => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function notifyUpdated(): void {
  updateListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      logger.warn(TAG, 'Offline data listener failed', error);
    }
  });
}

// ---------------------------------------------------------------------------
// Generic cache-through helper
// ---------------------------------------------------------------------------

async function cacheThrough<T>(params: {
  key: string;
  fetchRemote: () => Promise<T>;
  writeCache: (data: T) => Promise<void>;
  readCache: () => Promise<T | null>;
}): Promise<LoadResult<T>> {
  const { key, fetchRemote, writeCache, readCache } = params;
  if (!OFFLINE_CACHE_ENABLED) {
    return { data: await fetchRemote(), fromCache: false, syncedAt: null };
  }

  if (!isApiOfflineMode()) {
    try {
      const data = await fetchRemote();
      const syncedAt = new Date().toISOString();
      try {
        await writeCache(data);
        await setDatasetSyncedAt(key, syncedAt);
        notifyUpdated();
      } catch (cacheError) {
        logger.warn(TAG, `Failed to cache ${key}`, cacheError);
      }
      return { data, fromCache: false, syncedAt };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      logger.info(TAG, `Server unreachable — using cached ${key}`);
    }
  }

  const cached = await readCache().catch((cacheError: unknown) => {
    logger.warn(TAG, `Failed to read cached ${key}`, cacheError);
    return null;
  });
  const syncedAt = await getDatasetSyncedAt(key).catch(() => null);
  if (cached === null || !syncedAt) {
    throw new OfflineDataUnavailableError(key);
  }
  return { data: cached, fromCache: true, syncedAt };
}

/** Thrown when offline and the device has no cached copy of a dataset. */
export class OfflineDataUnavailableError extends Error {
  constructor(public readonly dataset: string) {
    super('This data has not been downloaded to this device yet. Connect to the internet once to use it offline.');
    this.name = 'OfflineDataUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export function loadActiveTour(): Promise<LoadResult<Tour | null>> {
  return cacheThrough<Tour | null>({
    key: datasetKey('tour'),
    fetchRemote: getActiveTour,
    writeCache: async (tour) => {
      if (tour) await saveActiveTour(tour);
      else await clearCachedActiveTour();
    },
    readCache: async () => (await getCachedActiveTour()) ?? null,
  });
}

export function loadRides(tourId: string): Promise<LoadResult<Ride[]>> {
  return cacheThrough<Ride[]>({
    key: datasetKey('rides', tourId),
    fetchRemote: () => listRides(tourId),
    writeCache: (rides) => replaceRidesForTour(tourId, rides),
    readCache: () => getRidesByTour(tourId),
  });
}

export function loadRiders(tourId: string): Promise<LoadResult<Rider[]>> {
  return cacheThrough<Rider[]>({
    key: datasetKey('riders', tourId),
    fetchRemote: () => listRiders(tourId),
    writeCache: (riders) => upsertRiders(riders, tourId),
    readCache: () => getRidersByTour(tourId),
  });
}

function checkInMatchKey(checkIn: CheckIn): string {
  return [
    checkIn.riderId,
    String(checkIn.stageNumber),
    checkIn.isNotRiding ? 'NR' : '',
    checkIn.isQuitRiding ? 'QR' : '',
    checkIn.timestamp,
  ].join('|');
}

/**
 * Add this device's unsynced check-ins to a server result so the dashboard
 * and log reflect what was captured offline.
 */
export async function mergeUnsyncedCheckIns(rideId: string, serverCheckIns: CheckIn[]): Promise<CheckIn[]> {
  if (!OFFLINE_CACHE_ENABLED) return serverCheckIns;
  const local = await getUnsyncedCheckInsByRide(rideId).catch(() => [] as CheckIn[]);
  if (local.length === 0) return serverCheckIns;
  const seen = new Set(serverCheckIns.map(checkInMatchKey));
  return [...serverCheckIns, ...local.filter((checkIn) => !seen.has(checkInMatchKey(checkIn)))];
}

function isCancelled(checkIn: CheckIn): boolean {
  return (checkIn.status ?? '').toUpperCase() === 'CANCELLED';
}

/**
 * Rider card details for a ride. Online: from the API (not cached — it is
 * derived data). Offline or unreachable: rebuilt from the cached rider and
 * the ride's cached check-ins (including unsynced local ones).
 */
export async function loadRideRiderDetails(
  tourId: string,
  rideId: string,
  riderId: string,
): Promise<LoadResult<RiderDetailsData | null>> {
  if (!OFFLINE_CACHE_ENABLED) {
    return { data: await getRideRiderDetails(tourId, rideId, riderId), fromCache: false, syncedAt: null };
  }
  if (!isApiOfflineMode()) {
    try {
      return { data: await getRideRiderDetails(tourId, rideId, riderId), fromCache: false, syncedAt: null };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      logger.info(TAG, 'Server unreachable — using cached rider details');
    }
  }
  const rider = await getRiderById(riderId);
  const syncedAt = await getDatasetSyncedAt(datasetKey('checkins', rideId)).catch(() => null);
  if (!rider || !syncedAt) throw new OfflineDataUnavailableError(datasetKey('riders', tourId));
  const timeline = (await getCheckInsByRider(riderId, rideId)).filter((checkIn) => !isCancelled(checkIn));
  return { data: { rider, checkInTimeline: timeline }, fromCache: true, syncedAt };
}

/**
 * Dashboard progress for a ride. Online: server result (cached for offline).
 * Offline: rebuilt from cached check-ins. Both include unsynced local check-ins.
 */
export async function loadDashboardProgress(
  tourId: string,
  rideId: string,
): Promise<LoadResult<DashboardProgressData | null>> {
  const result = await cacheThrough<DashboardProgressData | null>({
    key: datasetKey('checkins', rideId),
    fetchRemote: async () => (await getDashboardProgress(tourId, rideId)).data,
    writeCache: async (data) => {
      if (!data) return;
      const cancelled = (Array.isArray(data.cancelled) ? data.cancelled : []).map((checkIn) => ({
        ...checkIn,
        status: checkIn.status ?? 'CANCELLED',
      }));
      await replaceServerCheckInsForRide(rideId, [...(data.checkIns ?? []), ...cancelled], tourId);
    },
    readCache: async () => {
      const rows = await getCheckInsByRide(rideId);
      const server = rows.filter((checkIn) => !checkIn.localSyncStatus);
      return {
        rideId,
        checkIns: server.filter((checkIn) => !isCancelled(checkIn)),
        cancelled: server.filter(isCancelled),
        summary: { totalRiders: 0, checkedIn: 0, notRiding: 0, quitRiding: 0, notCheckedIn: 0 },
      };
    },
  });

  if (!result.data) return result;
  const checkIns = await mergeUnsyncedCheckIns(rideId, Array.isArray(result.data.checkIns) ? result.data.checkIns : []);
  return { ...result, data: { ...result.data, checkIns } };
}

export async function loadRiderNames(tourId: string): Promise<LoadResult<Record<string, string | null>>> {
  return cacheThrough<Record<string, string | null>>({
    key: datasetKey('riderNames', tourId),
    fetchRemote: async () => {
      const entries = await listTourRiderNames(tourId);
      const personalCodeEntries = entries
        .filter((entry): entry is typeof entry & { personalCode: string } => Boolean(entry.personalCode))
        .map((entry) => ({ personalCode: entry.personalCode, riderId: entry.riderId }));
      await replaceRiderPersonalCodes(tourId, personalCodeEntries);
      const map: Record<string, string | null> = {};
      for (const entry of entries) map[entry.riderId] = entry.name;
      return map;
    },
    writeCache: (map) =>
      replaceRiderNames(tourId, Object.entries(map).map(([riderId, name]) => ({ riderId, name }))),
    readCache: () => getCachedRiderNames(tourId),
  });
}

export async function loadAppUserNames(): Promise<LoadResult<Record<string, string | null>>> {
  return cacheThrough<Record<string, string | null>>({
    key: datasetKey('appUserNames'),
    fetchRemote: async () => {
      const entries = await listCognitoUserNames();
      const map: Record<string, string | null> = {};
      for (const entry of entries) map[entry.sub] = entry.name;
      return map;
    },
    writeCache: (map) => replaceAppUserNames(Object.entries(map).map(([sub, name]) => ({ sub, name }))),
    readCache: () => getCachedAppUserNames(),
  });
}

// ---------------------------------------------------------------------------
// Readiness status
// ---------------------------------------------------------------------------

/**
 * Oldest refresh time of the datasets needed for ride check-in offline
 * (null when any has never been downloaded).
 */
export function getRideReadinessSyncedAt(tourId: string, rideId: string | null): Promise<string | null> {
  const keys = [datasetKey('tour'), datasetKey('rides', tourId), datasetKey('riders', tourId)];
  if (rideId) keys.push(datasetKey('checkins', rideId));
  return getOldestSyncedAt(keys);
}

/**
 * Refresh the ride readiness caches directly (used by the periodic readiness
 * refresh when no dashboard is mounted). Errors are logged, never thrown.
 */
export async function refreshRideReadiness(tourId: string, rideId: string | null): Promise<void> {
  if (!OFFLINE_CACHE_ENABLED || isApiOfflineMode()) return;
  const tasks: Array<Promise<unknown>> = [loadRides(tourId), loadRiders(tourId)];
  if (rideId) tasks.push(loadDashboardProgress(tourId, rideId));
  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === 'rejected') logger.warn(TAG, 'Readiness refresh failed', result.reason);
  });
}
