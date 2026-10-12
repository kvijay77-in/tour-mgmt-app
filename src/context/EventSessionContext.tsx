/**
 * Event Session Context — shared state for event scanning.
 *
 * - Selected event / occurrence / activity (EventScanTab).
 * - This device's recent records for the selected occurrence and the failed /
 *   unsynced record counts, reloaded on sync changes.
 * - The caller's own tour assignment (my_tour_assignment cache).
 * - Owns the event bootstrap refresh triggers. Sending queued records is done
 *   by the shared outbound sync engine (see SyncStatusContext).
 *
 * Mounted in AppNavigator above the stack. See docs/Event-Engine-Design.md § State.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useOffline } from './OfflineContext';
import { useTour } from './TourContext';
import {
  EventBootstrapRefreshResult,
  refreshEventBootstrap,
} from '../services/events/eventBootstrapService';
import { subscribeEventBatchSynced, subscribeEventSync } from '../services/sync/eventSyncService';
import {
  getFailedEventRecordCount,
  getUnsyncedEventRecordCount,
} from '../services/database/eventRecordStore';
import { getMyTourAssignment } from '../services/database/eventStore';
import { TourUserAssignment } from '../types/models';
import { logger } from '../utils/logger';

const TAG = 'EventSessionContext';
const FOREGROUND_REFRESH_AFTER_MS = 5 * 60_000;

interface EventSessionContextValue {
  selectedEventId: string | null;
  selectedOccurrenceId: string | null;
  selectedActivityId: string | null;
  setSelection: (eventId: string, occurrenceId: string, activityId?: string | null) => void;
  setSelectedActivityId: (activityId: string | null) => void;
  clearSelection: () => void;
  /** Records the server rejected during background sync, all occurrences */
  failedCount: number;
  /** Records not yet sent, all occurrences */
  pendingCount: number;
  refreshRecords: () => Promise<void>;
  /** undefined = never fetched, null = no User-{tourId} record */
  myAssignment: TourUserAssignment | null | undefined;
  /** Increments whenever the bootstrap rewrote the SQLite cache */
  cacheVersion: number;
  refreshBootstrap: () => Promise<EventBootstrapRefreshResult | null>;
}

const EventSessionContext = createContext<EventSessionContextValue | undefined>(undefined);

export function EventSessionProvider({ children }: { children: React.ReactNode }) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const tourId = tour?.tourId ?? null;

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [myAssignment, setMyAssignment] = useState<TourUserAssignment | null | undefined>(undefined);
  const [cacheVersion, setCacheVersion] = useState(0);

  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const lastBootstrapAtRef = useRef<number | null>(null);
  const backgroundedAtRef = useRef<number | null>(null);

  const loadAssignment = useCallback(async () => {
    if (!tourId) {
      setMyAssignment(undefined);
      return;
    }
    try {
      const cached = await getMyTourAssignment(tourId);
      setMyAssignment(cached === undefined ? undefined : cached.assignment);
    } catch (error) {
      logger.warn(TAG, 'Reading cached tour assignment failed', error);
    }
  }, [tourId]);

  const refreshBootstrap = useCallback(async (): Promise<EventBootstrapRefreshResult | null> => {
    if (!tourId || isOfflineRef.current) return null;
    try {
      const result = await refreshEventBootstrap(tourId);
      // A failed bootstrap leaves the "first refresh" pending so reconnecting retries it.
      if (!result.error?.includes('bootstrap')) {
        lastBootstrapAtRef.current = Date.now();
      }
      if (result.updated) setCacheVersion((version) => version + 1);
      await loadAssignment();
      return result;
    } catch (error) {
      logger.warn(TAG, 'Event bootstrap refresh failed', error);
      return { updated: false, error: 'bootstrap' };
    }
  }, [tourId, loadAssignment]);

  const refreshRecords = useCallback(async () => {
    try {
      const [failed, count] = await Promise.all([
        getFailedEventRecordCount(),
        getUnsyncedEventRecordCount(),
      ]);
      setFailedCount(failed);
      setPendingCount(count);
    } catch (error) {
      logger.warn(TAG, 'Reading local event records failed', error);
    }
  }, []);

  // Tour change: reset session state and read the cached assignment.
  useEffect(() => {
    lastBootstrapAtRef.current = null;
    setSelectedEventId(null);
    setSelectedOccurrenceId(null);
    setSelectedActivityId(null);
    void loadAssignment();
  }, [loadAssignment]);

  // First bootstrap once the tour is known and the app is online.
  useEffect(() => {
    if (tourId && !isOffline && lastBootstrapAtRef.current === null) {
      void refreshBootstrap();
    }
  }, [tourId, isOffline, refreshBootstrap]);

  // Foreground after more than 5 minutes in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAtRef.current ??= Date.now();
        return;
      }
      if (state === 'active') {
        const since = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (since !== null && Date.now() - since > FOREGROUND_REFRESH_AFTER_MS) {
          void refreshBootstrap();
        }
      }
    });
    return () => subscription.remove();
  }, [refreshBootstrap]);

  // A background batch that sent event records refreshes the dashboard cache.
  useEffect(() => subscribeEventBatchSynced(() => {
    void refreshBootstrap();
  }), [refreshBootstrap]);

  useEffect(() => {
    void refreshRecords();
    return subscribeEventSync(() => {
      void refreshRecords();
    });
  }, [refreshRecords]);

  const setSelection = useCallback((eventId: string, occurrenceId: string, activityId: string | null = null) => {
    setSelectedEventId(eventId);
    setSelectedOccurrenceId(occurrenceId);
    setSelectedActivityId(activityId);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEventId(null);
    setSelectedOccurrenceId(null);
    setSelectedActivityId(null);
  }, []);

  const value = useMemo<EventSessionContextValue>(() => ({
    selectedEventId,
    selectedOccurrenceId,
    selectedActivityId,
    setSelection,
    setSelectedActivityId,
    clearSelection,
    failedCount,
    pendingCount,
    refreshRecords,
    myAssignment,
    cacheVersion,
    refreshBootstrap,
  }), [
    selectedEventId,
    selectedOccurrenceId,
    selectedActivityId,
    setSelection,
    clearSelection,
    failedCount,
    pendingCount,
    refreshRecords,
    myAssignment,
    cacheVersion,
    refreshBootstrap,
  ]);

  return <EventSessionContext.Provider value={value}>{children}</EventSessionContext.Provider>;
}

export function useEventSession(): EventSessionContextValue {
  const context = useContext(EventSessionContext);
  if (!context) throw new Error('useEventSession must be used within EventSessionProvider');
  return context;
}
