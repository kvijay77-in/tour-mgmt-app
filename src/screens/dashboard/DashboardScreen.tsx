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
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialIcons } from '@expo/vector-icons';
import { useTour } from '../../context/TourContext';
import { useAuth } from '../../context/AuthContext';
import { getActiveRide, listRides } from '../../services/api/rideApi';
import { getDashboardData } from '../../services/api/dashboardApi';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import { logger } from '../../utils/logger';
import { Ride, Rider, CheckIn, RiderStatus, CheckInStatus, Permission, UserRole } from '../../types/models';
import { COLORS, CHECK_IN_STATUS_COLORS, getStageColor, STAGE_VIEW_COLORS } from '../../constants/colors';
import { SortIcon } from '../../components/common/SortIcon';
import { hasPermission } from '../../utils/permissions';
import CheckInScreen from '../checkin/CheckInScreen';
import RideStatusManagementScreen from '../admin/RideStatusManagementScreen';

const { width: WINDOW_WIDTH } = Dimensions.get('window');

/**
 * Build RiderStatus[] from dashboard API response data.
 */
function buildRiderStatuses(ride: Ride, riders: Rider[], checkIns: CheckIn[]): RiderStatus[] {
  return riders.map((rider) => {
    const riderCheckIns = checkIns
      .filter((ci) => ci.riderId === rider.riderId && ci.rideId === ride.rideId)
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

    const lastStage = lastRegularCheckIn
      ? ride.stages.find((s) => s.stageNumber === lastRegularCheckIn.stageNumber)
      : undefined;

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

export default function DashboardScreen() {
  const { width, height } = useWindowDimensions();
  const { tour, isLoading: isTourLoading, error: tourError, refresh: refreshTour } = useTour();
  const {
    user,
    logout,
    changePassword,
    isAuthenticating: isAuthBusy,
    error: authError,
  } = useAuth();

  const [ride, setRide] = useState<Ride | null>(null);
  const [allRides, setAllRides] = useState<Ride[]>([]);
  const [isHistorical, setIsHistorical] = useState(false);
  const [showRidePicker, setShowRidePicker] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [allRiderStatuses, setAllRiderStatuses] = useState<RiderStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageViewId, setStageViewId] = useState<string | undefined>(undefined);
  const [isSorted, setIsSorted] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 3 | 4>(1);
  const [selectedRider, setSelectedRider] = useState<RiderStatus | null>(null);
  const [isRiderCardVisible, setIsRiderCardVisible] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showRideStatusManagement, setShowRideStatusManagement] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);
  const [isSkippedHighlightEnabled, setIsSkippedHighlightEnabled] = useState(true);

  // RBAC: can this user perform check-ins?
  const canCheckIn = user ? hasPermission(user.userRole, Permission.CHECKIN_RIDER) : false;
  const isAdministrator = user?.userRole === UserRole.ADMINISTRATOR;

  // Load a specific ride's dashboard data
  const loadRideDashboard = useCallback(async (
    targetRide: Ride,
    historical: boolean,
    options?: { background?: boolean }
  ) => {
    const isBackgroundRefresh = options?.background === true;

    if (!isBackgroundRefresh) {
      setIsLoading(true);
      setError(null);
    }
    setRide(targetRide);
    setIsHistorical(historical);
    try {
      const { data } = await getDashboardData(tour!.tourId, targetRide.rideId);
      if (!data) {
        if (!isBackgroundRefresh) {
          setError('No dashboard data available.');
          setIsLoading(false);
        }
        return;
      }

      const dashRide = data.ride ?? targetRide;
      if (!Array.isArray(dashRide.stages) || dashRide.stages.length === 0) {
        if (!isBackgroundRefresh) {
          setError('Ride has no stages configured. Please contact the tour administrator.');
        }
        setRide(dashRide);
        if (!isBackgroundRefresh) {
          setIsLoading(false);
        }
        return;
      }

      const riders = Array.isArray(data.riders) ? data.riders : [];
      const checkIns = Array.isArray(data.checkIns) ? data.checkIns : [];

      setRide(dashRide);
      setAllRiderStatuses(buildRiderStatuses(dashRide, riders, checkIns));
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
      if (!isBackgroundRefresh) {
        setIsLoading(false);
      }
    }
  }, [tour]);

  // Fetch data from API — tries today's ride first, then falls back to most recent
  const fetchDashboard = useCallback(async () => {
    if (!tour) return;
    setIsLoading(true);
    setError(null);
    try {
      // Fetch ride list for the selector
      const rides = await listRides(tour.tourId);
      // Sort by date descending (most recent first)
      const sortedRides = [...rides].sort((a, b) => b.date.localeCompare(a.date));
      setAllRides(sortedRides);

      // Try today's ride first
      const activeRide = await getActiveRide(tour.tourId);
      if (activeRide) {
        setIsHistorical(false);
        setRide(activeRide);

        const { data } = await getDashboardData(tour.tourId, activeRide.rideId);
        if (!data) {
          setError('No dashboard data available.');
          setIsLoading(false);
          return;
        }

        const dashRide = data.ride ?? activeRide;
        if (!Array.isArray(dashRide.stages) || dashRide.stages.length === 0) {
          setError('Ride has no stages configured. Please contact the tour administrator.');
          setRide(dashRide);
          setIsLoading(false);
          return;
        }

        const riders = Array.isArray(data.riders) ? data.riders : [];
        const checkIns = Array.isArray(data.checkIns) ? data.checkIns : [];

        setRide(dashRide);
        setAllRiderStatuses(buildRiderStatuses(dashRide, riders, checkIns));
      } else if (sortedRides.length > 0) {
        // Fall back to the most recent ride (historical/read-only)
        await loadRideDashboard(sortedRides[0], true);
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
      setIsLoading(false);
    }
  }, [tour, loadRideDashboard]);

  // Switch to a specific ride from the picker
  const switchToRide = useCallback((selectedRide: Ride) => {
    setShowRidePicker(false);
    // Determine if this is today's ride
    const today = new Date().toISOString().split('T')[0];
    const historical = selectedRide.date !== today;
    loadRideDashboard(selectedRide, historical);
  }, [loadRideDashboard]);

  useEffect(() => {
    if (!isTourLoading && tour) {
      fetchDashboard();
    } else if (!isTourLoading && !tour) {
      // Tour loading finished but no tour found — stop loading spinner
      setIsLoading(false);
    }
  }, [isTourLoading, tour, fetchDashboard]);

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
    return riderStatus.checkInHistory.some(
      (ci) => ci.stageNumber === stageNumber && !ci.isNotRiding && !ci.isQuitRiding
    );
  }, []);

  const hasRegularCheckInAfterStage = useCallback((riderStatus: RiderStatus, stageNumber: number): boolean => {
    return riderStatus.checkInHistory.some(
      (ci) => ci.stageNumber > stageNumber && !ci.isNotRiding && !ci.isQuitRiding
    );
  }, []);

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
  const handleRiderTap = (riderStatus: RiderStatus) => {
    if (zoomLevel === 1 || zoomLevel === 2) {
      setSelectedRider(riderStatus);
      setIsRiderCardVisible(true);
    }
  };

  const resetChangePasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordFormError(null);
  };

  const handleOpenChangePassword = () => {
    setShowHeaderMenu(false);
    resetChangePasswordForm();
    setShowChangePasswordModal(true);
  };

  const handleCloseChangePassword = () => {
    setShowChangePasswordModal(false);
    resetChangePasswordForm();
  };

  const handleSubmitChangePassword = async () => {
    setPasswordFormError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordFormError('Please fill in all password fields.');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordFormError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFormError('New password and confirm password do not match.');
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordFormError('New password must be different from current password.');
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      handleCloseChangePassword();
    } catch {
      // AuthContext already sets a user-friendly error message.
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
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!ride) {
    return (
      <View style={[styles.container, styles.centeredContent]}>
        <Text style={styles.errorText}>No active ride found.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchDashboard}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.rideTitle}>{ride.name}</Text>
            {isHistorical && (
              <View style={styles.historicalBadge}>
                <Text style={styles.historicalBadgeText}>Historical</Text>
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.dateSelector}
              onPress={() => setShowRidePicker(true)}
              disabled={allRides.length <= 1}
            >
              <Text style={styles.rideDate}>{ride.date}</Text>
              {allRides.length > 1 && (
                <MaterialIcons name="arrow-drop-down" size={20} color={COLORS.white} />
              )}
            </TouchableOpacity>
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
        onRequestClose={() => setIsRiderCardVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsRiderCardVisible(false)}
        >
          <View style={styles.riderCard}>
            {selectedRider && (
              <>
                <MaterialIcons 
                  name="account-circle" 
                  size={80} 
                  color={COLORS.gray[400]} 
                  style={styles.riderCardIcon}
                />
                <Text style={styles.riderCardId}>{selectedRider.rider.riderId}</Text>
                <Text style={styles.riderCardName}>{selectedRider.rider.name}</Text>
                <Text style={styles.riderCardContact}>{selectedRider.rider.phone || 'N/A'}</Text>
                <TouchableOpacity 
                  style={styles.closeButton}
                  onPress={() => setIsRiderCardVisible(false)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header Floating Menu */}
      <Modal
        visible={showHeaderMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowHeaderMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowHeaderMenu(false)}
        >
          <View style={styles.menuPanel}>
            <TouchableOpacity
              style={styles.menuCloseButton}
              onPress={() => setShowHeaderMenu(false)}
            >
              <MaterialIcons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleOpenChangePassword}>
              <MaterialIcons name="lock-reset" size={18} color={COLORS.textPrimary} />
              <Text style={styles.menuItemText}>Change password</Text>
            </TouchableOpacity>
            {isAdministrator && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => {
                  setShowHeaderMenu(false);
                  setShowRideStatusManagement(true);
                }}
              >
                <MaterialIcons name="route" size={18} color={COLORS.textPrimary} />
                <Text style={styles.menuItemText}>Ride status management</Text>
              </TouchableOpacity>
            )}
            {selectedStage && (
              <View style={styles.menuSwitchItem}>
                <View style={styles.menuSwitchLabelWrap}>
                  <MaterialIcons name="warning-amber" size={18} color={COLORS.warning} />
                  <Text style={styles.menuItemText}>Show skipped Check-In</Text>
                </View>
                <Switch
                  value={isSkippedHighlightEnabled}
                  onValueChange={setIsSkippedHighlightEnabled}
                  thumbColor={COLORS.white}
                  trackColor={{ false: COLORS.gray[400], true: COLORS.primary }}
                />
              </View>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setShowHeaderMenu(false);
                await logout();
              }}
            >
              <MaterialIcons name="logout" size={18} color={COLORS.textPrimary} />
              <Text style={styles.menuItemText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Change Password Popup */}
      <Modal
        visible={showChangePasswordModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCloseChangePassword}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={handleCloseChangePassword}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.changePasswordCard}>
              <View style={styles.changePasswordHeader}>
                <Text style={styles.changePasswordTitle}>Change Password</Text>
                <TouchableOpacity onPress={handleCloseChangePassword}>
                  <MaterialIcons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {(passwordFormError || authError) && (
                <View style={styles.changePasswordErrorBanner}>
                  <MaterialIcons name="error-outline" size={18} color={COLORS.danger} />
                  <Text style={styles.changePasswordErrorText}>{passwordFormError || authError}</Text>
                </View>
              )}

              <View style={styles.changePasswordFieldGroup}>
                <Text style={styles.changePasswordLabel}>Current password</Text>
                <TextInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="password"
                  placeholder="Enter current password"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.changePasswordInput}
                  editable={!isAuthBusy}
                />
              </View>

              <View style={styles.changePasswordFieldGroup}>
                <Text style={styles.changePasswordLabel}>New password</Text>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="newPassword"
                  placeholder="Enter new password"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.changePasswordInput}
                  editable={!isAuthBusy}
                />
              </View>

              <View style={styles.changePasswordFieldGroup}>
                <Text style={styles.changePasswordLabel}>Confirm new password</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  textContentType="newPassword"
                  placeholder="Re-enter new password"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.changePasswordInput}
                  editable={!isAuthBusy}
                  onSubmitEditing={handleSubmitChangePassword}
                />
              </View>

              <View style={styles.changePasswordActions}>
                <TouchableOpacity
                  style={styles.changePasswordCancelButton}
                  onPress={handleCloseChangePassword}
                  disabled={isAuthBusy}
                >
                  <Text style={styles.changePasswordCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.changePasswordSaveButton, isAuthBusy && styles.changePasswordSaveButtonDisabled]}
                  onPress={handleSubmitChangePassword}
                  disabled={isAuthBusy}
                >
                  {isAuthBusy ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.changePasswordSaveButtonText}>Update</Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
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
                setShowCheckIn(true);
              }
            }}
          >
            <MaterialIcons name="qr-code-scanner" size={28} color={COLORS.white} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Check-In Screen Modal */}
      {ride && (
        <Modal
          visible={showCheckIn}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowCheckIn(false)}
        >
          <CheckInScreen
            ride={ride}
            onCheckInComplete={() => {
              // Refresh dashboard data after a check-in
              if (tour && ride) {
                loadRideDashboard(ride, false, { background: true });
              }
            }}
            onClose={() => setShowCheckIn(false)}
          />
        </Modal>
      )}

      {/* Ride Status Management Screen Modal (Admin only) */}
      {tour && isAdministrator && (
        <Modal
          visible={showRideStatusManagement}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowRideStatusManagement(false)}
        >
          <RideStatusManagementScreen
            tourId={tour.tourId}
            onClose={() => setShowRideStatusManagement(false)}
            onStatusChanged={fetchDashboard}
          />
        </Modal>
      )}

      {/* Ride Picker Modal */}
      <Modal
        visible={showRidePicker}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRidePicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowRidePicker(false)}
        >
          <View style={styles.ridePickerContainer}>
            <View style={styles.ridePickerHeader}>
              <Text style={styles.ridePickerTitle}>Select Ride</Text>
              <TouchableOpacity onPress={() => setShowRidePicker(false)}>
                <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.ridePickerList}>
              {allRides.map((r) => {
                const isSelected = r.rideId === ride?.rideId;
                const today = new Date().toISOString().split('T')[0];
                const isToday = r.date === today;
                return (
                  <TouchableOpacity
                    key={r.rideId}
                    style={[styles.ridePickerItem, isSelected && styles.ridePickerItemSelected]}
                    onPress={() => switchToRide(r)}
                  >
                    <View>
                      <Text style={[styles.ridePickerItemName, isSelected && styles.ridePickerItemNameSelected]}>
                        {r.name}
                      </Text>
                      <Text style={styles.ridePickerItemDate}>
                        {r.date}{isToday ? ' (Today)' : ''}
                      </Text>
                    </View>
                    <Text style={styles.ridePickerItemStatus}>{r.status}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </GestureHandlerRootView>
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
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    padding: 4,
  },
  rideTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  rideDate: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.9,
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
    padding: 24,
    width: WINDOW_WIDTH * 0.8,
    maxWidth: 300,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  riderCardIcon: {
    marginBottom: 12,
  },
  riderCardId: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  riderCardName: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  riderCardContact: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  closeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  closeButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  menuPanel: {
    position: 'absolute',
    top: 84,
    right: 12,
    backgroundColor: COLORS.white,
    borderRadius: 10,
    minWidth: 260,
    maxWidth: WINDOW_WIDTH * 0.86,
    paddingVertical: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  menuCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
    zIndex: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuSwitchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuSwitchLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  menuItemText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  changePasswordCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 16,
    width: WINDOW_WIDTH * 0.9,
    maxWidth: 420,
  },
  changePasswordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  changePasswordTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  changePasswordErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 10,
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  changePasswordErrorText: {
    fontSize: 13,
    color: COLORS.danger,
    flex: 1,
  },
  changePasswordFieldGroup: {
    marginTop: 12,
  },
  changePasswordLabel: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '600',
    marginBottom: 6,
  },
  changePasswordInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    fontSize: 15,
    color: COLORS.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  changePasswordActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  changePasswordCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.gray[100],
  },
  changePasswordCancelButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  changePasswordSaveButton: {
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  changePasswordSaveButtonDisabled: {
    opacity: 0.7,
  },
  changePasswordSaveButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
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
  ridePickerContainer: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '60%',
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  ridePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  ridePickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  ridePickerList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  ridePickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  ridePickerItemSelected: {
    backgroundColor: COLORS.primary + '10',
  },
  ridePickerItemName: {
    fontSize: 16,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  ridePickerItemNameSelected: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  ridePickerItemDate: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  ridePickerItemStatus: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
});
