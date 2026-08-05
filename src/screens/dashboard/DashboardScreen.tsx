/**
 * Dashboard Screen - Main screen showing rider status
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { MaterialIcons, FontAwesome5 } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTour } from '../../context/TourContext';
import { listRides } from '../../services/api/rideApi';
import { getDashboardProgress } from '../../services/api/dashboardApi';
import { listRiders } from '../../services/api/riderApi';
import { subscribeDashboardCheckInEvent, subscribeDashboardCancelEvent, subscribeDashboardRefreshEvent } from '../../services/dashboard/dashboardEvents';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import { logger } from '../../utils/logger';
import { buildRiderStatuses, getRiderFloatDefinition, resolveStageForCheckIn, shouldShowFloatBadge } from '../../utils/riderStatus';
import RiderCardModal from '../../components/dashboard/RiderCardModal';
import {
  Ride,
  Rider,
  CheckIn,
  RiderStatus,
  CheckInStatus,
  RideStatus,
  TourRiderStatus,
  isCancelledCheckIn,
} from '../../types/models';
import { COLORS, CHECK_IN_STATUS_COLORS, getStageColor, STAGE_VIEW_COLORS } from '../../constants/colors';
// SortIcon not used in this file (kept in StageFilterBar)
import { useRideSession } from '../../context/RideSessionContext';

const { width: WINDOW_WIDTH } = Dimensions.get('window');
const STALE_SESSION_REFRESH_MS = 2 * 60 * 1000;

/**
 * Natural compare for rider IDs (e.g. R2 < R10).
 */
function compareRiderIdsNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function isExitedTourRider(status?: string): boolean {
  return typeof status === 'string' && status.trim().toUpperCase() === TourRiderStatus.EXITED;
}

function resolveTodayRideFromList(rides: Ride[]): Ride | null {
  const today = new Date().toISOString().split('T')[0];
  const todayRides = rides.filter((ride) => ride.date === today);

  if (todayRides.length === 0) {
    return null;
  }

  return todayRides.find((candidate) => candidate.status === RideStatus.STARTED || candidate.status === RideStatus.OPEN)
    ?? todayRides[0];
}

function getCheckInDedupKey(checkIn: CheckIn): string {
  if (checkIn.checkInId) {
    return checkIn.checkInId;
  }

  return [
    checkIn.rideId,
    checkIn.riderId,
    String(checkIn.stageNumber ?? ''),
    checkIn.timestamp,
    checkIn.isNotRiding ? 'NR' : '',
    checkIn.isQuitRiding ? 'QR' : '',
  ].join('|');
}

