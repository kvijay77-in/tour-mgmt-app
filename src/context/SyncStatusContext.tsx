/**
 * Sync Status Context — drives the outbound sync engine and exposes the
 * state of data captured on this device.
 *
 * - Enables sending only while online, in the foreground and signed in
 *   online (not an offline session). Reconnecting, returning to the
 *   foreground and "Sync now" trigger an immediate batch; there is no
 *   polling (battery).
 * - Pending / failed counts (COUNT queries) and the stale-queue alert
 *   (unsent data older than `staleQueueAlertMinutes`).
 * - Offline readiness: while online and a ride is live today, refreshes the
 *   ride data cache every `readinessRefreshMinutes` (skipped when the
 *   dashboard already refreshed it), so switching to offline needs no
 *   explicit download.
 * - Sign-out guard: warns when unsent data exists (it stays on the device and
 *   is sent after the same user signs in again).
 *
 * Mounted in AppNavigator (signed-in area). Mobile and web; web is always online.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet, Text } from 'react-native';
import { useAuth } from './AuthContext';
import { useOffline } from './OfflineContext';
import { useTour } from './TourContext';
import ConfirmDialog from '../components/artifacts/ConfirmDialog';
import {
  configureOutboundSync,
  getOutboundSyncStatus,
  OutboundSyncStatus,
  requestOutboundSync,
  retryFailedOperations,
  subscribeOutboundSync,
} from '../services/sync/outboundSyncService';
// Handler registration (side effects): every operation type the engine sends.
import '../services/sync/checkInSync';
import '../services/sync/eventSyncService';
import { getOldestPendingCreatedAt, getOperationCounts } from '../services/database/pendingStore';
import { getRidesByTour } from '../services/database/rideStore';
import { getSyncSettings, subscribeSyncSettings } from '../services/sync/syncSettingsService';
import { runRetentionIfDue } from '../services/offline/retentionService';
import {
  getClockSkew,
  isClockSkewSignificant,
  loadClockSkew,
  subscribeClockSkew,
} from '../services/sync/clockSkew';
import {
  getRideReadinessSyncedAt,
  OFFLINE_CACHE_ENABLED,
  refreshRideReadiness,
  subscribeOfflineDataUpdated,
} from '../services/offline/offlineDataService';
import { RideStatus } from '../types/models';
import { getLocalToday } from '../utils/dates';
import { COLORS } from '../constants/colors';
import { logger } from '../utils/logger';

const TAG = 'SyncStatusContext';
const COUNT_RELOAD_DEBOUNCE_MS = 300;

export interface SyncStatusContextValue {
  /** Operations waiting to be sent (captured on this device) */
  pendingCount: number;
  /** Operations that need attention (rejected or retries exhausted) */
  failedCount: number;
  /** Capture time of the oldest unsent operation */
  oldestPendingAt: string | null;
  /** Unsent data older than the stale-queue alert threshold */
  isStale: boolean;
  /**
   * Oldest refresh time of the data needed to keep working offline (tour,
   * rides, riders and today's live ride check-ins); null = not downloaded yet
   */
  readinessSyncedAt: string | null;
  /** Server time minus device time (ms) from the last API responses; null = unknown */
  clockSkewMs: number | null;
  /** True when the device clock is off by more than clockSkewWarnMinutes */
  isClockSkewed: boolean;
  /** Engine status (running, next retry, last error) */
  engine: OutboundSyncStatus;
  /** Clear retry waits and send now (no-op while offline) */
  syncNow: () => void;
  /** Re-queue every failed operation and send */
  retryAllFailed: () => Promise<number>;
  refreshCounts: () => Promise<void>;
  /** Sign out, warning first when unsent data exists */
  requestLogout: () => void;
}

