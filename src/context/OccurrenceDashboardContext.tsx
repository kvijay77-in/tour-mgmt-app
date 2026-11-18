/**
 * Screen-scoped state for the event occurrence dashboard: loads the dashboard
 * (or an offline snapshot), polls progress while the occurrence is ACTIVE,
 * overlays this device's unsynced scans as QUEUED, and holds the activity
 * filter and sort shared by the dashboard tabs.
 *
 * See docs/design/events.md.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { EVENT_DASHBOARD_MESSAGES, EventMessageKind } from '../constants/eventMessages';
import {
  describeUnexpectedEventError,
  EventApiError,
  getEvent,
  getOccurrence,
} from '../services/api/eventsApi';
import { getEventById, getOccurrenceById } from '../services/database/eventStore';
import { getEventRecordsByOccurrence, LocalEventActivityRecord } from '../services/database/eventRecordStore';
import {
  fetchOccurrenceDashboard,
  fetchOccurrenceProgress,
  fetchOccurrenceReconciliation,
  readOccurrenceSnapshot,
} from '../services/events/eventDashboardService';
import { subscribeEventSync } from '../services/sync/eventSyncService';
import {
  EventDashboardSummary,
  OccurrenceDashboardResponse,
  ReconciliationResponse,
} from '../types/api';
import { EventDefinition, EventOccurrence, OccurrenceStatus, Permission } from '../types/models';
import {
  applyLocalQueued,
  DashboardActivity,
  deriveRiderStatuses,
  getDashboardActivities,
  RiderStatusMap,
} from '../utils/eventProgress';
import { logger } from '../utils/logger';
import { hasPermission } from '../utils/permissions';
import { useAuth } from './AuthContext';
import { useOffline } from './OfflineContext';

const TAG = 'OccurrenceDashboardContext';
const PROGRESS_POLL_INTERVAL_MS = 15_000;
const PROGRESS_REFRESH_DEBOUNCE_MS = 1_000;

export type DashboardBanner = { kind: EventMessageKind; message: string };

export interface OccurrenceDashboardContextValue {
  tourId: string | undefined;
  eventId: string;
  occurrenceId: string;
  canViewDashboard: boolean;
  dashboard: OccurrenceDashboardResponse | null;
  event: EventDefinition | null;
  occurrence: EventOccurrence | null;
  summary: EventDashboardSummary | null;
  activities: DashboardActivity[];
  /** riderId → activityId → status, including the QUEUED overlay */
  riderStatuses: RiderStatusMap;
  localRecords: LocalEventActivityRecord[];
  reconciliation: ReconciliationResponse | null;
  reconciliationError: EventApiError | null;
  staleAt: string | null;
  unavailable: string | null;
  notFound: boolean;
  banner: DashboardBanner | null;
  isLoading: boolean;
  isRefreshing: boolean;
  reload: () => Promise<void>;
  refreshProgressSoon: () => void;
  activityFilter: string | null;
  setActivityFilter: (activityId: string | null) => void;
  isSorted: boolean;
  toggleSort: () => void;
}

const OccurrenceDashboardContext = createContext<OccurrenceDashboardContextValue | undefined>(undefined);

