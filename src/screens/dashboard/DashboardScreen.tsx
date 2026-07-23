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
  Animated,
  PanResponder,
  Modal,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTour } from '../../context/TourContext';
import { useAuth } from '../../context/AuthContext';
import { closePitStopStage, listRides, openPitStopStage } from '../../services/api/rideApi';
import { getDashboardProgress } from '../../services/api/dashboardApi';
import { getRideRiderDetails, listRiders } from '../../services/api/riderApi';
import { subscribeDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import { logger } from '../../utils/logger';
import {
  Ride,
  Rider,
  CheckIn,
  RiderStatus,
  CheckInStatus,
  Permission,
  UserRole,
  StageType,
  Stage,
  RideStatus,
  RiderDetailsData,
  isCancelledCheckIn,
} from '../../types/models';
import { COLORS, CHECK_IN_STATUS_COLORS, getStageColor, STAGE_VIEW_COLORS } from '../../constants/colors';
import { SortIcon } from '../../components/common/SortIcon';
import { AppMenu } from '../../components/common/AppMenu';
import { getPitStopStageNumbersFromRoles, hasPermission, isPitStopUserRole } from '../../utils/permissions';
import { AppStackParamList } from '../../types/navigation';
import {
  clearPitStopContextStageNumber,
  loadPitStopContextStageNumber,
  savePitStopContextStageNumber,
} from '../../services/config/pitStopContextService';

const { width: WINDOW_WIDTH } = Dimensions.get('window');
const ENABLE_OFFLINE_RIDER_PROFILE_CACHE = false;
const STALE_SESSION_REFRESH_MS = 2 * 60 * 1000;

/**
 * Build RiderStatus[] from dashboard API response data.
 */
function buildRiderStatuses(ride: Ride, riders: Rider[], checkIns: CheckIn[]): RiderStatus[] {
  if (!Array.isArray(riders)) {
    logger.error('Dashboard', 'buildRiderStatuses received a non-array rider roster');
    return [];
  }

  return riders.map((rider) => {
    const riderCheckIns = checkIns
      .filter((ci) => {
        const matchesRider = ci.riderId === rider.riderId;
        const matchesRide = typeof ci.rideId !== 'string' || ci.rideId === ride.rideId;

        return matchesRider && matchesRide && !isCancelledCheckIn(ci);
      })
      .sort((a, b) => a.stageNumber - b.stageNumber);

    // Determine overall status
    let overallStatus = CheckInStatus.NOT_CHECKED_IN;
    const nrCheckIn = riderCheckIns.find((ci) => ci.isNotRiding);
    const qrCheckIn = riderCheckIns.find((ci) => ci.isQuitRiding);

    if (nrCheckIn) {
      overallStatus = CheckInStatus.NOT_RIDING;
    } else if (qrCheckIn) {
      overallStatus = CheckInStatus.QUIT_RIDING;
    } else if (riderCheckIns.length > 0) {
      overallStatus = CheckInStatus.CHECKED_IN;
    }

    // Last non-special check-in determines the last stage reached
    const regularCheckIns = riderCheckIns.filter((ci) => !ci.isNotRiding && !ci.isQuitRiding);
    const lastRegularCheckIn = regularCheckIns.length > 0
      ? regularCheckIns[regularCheckIns.length - 1]
      : undefined;

    const lastStage = lastRegularCheckIn ? resolveStageForCheckIn(ride, lastRegularCheckIn) : undefined;

    const lastCheckIn = riderCheckIns.length > 0
      ? riderCheckIns[riderCheckIns.length - 1]
      : undefined;

    return {
      rider,
      ride,
      lastCheckIn,
      overallStatus,
      lastStage,
      checkInHistory: riderCheckIns,
    };
  });
}

/**
 * Natural compare for rider IDs (e.g. R2 < R10).
 */
function compareRiderIdsNatural(a: string, b: string): number {
  return a.localeCompare(b, 'en', {
    numeric: true,
    sensitivity: 'base',
  });
}

function normalizeStageNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveStageForCheckIn(ride: Ride | null, checkIn: CheckIn): Stage | undefined {
  if (!ride) {
    return undefined;
  }

  if (checkIn.stageId) {
    const stageById = ride.stages.find((stage) => stage.stageId === checkIn.stageId);
    if (stageById) {
      return stageById;
    }
  }

  const normalizedStageNumber = normalizeStageNumber(checkIn.stageNumber);
  if (normalizedStageNumber === null) {
    return undefined;
  }

  const exactMatch = ride.stages.find((stage) => stage.stageNumber === normalizedStageNumber);
  if (exactMatch) {
    return exactMatch;
  }

  if (normalizedStageNumber > 0) {
    return ride.stages.find((stage) => stage.stageNumber === normalizedStageNumber - 1);
  }

  return undefined;
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
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'Dashboard'>>();
  const { width, height } = useWindowDimensions();
  const { tour, isLoading: isTourLoading, error: tourError, refresh: refreshTour } = useTour();
  const {
    user,
    logout,
  } = useAuth();

  const [ride, setRide] = useState<Ride | null>(null);
  const [allRides, setAllRides] = useState<Ride[]>([]);
  const [isHistorical, setIsHistorical] = useState(false);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [allRiderStatuses, setAllRiderStatuses] = useState<RiderStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageViewId, setStageViewId] = useState<string | undefined>(undefined);
  const [isSorted, setIsSorted] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 3 | 4>(1);
  const [selectedRiderStatus, setSelectedRiderStatus] = useState<RiderStatus | null>(null);
  const [selectedRiderDetails, setSelectedRiderDetails] = useState<RiderDetailsData | null>(null);
  const [isRiderDetailsLoading, setIsRiderDetailsLoading] = useState(false);
  const [riderDetailsError, setRiderDetailsError] = useState<string | null>(null);
  const [isRiderCardVisible, setIsRiderCardVisible] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showPitStopContextPicker, setShowPitStopContextPicker] = useState(false);
  const [showPitStopManagementModal, setShowPitStopManagementModal] = useState(false);
  const [selectedPitStopStageNumber, setSelectedPitStopStageNumber] = useState<number | null>(null);
  const [isPitStopActionSubmitting, setIsPitStopActionSubmitting] = useState(false);
  const [managedPitStopStageNumber, setManagedPitStopStageNumber] = useState<number | null>(null);
  const [isSkippedHighlightEnabled, setIsSkippedHighlightEnabled] = useState(true);

  const inFlightRequestKeysRef = useRef<Set<string>>(new Set());
  const ridersLoadPromiseRef = useRef<Promise<Rider[]> | null>(null);
  const lastServerPullAtRef = useRef(0);
  const shouldSkipNextFocusRefreshRef = useRef(false);

  // RBAC: can this user perform check-ins?
  const canCheckIn = user ? hasPermission(user.userRole, Permission.CHECKIN_RIDER) : false;
  const isAdministrator = user?.userRole === UserRole.ADMINISTRATOR;
  const isSuperUser = user?.userRole === UserRole.SUPER_USER;
  const isPitStopPrimaryRole = user ? isPitStopUserRole(user.userRole) : false;

  const pitStopRoleStageNumbers = useMemo(
    () => getPitStopStageNumbersFromRoles(user?.userRoles ?? []),
    [user?.userRoles],
  );

  const availablePitStopStagesForUser = useMemo(() => {
    if (!ride || !isPitStopPrimaryRole) return [] as Array<{ stageNumber: number; name: string }>;

    return ride.stages
      .filter((s) => s.type === StageType.PIT_STOP && pitStopRoleStageNumbers.includes(s.stageNumber))
      .map((s) => ({ stageNumber: s.stageNumber, name: s.name }));
  }, [ride, isPitStopPrimaryRole, pitStopRoleStageNumbers]);

  const availablePitStopStageNumbers = useMemo(
    () => availablePitStopStagesForUser.map((s) => s.stageNumber),
    [availablePitStopStagesForUser],
  );

  const availablePitStopStagesForManagement = useMemo(() => {
    if (!ride) return [] as Stage[];

    const pitStopStages = ride.stages
      .filter((stage) => stage.type === StageType.PIT_STOP)
      .sort((a, b) => a.stageNumber - b.stageNumber);

    if (isAdministrator || isSuperUser) {
      return pitStopStages;
    }

    if (pitStopRoleStageNumbers.length > 0) {
      return pitStopStages.filter((stage) => pitStopRoleStageNumbers.includes(stage.stageNumber));
    }

    return [] as Stage[];
  }, [ride, isAdministrator, isSuperUser, pitStopRoleStageNumbers]);

  const selectedPitStopStageForManagement = useMemo(() => {
    if (!ride || selectedPitStopStageNumber === null) return null;
    return ride.stages.find(
      (stage) => stage.type === StageType.PIT_STOP && stage.stageNumber === selectedPitStopStageNumber,
    ) ?? null;
  }, [ride, selectedPitStopStageNumber]);

  useEffect(() => {
    if (!ride || !isPitStopPrimaryRole) {
      setManagedPitStopStageNumber(null);
      return;
    }

    let active = true;

    const loadAndValidateContext = async () => {
      const storedStageNumber = await loadPitStopContextStageNumber();
      if (!active) return;

      if (storedStageNumber === null) {
        setManagedPitStopStageNumber(null);
        return;
      }

      if (!availablePitStopStageNumbers.includes(storedStageNumber)) {
        await clearPitStopContextStageNumber();
        if (!active) return;
        setManagedPitStopStageNumber(null);
        Alert.alert(
          'Pit Stop Context Reset',
          'Previously selected pit stop context is not valid for this ride. Please set it again from the menu.',
        );
        return;
      }

      setManagedPitStopStageNumber(storedStageNumber);
    };

    void loadAndValidateContext();

    return () => {
      active = false;
    };
  }, [ride, ride?.rideId, isPitStopPrimaryRole, availablePitStopStageNumbers]);

  const handleSelectPitStopContext = useCallback(async (stageNumber: number) => {
    await savePitStopContextStageNumber(stageNumber);
    setManagedPitStopStageNumber(stageNumber);
    setShowPitStopContextPicker(false);
  }, []);

  const handleOpenPitStopManagement = useCallback((stageNumber: number) => {
    setSelectedPitStopStageNumber(stageNumber);
    setShowPitStopManagementModal(true);
  }, []);

  const getPitStopActionErrorMessage = useCallback((err: unknown): string => {
    const isApiError = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
    if (isApiError) {
      const apiErr = err as ApiError;
      if (apiErr.statusCode === 0) {
        return 'Unable to reach the server. Please check your internet connection and try again.';
      }
      return apiErr.message || 'Unable to update pit stop status. Please try again.';
    }
    if (isNetworkError(err)) {
      return 'Unable to reach the server. Please check your internet connection and try again.';
    }
    return 'An unexpected error occurred. Please try again.';
  }, []);

  const applyUpdatedRideFromPitStopAction = useCallback((updatedRide: Ride) => {
    setRide(updatedRide);

    const updatedSelectedStage = updatedRide.stages.find(
      (stage) => stage.type === StageType.PIT_STOP && stage.stageNumber === selectedPitStopStageNumber,
    );

    if (!updatedSelectedStage) {
      setShowPitStopManagementModal(false);
      setSelectedPitStopStageNumber(null);
    }
  }, [selectedPitStopStageNumber]);

  const handleOpenPitStop = useCallback(async () => {
    if (!tour || !ride || !selectedPitStopStageForManagement) return;

    setIsPitStopActionSubmitting(true);
    try {
      const updatedRide = await openPitStopStage(
        tour.tourId,
        ride.rideId,
        selectedPitStopStageForManagement.stageNumber,
      );
      applyUpdatedRideFromPitStopAction(updatedRide);
    } catch (err) {
      logger.error('Dashboard', 'handleOpenPitStop failed', err);
      Alert.alert('Unable to open pit stop', getPitStopActionErrorMessage(err));
    } finally {
      setIsPitStopActionSubmitting(false);
    }
  }, [tour, ride, selectedPitStopStageForManagement, applyUpdatedRideFromPitStopAction, getPitStopActionErrorMessage]);

  const handleClosePitStop = useCallback(async () => {
    if (!tour || !ride || !selectedPitStopStageForManagement) return;

    setIsPitStopActionSubmitting(true);
    try {
      const updatedRide = await closePitStopStage(
        tour.tourId,
        ride.rideId,
        selectedPitStopStageForManagement.stageNumber,
      );
      applyUpdatedRideFromPitStopAction(updatedRide);
    } catch (err) {
      logger.error('Dashboard', 'handleClosePitStop failed', err);
      Alert.alert('Unable to close pit stop', getPitStopActionErrorMessage(err));
    } finally {
      setIsPitStopActionSubmitting(false);
    }
  }, [tour, ride, selectedPitStopStageForManagement, applyUpdatedRideFromPitStopAction, getPitStopActionErrorMessage]);

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

  const applyDashboardProgress = useCallback((targetRide: Ride, roster: Rider[], checkIns: CheckIn[]) => {
    setRide(targetRide);
    setAllRiderStatuses(buildRiderStatuses(targetRide, roster, checkIns));
    lastServerPullAtRef.current = Date.now();
  }, []);

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
      applyDashboardProgress(targetRide, roster, checkIns);
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
      setAllRides(sortedRides);

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
        applyDashboardProgress(todayRide, roster, checkIns);
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

  const handleSelectRideFromMenu = useCallback((selectedRide: Ride) => {
    const today = new Date().toISOString().split('T')[0];
    const historical = selectedRide.date !== today;
    loadRideDashboard(selectedRide, historical);
  }, [loadRideDashboard]);

  const handleOpenRideInfo = useCallback((selectedRide: Ride, source: 'dashboard' | 'menu') => {
    // Ride info is read-only and should not reload dashboard on close.
    shouldSkipNextFocusRefreshRef.current = true;
    navigation.navigate('RideInfo', {
      ride: selectedRide,
      source,
    });
  }, [navigation]);

  useEffect(() => {
    if (!isTourLoading && tour) {
      fetchDashboard();
    } else if (!isTourLoading && !tour) {
      // Tour loading finished but no tour found — stop loading spinner
      setIsLoading(false);
    }
  }, [isTourLoading, tour, fetchDashboard]);

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
  }, [ride, riders]);

  useEffect(() => {
    const unsubscribe = subscribeDashboardCheckInEvent(({ checkIn }) => {
      // Returning from Check-In should not force a full reload.
      shouldSkipNextFocusRefreshRef.current = true;
      applyLocalCheckInUpdate(checkIn);
    });

    return unsubscribe;
  }, [applyLocalCheckInUpdate]);

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

  // FAB draggable position
  const pan = useRef(new Animated.ValueXY({ x: width - 76, y: width - 76 })).current;
  const [isDragging, setIsDragging] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      // Let taps pass through to the FAB button; only capture real drag gestures.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => {
        return Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4;
      },
      onPanResponderGrant: () => {
        pan.setOffset({
          // @ts-ignore - accessing private _value property
          x: pan.x._value,
          // @ts-ignore - accessing private _value property
          y: pan.y._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, gesture) => {
        setIsDragging(true);
        Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        })(_, gesture);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
        setTimeout(() => setIsDragging(false), 100);
      },
    })
  ).current;

  // Toggle stage view - clicking again deactivates
  const toggleStageView = (stageId: string) => {
    setStageViewId(stageViewId === stageId ? undefined : stageId);
  };

  const selectedStage = useMemo(() => {
    if (!stageViewId || !ride) return undefined;
    return ride.stages.find((s) => s.stageId === stageViewId);
  }, [stageViewId, ride]);

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

    // Show caution only when there is a later regular check-in but the selected stage itself is missing.
    return hasRegularCheckInAfterStage(riderStatus, selectedStage.stageNumber)
      && !hasRegularCheckInAtStage(riderStatus, selectedStage.stageNumber);
  }, [hasRegularCheckInAfterStage, hasRegularCheckInAtStage, isSkippedHighlightEnabled, selectedStage]);

  // Toggle sort
  const toggleSort = () => {
    setIsSorted(!isSorted);
  };

  // Handle rider icon tap
  const getDashboardErrorMessage = useCallback((err: unknown, fallback: string): string => {
    const isApiError = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
    if (isApiError) {
      const apiErr = err as ApiError;
      if (apiErr.errorCode === 'CONFIG_ERROR') return apiErr.message;
      if (apiErr.statusCode === 0) return 'Unable to reach the server. Please check your internet connection and try again.';
      if (apiErr.statusCode >= 500) return 'The server encountered an error. Please try again later.';
      return apiErr.message || fallback;
    }
    if (isNetworkError(err)) {
      return 'Unable to reach the server. Please check your internet connection and try again.';
    }
    return 'An unexpected error occurred. Please try again.';
  }, []);

  const loadSelectedRiderDetails = useCallback(async (riderStatus: RiderStatus) => {
    if (!tour || !ride) return;

    setIsRiderDetailsLoading(true);
    setRiderDetailsError(null);
    setSelectedRiderDetails(null);

    try {
      const details = await getRideRiderDetails(tour.tourId, ride.rideId, riderStatus.rider.riderId);
      if (!details) {
        setRiderDetailsError('Rider details are not available for this rider.');
        return;
      }

      // The rider-details endpoint returns a timeline already scoped to this
      // rider + ride, so individual entries may omit riderId/rideId. Backfill
      // them so the shared buildRiderStatuses() matching logic (also used for
      // the full roster, where entries always carry riderId/rideId) works
      // correctly here too.
      const normalizedDetails: RiderDetailsData = {
        ...details,
        checkInTimeline: details.checkInTimeline.map((checkIn) => ({
          ...checkIn,
          riderId: checkIn.riderId || details.rider.riderId,
          rideId: checkIn.rideId || ride.rideId,
        })),
      };

      // Privacy requirement: keep rider details in-memory only.
      setSelectedRiderDetails(normalizedDetails);

      if (ENABLE_OFFLINE_RIDER_PROFILE_CACHE) {
        // Future enhancement placeholder: optional offline rider-profile cache path.
      }
    } catch (err) {
      logger.error('Dashboard', 'loadSelectedRiderDetails failed', err);
      setRiderDetailsError(getDashboardErrorMessage(err, 'Failed to load rider details. Please try again.'));
    } finally {
      setIsRiderDetailsLoading(false);
    }
  }, [tour, ride, getDashboardErrorMessage]);

  const handleCloseRiderCard = useCallback(() => {
    setIsRiderCardVisible(false);
    setSelectedRiderStatus(null);
    setSelectedRiderDetails(null);
    setRiderDetailsError(null);
    setIsRiderDetailsLoading(false);
  }, []);

  const handleRiderTap = (riderStatus: RiderStatus) => {
    if (zoomLevel === 1 || zoomLevel === 2) {
      setSelectedRiderStatus(riderStatus);
      setIsRiderCardVisible(true);
      void loadSelectedRiderDetails(riderStatus);
    }
  };

  const selectedRider = useMemo(() => {
    if (!ride || !selectedRiderStatus || !selectedRiderDetails) {
      return null;
    }

    const [status] = buildRiderStatuses(ride, [selectedRiderDetails.rider], selectedRiderDetails.checkInTimeline);
    return status ?? null;
  }, [ride, selectedRiderStatus, selectedRiderDetails]);

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

  // Calculate per-stage counts
  // Each stage count includes riders at that stage AND all subsequent stages
  // QR riders are counted for stages they reached before quitting
  const getStageCounts = () => {
    const counts: Record<string, number> = {};
    
    if (!ride) return counts;

    ride.stages.forEach(stage => {
      // Count riders who have reached this stage or beyond
      // This includes riders currently at this stage, at later stages, or who quit after reaching this stage
      counts[stage.stageId] = allRiderStatuses.filter(rs => {
        // Exclude NR riders (they never started)
        if (rs.overallStatus === CheckInStatus.NOT_RIDING) {
          return false;
        }
        
        // Include if rider has reached or passed this stage
        // This works because checking in at a later stage means they passed all earlier stages
        if (rs.lastStage && rs.lastStage.stageNumber >= stage.stageNumber) {
          return true;
        }
        
        return false;
      }).length;
    });
    
    counts['NR'] = allRiderStatuses.filter(rs => rs.overallStatus === CheckInStatus.NOT_RIDING).length;
    counts['QR'] = allRiderStatuses.filter(rs => rs.overallStatus === CheckInStatus.QUIT_RIDING).length;
    
    return counts;
  };

  const stageCounts = getStageCounts();

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

  const getStageLabel = (stageNumber: number, totalStages: number): string => {
    if (stageNumber === 0) return 'Start';
    if (stageNumber === totalStages - 1) return 'Finish';
    return `PS${stageNumber}`;
  };

  const formatDateTimeForDisplay = (value?: string): string => {
    if (!value) return 'N/A';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString();
  };

  const getLatestCheckInForStage = useCallback((riderStatus: RiderStatus, stageNumber: number): CheckIn | undefined => {
    const targetStage = ride?.stages.find((stage) => stage.stageNumber === stageNumber);
    if (!targetStage) {
      return undefined;
    }

    let latestCheckIn: CheckIn | undefined;

    riderStatus.checkInHistory.forEach((checkIn) => {
      const matchedStage = resolveStageForCheckIn(ride, checkIn);
      if (matchedStage?.stageId !== targetStage.stageId || isCancelledCheckIn(checkIn)) return;

      if (!latestCheckIn) {
        latestCheckIn = checkIn;
        return;
      }

      if (new Date(checkIn.timestamp).getTime() > new Date(latestCheckIn.timestamp).getTime()) {
        latestCheckIn = checkIn;
      }
    });

    return latestCheckIn;
  }, [ride]);

  const getLatestSpecialCheckIn = useCallback(
    (riderStatus: RiderStatus, kind: 'NR' | 'QR'): CheckIn | undefined => {
      let latestCheckIn: CheckIn | undefined;

      riderStatus.checkInHistory.forEach((checkIn) => {
        if (isCancelledCheckIn(checkIn)) return;

        const matches = kind === 'NR' ? checkIn.isNotRiding : checkIn.isQuitRiding;
        if (!matches) return;

        if (!latestCheckIn) {
          latestCheckIn = checkIn;
          return;
        }

        if (new Date(checkIn.timestamp).getTime() > new Date(latestCheckIn.timestamp).getTime()) {
          latestCheckIn = checkIn;
        }
      });

      return latestCheckIn;
    },
    []
  );

  const getStageDisplayName = useCallback((stage: Stage, totalStages: number): string => {
    const name = stage.name?.trim();
    if (name) return name;
    return getStageLabel(stage.stageNumber, totalStages);
  }, []);

  const isRideCompletedOrClosed = ride?.status === RideStatus.COMPLETED || ride?.status === RideStatus.CLOSED;
  const showPitStopManagementOption = !isHistorical
    && !isRideCompletedOrClosed
    && availablePitStopStagesForManagement.length > 0;

  const selectedPitStopStatus = selectedPitStopStageForManagement?.pitStopStatus ?? null;
  const canOpenSelectedPitStop = selectedPitStopStatus === null;
  const canCloseSelectedPitStop = selectedPitStopStatus === 'OPEN';

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

  const getStageButtonStyle = (stage: { stageId: string; stageNumber: number }) => {
    const isActive = stageViewId === stage.stageId;
    const bgColor = getStageColor(stage.stageNumber, ride?.stages.length ?? 0);
    
    return [
      styles.stageBtn,
      { 
        backgroundColor: bgColor,
        opacity: isActive ? 1 : 0.6,
        borderWidth: isActive ? 2 : 0,
        borderColor: COLORS.white,
      }
    ];
  };

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
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleRow}>
            <TouchableOpacity
              style={styles.rideTitleButton}
              onPress={() => handleOpenRideInfo(ride, 'dashboard')}
              accessibilityRole="button"
              accessibilityLabel="Open ride details"
              accessibilityHint="Shows details for the selected ride"
            >
              <Text style={styles.rideTitle}>{ride.name}</Text>
              <MaterialIcons name="info-outline" size={18} color={COLORS.white} />
            </TouchableOpacity>
            {isHistorical && (
              <View style={styles.historicalBadge}>
                <Text style={styles.historicalBadgeText}>Historical</Text>
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => setShowHeaderMenu(true)} style={styles.menuButton}>
              <MaterialIcons name="menu" size={22} color={COLORS.white} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.statsRow}>
          {ride.stages.map((stage) => (
            <View key={stage.stageId} style={styles.statChip}>
              <Text style={styles.statChipValue}>{stageCounts[stage.stageId] || 0}</Text>
              <Text style={styles.statChipLabel}>{getStageLabel(stage.stageNumber, ride.stages.length)}</Text>
            </View>
          ))}
          <View style={styles.statChip}>
            <Text style={styles.statChipValue}>{stageCounts['NR']}</Text>
            <Text style={styles.statChipLabel}>NR</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statChipValue}>{stageCounts['QR']}</Text>
            <Text style={styles.statChipLabel}>QR</Text>
          </View>
        </View>
      </View>

      {/* Rider Grid - Maximum space with Pinch Zoom */}
      <GestureDetector gesture={pinchGesture}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.gridContainer}>
        {(() => {
          const textSizes = getRiderTextSizes(zoomLevel);

          return filteredRiders.map((riderStatus) => {
            const isWhiteBg = getRiderColor(riderStatus) === COLORS.white;
            const showSkippedIndicator = shouldShowSkippedIndicator(riderStatus);
            return (
              <TouchableOpacity
                key={riderStatus.rider.riderId}
                style={getRiderIconStyle(riderStatus)}
                onPress={() => handleRiderTap(riderStatus)}
              >
                {showSkippedIndicator && (
                  <View style={styles.skippedBadge} pointerEvents="none">
                    <Text style={styles.skippedBadgeMark}>!</Text>
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
      <Modal
        visible={isRiderCardVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseRiderCard}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleCloseRiderCard}
        >
          <TouchableOpacity
            style={[
              styles.riderCard,
              {
                width: Math.min(width * 0.92, 460),
                maxHeight: height * 0.9,
              },
            ]}
            activeOpacity={1}
            onPress={() => {
              // Keep modal open while interacting inside the rider card.
            }}
          >
            {isRiderDetailsLoading && (
              <View style={styles.riderCardLoadingState}>
                <ActivityIndicator size="small" color={COLORS.primary} />
                <Text style={styles.riderCardLoadingText}>Loading rider details...</Text>
              </View>
            )}

            {!isRiderDetailsLoading && riderDetailsError && selectedRiderStatus && (
              <View style={styles.riderCardLoadingState}>
                <Text style={styles.riderCardErrorText}>{riderDetailsError}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    void loadSelectedRiderDetails(selectedRiderStatus);
                  }}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isRiderDetailsLoading && !riderDetailsError && selectedRider && (
              <ScrollView
                style={styles.riderCardScroll}
                contentContainerStyle={styles.riderCardScrollContent}
                showsVerticalScrollIndicator={true}
              >
                <View style={styles.riderCardHeader}>
                  <MaterialIcons
                    name="account-circle"
                    size={80}
                    color={COLORS.gray[400]}
                    style={styles.riderCardIcon}
                  />
                  <Text style={styles.riderCardId}>{selectedRider.rider.riderId}</Text>
                  <Text style={styles.riderCardName}>{selectedRider.rider.name}</Text>
                  <Text style={styles.riderCardContact}>{selectedRider.rider.phone || 'N/A'}</Text>
                </View>

                <View style={styles.riderCardSection}>
                  {selectedRider.overallStatus === CheckInStatus.NOT_RIDING ? (
                    (() => {
                      const notRidingCheckIn = getLatestSpecialCheckIn(selectedRider, 'NR');
                      return (
                        <>
                          <Text style={styles.riderCardSectionTitle}>Not Riding</Text>
                          <Text style={styles.riderSpecialStatusTime}>
                            {notRidingCheckIn
                              ? `Marked at ${formatDateTimeForDisplay(notRidingCheckIn.timestamp)}`
                              : 'Marked as Not Riding'}
                          </Text>
                        </>
                      );
                    })()
                  ) : (
                    <>
                      <Text style={styles.riderCardSectionTitle}>Stage Check-ins</Text>
                      {(() => {
                        const sortedStages = [...ride.stages].sort((a, b) => a.stageNumber - b.stageNumber);

                        if (selectedRider.overallStatus === CheckInStatus.QUIT_RIDING) {
                          const quitCheckIn = getLatestSpecialCheckIn(selectedRider, 'QR');
                          const quitTime = quitCheckIn
                            ? new Date(quitCheckIn.timestamp).getTime()
                            : Number.POSITIVE_INFINITY;

                          const regularStages = sortedStages.filter((stage) => {
                            const checkIn = getLatestCheckInForStage(selectedRider, stage.stageNumber);
                            if (!checkIn || checkIn.isNotRiding || checkIn.isQuitRiding) return false;
                            return new Date(checkIn.timestamp).getTime() <= quitTime;
                          });

                          return (
                            <>
                              {regularStages.map((stage) => {
                                const checkIn = getLatestCheckInForStage(selectedRider, stage.stageNumber);
                                const stageColor = getStageColor(stage.stageNumber, ride.stages.length);

                                return (
                                  <View key={stage.stageId} style={styles.riderStageRow}>
                                    <View style={styles.riderStageHeaderRow}>
                                      <View style={[styles.riderStageNameChip, { backgroundColor: stageColor }]}>
                                        <Text style={styles.riderStageNameChipText}>
                                          {getStageDisplayName(stage, ride.stages.length)}
                                        </Text>
                                      </View>
                                    </View>
                                    <Text style={styles.riderStageTime}>{formatDateTimeForDisplay(checkIn?.timestamp)}</Text>
                                  </View>
                                );
                              })}

                              <View style={styles.riderStageRow}>
                                <View style={styles.riderStageHeaderRow}>
                                  <View style={[styles.riderStageNameChip, styles.riderQuitChip]}>
                                    <Text style={styles.riderStageNameChipText}>Quit Riding</Text>
                                  </View>
                                </View>
                                <Text style={styles.riderStageTime}>
                                  {quitCheckIn
                                    ? formatDateTimeForDisplay(quitCheckIn.timestamp)
                                    : 'Marked as Quit Riding'}
                                </Text>
                              </View>
                            </>
                          );
                        }

                        return sortedStages.map((stage) => {
                          const checkIn = getLatestCheckInForStage(selectedRider, stage.stageNumber);
                          const stageColor = getStageColor(stage.stageNumber, ride.stages.length);
                          const isSkippedStage = hasRegularCheckInAfterStage(selectedRider, stage.stageNumber)
                            && !hasRegularCheckInAtStage(selectedRider, stage.stageNumber);

                          return (
                            <View key={stage.stageId} style={styles.riderStageRow}>
                              <View style={styles.riderStageHeaderRow}>
                                <View style={[styles.riderStageNameChip, { backgroundColor: stageColor }]}> 
                                  <Text style={styles.riderStageNameChipText}>
                                    {getStageDisplayName(stage, ride.stages.length)}
                                  </Text>
                                </View>
                                {isSkippedStage && (
                                  <View style={styles.riderStageWarningBadge}>
                                    <Text style={styles.riderStageWarningMark}>!</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.riderStageTime}>
                                {checkIn ? formatDateTimeForDisplay(checkIn.timestamp) : 'Not checked in'}
                              </Text>
                            </View>
                          );
                        });
                      })()}
                    </>
                  )}
                </View>

                <TouchableOpacity 
                  style={styles.closeButton}
                  onPress={handleCloseRiderCard}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Header Menu (slide-in) */}
      <AppMenu
        visible={showHeaderMenu}
        onClose={() => setShowHeaderMenu(false)}
        isAdministrator={isAdministrator}
        rides={allRides}
        currentRideId={ride?.rideId ?? null}
        onSelectRide={handleSelectRideFromMenu}
        onViewRideInfo={(selectedRide) => handleOpenRideInfo(selectedRide, 'menu')}
        showPitStopContextOption={isPitStopPrimaryRole && availablePitStopStagesForUser.length > 1}
        managedPitStopStageNumber={managedPitStopStageNumber}
        onOpenPitStopContextPicker={() => setShowPitStopContextPicker(true)}
        showPitStopManagementOption={showPitStopManagementOption}
        pitStopManagementStages={availablePitStopStagesForManagement.map((stage) => ({
          stageNumber: stage.stageNumber,
          name: stage.name,
        }))}
        onOpenPitStopManagement={handleOpenPitStopManagement}
        showSkippedToggle={!!selectedStage}
        isSkippedHighlightEnabled={isSkippedHighlightEnabled}
        onToggleSkippedHighlight={setIsSkippedHighlightEnabled}
        onLogout={logout}
      />

      {/* Pit Stop Management Modal */}
      <Modal
        visible={showPitStopManagementModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isPitStopActionSubmitting) {
            setShowPitStopManagementModal(false);
          }
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            if (!isPitStopActionSubmitting) {
              setShowPitStopManagementModal(false);
            }
          }}
        >
          <TouchableOpacity
            style={styles.pitStopManagementCard}
            activeOpacity={1}
            onPress={() => {
              // Prevent close when interacting inside modal card.
            }}
          >
            <View style={styles.pitStopManagementHeader}>
              <View style={styles.pitStopManagementTitleWrap}>
                <Text style={styles.pitStopManagementTitle}>Pit Stop management</Text>
                <Text style={styles.pitStopManagementSubtitle}>
                  {selectedPitStopStageForManagement
                    ? `PS${selectedPitStopStageForManagement.stageNumber} - ${selectedPitStopStageForManagement.name}`
                    : 'Select a pit stop from menu'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.pitStopManagementCloseButton}
                onPress={() => {
                  if (!isPitStopActionSubmitting) {
                    setShowPitStopManagementModal(false);
                  }
                }}
                disabled={isPitStopActionSubmitting}
              >
                <MaterialIcons name="close" size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.pitStopManagementBody}>
              <View style={styles.pitStopManagementInfoRow}>
                <Text style={styles.pitStopManagementLabel}>Pit stop</Text>
                <Text style={styles.pitStopManagementValue}>{selectedPitStopStageForManagement?.name ?? 'N/A'}</Text>
              </View>
              <View style={styles.pitStopManagementInfoRow}>
                <Text style={styles.pitStopManagementLabel}>Duration</Text>
                <Text style={styles.pitStopManagementValue}>
                  {typeof selectedPitStopStageForManagement?.pitStopDuration === 'number'
                    ? `${selectedPitStopStageForManagement.pitStopDuration} min`
                    : 'N/A'}
                </Text>
              </View>
              <View style={styles.pitStopManagementInfoRow}>
                <Text style={styles.pitStopManagementLabel}>Status</Text>
                <Text style={styles.pitStopManagementValue}>{selectedPitStopStatus ?? 'Not opened'}</Text>
              </View>

              {selectedPitStopStageForManagement?.openedAt && (
                <View style={styles.pitStopManagementInfoRow}>
                  <Text style={styles.pitStopManagementLabel}>Opened At</Text>
                  <Text style={styles.pitStopManagementValue}>
                    {formatDateTimeForDisplay(selectedPitStopStageForManagement.openedAt)}
                  </Text>
                </View>
              )}

              {selectedPitStopStageForManagement?.closedAt && (
                <View style={styles.pitStopManagementInfoRow}>
                  <Text style={styles.pitStopManagementLabel}>Closed At</Text>
                  <Text style={styles.pitStopManagementValue}>
                    {formatDateTimeForDisplay(selectedPitStopStageForManagement.closedAt)}
                  </Text>
                </View>
              )}

              <View style={styles.pitStopManagementActionRow}>
                <TouchableOpacity
                  style={[
                    styles.pitStopManagementActionButton,
                    styles.pitStopManagementOpenButton,
                    (!canOpenSelectedPitStop || isPitStopActionSubmitting) && styles.pitStopManagementActionButtonDisabled,
                  ]}
                  disabled={!canOpenSelectedPitStop || isPitStopActionSubmitting}
                  onPress={() => {
                    void handleOpenPitStop();
                  }}
                >
                  <Text style={styles.pitStopManagementActionButtonText}>OPEN</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.pitStopManagementActionButton,
                    styles.pitStopManagementCloseActionButton,
                    (!canCloseSelectedPitStop || isPitStopActionSubmitting) && styles.pitStopManagementActionButtonDisabled,
                  ]}
                  disabled={!canCloseSelectedPitStop || isPitStopActionSubmitting}
                  onPress={() => {
                    void handleClosePitStop();
                  }}
                >
                  <Text style={styles.pitStopManagementActionButtonText}>CLOSE</Text>
                </TouchableOpacity>
              </View>

              {isPitStopActionSubmitting && (
                <View style={styles.pitStopManagementSubmittingRow}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <Text style={styles.pitStopManagementSubmittingText}>Updating pit stop status...</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Footer with Sort and Stage View Toggles */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.sortButton, isSorted && styles.sortButtonActive]}
          onPress={toggleSort}
        >
          <SortIcon 
            size={24} 
            color={isSorted ? COLORS.primary : COLORS.gray[500]} 
          />
        </TouchableOpacity>
        
        <ScrollView 
          horizontal 
          style={styles.stageScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stageContent}
        >
          {ride.stages.map((stage) => (
            <TouchableOpacity
              key={stage.stageId}
              style={getStageButtonStyle(stage)}
              onPress={() => toggleStageView(stage.stageId)}
            >
              <Text style={styles.stageBtnText}>
                {getStageLabel(stage.stageNumber, ride.stages.length)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Floating Action Button for QR Scanner - Draggable (hidden for historical rides and non-checkin roles) */}
      {!isHistorical && canCheckIn && ride && (
        <Animated.View
          style={[
            styles.fab,
            {
              transform: [{ translateX: pan.x }, { translateY: pan.y }],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={styles.fabButton}
            disabled={isDragging}
            onPress={() => {
              if (!isDragging) {
                shouldSkipNextFocusRefreshRef.current = true;
                navigation.navigate('CheckIn', {
                  ride,
                  managedPitStopStageNumber: managedPitStopStageNumber ?? undefined,
                });
              }
            }}
          >
            <MaterialIcons name="qr-code-scanner" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {isHistorical && (
        <Animated.View
          style={[
            styles.fab,
            {
              right: 16,
              bottom: 76,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.fabButton}
            onPress={() => {
              void fetchDashboard({ allowHistoricalFallback: false });
            }}
          >
            <MaterialIcons name="today" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Pit Stop Context Picker */}
      <Modal
        visible={showPitStopContextPicker}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPitStopContextPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPitStopContextPicker(false)}
        >
          <View style={styles.ridePickerContainer}>
            <View style={styles.ridePickerHeader}>
              <Text style={styles.ridePickerTitle}>Set Pit Stop Context</Text>
              <TouchableOpacity onPress={() => setShowPitStopContextPicker(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.ridePickerList}>
              {availablePitStopStagesForUser.map((stage) => {
                const isSelected = managedPitStopStageNumber === stage.stageNumber;
                return (
                  <TouchableOpacity
                    key={`pit-stop-context-${stage.stageNumber}`}
                    style={[styles.ridePickerItem, isSelected && styles.ridePickerItemSelected]}
                    onPress={() => {
                      void handleSelectPitStopContext(stage.stageNumber);
                    }}
                  >
                    <View>
                      <Text style={[styles.ridePickerItemName, isSelected && styles.ridePickerItemNameSelected]}>
                        PS{stage.stageNumber}
                      </Text>
                      <Text style={styles.ridePickerItemDate}>{stage.name}</Text>
                    </View>
                    {isSelected && <MaterialIcons name="check-circle" size={20} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    gap: 12,
  },
  menuButton: {
    padding: 4,
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
    padding: 12,
  },
  riderIcon: {
    width: 1,
    height: 1,
    margin: 3,
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
    marginTop: 2,
  },
  riderContactText: {
    fontSize: 8,
    color: COLORS.white,
    textAlign: 'center',
    marginTop: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  riderCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    width: WINDOW_WIDTH * 0.88,
    maxWidth: 420,
    maxHeight: '80%',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  riderCardScroll: {
    flexGrow: 0,
  },
  riderCardScrollContent: {
    paddingBottom: 4,
  },
  riderCardLoadingState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  riderCardLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  riderCardErrorText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  riderCardHeader: {
    alignItems: 'center',
  },
  riderCardIcon: {
    marginBottom: 8,
  },
  riderCardId: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  riderCardName: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  riderCardContact: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  riderCardSection: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  riderCardSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  riderStageRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  riderStageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  riderStageNameChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  riderQuitChip: {
    backgroundColor: COLORS.danger,
  },
  riderStageNameChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  riderStageTime: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  riderStageWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFF8E1',
  },
  riderStageWarningMark: {
    fontSize: 14,
    lineHeight: 14,
    fontWeight: '900',
    color: '#92400E',
  },
  riderSpecialStatusTime: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  closeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'center',
  },
  closeButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    height: 60,
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