const SyncStatusContext = createContext<SyncStatusContextValue | undefined>(undefined);

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { isOffline } = useOffline();
  const { tour } = useTour();
  const tourId = tour?.tourId ?? null;

  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [oldestPendingAt, setOldestPendingAt] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [readinessSyncedAt, setReadinessSyncedAt] = useState<string | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState<number | null>(() => getClockSkew().skewMs);
  const [engine, setEngine] = useState<OutboundSyncStatus>(getOutboundSyncStatus());
  const [settings, setSettings] = useState(getSyncSettings());
  const [logoutPromptVisible, setLogoutPromptVisible] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const countTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readinessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendingEnabled = Boolean(user) && !user?.isOfflineSession && !isOffline && appActive && Boolean(tourId);

  // App foreground/background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => subscribeSyncSettings(setSettings), []);

  // Device clock check (from API response Date headers; last value persisted).
  useEffect(() => {
    const unsubscribe = subscribeClockSkew((next) => setClockSkewMs(next.skewMs));
    void loadClockSkew();
    return unsubscribe;
  }, []);
  const isClockSkewed = OFFLINE_CACHE_ENABLED && isClockSkewSignificant(clockSkewMs, settings.clockSkewWarnMinutes);

  // Local data retention: checked on start and each foreground (runs at most twice a day).
  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED || !user || !appActive) return;
    void runRetentionIfDue();
  }, [user, appActive]);

  // Engine session: owner, tour and whether sending is allowed.
  useEffect(() => {
    configureOutboundSync({ userId: user?.userId ?? null, tourId, enabled: sendingEnabled });
  }, [user?.userId, tourId, sendingEnabled]);

  useEffect(() => () => {
    configureOutboundSync({ userId: null, tourId: null, enabled: false });
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const [counts, oldest] = await Promise.all([getOperationCounts(), getOldestPendingCreatedAt()]);
      setPendingCount(counts.pending);
      setFailedCount(counts.failed);
      setOldestPendingAt(oldest);
    } catch (error) {
      logger.warn(TAG, 'Reading sync counts failed', error);
    }
  }, []);

  // Queue/engine changes → debounced count reload.
  useEffect(() => {
    void refreshCounts();
    const unsubscribe = subscribeOutboundSync(() => {
      setEngine(getOutboundSyncStatus());
      if (countTimerRef.current) return;
      countTimerRef.current = setTimeout(() => {
        countTimerRef.current = null;
        void refreshCounts();
      }, COUNT_RELOAD_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
      countTimerRef.current = null;
    };
  }, [refreshCounts]);

  // Stale alert: one timer for the moment the oldest unsent item becomes stale.
  useEffect(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
    if (!oldestPendingAt) {
      setIsStale(false);
      return undefined;
    }
    const staleAt = Date.parse(oldestPendingAt) + settings.staleQueueAlertMinutes * 60_000;
    const remaining = staleAt - Date.now();
    if (!Number.isFinite(staleAt) || remaining <= 0) {
      setIsStale(true);
      return undefined;
    }
    setIsStale(false);
    staleTimerRef.current = setTimeout(() => setIsStale(true), remaining);
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    };
  }, [oldestPendingAt, settings.staleQueueAlertMinutes]);

  /** Today's OPEN/STARTED ride from the device cache, if any. */
  const findLiveRideId = useCallback(async (): Promise<string | null> => {
    if (!tourId) return null;
    const today = getLocalToday();
    const rides = await getRidesByTour(tourId);
    const liveRide = rides.find(
      (ride) => ride.date === today && (ride.status === RideStatus.OPEN || ride.status === RideStatus.STARTED),
    );
    return liveRide?.rideId ?? null;
  }, [tourId]);

  // Readiness indicator: recomputed (debounced) whenever cached data is refreshed.
  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED || !tourId) {
      setReadinessSyncedAt(null);
      return undefined;
    }
    let active = true;
    const recompute = async () => {
      try {
        const syncedAt = await getRideReadinessSyncedAt(tourId, await findLiveRideId());
        if (active) setReadinessSyncedAt(syncedAt);
      } catch (error) {
        logger.warn(TAG, 'Reading offline readiness failed', error);
      }
    };
    void recompute();
    const unsubscribe = subscribeOfflineDataUpdated(() => {
      if (readinessTimerRef.current) return;
      readinessTimerRef.current = setTimeout(() => {
        readinessTimerRef.current = null;
        void recompute();
      }, COUNT_RELOAD_DEBOUNCE_MS);
    });
    return () => {
      active = false;
      unsubscribe();
      if (readinessTimerRef.current) clearTimeout(readinessTimerRef.current);
      readinessTimerRef.current = null;
    };
  }, [tourId, findLiveRideId]);

  // Offline readiness refresh while online and today's ride is live.
  useEffect(() => {
    if (!OFFLINE_CACHE_ENABLED || !sendingEnabled || !tourId) return undefined;
    let cancelled = false;
    const intervalMs = settings.readinessRefreshMinutes * 60_000;

    const refreshIfDue = async () => {
      try {
        const liveRideId = await findLiveRideId();
        if (!liveRideId || cancelled) return;
        const syncedAt = await getRideReadinessSyncedAt(tourId, liveRideId);
        if (syncedAt && Date.now() - Date.parse(syncedAt) < intervalMs) return;
        await refreshRideReadiness(tourId, liveRideId);
      } catch (error) {
        logger.warn(TAG, 'Offline readiness refresh failed', error);
      }
    };

    void refreshIfDue();
    const timer = setInterval(() => void refreshIfDue(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sendingEnabled, tourId, settings.readinessRefreshMinutes, findLiveRideId]);

  const syncNow = useCallback(() => {
    requestOutboundSync({ resetBackoff: true });
  }, []);

  const retryAllFailed = useCallback(() => retryFailedOperations(), []);

  const requestLogout = useCallback(() => {
    if (pendingCount + failedCount > 0) {
      setLogoutPromptVisible(true);
      return;
    }
    void logout();
  }, [pendingCount, failedCount, logout]);

  const confirmLogout = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await logout();
    } finally {
      setIsSigningOut(false);
      setLogoutPromptVisible(false);
    }
  }, [logout]);

  const unsentTotal = pendingCount + failedCount;
  const logoutMessage =
    `${unsentTotal} item${unsentTotal === 1 ? '' : 's'} captured on this device ${unsentTotal === 1 ? 'has' : 'have'} not been sent yet. ` +
    'They stay on this device and are sent after you sign in again on this device. Signing in as a different user on this device will be blocked until they are sent or discarded.';

  const value = useMemo<SyncStatusContextValue>(() => ({
    pendingCount,
    failedCount,
    oldestPendingAt,
    isStale,
    readinessSyncedAt,
    clockSkewMs,
    isClockSkewed,
    engine,
    syncNow,
    retryAllFailed,
    refreshCounts,
    requestLogout,
  }), [pendingCount, failedCount, oldestPendingAt, isStale, readinessSyncedAt, clockSkewMs, isClockSkewed, engine, syncNow, retryAllFailed, refreshCounts, requestLogout]);

  return (
    <SyncStatusContext.Provider value={value}>
      {children}
      <ConfirmDialog
        visible={logoutPromptVisible}
        title="Unsent data on this device"
        message={logoutMessage}
        confirmLabel="Sign out anyway"
        cancelLabel="Stay signed in"
        confirmTone="danger"
        isSubmitting={isSigningOut}
        onConfirm={() => void confirmLogout()}
        onCancel={() => setLogoutPromptVisible(false)}
      >
        {sendingEnabled ? (
          <Text style={styles.hint}>Tip: stay signed in for a moment while the data is sent, or use Sync now in Sync status.</Text>
        ) : null}
      </ConfirmDialog>
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusContextValue {
  const context = useContext(SyncStatusContext);
  if (!context) throw new Error('useSyncStatus must be used within SyncStatusProvider');
  return context;
}

const styles = StyleSheet.create({
  hint: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 8,
  },
});
