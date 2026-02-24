/**
 * Unified data service — the single entry-point for all data access.
 *
 * Strategy:
 *  1. When online and API is configured, fetch from AppSync and cache to SQLite.
 *  2. When offline (or API not configured), serve from the local SQLite cache.
 *  3. Check-ins are always written to the local queue first, then uploaded
 *     asynchronously by the sync service.
 *  4. During development (no API configured), falls back to mock data so the
 *     UI remains functional.
 *
 * Consumers should never import from graphqlService or databaseService directly;
 * use this module instead so the online/offline strategy is applied consistently.
 */

import { Rider, Ride, CheckIn, CheckInStatus, RiderStatus, Stage } from '../../types/models';
import { CheckInRequest } from '../../types/api';
import { isAmplifyConfigured } from '../../config/amplify';
import * as graphql from './graphqlService';
import * as db from '../database/databaseService';
import {
  getMockDashboardData,
  getMockCurrentRide,
  getMockRiders,
  getMockCheckIns,
} from './mockData';

// ============================================================================
// Internal helpers
// ============================================================================

/** True when the last API call succeeded (used as lightweight online indicator). */
let _isOnline = false;

/** Update the cached online state. */
export const setOnlineState = (online: boolean): void => {
  _isOnline = online;
};

/** Whether the service currently believes the device is online. */
export const getIsOnline = (): boolean => _isOnline;

/**
 * Determine today's date in YYYY-MM-DD format using local time.
 * This is the default ride date for the dashboard.
 */
const todayDateString = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ============================================================================
// Riders
// ============================================================================

/**
 * Fetch all riders.
 * Online: fetches from API and refreshes the local cache.
 * Offline: serves from local cache.
 * Not configured: returns mock data.
 */
export const getRiders = async (): Promise<Rider[]> => {
  if (!isAmplifyConfigured()) {
    return getMockRiders();
  }

  if (_isOnline) {
    try {
      const riders = await graphql.fetchRiders();
      await db.saveRiders(riders);
      return riders;
    } catch (err) {
      console.warn('[DataService] Failed to fetch riders from API:', err);
    }
  }

  const localRiders = await db.getLocalRiders();
  if (localRiders.length > 0) return localRiders;

  // Last resort: mock data
  return getMockRiders();
};

// ============================================================================
// Rides
// ============================================================================

/**
 * Get the current (today's) ride.
 * Online: fetches all rides, saves to cache, returns today's.
 * Offline: returns from cache.
 */
export const getCurrentRide = async (): Promise<Ride | null> => {
  const today = todayDateString();
  return getRideByDate(today);
};

/**
 * Get a ride for a specific date.
 */
export const getRideByDate = async (date: string): Promise<Ride | null> => {
  if (!isAmplifyConfigured()) {
    // Mock data: only has RIDE001 on 2026-02-01
    const mock = getMockCurrentRide();
    return mock.date === date ? mock : null;
  }

  if (_isOnline) {
    try {
      const rides = await graphql.fetchRides({ startDate: date, endDate: date });
      for (const ride of rides) await db.saveRide(ride);
      return rides.find((r) => r.date === date) ?? null;
    } catch (err) {
      console.warn('[DataService] Failed to fetch ride for date from API:', err);
    }
  }

  return db.getLocalRideByDate(date);
};

/**
 * Get all available rides (for historical dashboard).
 */
export const getHistoricalRides = async (): Promise<Ride[]> => {
  if (!isAmplifyConfigured()) {
    return [getMockCurrentRide()];
  }

  if (_isOnline) {
    try {
      const rides = await graphql.fetchRides({ status: 'COMPLETED' });
      const inProgress = await graphql.fetchRides({ status: 'IN_PROGRESS' });
      const allRides = [...inProgress, ...rides];
      for (const ride of allRides) await db.saveRide(ride);
      return allRides.sort((a, b) => b.date.localeCompare(a.date));
    } catch (err) {
      console.warn('[DataService] Failed to fetch historical rides from API:', err);
    }
  }

  return db.getLocalRides();
};

// ============================================================================
// Check-ins
// ============================================================================

/**
 * Get all check-ins for a ride.
 * Online: fetches from API and refreshes cache.
 * Offline: serves from local cache + any pending local check-ins.
 */
export const getCheckIns = async (rideId: string): Promise<CheckIn[]> => {
  if (!isAmplifyConfigured()) {
    return getMockCheckIns(rideId);
  }

  const [localSynced, pending] = await Promise.all([
    db.getLocalCheckIns(rideId),
    db.getPendingCheckIns(),
  ]);

  const pendingForRide = pending
    .filter((p) => p.rideId === rideId)
    .map((p) => ({
      checkInId: p.localId,
      riderId: p.riderId,
      rideId: p.rideId,
      stageId: p.stageId,
      status: p.status as CheckIn['status'],
      timestamp: p.createdAt,
      checkedInBy: 'local',
      method: p.method,
      notes: p.notes,
      location: p.location,
    }));

  if (_isOnline) {
    try {
      const serverCheckIns = await graphql.fetchCheckIns({ rideId });
      await db.saveCheckIns(serverCheckIns);
      // Merge server records with any pending local ones not yet synced
      const serverIds = new Set(serverCheckIns.map((ci) => ci.checkInId));
      const stillPending = pendingForRide.filter((p) => !serverIds.has(p.checkInId));
      return [...serverCheckIns, ...stillPending];
    } catch (err) {
      console.warn('[DataService] Failed to fetch check-ins from API:', err);
    }
  }

  // Offline: merge cached + pending
  const cachedIds = new Set(localSynced.map((ci) => ci.checkInId));
  const newPending = pendingForRide.filter((p) => !cachedIds.has(p.checkInId));
  return [...localSynced, ...newPending];
};