interface ProviderProps {
  tourId: string | undefined;
  eventId: string;
  occurrenceId: string;
  children: React.ReactNode;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function OccurrenceDashboardProvider({ tourId, eventId, occurrenceId, children }: ProviderProps) {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const isFocused = useIsFocused();
  const canViewDashboard = user ? hasPermission(user.userRole, Permission.VIEW_DASHBOARD) : false;

  const [dashboard, setDashboard] = useState<OccurrenceDashboardResponse | null>(null);
  const [basicEvent, setBasicEvent] = useState<EventDefinition | null>(null);
  const [basicOccurrence, setBasicOccurrence] = useState<EventOccurrence | null>(null);
  const [localRecords, setLocalRecords] = useState<LocalEventActivityRecord[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [reconciliationError, setReconciliationError] = useState<EventApiError | null>(null);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<DashboardBanner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rawActivityFilter, setActivityFilter] = useState<string | null>(null);
  const [isSorted, setIsSorted] = useState(false);

  const requestId = useRef(0);
  const pollingRef = useRef(false);
  const dashboardRef = useRef<OccurrenceDashboardResponse | null>(null);
  dashboardRef.current = dashboard;

  const event = dashboard?.event ?? basicEvent;
  const occurrence = dashboard?.occurrence ?? basicOccurrence;
  const summary = dashboard?.summary ?? null;

  const refreshLocalRecords = useCallback(async () => {
    try {
      setLocalRecords(await getEventRecordsByOccurrence(occurrenceId));
    } catch (error) {
      logger.warn(TAG, 'Reading local event records failed', error);
    }
  }, [occurrenceId]);

  useEffect(() => {
    void refreshLocalRecords();
    return subscribeEventSync(() => void refreshLocalRecords());
  }, [refreshLocalRecords]);

  const refreshReconciliation = useCallback(async (target: EventOccurrence) => {
    if (!tourId) return;
    if (!target.linkedOccurrenceRef) {
      setReconciliation(null);
      setReconciliationError(null);
      return;
    }
    const outcome = await fetchOccurrenceReconciliation(tourId, eventId, occurrenceId);
    if (outcome.kind === 'success') {
      setReconciliation(outcome.data);
      setReconciliationError(null);
    } else {
      setReconciliation(null);
      setReconciliationError(outcome.error);
    }
  }, [tourId, eventId, occurrenceId]);

  const loadFromSnapshot = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false;
    const stored = await readOccurrenceSnapshot(tourId, occurrenceId);
    if (!stored?.snapshot.dashboard) return false;
    setDashboard(stored.snapshot.dashboard);
    setReconciliation(stored.snapshot.reconciliation);
    setReconciliationError(null);
    setStaleAt(stored.fetchedAt);
    setUnavailable(null);
    return true;
  }, [tourId, occurrenceId]);

  const loadBasicOffline = useCallback(async (): Promise<boolean> => {
    const [cachedEvent, cachedOccurrence] = await Promise.all([getEventById(eventId), getOccurrenceById(occurrenceId)]);
    setBasicEvent(cachedEvent);
    setBasicOccurrence(cachedOccurrence);
    return Boolean(cachedEvent && cachedOccurrence);
  }, [eventId, occurrenceId]);

  const loadBasicOnline = useCallback(async (current: number): Promise<void> => {
    if (!tourId) return;
    const [eventOutcome, occurrenceOutcome] = await Promise.all([
      getEvent(tourId, eventId),
      getOccurrence(tourId, eventId, occurrenceId),
    ]);
    if (current !== requestId.current) return;
    if (occurrenceOutcome.kind === 'error' && occurrenceOutcome.error.status === 404) {
      setNotFound(true);
      return;
    }
    if (eventOutcome.kind === 'success' && occurrenceOutcome.kind === 'success') {
      setBasicEvent(eventOutcome.data);
      setBasicOccurrence(occurrenceOutcome.data);
      return;
    }
    if (!(await loadBasicOffline())) setUnavailable(EVENT_DASHBOARD_MESSAGES.NOT_SAVED_OFFLINE);
  }, [tourId, eventId, occurrenceId, loadBasicOffline]);

  const load = useCallback(async (refreshing: boolean) => {
    if (!tourId) {
      setIsLoading(false);
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    if (refreshing) setIsRefreshing(true);
    setBanner(null);
    try {
      if (!canViewDashboard) {
        if (isOffline) {
          if (!(await loadBasicOffline())) setUnavailable(EVENT_DASHBOARD_MESSAGES.NOT_SAVED_OFFLINE);
        } else {
          await loadBasicOnline(current);
        }
        return;
      }

      if (isOffline) {
        const found = await loadFromSnapshot();
        if (current === requestId.current && !found) {
          await loadBasicOffline();
          setUnavailable(EVENT_DASHBOARD_MESSAGES.NOT_SAVED_OFFLINE);
        }
        return;
      }

      const outcome = await fetchOccurrenceDashboard(tourId, eventId, occurrenceId);
      if (current !== requestId.current) return;
      if (outcome.kind === 'error') {
        if (outcome.error.status === 404) setNotFound(true);
        else setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      setDashboard(outcome.data);
      setStaleAt(null);
      setUnavailable(null);
      await refreshReconciliation(outcome.data.occurrence);
    } catch (err) {
      logger.error(TAG, 'Loading occurrence dashboard failed', err);
      if (current !== requestId.current) return;
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      if (canViewDashboard) {
        await loadFromSnapshot().catch((snapshotError: unknown) => {
          logger.warn(TAG, 'Snapshot fallback failed', snapshotError);
        });
      }
    } finally {
      if (current === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [
    tourId, eventId, occurrenceId, isOffline, canViewDashboard,
    loadBasicOffline, loadBasicOnline, loadFromSnapshot, refreshReconciliation,
  ]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const reload = useCallback(() => load(true), [load]);

  /** Progress poll: replaces records/summary; refetches the full dashboard when the roster or activities changed. */
  const refreshProgress = useCallback(async () => {
    const current = dashboardRef.current;
    if (!tourId || !current || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const outcome = await fetchOccurrenceProgress(tourId, eventId, occurrenceId);
      if (outcome.kind === 'error') {
        logger.warn(TAG, 'Progress unavailable', { code: outcome.error.code });
        return;
      }
      if (outcome.data.notModified) return;

      const { progress } = outcome.data;
      const currentIds = current.summary.activities.map((item) => item.activityId);
      const nextIds = progress.summary.activities.map((item) => item.activityId);
      if (progress.summary.totalRiders !== current.riders.length || !sameIds(currentIds, nextIds)) {
        const full = await fetchOccurrenceDashboard(tourId, eventId, occurrenceId);
        if (full.kind === 'success') setDashboard(full.data);
      } else {
        setDashboard((prev) => (prev
          ? { ...prev, records: progress.records, cancelled: progress.cancelled, summary: progress.summary }
          : prev));
      }
      await refreshReconciliation(current.occurrence);
    } catch (err) {
      logger.warn(TAG, 'Progress refresh failed', err);
    } finally {
      pollingRef.current = false;
    }
  }, [tourId, eventId, occurrenceId, refreshReconciliation]);

  const canPoll = canViewDashboard
    && Boolean(tourId)
    && !isOffline
    && !staleAt
    && occurrence?.status === OccurrenceStatus.ACTIVE
    && Boolean(dashboard);

  useEffect(() => {
    if (!canPoll || !isFocused) return undefined;
    const timer = setInterval(() => void refreshProgress(), PROGRESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canPoll, isFocused, refreshProgress]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const refreshProgressSoon = useCallback(() => {
    if (!canViewDashboard || isOffline) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void refreshProgress(), PROGRESS_REFRESH_DEBOUNCE_MS);
  }, [canViewDashboard, isOffline, refreshProgress]);

  const activities = useMemo(
    () => (event ? getDashboardActivities(event, occurrence, summary) : []),
    [event, occurrence, summary],
  );

  const riderStatuses = useMemo(() => {
    if (!dashboard) return new Map() as RiderStatusMap;
    const base = deriveRiderStatuses(dashboard.riders, dashboard.records, activities.map((a) => a.activityId));
    return applyLocalQueued(base, localRecords);
  }, [dashboard, activities, localRecords]);

  const activityFilter = rawActivityFilter && activities.some((a) => a.activityId === rawActivityFilter)
    ? rawActivityFilter
    : null;
  const toggleSort = useCallback(() => setIsSorted((value) => !value), []);

  const value = useMemo<OccurrenceDashboardContextValue>(() => ({
    tourId,
    eventId,
    occurrenceId,
    canViewDashboard,
    dashboard,
    event,
    occurrence,
    summary,
    activities,
    riderStatuses,
    localRecords,
    reconciliation,
    reconciliationError,
    staleAt,
    unavailable,
    notFound,
    banner,
    isLoading,
    isRefreshing,
    reload,
    refreshProgressSoon,
    activityFilter,
    setActivityFilter,
    isSorted,
    toggleSort,
  }), [
    tourId, eventId, occurrenceId, canViewDashboard, dashboard, event, occurrence, summary, activities,
    riderStatuses, localRecords, reconciliation, reconciliationError, staleAt, unavailable, notFound,
    banner, isLoading, isRefreshing, reload, refreshProgressSoon, activityFilter, isSorted, toggleSort,
  ]);

  return <OccurrenceDashboardContext.Provider value={value}>{children}</OccurrenceDashboardContext.Provider>;
}

export function useOccurrenceDashboard(): OccurrenceDashboardContextValue {
  const context = useContext(OccurrenceDashboardContext);
  if (!context) throw new Error('useOccurrenceDashboard must be used within OccurrenceDashboardProvider');
  return context;
}
