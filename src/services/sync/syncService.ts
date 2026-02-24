/**
 * Background sync service.
 *
 * Responsibilities:
 *  1. Upload pending (locally created) check-ins to the backend.
 *  2. Pull the latest riders / current ride / check-ins from the backend
 *     and refresh the local SQLite cache.
 *  3. Pre-cache NR and QR check-ins for offline pit stop crew use.
 *
 * Consumers should call:
 *  - startSync()  – to trigger a full sync cycle (call when coming online)
 *  - syncPendingCheckIns() – to flush the pending queue only
 *
 * The service is intentionally stateless; sync state (pending count, last
 * sync timestamp, errors) is owned by the `useSync` hook.
 */

import * as db from '../database/databaseService';
import * as graphql from '../api/graphqlService';
import * as dataService from '../api/dataService';
import { isAmplifyConfigured } from '../../config/amplify';
import { PendingCheckIn } from '../../types/api';

// ============================================================================
// Sync listeners (for useSync hook)
// ============================================================================

type SyncListener = (event: SyncEvent) => void;

export interface SyncEvent {
  type: 'START' | 'COMPLETE' | 'ERROR' | 'PENDING_CHECKIN_SYNCED' | 'PENDING_CHECKIN_FAILED';
  pendingCount?: number;
  error?: string;
  localId?: string;
}

const _listeners: Set<SyncListener> = new Set();

export const addSyncListener = (listener: SyncListener): (() => void) => {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
};

const emit = (event: SyncEvent): void => {
  _listeners.forEach((l) => l(event));
};

// ============================================================================
// Pending check-in upload
// ============================================================================

/**
 * Upload all pending (PENDING or FAILED) check-ins to the server.
 * Each item is processed sequentially to preserve ordering.
 */
export const syncPendingCheckIns = async (): Promise<void> => {
  if (!isAmplifyConfigured()) return;

  const pending = await db.getPendingCheckIns();
  if (pending.length === 0) return;

  emit({ type: 'START', pendingCount: pending.length });

  for (const item of pending) {
    await uploadPendingCheckIn(item);
  }

  // Clean up successfully synced rows
  await db.purgeSyncedPendingCheckIns();
};

const uploadPendingCheckIn = async (item: PendingCheckIn): Promise<void> => {
  try {
    const serverCheckIn = await graphql.submitCheckIn({
      riderId: item.riderId,
      rideId: item.rideId,
      stageId: item.stageId,
      status: item.status,
      method: item.method,
      notes: item.notes,
      location: item.location,
    });
    // Cache the returned server record
    await db.saveCheckIns([serverCheckIn]);
    await db.markPendingCheckInSynced(item.localId);
    emit({ type: 'PENDING_CHECKIN_SYNCED', localId: item.localId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.markPendingCheckInFailed(item.localId, message);
    emit({ type: 'PENDING_CHECKIN_FAILED', localId: item.localId, error: message });
  }
};

// ============================================================================
// Refresh from backend
// ============================================================================

/**
 * Pull the latest data from the backend and refresh all local caches.
 * Runs best-effort — individual failures don't abort the whole cycle.
 */
export const refreshFromBackend = async (rideId?: string): Promise<void> => {
  if (!isAmplifyConfigured() || !dataService.getIsOnline()) return;

  // Refresh riders
  try {
    const riders = await graphql.fetchRiders();
    await db.saveRiders(riders);
  } catch (err) { console.warn('[Sync] Failed to refresh riders:', err); }

  // Refresh rides
  try {
    const today = new Date().toISOString().split('T')[0];
    const rides = await graphql.fetchRides({ startDate: today });
    for (const ride of rides) await db.saveRide(ride);
  } catch (err) { console.warn('[Sync] Failed to refresh rides:', err); }

  if (!rideId) return;

  // Refresh check-ins for the active ride
  try {
    const checkIns = await graphql.fetchCheckIns({ rideId });
    await db.saveCheckIns(checkIns);
  } catch (err) { console.warn('[Sync] Failed to refresh check-ins:', err); }

  // Pre-cache NR / QR so pit stop crew can see them offline
  await dataService.preCacheSpecialStatuses(rideId);
};

// ============================================================================
// Full sync cycle
// ============================================================================

/**
 * Full sync: upload pending check-ins THEN refresh caches from the server.
 * Should be called when the app comes online or periodically in background.
 */
export const startSync = async (rideId?: string): Promise<void> => {
  try {
    emit({ type: 'START' });
    await syncPendingCheckIns();
    await refreshFromBackend(rideId);
    emit({ type: 'COMPLETE' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: 'ERROR', error: message });
  }
};