// ============================================================================
// Dashboard
// ============================================================================

/**
 * Build the full rider status list for the dashboard.
 * Falls back gracefully at each layer.
 */
export const getDashboardData = async (rideId: string, ride: Ride): Promise<RiderStatus[]> => {
  if (!isAmplifyConfigured()) {
    return getMockDashboardData();
  }

  const [riders, checkIns] = await Promise.all([
    getRiders(),
    getCheckIns(rideId),
  ]);

  return buildRiderStatuses(riders, ride, checkIns);
};

// ============================================================================
// Check-in submission (offline-first)
// ============================================================================

/**
 * Submit a check-in.
 *
 * Always enqueues to the local pending queue first, then immediately tries to
 * push to the server.  If the push succeeds, the pending entry is marked as
 * synced.  If not (no connectivity / error), the entry remains in the queue
 * and will be retried by the sync service.
 *
 * Returns a temporary CheckIn object (using the localId as the checkInId)
 * so the UI can update optimistically.
 */
export const submitCheckIn = async (
  req: CheckInRequest,
  userId: string = 'unknown'
): Promise<CheckIn> => {
  // 1. Always save to local pending queue
  const localId = await db.savePendingCheckIn(req);

  const optimisticCheckIn: CheckIn = {
    checkInId: localId,
    riderId: req.riderId,
    rideId: req.rideId,
    stageId: req.stageId,
    status: req.status as CheckIn['status'],
    timestamp: new Date().toISOString(),
    checkedInBy: userId,
    method: req.method,
    notes: req.notes,
    location: req.location,
  };

  if (!isAmplifyConfigured() || !_isOnline) {
    return optimisticCheckIn;
  }

  // 2. Try immediate upload
  try {
    const serverCheckIn = await graphql.submitCheckIn(req);
    await db.markPendingCheckInSynced(localId);
    // Also cache the server record so the dashboard picks it up immediately
    await db.saveCheckIns([serverCheckIn]);
    return serverCheckIn;
  } catch {
    // Upload failed — will be retried by sync service
    await db.markPendingCheckInFailed(localId, 'Immediate upload failed');
    return optimisticCheckIn;
  }
};

// ============================================================================
// NR / QR pre-cache (for offline pit stop crew use)
// ============================================================================

/**
 * Fetch and cache all Not Riding and Quit Riding check-ins for the given ride
 * so that pit stop crew can see them in offline mode.
 *
 * Safe to call at startup whenever online; silently no-ops if offline or
 * backend is not configured.
 */
export const preCacheSpecialStatuses = async (rideId: string): Promise<void> => {
  if (!isAmplifyConfigured() || !_isOnline) return;

  try {
    const [nrCheckIns, qrCheckIns] = await Promise.all([
      graphql.fetchCheckIns({ rideId, status: CheckInStatus.NOT_RIDING }),
      graphql.fetchCheckIns({ rideId, status: CheckInStatus.QUIT_RIDING }),
    ]);
    await db.saveCheckIns([...nrCheckIns, ...qrCheckIns]);
  } catch (err) {
    console.warn('[DataService] Failed to pre-cache special statuses:', err);
  }
};

// ============================================================================
// Builder: RiderStatus[]
// ============================================================================

/**
 * Build the dashboard RiderStatus array from the in-memory riders + check-ins.
 * This is a pure function so it can be tested independently.
 */
export const buildRiderStatuses = (
  riders: Rider[],
  ride: Ride,
  checkIns: CheckIn[]
): RiderStatus[] => {
  const checkInsByRider = new Map<string, CheckIn[]>();
  for (const ci of checkIns) {
    const list = checkInsByRider.get(ci.riderId) ?? [];
    list.push(ci);
    checkInsByRider.set(ci.riderId, list);
  }

  return riders.map((rider) => {
    const riderCheckIns = checkInsByRider.get(rider.riderId) ?? [];

    // Sort by stage number ascending to determine last stage
    const sorted = [...riderCheckIns].sort((a, b) => {
      const stageA = ride.stages.find((s) => s.stageId === a.stageId);
      const stageB = ride.stages.find((s) => s.stageId === b.stageId);
      return (stageA?.stageNumber ?? 0) - (stageB?.stageNumber ?? 0);
    });

    const lastCheckIn = sorted[sorted.length - 1] as CheckIn | undefined;

    let overallStatus: CheckInStatus = CheckInStatus.NOT_CHECKED_IN;
    let lastStage: Stage | undefined;

    if (lastCheckIn) {
      if (
        lastCheckIn.status === CheckInStatus.NOT_RIDING ||
        lastCheckIn.status === CheckInStatus.QUIT_RIDING
      ) {
        overallStatus = lastCheckIn.status;
        // Last stage = last CHECKED_IN record (where they physically reached)
        const lastCheckedIn = sorted
          .filter((ci) => ci.status === CheckInStatus.CHECKED_IN)
          .at(-1);
        lastStage = lastCheckedIn
          ? ride.stages.find((s) => s.stageId === lastCheckedIn.stageId)
          : undefined;
      } else {
        overallStatus = CheckInStatus.CHECKED_IN;
        lastStage = ride.stages.find((s) => s.stageId === lastCheckIn.stageId);
      }
    }

    return {
      rider,
      ride,
      lastCheckIn,
      overallStatus,
      lastStage,
      checkInHistory: riderCheckIns,
    };
  });
};