export default function DashboardScreen() {
  const { width, height } = useWindowDimensions();
  const { tour, isLoading: isTourLoading, error: tourError, refresh: refreshTour } = useTour();

  const [ride, setRide] = useState<Ride | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [allRiderStatuses, setAllRiderStatuses] = useState<RiderStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Shared session state (ride, selection, checkIns)
  const {
    currentRide: sessionRide,
    isHistorical: sessionHistorical,
    selectedStageNumber,
    isSorted,
    setCurrentRide,
    setCheckIns,
    setCancelledCheckIns,
  } = useRideSession();
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 3 | 4>(1);
  const [selectedRiderStatus, setSelectedRiderStatus] = useState<RiderStatus | null>(null);
  const [isRiderCardVisible, setIsRiderCardVisible] = useState(false);
  const [isSkippedHighlightEnabled] = useState(true);

  const inFlightRequestKeysRef = useRef<Set<string>>(new Set());
  const ridersLoadPromiseRef = useRef<Promise<Rider[]> | null>(null);
  const lastServerPullAtRef = useRef(0);
  const shouldSkipNextFocusRefreshRef = useRef(false);

  const ensureRidersLoaded = useCallback(async (): Promise<Rider[]> => {
    if (!tour) return [];
    if (riders.length > 0) return riders;
    if (ridersLoadPromiseRef.current) {
      return ridersLoadPromiseRef.current;
    }

    ridersLoadPromiseRef.current = listRiders(tour.tourId)
      .then((roster) => {
        setRiders(roster);
        return roster;
      })
      .finally(() => {
        ridersLoadPromiseRef.current = null;
      });

    return ridersLoadPromiseRef.current;
  }, [tour, riders]);

  const applyDashboardProgress = useCallback((
    targetRide: Ride,
    roster: Rider[],
    checkIns: CheckIn[],
    cancelled: CheckIn[],
    historical: boolean
  ) => {
    setRide(targetRide);
    setAllRiderStatuses(buildRiderStatuses(targetRide, roster, checkIns));
    lastServerPullAtRef.current = Date.now();
    try {
      setCurrentRide(targetRide, historical);
      setCheckIns(Array.isArray(checkIns) ? checkIns : []);
      setCancelledCheckIns(Array.isArray(cancelled) ? cancelled : []);
    } catch (err) {
      // Context may not be available in some test scenarios; fail silently
      logger.info('Dashboard', 'RideSessionContext update skipped', err);
    }
  }, [setCurrentRide, setCheckIns, setCancelledCheckIns]);

  // Load a specific ride's dashboard progress using preloaded rider roster.
  const loadRideDashboard = useCallback(async (
    targetRide: Ride,
    historical: boolean,
    options?: { background?: boolean }
  ) => {
    const isBackgroundRefresh = options?.background === true;
    const requestKey = `dashboard-progress:${targetRide.rideId}`;

    if (inFlightRequestKeysRef.current.has(requestKey)) {
      logger.info('Dashboard', `Skipping duplicate in-flight request: ${requestKey}`);
      return;
    }
    inFlightRequestKeysRef.current.add(requestKey);

    if (!isBackgroundRefresh) {
      setIsLoading(true);
      setError(null);
    }
    setRide(targetRide);
    setIsHistorical(historical);
    try {
      const roster = await ensureRidersLoaded();
      const { data } = await getDashboardProgress(tour!.tourId, targetRide.rideId);
      if (!data) {
        if (!isBackgroundRefresh) {
          setError('No dashboard progress data available.');
          setIsLoading(false);
        }
        return;
      }

      if (!Array.isArray(targetRide.stages) || targetRide.stages.length === 0) {
        if (!isBackgroundRefresh) {
          setError('Ride has no stages configured. Please contact the tour administrator.');
        }
        setRide(targetRide);
        if (!isBackgroundRefresh) {
          setIsLoading(false);
        }
        return;
      }

      const checkIns = Array.isArray(data.checkIns) ? data.checkIns : [];
      const cancelled = Array.isArray(data.cancelled) ? data.cancelled : [];
      applyDashboardProgress(targetRide, roster, checkIns, cancelled, historical);
    } catch (err) {
      logger.error('Dashboard', 'loadRideDashboard failed', err);
      let message: string;
      const isApiError = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
      if (isApiError) {
        const apiErr = err as ApiError;
        if (apiErr.errorCode === 'CONFIG_ERROR') {
          message = apiErr.message;
        } else if (apiErr.statusCode === 0) {
          message = 'Unable to reach the server. Please check your internet connection and try again.';
        } else if (apiErr.statusCode >= 500) {
          message = 'The server encountered an error. Please try again later.';
        } else {
          message = 'Failed to load dashboard data. Please try again.';
        }
      } else if (isNetworkError(err)) {
        message = 'Unable to reach the server. Please check your internet connection and try again.';
      } else {
        message = 'An unexpected error occurred. Please try again.';
      }
      if (!isBackgroundRefresh) {
        setError(message);
      }
    } finally {
      inFlightRequestKeysRef.current.delete(requestKey);
      if (!isBackgroundRefresh) {
        setIsLoading(false);
      }
    }
  }, [tour, ensureRidersLoaded, applyDashboardProgress]);

  // Fetch data from API — tries today's ride first, then falls back to most recent
  const fetchDashboard = useCallback(async (options?: { allowHistoricalFallback?: boolean }) => {
    const allowHistoricalFallback = options?.allowHistoricalFallback ?? true;

    if (!tour) return;
    const requestKey = `dashboard-bootstrap:${tour.tourId}`;
    if (inFlightRequestKeysRef.current.has(requestKey)) {
      logger.info('Dashboard', `Skipping duplicate in-flight request: ${requestKey}`);
      return;
    }
    inFlightRequestKeysRef.current.add(requestKey);

    setIsLoading(true);
    setError(null);
    try {
      // Fetch ride list for the selector
      const rides = await listRides(tour.tourId);
      // Sort by date descending (most recent first)
      const sortedRides = [...rides].sort((a, b) => b.date.localeCompare(a.date));

      const roster = await ensureRidersLoaded();

      // Resolve today's ride from listRides response to avoid overlapping ride fetches.
      const todayRide = resolveTodayRideFromList(sortedRides);
      if (todayRide) {
        setIsHistorical(false);
        setRide(todayRide);

        const { data } = await getDashboardProgress(tour.tourId, todayRide.rideId);
        if (!data) {
          setError('No dashboard progress data available.');
          setIsLoading(false);
          return;
        }

        if (!Array.isArray(todayRide.stages) || todayRide.stages.length === 0) {
          setError('Ride has no stages configured. Please contact the tour administrator.');
          setRide(todayRide);
          setIsLoading(false);
          return;
        }

        const checkIns = Array.isArray(data.checkIns) ? data.checkIns : [];
        const cancelled = Array.isArray(data.cancelled) ? data.cancelled : [];
        applyDashboardProgress(todayRide, roster, checkIns, cancelled, false);
      } else if (allowHistoricalFallback && sortedRides.length > 0) {
        // Fall back to the most recent ride (historical/read-only)
        await loadRideDashboard(sortedRides[0], true);
        return;
      } else if (sortedRides.length > 0) {
        setError('No ride found for today.');
        setIsLoading(false);
        return;
      } else {
        setError('No rides found for this tour.');
        setIsLoading(false);
        return;
      }
    } catch (err) {
      logger.error('Dashboard', 'fetchDashboard failed', err);
      let message: string;
      const isApiError = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
      if (isApiError) {
        const apiErr = err as ApiError;
        if (apiErr.errorCode === 'CONFIG_ERROR') {
          message = apiErr.message;
        } else if (apiErr.statusCode === 0) {
          message = 'Unable to reach the server. Please check your internet connection and try again.';
        } else if (apiErr.statusCode >= 500) {
          message = 'The server encountered an error. Please try again later.';
        } else {
          message = 'Failed to load dashboard data. Please try again.';
        }
      } else if (isNetworkError(err)) {
        message = 'Unable to reach the server. Please check your internet connection and try again.';
      } else {
        message = 'An unexpected error occurred. Please try again.';
      }
      setError(message);
    } finally {
      inFlightRequestKeysRef.current.delete(requestKey);
      setIsLoading(false);
    }
  }, [tour, loadRideDashboard, ensureRidersLoaded, applyDashboardProgress]);

  useEffect(() => {
    if (!isTourLoading && tour) {
      void fetchDashboard();
    } else if (!isTourLoading && !tour) {
      // Tour loading finished but no tour found — stop loading spinner
      setIsLoading(false);
    }
  // Avoid pinning the effect to `fetchDashboard` function identity which may
  // change due to internal state updates (causing an infinite fetch loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTourLoading, tour]);

  useEffect(() => {
    if (!sessionRide) {
      return;
    }

    if (ride?.rideId === sessionRide.rideId && isHistorical === sessionHistorical) {
      return;
    }

    void loadRideDashboard(sessionRide, sessionHistorical);
  }, [sessionRide, sessionHistorical, ride?.rideId, isHistorical, loadRideDashboard]);

  // Focus refresh is targeted: skip known non-refresh returns and only pull
  // from server when the last successful sync is stale.
  const isInitialFocusRef = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (isInitialFocusRef.current) {
        isInitialFocusRef.current = false;
        return;
      }
      if (shouldSkipNextFocusRefreshRef.current) {
        shouldSkipNextFocusRefreshRef.current = false;
        return;
      }
      if (!tour) {
        return;
      }

      const isStale = Date.now() - lastServerPullAtRef.current >= STALE_SESSION_REFRESH_MS;
      if (isStale) {
        void fetchDashboard();
      }
    }, [tour, fetchDashboard])
  );

  const applyLocalCheckInUpdate = useCallback((checkIn: CheckIn) => {
    if (!ride || checkIn.rideId !== ride.rideId) {
      return;
    }

    setAllRiderStatuses((prevStatuses) => {
      const checkInByKey = new Map<string, CheckIn>();

      prevStatuses
        .flatMap((status) => status.checkInHistory)
        .forEach((existingCheckIn) => {
          checkInByKey.set(getCheckInDedupKey(existingCheckIn), existingCheckIn);
        });

      const incomingKey = getCheckInDedupKey(checkIn);
      if (checkInByKey.has(incomingKey)) {
        return prevStatuses;
      }

      checkInByKey.set(incomingKey, checkIn);

      const roster = riders.length > 0 ? riders : prevStatuses.map((status) => status.rider);
      const mergedCheckIns = Array.from(checkInByKey.values()).filter((entry) => entry.rideId === ride.rideId);

      return buildRiderStatuses(ride, roster, mergedCheckIns);
    });

    try {
      setCheckIns((prev) => {
        const map = new Map(prev.map((ci) => [getCheckInDedupKey(ci), ci]));
        const incomingKey = getCheckInDedupKey(checkIn);
        if (!map.has(incomingKey)) map.set(incomingKey, checkIn);
        return Array.from(map.values()).filter((ci) => ci.rideId === ride.rideId);
      });
    } catch (err) {
      logger.info('Dashboard', 'setCheckIns skipped', err);
    }
  }, [ride, riders, setCheckIns]);

  // A check-in cancelled from the Check-In Log tab should update the grid
  // (rider reverts to its prior status) without a full dashboard reload.
  const applyLocalCancelUpdate = useCallback((cancelledCheckIn: CheckIn) => {
    if (!ride || cancelledCheckIn.rideId !== ride.rideId) {
      return;
    }

    setAllRiderStatuses((prevStatuses) => {
      const checkInByKey = new Map<string, CheckIn>();

      prevStatuses
        .flatMap((status) => status.checkInHistory)
        .forEach((existingCheckIn) => {
          checkInByKey.set(getCheckInDedupKey(existingCheckIn), existingCheckIn);
        });

      checkInByKey.set(getCheckInDedupKey(cancelledCheckIn), cancelledCheckIn);

      const roster = riders.length > 0 ? riders : prevStatuses.map((status) => status.rider);
      const mergedCheckIns = Array.from(checkInByKey.values()).filter((entry) => entry.rideId === ride.rideId);

      return buildRiderStatuses(ride, roster, mergedCheckIns);
    });

    try {
      setCheckIns((prev) => prev.filter((ci) => ci.checkInId !== cancelledCheckIn.checkInId));
      setCancelledCheckIns((prev) => {
        if (prev.some((ci) => ci.checkInId === cancelledCheckIn.checkInId)) {
          return prev;
        }
        return [cancelledCheckIn, ...prev];
      });
    } catch (err) {
      logger.info('Dashboard', 'setCancelledCheckIns skipped', err);
    }
  }, [ride, riders, setCheckIns, setCancelledCheckIns]);

  useEffect(() => {
    const unsubscribe = subscribeDashboardCheckInEvent(({ checkIn }) => {
      // Returning from Check-In should not force a full reload.
      shouldSkipNextFocusRefreshRef.current = true;
      applyLocalCheckInUpdate(checkIn);
    });

    return unsubscribe;
  }, [applyLocalCheckInUpdate]);

  useEffect(() => {
    const unsubscribe = subscribeDashboardCancelEvent(({ checkIn }) => {
      shouldSkipNextFocusRefreshRef.current = true;
      applyLocalCancelUpdate(checkIn);
    });

    return unsubscribe;
  }, [applyLocalCancelUpdate]);

  useEffect(() => {
    const unsubscribe = subscribeDashboardRefreshEvent(() => {
      void fetchDashboard();
    });

    return unsubscribe;
  }, [fetchDashboard]);

  // Pinch gesture for zoom
  const baseScale = useRef(1);
  const pinchScale = useRef(1);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      pinchScale.current = baseScale.current * event.scale;
    })
    .onEnd(() => {
      const scale = pinchScale.current;
      baseScale.current = scale;
      
      // Map scale to zoom levels
      if (scale <= 0.8) {
        setZoomLevel(1);
        baseScale.current = 1;
      } else if (scale <= 1.5) {
        setZoomLevel(2);
        baseScale.current = 1;
      } else if (scale <= 2.5) {
        setZoomLevel(3);
        baseScale.current = 1;
      } else {
        setZoomLevel(4);
        baseScale.current = 1;
      }
      
      pinchScale.current = 1;
    });

  // Compute selected stage object from session-selected stage number
  const selectedStage = useMemo(() => {
    if (selectedStageNumber === null || !ride) return undefined;
    return ride.stages.find((s) => s.stageNumber === selectedStageNumber);
  }, [selectedStageNumber, ride]);

  const hasRegularCheckInAtStage = useCallback((riderStatus: RiderStatus, stageNumber: number): boolean => {
    const targetStage = ride?.stages.find((stage) => stage.stageNumber === stageNumber);
    if (!targetStage) {
      return false;
    }

    return riderStatus.checkInHistory.some(
      (ci) => {
        const matchedStage = resolveStageForCheckIn(ride, ci);
        return matchedStage?.stageId === targetStage.stageId
          && !ci.isNotRiding
          && !ci.isQuitRiding
          && !ci.isFloat
          && !isCancelledCheckIn(ci);
      }
    );
  }, [ride]);

  const hasRegularCheckInAfterStage = useCallback((riderStatus: RiderStatus, stageNumber: number): boolean => {
    const targetStage = ride?.stages.find((stage) => stage.stageNumber === stageNumber);
    if (!targetStage) {
      return false;
    }

    return riderStatus.checkInHistory.some(
      (ci) => {
        const matchedStage = resolveStageForCheckIn(ride, ci);
        return matchedStage !== undefined
          && matchedStage.stageNumber > targetStage.stageNumber
          && !ci.isNotRiding
          && !ci.isQuitRiding
          && !ci.isFloat
          && !isCancelledCheckIn(ci);
      }
    );
  }, [ride]);

  const shouldShowSkippedIndicator = useCallback((riderStatus: RiderStatus): boolean => {
    if (!isSkippedHighlightEnabled || !selectedStage) {
      return false;
    }

    if (riderStatus.overallStatus === CheckInStatus.NOT_RIDING) {
      return false;
    }

    const floatDef = ride ? getRiderFloatDefinition(ride, riderStatus) : null;
    if (floatDef && selectedStage.stageNumber < floatDef.floatToStage) {
      return false;
    }

    // Show caution only when there is a later regular check-in but the selected stage itself is missing.
    return hasRegularCheckInAfterStage(riderStatus, selectedStage.stageNumber)
      && !hasRegularCheckInAtStage(riderStatus, selectedStage.stageNumber);
  }, [hasRegularCheckInAfterStage, hasRegularCheckInAtStage, isSkippedHighlightEnabled, selectedStage]);

  const handleCloseRiderCard = useCallback(() => {
    setIsRiderCardVisible(false);
    setSelectedRiderStatus(null);
  }, []);

  const handleRiderTap = (riderStatus: RiderStatus) => {
    if (zoomLevel === 1 || zoomLevel === 2) {
      setSelectedRiderStatus(riderStatus);
      setIsRiderCardVisible(true);
    }
  };

  // Sort riders based on requirements
  const sortRiders = (riders: RiderStatus[]): RiderStatus[] => {
    if (!isSorted) {
      // Unsorted mode: sort by Rider ID using 'natural sort' instead of lexicographically
      return [...riders].sort((a, b) => 
        compareRiderIdsNatural(a.rider.riderId, b.rider.riderId)
      );
    }

    // Sorted mode
    return [...riders].sort((a, b) => {
      if (selectedStage) {
        // Stage View sorting
        const getStageViewGroupOrder = (rs: RiderStatus): number => {
          if (rs.overallStatus === CheckInStatus.NOT_RIDING) {
            return 3; // NR always last
          }

          const hasCheckedInAtSelectedStage = hasRegularCheckInAtStage(rs, selectedStage.stageNumber);
          if (hasCheckedInAtSelectedStage) {
            // Stage view marks checked-in only with an explicit check-in at this stage.
            return 1;
          }

          if (rs.overallStatus === CheckInStatus.QUIT_RIDING) {
            return 2; // QR who quit before reaching this stage
          }

          return 0; // Not checked in at selected stage
        };

        const aGroup = getStageViewGroupOrder(a);
        const bGroup = getStageViewGroupOrder(b);

        if (aGroup !== bGroup) {
          return aGroup - bGroup;
        }

        // Same group: sub-sort by Rider ID
        return compareRiderIdsNatural(a.rider.riderId, b.rider.riderId);
      } else {
        // Default View sorting
        // Assign group order: not checked in → QR → stages → NR
        const getGroupOrder = (rs: RiderStatus): number => {
          if (rs.overallStatus === CheckInStatus.NOT_RIDING) return 1000; // NR last
          if (rs.overallStatus === CheckInStatus.QUIT_RIDING) return 100; // QR second (after not checked in)
          if (rs.overallStatus === CheckInStatus.NOT_CHECKED_IN) return 0; // Not checked in first
          return 200 + (rs.lastStage?.stageNumber || 0); // Regular riders by stage (after QR)
        };
        
        const aGroup = getGroupOrder(a);
        const bGroup = getGroupOrder(b);
        
        if (aGroup !== bGroup) {
          return aGroup - bGroup;
        }
        
        // Same group: sub-sort by Rider ID
        return compareRiderIdsNatural(a.rider.riderId, b.rider.riderId);
      }
    });
  };

  // Apply sorting
  const filteredRiders = sortRiders(allRiderStatuses);

  // Get color for rider based on status and stage view
  const getRiderColor = (riderStatus: RiderStatus): string => {
    // NR always uses gray color in all views
    if (riderStatus.overallStatus === CheckInStatus.NOT_RIDING) {
      return COLORS.gray[400]; // Grey for Not Riding
    }

    // Stage view active
    if (selectedStage && ride) {
      
      // If rider hasn't checked in anywhere yet, show white
      if (!riderStatus.lastStage) {
        return STAGE_VIEW_COLORS.notCheckedInAtStage;
      }
      
      // Stage view should show checked-in only if this exact stage has a check-in record.
      if (hasRegularCheckInAtStage(riderStatus, selectedStage.stageNumber)) {
        return getStageColor(selectedStage.stageNumber, ride?.stages.length ?? 0);
      }
      
      // Rider hasn't reached this stage yet
      // If QR rider who quit before this stage, show QR color
      // Otherwise show white (not checked in at this stage yet)
      if (riderStatus.overallStatus === CheckInStatus.QUIT_RIDING) {
        return CHECK_IN_STATUS_COLORS[CheckInStatus.QUIT_RIDING];
      }
      
      return STAGE_VIEW_COLORS.notCheckedInAtStage;
    }

    // Default/Overall view - QR riders show their special color
    if (riderStatus.overallStatus === CheckInStatus.QUIT_RIDING) {
      return CHECK_IN_STATUS_COLORS[CheckInStatus.QUIT_RIDING];
    }

    // Default view - show last stage color or white for not checked in
    if (riderStatus.overallStatus === CheckInStatus.NOT_CHECKED_IN) {
      return STAGE_VIEW_COLORS.notCheckedInAtStage; // White with border
    }
    
    if (riderStatus.lastStage) {
      return getStageColor(riderStatus.lastStage.stageNumber, ride?.stages.length ?? 0);
    }
    
    return STAGE_VIEW_COLORS.notCheckedInAtStage; // White with border
  };

  // Style helpers for dynamic colors and sizes
  const getRiderIconStyle = (riderStatus: RiderStatus) => {
    const bgColor = getRiderColor(riderStatus);
    const isWhite = bgColor === COLORS.white;
    
    // Calculate icon size based on zoom level
    const columns = getGridColumns(zoomLevel);
    const gridBaseWidth = width >= 768 ? Math.min(width, height) : width;
    const iconSize = Math.floor((gridBaseWidth - 32 - (columns - 1) * 6) / columns);
    
    return [
      styles.riderIcon,
      {
        width: iconSize,
        height: iconSize,
        backgroundColor: bgColor,
        borderWidth: isWhite ? 2 : 0,
        borderColor: isWhite ? COLORS.gray[400] : 'transparent',
      }
    ];
  };

  // stage button styling is handled by StageFilterBar component

  const getGridColumns = useCallback((currentZoomLevel: 1 | 2 | 3 | 4) => {
    const isTablet = width >= 768;

    if (isTablet) {
      if (currentZoomLevel === 1) return 10;
      if (currentZoomLevel === 2) return 8;
      if (currentZoomLevel === 3) return 6;
      return 4;
    }

    if (currentZoomLevel === 1) return 6;
    if (currentZoomLevel === 2) return 4;
    if (currentZoomLevel === 3) return 3;
    return 2;
  }, [width]);

  const getRiderTextSizes = useCallback((currentZoomLevel: 1 | 2 | 3 | 4) => {
    const isTablet = width >= 768;

    if (currentZoomLevel === 1) {
      return { id: isTablet ? 11 : 12, name: 0, contact: 0, icon: 0 };
    }

    if (currentZoomLevel === 2) {
      return { id: 10, name: isTablet ? 10 : 9, contact: 0, icon: 0 };
    }

    if (currentZoomLevel === 3) {
      return { id: 10, name: 9, contact: isTablet ? 9 : 8, icon: 0 };
    }

    return { id: 10, name: 9, contact: isTablet ? 9 : 8, icon: isTablet ? 34 : 40 };
  }, [width]);

  // Loading / error / no-data guards
  if (isTourLoading || isLoading) {
    return (
      <View style={[styles.container, styles.centeredContent]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </View>
    );
  }

  if (tourError || error) {
    const handleRetry = tourError ? refreshTour : fetchDashboard;
    return (
      <View style={[styles.container, styles.centeredContent]}>
        <MaterialIcons name="error-outline" size={48} color={COLORS.danger} />
        <Text style={styles.errorText}>{tourError || error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => { void handleRetry(); }}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.container, styles.centeredContent]}>
        <Text style={styles.errorText}>No active ride found.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => { void fetchDashboard(); }}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Rider Grid - Maximum space with Pinch Zoom */}
      <GestureDetector gesture={pinchGesture}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.gridContainer}>
        {(() => {
          const textSizes = getRiderTextSizes(zoomLevel);

          return filteredRiders.map((riderStatus) => {
            const isWhiteBg = getRiderColor(riderStatus) === COLORS.white;
            const showSkippedIndicator = shouldShowSkippedIndicator(riderStatus);
            const isExitedRider = isExitedTourRider(riderStatus.rider.status);
            const floatDef = ride ? getRiderFloatDefinition(ride, riderStatus) : null;
            const showFloatBadge = floatDef
              ? shouldShowFloatBadge(riderStatus, floatDef, selectedStage?.stageNumber ?? null)
              : false;
            return (
              <TouchableOpacity
                key={riderStatus.rider.riderId}
                style={[getRiderIconStyle(riderStatus), isExitedRider && styles.exitedRiderIcon]}
                onPress={() => handleRiderTap(riderStatus)}
              >
                {isExitedRider && (
                  <View style={styles.exitedOverlay} pointerEvents="none">
                    <Text style={styles.exitedOverlayMark}>X</Text>
                  </View>
                )}
                {showSkippedIndicator && (
                  <View style={styles.skippedBadge} pointerEvents="none">
                    <Text style={styles.skippedBadgeMark}>!</Text>
                  </View>
                )}
                {showFloatBadge && (
                  <View style={styles.floatBadge} pointerEvents="none">
                    {/* <MaterialIcons name="airport-shuttle" size={16} color={COLORS.white} /> */}
                    <FontAwesome5 name="truck" size={14} color={COLORS.white} />
                    {floatDef && floatDef.floatNo > 0 && (
                      <Text style={styles.floatBadgeText}> {floatDef.floatNo}</Text>
                    )}
                  </View>
                )}
                <View style={styles.riderIconContent}>
                  {/* Level 1: Rider ID only */}
                  {zoomLevel === 1 && (
                    <Text style={[styles.riderIdText, { fontSize: textSizes.id }, isWhiteBg && { color: COLORS.textPrimary }]}>
                      {riderStatus.rider.riderId}
                    </Text>
                  )}
                  
                  {/* Level 2: Rider ID + Name */}
                  {zoomLevel === 2 && (
                    <>
                      <Text style={[styles.riderIdTextZoom, { fontSize: textSizes.id }, isWhiteBg && { color: COLORS.textPrimary }]}>
                        {riderStatus.rider.riderId}
                      </Text>
                      <Text style={[styles.riderNameText, { fontSize: textSizes.name }, isWhiteBg && { color: COLORS.textSecondary }]} numberOfLines={2}>
                        {riderStatus.rider.name}
                      </Text>
                    </>
                  )}
                  
                  {/* Level 3: Rider ID + Name + Contact */}
                  {zoomLevel === 3 && (
                    <>
                      <Text style={[styles.riderIdTextZoom, { fontSize: textSizes.id }, isWhiteBg && { color: COLORS.textPrimary }]}>
                        {riderStatus.rider.riderId}
                      </Text>
                      <Text style={[styles.riderNameText, { fontSize: textSizes.name }, isWhiteBg && { color: COLORS.textSecondary }]} numberOfLines={1}>
                        {riderStatus.rider.name}
                      </Text>
                      <Text style={[styles.riderContactText, { fontSize: textSizes.contact }, isWhiteBg && { color: COLORS.textSecondary }]} numberOfLines={1}>
                        {riderStatus.rider.phone || 'N/A'}
                      </Text>
                    </>
                  )}
                  
                  {/* Level 4: Rider ID + Name + Photo + Contact */}
                  {zoomLevel === 4 && (
                    <>
                      <MaterialIcons 
                        name="account-circle" 
                        size={textSizes.icon} 
                        color={isWhiteBg ? COLORS.gray[400] : COLORS.white} 
                      />
                      <Text style={[styles.riderIdTextZoom, { fontSize: textSizes.id }, isWhiteBg && { color: COLORS.textPrimary }]}>
                        {riderStatus.rider.riderId}
                      </Text>
                      <Text style={[styles.riderNameText, { fontSize: textSizes.name }, isWhiteBg && { color: COLORS.textSecondary }]} numberOfLines={1}>
                        {riderStatus.rider.name}
                      </Text>
                      <Text style={[styles.riderContactText, { fontSize: textSizes.contact }, isWhiteBg && { color: COLORS.textSecondary }]} numberOfLines={1}>
                        {riderStatus.rider.phone || 'N/A'}
                      </Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          });
        })()}
        </ScrollView>
      </GestureDetector>

      {/* Rider Card Modal for Level 1 & 2 */}
      <RiderCardModal
        visible={isRiderCardVisible}
        tourId={tour?.tourId}
        ride={ride}
        riderId={selectedRiderStatus?.rider.riderId ?? null}
        onClose={handleCloseRiderCard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centeredContent: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  rideTitleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  historicalBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  historicalBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuButton: {
    padding: 2,
  },
  rideTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    flexShrink: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statChip: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 1,
  },
  statChipValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  statChipLabel: {
    fontSize: 11,
    color: COLORS.white,
    opacity: 0.9,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 17,
    paddingVertical: 8,
  },
  riderIcon: {
    width: 1,
    height: 1,
    margin: 2,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    overflow: 'visible',
  },
  exitedRiderIcon: {
    borderWidth: 3,
    borderColor: '#111827',
    backgroundColor: 'transparent',
  },
  exitedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 4,
    elevation: 4,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitedOverlayMark: {
    fontSize: 40,
    lineHeight: 40,
    fontWeight: '400',
    color: '#111827',
    textShadowColor: 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  skippedBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    zIndex: 3,
    elevation: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFF8E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  skippedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: '#92400E',
  },
  skippedBadgeMark: {
    fontSize: 14,
    lineHeight: 14,
    fontWeight: '900',
    color: '#92400E',
  },
  floatBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    zIndex: 2,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
  },
  floatBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  riderIconContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  riderIdText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  riderIdTextZoom: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  riderNameText: {
    fontSize: 9,
    color: COLORS.white,
    textAlign: 'center',
    marginTop: 1,
  },
  riderContactText: {
    fontSize: 8,
    color: COLORS.white,
    textAlign: 'center',
    marginTop: 0,
  },
  ridePickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    width: WINDOW_WIDTH * 0.88,
    maxWidth: 420,
    maxHeight: '72%',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  ridePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ridePickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  ridePickerList: {
    maxHeight: 360,
  },
  ridePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  ridePickerItemSelected: {
    backgroundColor: COLORS.primary + '12',
  },
  ridePickerItemName: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  ridePickerItemNameSelected: {
    color: COLORS.primary,
  },
  ridePickerItemDate: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  pitStopManagementCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    width: WINDOW_WIDTH * 0.88,
    maxWidth: 420,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    overflow: 'hidden',
  },
  pitStopManagementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pitStopManagementTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  pitStopManagementTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  pitStopManagementSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  pitStopManagementCloseButton: {
    padding: 4,
  },
  pitStopManagementBody: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pitStopManagementInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  pitStopManagementLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  pitStopManagementValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  pitStopManagementActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  pitStopManagementActionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pitStopManagementOpenButton: {
    backgroundColor: COLORS.primary,
  },
  pitStopManagementCloseActionButton: {
    backgroundColor: COLORS.warning,
  },
  pitStopManagementActionButtonDisabled: {
    backgroundColor: COLORS.gray[300],
  },
  pitStopManagementActionButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  pitStopManagementSubmittingRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pitStopManagementSubmittingText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  footer: {
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    minHeight: 60,
    gap: 12,
  },
  sortButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.gray[100],
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary + '15', // 15% opacity
  },
  stageScroll: {
    flex: 1,
  },
  stageContent: {
    alignItems: 'center',
    gap: 6,
  },
  stageBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 6,
  },
  stageBtnText: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#14B8A6',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});
