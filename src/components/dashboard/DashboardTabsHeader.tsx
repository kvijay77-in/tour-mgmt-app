import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome5, MaterialIcons, Entypo } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { useRideSession } from '../../context/RideSessionContext';
import { useTour } from '../../context/TourContext';
import { useAuth } from '../../context/AuthContext';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { useOffline } from '../../context/OfflineContext';
import { closePitStopStage, openPitStopStage } from '../../services/api/rideApi';
import { loadRides as loadRidesCacheThrough } from '../../services/offline/offlineDataService';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import {
  clearPitStopContextStageNumber,
  loadPitStopContextStageNumber,
  savePitStopContextStageNumber,
} from '../../services/config/pitStopContextService';
import {
  MIN_SCAN_PAUSE_SECONDS,
  normalizeScanPauseSeconds,
} from '../../services/config/scanPauseConfigService';
import { canUseAdvancedSettings, getPitStopStageNumbersFromRoles, isPitStopUserRole } from '../../utils/permissions';
import { AppStackParamList } from '../../types/navigation';
import { CheckIn, CheckInStatus, Ride, RideStatus, Stage, StageType, UserRole } from '../../types/models';
import StageFilterBar from './StageFilterBar';
import { AppMenu } from '../common/AppMenu';
import OfflineBanner from '../common/OfflineBanner';
import { useVisibleModules } from '../../navigation/modules';
import { getLocalToday } from '../../utils/dates';

function resolveTodayRideFromList(rides: Ride[]): Ride | null {
  const today = getLocalToday();
  const todayRides = rides.filter((ride) => ride.date === today);

  if (todayRides.length === 0) {
    return null;
  }

  return todayRides.find((candidate) => candidate.status === 'STARTED' || candidate.status === 'OPEN')
    ?? todayRides[0];
}

function getStageCounts(ride: Ride, checkIns: CheckIn[]): Record<string, number> {
  const counts: Record<string, number> = {};

  ride.stages.forEach((stage) => {
    counts[stage.stageId] = 0;
  });

  const latestByRider = new Map<string, {
    status: CheckInStatus;
    lastRegularStageNumber: number | null;
  }>();

  for (const checkIn of checkIns) {
    if (checkIn.rideId !== ride.rideId) continue;

    const current = latestByRider.get(checkIn.riderId) ?? {
      status: CheckInStatus.NOT_CHECKED_IN,
      lastRegularStageNumber: null,
    };

    if (checkIn.isNotRiding) {
      current.status = CheckInStatus.NOT_RIDING;
    } else if (checkIn.isQuitRiding) {
      if (current.status !== CheckInStatus.NOT_RIDING) {
        current.status = CheckInStatus.QUIT_RIDING;
      }
    } else if (typeof checkIn.stageNumber === 'number') {
      current.status = CheckInStatus.CHECKED_IN;
      if (current.lastRegularStageNumber === null || checkIn.stageNumber > current.lastRegularStageNumber) {
        current.lastRegularStageNumber = checkIn.stageNumber;
      }
    }

    latestByRider.set(checkIn.riderId, current);
  }

  for (const stage of ride.stages) {
    counts[stage.stageId] = Array.from(latestByRider.values()).filter((rider) => {
      if (rider.status === CheckInStatus.NOT_RIDING) return false;
      return rider.lastRegularStageNumber !== null && rider.lastRegularStageNumber >= stage.stageNumber;
    }).length;
  }

  counts.NR = Array.from(latestByRider.values()).filter((rider) => rider.status === CheckInStatus.NOT_RIDING).length;
  counts.QR = Array.from(latestByRider.values()).filter((rider) => rider.status === CheckInStatus.QUIT_RIDING).length;

  return counts;
}

