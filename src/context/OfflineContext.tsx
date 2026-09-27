/**
 * Offline Context — manages connectivity state and manual offline toggle.
 *
 * Per design (§4.3):
 * - Automatic detection via @react-native-community/netinfo (event-driven)
 * - Manual toggle for user control when connectivity is unstable
 * - Effective offline = manual toggle ON **or** NetInfo reports no connectivity
 * - Outbound sync pauses while offline
 *
 * Offline mode is a mobile capability. On web the app is always online and
 * the toggle is unavailable (web is used for admin features).
 *
 * The manual toggle is persisted on the device so the app restarts in the
 * same mode (the login screen can then offer offline sign-in). This provider
 * is mounted above AuthProvider because sign-in needs connectivity state.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setApiOfflineMode } from '../services/api/apiClient';
import { logger } from '../utils/logger';

const TAG = 'OfflineContext';
const MANUAL_OFFLINE_KEY = 'offline.manualMode';

/** True on platforms that support offline mode (mobile only). */
export const OFFLINE_MODE_SUPPORTED = Platform.OS !== 'web';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OfflineContextValue {
  /** True when the app is in effective offline mode (manual OR auto-detected) */
  isOffline: boolean;
  /** True when the manual offline toggle is ON */
  isManualOffline: boolean;
  /** True when NetInfo reports no connectivity */
  isAutoDetectedOffline: boolean;
  /** Toggle manual offline mode (persisted on the device) */
  setManualOffline: (offline: boolean) => void;
  /** Human-readable status for indicator */
  offlineReason: 'manual' | 'no-connectivity' | null;
  /** False on web — offline mode is a mobile feature */
  isOfflineSupported: boolean;
  /** True once the persisted toggle and first NetInfo state are known */
  isReady: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const OfflineContext = createContext<OfflineContextValue>({
  isOffline: false,
  isManualOffline: false,
  isAutoDetectedOffline: false,
  setManualOffline: () => {},
  offlineReason: null,
  isOfflineSupported: OFFLINE_MODE_SUPPORTED,
  isReady: true,
});

/**
 * Hook to access offline state.
 */
export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface OfflineProviderProps {
  children: React.ReactNode;
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const [isManualOffline, setManualOfflineState] = useState(false);
  const [isAutoDetectedOffline, setAutoDetectedOffline] = useState(false);
  const [isToggleLoaded, setToggleLoaded] = useState(!OFFLINE_MODE_SUPPORTED);
  const [isNetInfoLoaded, setNetInfoLoaded] = useState(!OFFLINE_MODE_SUPPORTED);

  // Restore the persisted manual toggle.
  useEffect(() => {
    if (!OFFLINE_MODE_SUPPORTED) return;
    let cancelled = false;
    AsyncStorage.getItem(MANUAL_OFFLINE_KEY)
      .then((value) => {
        if (!cancelled) setManualOfflineState(value === 'true');
      })
      .catch((error: unknown) => logger.warn(TAG, 'Failed to read offline toggle', error))
      .finally(() => {
        if (!cancelled) setToggleLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to NetInfo connectivity changes (event-driven, not polling).
  useEffect(() => {
    if (!OFFLINE_MODE_SUPPORTED) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    async function setupNetInfo() {
      try {
        // Dynamic import to avoid issues in test environments
        const NetInfo = (await import('@react-native-community/netinfo')).default;
        // Battery: only probe internet reachability while the app is in the foreground.
        NetInfo.configure({
          reachabilityShouldRun: () => AppState.currentState === 'active',
        });
        if (cancelled) return;
        unsubscribe = NetInfo.addEventListener((state) => {
          const offline = state.isConnected === false || state.isInternetReachable === false;
          setAutoDetectedOffline(offline);
          setNetInfoLoaded(true);
        });
      } catch (e) {
        // NetInfo not available (test environment) — assume online
        logger.warn(TAG, 'NetInfo not available, assuming online', e);
        setAutoDetectedOffline(false);
        setNetInfoLoaded(true);
      }
    }

    setupNetInfo();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const setManualOffline = useCallback((offline: boolean) => {
    if (!OFFLINE_MODE_SUPPORTED) return;
    setManualOfflineState(offline);
    AsyncStorage.setItem(MANUAL_OFFLINE_KEY, offline ? 'true' : 'false').catch((error: unknown) =>
      logger.warn(TAG, 'Failed to persist offline toggle', error),
    );
  }, []);

  // Effective offline = manual toggle OR auto-detected
  const isOffline = OFFLINE_MODE_SUPPORTED && (isManualOffline || isAutoDetectedOffline);

  // Requests fail fast (no network call / retries) while offline.
  useEffect(() => {
    setApiOfflineMode(isOffline);
  }, [isOffline]);

  const value = useMemo<OfflineContextValue>(() => ({
    isOffline,
    isManualOffline,
    isAutoDetectedOffline,
    setManualOffline,
    offlineReason: isManualOffline ? 'manual' : isAutoDetectedOffline ? 'no-connectivity' : null,
    isOfflineSupported: OFFLINE_MODE_SUPPORTED,
    isReady: isToggleLoaded && isNetInfoLoaded,
  }), [isOffline, isManualOffline, isAutoDetectedOffline, setManualOffline, isToggleLoaded, isNetInfoLoaded]);

  return (
    <OfflineContext.Provider value={value}>
      {children}
    </OfflineContext.Provider>
  );
}
