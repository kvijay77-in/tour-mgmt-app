/**
 * useOffline — React hook for monitoring network connectivity.
 *
 * Implementation uses a periodic lightweight fetch to a known public endpoint
 * (or the AppSync endpoint if configured) to determine reachability.  This
 * avoids adding extra native packages while still being reliable for the
 * use-case of detecting intermittent connectivity at remote locations.
 *
 * The hook also updates the dataService's internal online state so the service
 * layer automatically picks the right data source.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { setOnlineState } from '../services/api/dataService';

/** How often (ms) to poll for connectivity while the app is in the foreground. */
const POLL_INTERVAL_MS = 30_000;

/** URL used to check connectivity. Falls back to a connectivity-check endpoint. */
const getConnectivityCheckUrl = (): string => {
  const endpoint: string =
    (Constants.expoConfig?.extra?.AWS_APPSYNC_GRAPHQL_ENDPOINT as string | undefined) ?? '';
  if (endpoint) return endpoint;
  // Fallback: Cloudflare's connectivity-check endpoint (lightweight, neutral)
  return 'https://1.1.1.1/cdn-cgi/trace';
};

/**
 * Attempt a HEAD request with a short timeout.
 * Returns true when a response (any HTTP status) is received.
 */
const checkConnectivity = async (): Promise<boolean> => {
  const url = getConnectivityCheckUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(url, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

interface UseOfflineResult {
  /** True when the device appears to have internet access. */
  isOnline: boolean;
  /** Manually trigger a connectivity re-check. */
  checkNow: () => void;
}

/**
 * Hook that monitors network connectivity and keeps the dataService in sync.
 *
 * Returns `{ isOnline, checkNow }`.
 */
export const useOffline = (): UseOfflineResult => {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateOnlineState = useCallback(async () => {
    const online = await checkConnectivity();
    setIsOnline(online);
    setOnlineState(online);
  }, []);

  const checkNow = useCallback(() => {
    updateOnlineState();
  }, [updateOnlineState]);

  // Poll on interval while app is in foreground
  useEffect(() => {
    updateOnlineState(); // initial check

    pollRef.current = setInterval(updateOnlineState, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [updateOnlineState]);

  // Re-check when app comes back to foreground
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        updateOnlineState();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [updateOnlineState]);

  return { isOnline, checkNow };
};
