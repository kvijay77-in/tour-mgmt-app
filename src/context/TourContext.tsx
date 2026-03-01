/**
 * Tour Context — provides the active tour ID to all components.
 *
 * At app startup, resolves the active tour via the API.
 * All tour-scoped API calls use the tourId from this context.
 *
 * See docs/DataIntegrationDesign.md §2.4.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Tour } from '../types/models';
import { getActiveTour } from '../services/api/tourApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TourContextValue {
  /** The active tour, or null if none / not yet loaded */
  tour: Tour | null;
  /** True while the active tour is being fetched */
  isLoading: boolean;
  /** Error message if tour fetch failed */
  error: string | null;
  /** Re-fetch the active tour (e.g. after connectivity restored) */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TourContext = createContext<TourContextValue>({
  tour: null,
  isLoading: true,
  error: null,
  refresh: async () => {},
});

/**
 * Hook to access the active tour context.
 */
export function useTour(): TourContextValue {
  return useContext(TourContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface TourProviderProps {
  children: React.ReactNode;
}

export function TourProvider({ children }: TourProviderProps) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveTour = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const activeTour = await getActiveTour();
      setTour(activeTour);
      if (!activeTour) {
        setError('No active tour found. Please contact the tour administrator.');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load active tour';
      setError(message);
      // Keep previous tour if available (offline scenario)
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveTour();
  }, [fetchActiveTour]);

  const value: TourContextValue = {
    tour,
    isLoading,
    error,
    refresh: fetchActiveTour,
  };

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
