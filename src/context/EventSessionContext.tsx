/**
 * Event Session Context — shared state for event scanning.
 *
 * - Selected event / occurrence / activity (EventScanScreen).
 * - This device's recent records for the selected occurrence, failed records
 *   ("Sync issues") and the unsynced record count, reloaded on sync changes.
 * - The caller's own tour assignment (my_tour_assignment cache).
 * - Owns the event bootstrap refresh triggers and the event outbound sync loop
 *   (runs while a tour is loaded and the app is online).
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
import { startEventSync, stopEventSync, subscribeEventSync } from '../services/sync/eventSyncService';
import {
  getEventRecordsByOccurrence,
  getFailedEventRecords,
  getUnsyncedEventRecordCount,
  LocalEventActivityRecord,
} from '../services/database/eventRecordStore';
import { getMyTourAssignment } from '../services/database/eventStore';
import { TourUserAssignment } from '../types/models';
import { logger } from '../utils/logger';

const TAG = 'EventSessionContext';
const RECENT_RECORDS_LIMIT = 10;
const FOREGROUND_REFRESH_AFTER_MS = 5 * 60_000;

interface EventSessionContextValue {
  selectedEventId: string | null;
  selectedOccurrenceId: string | null;
  selectedActivityId: string | null;
  setSelection: (eventId: string, occurrenceId: string, activityId?: string | null) => void;
  setSelectedActivityId: (activityId: string | null) => void;
  clearSelection: () => void;
  /** This device's records for the selected occurrence, newest first */
  recentRecords: LocalEventActivityRecord[];
  /** Records the server rejected during background sync, all occurrences */
  failedRecords: LocalEventActivityRecord[];
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
  const [recentRecords, setRecentRecords] = useState<LocalEventActivityRecord[]>([]);
  const [failedRecords, setFailedRecords] = useState<LocalEventActivityRecord[]>([]);
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
      const [recent, failed, count] = await Promise.all([
        selectedOccurrenceId
          ? getEventRecordsByOccurrence(selectedOccurrenceId, RECENT_RECORDS_LIMIT)
          : Promise.resolve([] as LocalEventActivityRecord[]),
        getFailedEventRecords(),
        getUnsyncedEventRecordCount(),
      ]);
      setRecentRecords(recent);
      setFailedRecords(failed);
      setPendingCount(count);
    } catch (error) {
      logger.warn(TAG, 'Reading local event records failed', error);
    }
  }, [selectedOccurrenceId]);

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

  // Outbound event sync loop while online; a batch that synced anything refreshes the cache.
  useEffect(() => {
    if (!tourId || isOffline) {
      stopEventSync();
      return undefined;
    }
    startEventSync(tourId, () => {
      void refreshBootstrap();
    });
    return () => stopEventSync();
  }, [tourId, isOffline, refreshBootstrap]);

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
    recentRecords,
    failedRecords,
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
    recentRecords,
    failedRecords,
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
