/**
 * Name Directory Context
 *
 * Loads and stores lightweight name lookup maps used by Check-In and Log tabs.
 * - Rider names: GET /v1/tours/{tourId}/riders/names
 * - App user names: GET /v1/users/cognito
 * Both are cached on mobile so names resolve offline.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useTour } from './TourContext';
import { loadAppUserNames, loadRiderNames } from '../services/offline/offlineDataService';
import { logger } from '../utils/logger';

const TAG = 'NameDirectoryContext';

export interface RiderDisplayName {
  name: string;
  isAnomaly: boolean;
}

interface NameDirectoryContextValue {
  riderNamesById: Record<string, string | null>;
  appUserNamesBySub: Record<string, string | null>;
  getRiderDisplayName: (riderId: string) => RiderDisplayName;
  getAppUserDisplayName: (sub: string | undefined | null) => string;
}

const NameDirectoryContext = createContext<NameDirectoryContextValue>({
  riderNamesById: {},
  appUserNamesBySub: {},
  getRiderDisplayName: () => ({ name: 'Unknown', isAnomaly: true }),
  getAppUserDisplayName: () => 'N/A',
});

export function useNameDirectory(): NameDirectoryContextValue {
  return useContext(NameDirectoryContext);
}

export function NameDirectoryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { tour } = useTour();
  const userId = user?.userId ?? null;
  const tourId = tour?.tourId ?? null;

  const [riderNamesById, setRiderNamesById] = useState<Record<string, string | null>>({});
  const [appUserNamesBySub, setAppUserNamesBySub] = useState<Record<string, string | null>>({});

  // Fetch app-user names once per sign-in.
  useEffect(() => {
    let mounted = true;

    if (!userId) {
      setAppUserNamesBySub({});
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        const { data: map } = await loadAppUserNames();
        if (!mounted) return;
        setAppUserNamesBySub(map);
      } catch (err) {
        logger.warn(TAG, 'Failed to load /v1/users/cognito name directory', err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

  // Fetch rider names when active tour is available for this sign-in.
  useEffect(() => {
    let mounted = true;

    if (!userId || !tourId) {
      setRiderNamesById({});
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        const { data: map } = await loadRiderNames(tourId);
        if (!mounted) return;
        setRiderNamesById(map);
      } catch (err) {
        logger.warn(TAG, `Failed to load rider names for tour ${tourId}`, err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userId, tourId]);

  const value = useMemo<NameDirectoryContextValue>(() => ({
    riderNamesById,
    appUserNamesBySub,
    getRiderDisplayName: (riderId: string): RiderDisplayName => {
      const rawName = riderNamesById[riderId];
      if (!rawName) {
        return { name: 'Unknown', isAnomaly: true };
      }
      return { name: rawName, isAnomaly: false };
    },
    getAppUserDisplayName: (sub: string | undefined | null): string => {
      if (!sub) return 'N/A';
      const rawName = appUserNamesBySub[sub];
      return rawName || 'N/A';
    },
  }), [riderNamesById, appUserNamesBySub]);

  return (
    <NameDirectoryContext.Provider value={value}>
      {children}
    </NameDirectoryContext.Provider>
  );
}
