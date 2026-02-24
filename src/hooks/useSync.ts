/**
 * useSync — React hook exposing synchronisation state and controls.
 *
 * Subscribes to SyncEvents emitted by syncService and provides:
 *  - pendingCount  : number of check-ins waiting to be uploaded
 *  - isSyncing     : true while a sync cycle is in progress
 *  - lastSyncAt    : ISO timestamp of the last successful sync
 *  - syncErrors    : recent per-item sync failures
 *  - triggerSync   : function to kick off a manual sync
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { addSyncListener, startSync, SyncEvent } from '../services/sync/syncService';
import { getPendingCheckIns } from '../services/database/databaseService';
import { SyncError } from '../types/api';

interface UseSyncResult {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncAt: string | undefined;
  syncErrors: SyncError[];
  triggerSync: (rideId?: string) => void;
}

export const useSync = (rideId?: string): UseSyncResult => {
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | undefined>(undefined);
  const [syncErrors, setSyncErrors] = useState<SyncError[]>([]);
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;

  // Load initial pending count
  useEffect(() => {
    getPendingCheckIns().then((items) => setPendingCount(items.length)).catch(() => {});
  }, []);

  // Subscribe to sync events
  useEffect(() => {
    const unsubscribe = addSyncListener((event: SyncEvent) => {
      switch (event.type) {
        case 'START':
          setIsSyncing(true);
          if (event.pendingCount !== undefined) setPendingCount(event.pendingCount);
          break;

        case 'COMPLETE':
          setIsSyncing(false);
          setLastSyncAt(new Date().toISOString());
          // Re-read pending count
          getPendingCheckIns()
            .then((items) => setPendingCount(items.length))
            .catch(() => {});
          break;

        case 'ERROR':
          setIsSyncing(false);
          if (event.error) {
            setSyncErrors((prev) => [
              {
                id: `sync_err_${Date.now()}`,
                operation: 'CHECK_IN',
                data: null,
                error: event.error ?? '',
                timestamp: new Date().toISOString(),
                retryCount: 0,
              },
              ...prev.slice(0, 9), // keep last 10
            ]);
          }
          break;

        case 'PENDING_CHECKIN_SYNCED':
          setPendingCount((c) => Math.max(0, c - 1));
          break;

        case 'PENDING_CHECKIN_FAILED':
          if (event.error) {
            setSyncErrors((prev) => [
              {
                id: event.localId ?? `err_${Date.now()}`,
                operation: 'CHECK_IN',
                data: { localId: event.localId },
                error: event.error ?? '',
                timestamp: new Date().toISOString(),
                retryCount: 1,
              },
              ...prev.slice(0, 9),
            ]);
          }
          break;
      }
    });

    return unsubscribe;
  }, []);

  const triggerSync = useCallback((overrideRideId?: string) => {
    startSync(overrideRideId ?? rideIdRef.current);
  }, []);

  return { pendingCount, isSyncing, lastSyncAt, syncErrors, triggerSync };
};