export default function DashboardTabsHeader() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const insets = useSafeAreaInsets();
  const { tour } = useTour();
  const { user } = useAuth();
  const { requestLogout, pendingCount, failedCount } = useSyncStatus();
  const { isOffline, isOfflineSupported } = useOffline();
  // Pit-stop open/close is an online-only action.
  const isPitStopActionBlocked = isOffline || Boolean(user?.isOfflineSession);
  const { hasHome } = useVisibleModules();
  const {
    currentRide,
    isHistorical,
    selectedStageNumber,
    selectedSpecial,
    checkIns,
    isSorted,
    scanPauseSeconds,
    setCurrentRide,
    updateCurrentRide,
    setSelectedStage,
    setSelectedSpecial,
    setScanPauseSeconds,
    toggleSort,
  } = useRideSession();

  const [allRides, setAllRides] = useState<Ride[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showPitStopContextPicker, setShowPitStopContextPicker] = useState(false);
  const [showScanPauseConfigModal, setShowScanPauseConfigModal] = useState(false);
  const [scanPauseInput, setScanPauseInput] = useState(String(scanPauseSeconds));
  const [managedPitStopStageNumber, setManagedPitStopStageNumber] = useState<number | null>(null);
  const [showPitStopManagementModal, setShowPitStopManagementModal] = useState(false);
  const [selectedPitStopStageNumber, setSelectedPitStopStageNumber] = useState<number | null>(null);
  const [isPitStopActionSubmitting, setIsPitStopActionSubmitting] = useState(false);

  const stageCounts = useMemo(() => {
    if (!currentRide) return {} as Record<string, number>;
    return getStageCounts(currentRide, checkIns);
  }, [currentRide, checkIns]);

  const loadRides = useCallback(async () => {
    if (!tour) {
      setAllRides([]);
      return;
    }

    try {
      const { data: rides } = await loadRidesCacheThrough(tour.tourId);
      const sortedRides = [...rides].sort((a, b) => b.date.localeCompare(a.date));
      setAllRides(sortedRides);
    } catch {
      // Header remains usable even if ride list is temporarily unavailable.
      setAllRides([]);
    }
  }, [tour]);

  useEffect(() => {
    void loadRides();
  }, [loadRides]);

  const handleSelectRide = useCallback((ride: Ride) => {
    const today = getLocalToday();
    setCurrentRide(ride, ride.date !== today);
  }, [setCurrentRide]);

  const handleBackToToday = useCallback(() => {
    const todayRide = resolveTodayRideFromList(allRides);
    if (!todayRide) {
      Alert.alert('No ride for today', 'Could not find a ride for today in the available ride list.');
      return;
    }

    setCurrentRide(todayRide, false);
  }, [allRides, setCurrentRide]);

  const isAdministrator = user?.userRole === UserRole.ADMINISTRATOR;
  const isSuperUser = user?.userRole === UserRole.SUPER_USER;
  const isPitStopPrimaryRole = user ? isPitStopUserRole(user.userRole) : false;

  const pitStopRoleStageNumbers = useMemo(
    () => getPitStopStageNumbersFromRoles(user?.userRoles ?? []),
    [user?.userRoles],
  );

  const availablePitStopStagesForUser = useMemo(() => {
    if (!currentRide || !isPitStopPrimaryRole) return [] as Array<{ stageNumber: number; name: string }>;

    return currentRide.stages
      .filter((s) => s.type === StageType.PIT_STOP && pitStopRoleStageNumbers.includes(s.stageNumber))
      .map((s) => ({ stageNumber: s.stageNumber, name: s.name }));
  }, [currentRide, isPitStopPrimaryRole, pitStopRoleStageNumbers]);

  const availablePitStopStageNumbers = useMemo(
    () => availablePitStopStagesForUser.map((s) => s.stageNumber),
    [availablePitStopStagesForUser],
  );

  const availablePitStopStagesForManagement = useMemo(() => {
    if (!currentRide) return [] as Stage[];

    const pitStopStages = currentRide.stages
      .filter((stage) => stage.type === StageType.PIT_STOP)
      .sort((a, b) => a.stageNumber - b.stageNumber);

    if (isAdministrator || isSuperUser) {
      return pitStopStages;
    }

    if (pitStopRoleStageNumbers.length > 0) {
      return pitStopStages.filter((stage) => pitStopRoleStageNumbers.includes(stage.stageNumber));
    }

    return [] as Stage[];
  }, [currentRide, isAdministrator, isSuperUser, pitStopRoleStageNumbers]);

  const selectedPitStopStageForManagement = useMemo(() => {
    if (!currentRide || selectedPitStopStageNumber === null) return null;
    return currentRide.stages.find(
      (stage) => stage.type === StageType.PIT_STOP && stage.stageNumber === selectedPitStopStageNumber,
    ) ?? null;
  }, [currentRide, selectedPitStopStageNumber]);

  useEffect(() => {
    if (!currentRide || !isPitStopPrimaryRole) {
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
  }, [currentRide, currentRide?.rideId, isPitStopPrimaryRole, availablePitStopStageNumbers]);

  const handleSelectPitStopContext = useCallback(async (stageNumber: number) => {
    await savePitStopContextStageNumber(stageNumber);
    setManagedPitStopStageNumber(stageNumber);
    setShowPitStopContextPicker(false);
  }, []);

  const handleOpenScanPauseConfig = useCallback(() => {
    setScanPauseInput(String(scanPauseSeconds));
    setShowScanPauseConfigModal(true);
  }, [scanPauseSeconds]);

  const handleSaveScanPauseConfig = useCallback(() => {
    const parsed = Number.parseInt(scanPauseInput, 10);
    if (!Number.isFinite(parsed)) {
      Alert.alert('Invalid value', `Enter pause time in seconds (minimum ${MIN_SCAN_PAUSE_SECONDS}).`);
      return;
    }

    if (parsed < MIN_SCAN_PAUSE_SECONDS) {
      Alert.alert('Invalid value', `Minimum pause time is ${MIN_SCAN_PAUSE_SECONDS} seconds.`);
      return;
    }

    setScanPauseSeconds(normalizeScanPauseSeconds(parsed));
    setShowScanPauseConfigModal(false);
  }, [scanPauseInput, setScanPauseSeconds]);

  const getPitStopActionErrorMessage = useCallback((err: unknown): string => {
    const isApiErr = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
    if (isApiErr) {
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
    updateCurrentRide(updatedRide, isHistorical);
    setAllRides((prev) => prev.map((ride) => (ride.rideId === updatedRide.rideId ? updatedRide : ride)));

    const updatedSelectedStage = updatedRide.stages.find(
      (stage) => stage.type === StageType.PIT_STOP && stage.stageNumber === selectedPitStopStageNumber,
    );

    if (!updatedSelectedStage) {
      setShowPitStopManagementModal(false);
      setSelectedPitStopStageNumber(null);
    }
  }, [isHistorical, selectedPitStopStageNumber, updateCurrentRide]);

  const handleOpenPitStop = useCallback(async () => {
    if (!tour || !currentRide || !selectedPitStopStageForManagement) return;

    setIsPitStopActionSubmitting(true);
    try {
      const updatedRide = await openPitStopStage(
        tour.tourId,
        currentRide.rideId,
        selectedPitStopStageForManagement.stageNumber,
      );
      applyUpdatedRideFromPitStopAction(updatedRide);
    } catch (err) {
      Alert.alert('Unable to open pit stop', getPitStopActionErrorMessage(err));
    } finally {
      setIsPitStopActionSubmitting(false);
    }
  }, [tour, currentRide, selectedPitStopStageForManagement, applyUpdatedRideFromPitStopAction, getPitStopActionErrorMessage]);

  const handleClosePitStop = useCallback(async () => {
    if (!tour || !currentRide || !selectedPitStopStageForManagement) return;

    setIsPitStopActionSubmitting(true);
    try {
      const updatedRide = await closePitStopStage(
        tour.tourId,
        currentRide.rideId,
        selectedPitStopStageForManagement.stageNumber,
      );
      applyUpdatedRideFromPitStopAction(updatedRide);
    } catch (err) {
      Alert.alert('Unable to close pit stop', getPitStopActionErrorMessage(err));
    } finally {
      setIsPitStopActionSubmitting(false);
    }
  }, [tour, currentRide, selectedPitStopStageForManagement, applyUpdatedRideFromPitStopAction, getPitStopActionErrorMessage]);

  const isRideCompletedOrClosed = currentRide?.status === RideStatus.COMPLETED || currentRide?.status === RideStatus.CLOSED;
  const showPitStopManagementOption = !isHistorical
    && !isRideCompletedOrClosed
    && availablePitStopStagesForManagement.length > 0;

  const selectedPitStopStatus = selectedPitStopStageForManagement?.pitStopStatus ?? null;
  const canOpenSelectedPitStop = selectedPitStopStatus === null && !isPitStopActionBlocked;
  const canCloseSelectedPitStop = selectedPitStopStatus === 'OPEN' && !isPitStopActionBlocked;

  const formatDateTimeForDisplay = (value?: string): string => {
    if (!value) return 'N/A';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString();
  };

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {hasHome && (
            <TouchableOpacity
              onPress={() => navigation.navigate('Home', undefined, { pop: true })}
              style={styles.homeButton}
              accessibilityRole="button"
              accessibilityLabel="Go to Home"
            >
              <MaterialIcons name="home" size={22} color={COLORS.white} />
            </TouchableOpacity>
          )}
          {currentRide ? (
            <TouchableOpacity
              style={styles.rideTitleButton}
              onPress={() => navigation.navigate('RideInfo', { ride: currentRide, source: 'dashboard' })}
              accessibilityRole="button"
              accessibilityLabel="Open ride details"
              accessibilityHint="Shows details for the selected ride"
            >
              <Text style={styles.rideTitle}>{currentRide.name}</Text>
              {/* <MaterialIcons name="info-outline" size={18} color={COLORS.white} /> */}
              <FontAwesome5 name="info-circle" size={18} color={COLORS.white} />
            </TouchableOpacity>
          ) : (
            <Text style={styles.rideTitle}>No active ride</Text>
          )}
        </View>

        <View style={styles.headerActions}>
          {isHistorical && (
            <TouchableOpacity onPress={handleBackToToday} style={styles.menuButton}>
              <MaterialIcons name="today" size={22} color={COLORS.white} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              void loadRides();
              setIsMenuOpen(true);
            }}
            style={styles.menuCircleButton}
          >
            {/* <MaterialIcons name="menu" size={18} color={COLORS.primary} /> */}
            <Entypo name="menu" size={20} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {isOfflineSupported && <OfflineBanner variant="compact" captureLabel="Check-ins" />}

      {isHistorical && (
        <View style={styles.historicalWrap}>
          <View style={styles.historicalBadge}>
            <Text style={styles.historicalBadgeText}>Historical</Text>
          </View>
        </View>
      )}

      {currentRide && (
        <StageFilterBar
          stages={currentRide.stages}
          stageCounts={stageCounts}
          totalStages={currentRide.stages.length}
          selectedStageNumber={selectedStageNumber}
          selectedSpecial={selectedSpecial}
          isSorted={isSorted}
          onToggleSort={() => toggleSort()}
          onSelectStage={(n) => {
            setSelectedStage(n);
            if (n !== null) setSelectedSpecial(null);
          }}
          onSelectSpecial={(s) => {
            setSelectedSpecial(s);
            if (s !== null) setSelectedStage(null);
          }}
        />
      )}

      <AppMenu
        visible={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        showAccountOptions={!hasHome}
        rides={allRides}
        currentRideId={currentRide?.rideId ?? null}
        onSelectRide={handleSelectRide}
        onViewRideInfo={(ride) => navigation.navigate('RideInfo', { ride, source: 'menu' })}
        showPitStopContextOption={isPitStopPrimaryRole && availablePitStopStagesForUser.length > 1}
        managedPitStopStageNumber={managedPitStopStageNumber}
        onOpenPitStopContextPicker={() => setShowPitStopContextPicker(true)}
        showPitStopManagementOption={showPitStopManagementOption}
        pitStopManagementStages={availablePitStopStagesForManagement.map((stage) => ({
          stageNumber: stage.stageNumber,
          name: stage.name,
        }))}
        onOpenPitStopManagement={(stageNumber) => {
          setSelectedPitStopStageNumber(stageNumber);
          setShowPitStopManagementModal(true);
        }}
        showSkippedToggle={false}
        isSkippedHighlightEnabled={false}
        onToggleSkippedHighlight={() => {}}
        showScanPauseConfigOption={true}
        scanPauseSeconds={scanPauseSeconds}
        onOpenScanPauseConfig={handleOpenScanPauseConfig}
        onLogout={requestLogout}
        showAdvancedSettingsOption={canUseAdvancedSettings(user?.userRole)}
        unsentCount={pendingCount + failedCount}
      />

      <Modal
        visible={showScanPauseConfigModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowScanPauseConfigModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowScanPauseConfigModal(false)}
        >
          <TouchableOpacity
            style={styles.scanPauseCard}
            activeOpacity={1}
            onPress={() => {
              // Prevent closing when pressing inside modal card.
            }}
          >
            <Text style={styles.scanPauseTitle}>QR scan pause</Text>
            <Text style={styles.scanPauseSubtitle}>
              Set cooldown in seconds between scans of the same or any QR code.
            </Text>

            <Text style={styles.scanPauseInputLabel}>Pause time (seconds)</Text>
            <TextInput
              style={styles.scanPauseInput}
              value={scanPauseInput}
              onChangeText={(value) => setScanPauseInput(value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
              placeholder={`${MIN_SCAN_PAUSE_SECONDS}`}
              placeholderTextColor={COLORS.textDisabled}
            />
            <Text style={styles.scanPauseHint}>Minimum value: {MIN_SCAN_PAUSE_SECONDS} seconds</Text>

            <View style={styles.scanPauseActionRow}>
              <TouchableOpacity
                style={[styles.scanPauseActionButton, styles.scanPauseCancelButton]}
                onPress={() => setShowScanPauseConfigModal(false)}
              >
                <Text style={styles.scanPauseCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.scanPauseActionButton, styles.scanPauseSaveButton]}
                onPress={handleSaveScanPauseConfig}
              >
                <Text style={styles.scanPauseSaveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
              // Prevent closing when pressing inside modal card.
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

              {isPitStopActionBlocked && (
                <Text style={styles.pitStopManagementOfflineText}>
                  Opening or closing a pit stop needs a connection.
                </Text>
              )}

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
  header: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.primary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rideTitleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  homeButton: {
    paddingRight: 8,
    paddingVertical: 4,
  },
  rideTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuButton: {
    padding: 8,
    borderRadius: 16,
  },
  menuCircleButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historicalWrap: {
    marginBottom: 6,
  },
  historicalBadge: {
    alignSelf: 'flex-start',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ridePickerContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    width: '88%',
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
    width: '88%',
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
  pitStopManagementOfflineText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
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
  scanPauseCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    width: '88%',
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  scanPauseTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  scanPauseSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  scanPauseInputLabel: {
    marginTop: 12,
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  scanPauseInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    backgroundColor: COLORS.white,
  },
  scanPauseHint: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  scanPauseActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  scanPauseActionButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  scanPauseCancelButton: {
    backgroundColor: COLORS.gray[100],
  },
  scanPauseSaveButton: {
    backgroundColor: COLORS.primary,
  },
  scanPauseCancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  scanPauseSaveButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
});
