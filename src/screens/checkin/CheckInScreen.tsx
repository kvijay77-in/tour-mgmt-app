/**
 * CheckInScreen — QR-code-based rider check-in.
 *
 * Flow:
 * 1. Select check-in type (regular, Not Riding, Quit Riding)
 * 2. Scan rider QR code (contains rider ID)
 * 3. After 3 failed scans → manual Rider ID fallback
 * 4. Submit check-in to backend
 *
 * See docs/Requirements.md § Check-In and docs/SolutionDesign.md § Check-In Flow.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useTour } from '../../context/TourContext';
import { useRideSession } from '../../context/RideSessionContext';
import { HighlightedText } from '../../components/common/HighlightedText';
import StageFilterBar from '../../components/dashboard/StageFilterBar';
import { createInteractiveCheckIn, overrideInteractiveCheckIn } from '../../services/api/checkInApi';
import { publishDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { COLORS, QR_SCANNER_COLORS, getStageColor } from '../../constants/colors';
import { CheckIn, CheckInMethod, Permission, Ride, RideStatus, Stage, StageType } from '../../types/models';
import { CheckInRequest } from '../../types/api';
import { AppStackParamList } from '../../types/navigation';
import { getPitStopStageNumbersFromRoles, hasPermission, isPitStopUserRole } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import { getRiderById } from '../../services/database/riderStore';
import { playSuccess, playFailure, playScanTick } from '../../services/feedback/feedbackService';

const TAG = 'CheckInScreen';

/** Max QR scan retries before showing manual input */
const MAX_SCAN_RETRIES = 3;

/**
 * Supported QR payload formats:
 * 1) "R123" (riderId only)
 * 2) "R123|..." (pipe-delimited; first segment is riderId)
 */
function extractRiderIdFromQr(rawValue?: string): string | null {
  const value = rawValue?.trim();
  if (!value) return null;

  const riderId = value.includes('|') ? value.split('|')[0]?.trim() : value;
  return riderId || null;
}

type CheckInType = 'regular' | 'not_riding' | 'quit_riding';

interface CheckInScreenProps {
  ride?: Ride;
  /** Optional persisted pit-stop stage context chosen by the user */
  managedPitStopStageNumber?: number;
  /** Called when check-in completes successfully — dashboard can update local state */
  onCheckInComplete?: (checkIn: CheckIn) => void;
  /** Called when user closes the screen */
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Stage selector
// ---------------------------------------------------------------------------

function StageSelector({
  stages,
  selectedStage,
  onSelect,
  checkInType,
  rideStatus,
  allowedRegularStageNumbers,
}: {
  stages: Stage[];
  selectedStage: Stage | null;
  onSelect: (stage: Stage) => void;
  checkInType: CheckInType;
  rideStatus: RideStatus;
  allowedRegularStageNumbers?: number[];
}) {
  // For Not Riding, always use the Start stage
  const filteredStages = checkInType === 'not_riding'
    ? stages.filter((s) => s.type === StageType.START)
    : stages;

  const isStageEnabled = (stage: Stage): boolean => {
    if (checkInType === 'not_riding') {
      return rideStatus === RideStatus.OPEN;
    }

    if (checkInType === 'regular' && allowedRegularStageNumbers && allowedRegularStageNumbers.length > 0) {
      if (stage.type !== StageType.PIT_STOP) {
        return false;
      }
      if (!allowedRegularStageNumbers.includes(stage.stageNumber)) {
        return false;
      }
    }

    if (stage.type === StageType.START) {
      return rideStatus === RideStatus.OPEN;
    }

    return rideStatus === RideStatus.STARTED;
  };

  return (
    <View style={stageStyles.container}>
      <Text style={stageStyles.label}>
        {checkInType === 'not_riding' ? 'Stage (auto-selected)' : 'Select Stage'}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={stageStyles.scrollContent}>
        {filteredStages.map((stage) => {
          const isSelected = selectedStage?.stageId === stage.stageId;
          const color = getStageColor(stage.stageNumber, stages.length);
          const isEnabled = isStageEnabled(stage);
          return (
            <TouchableOpacity
              key={stage.stageId}
              style={[
                stageStyles.chip,
                { borderColor: color },
                isSelected && { backgroundColor: color },
                !isEnabled && stageStyles.chipDisabled,
              ]}
              onPress={() => onSelect(stage)}
              disabled={!isEnabled}
            >
              <Text
                style={[
                  stageStyles.chipText,
                  { color: isSelected ? COLORS.white : color },
                ]}
              >
                {stage.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const stageStyles = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 6 },
  scrollContent: { gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type Phase = 'type_select' | 'stage_select' | 'scanning' | 'manual_entry' | 'confirming' | 'success' | 'error';
type ErrorPresentation = 'error' | 'info' | 'warning';

export default function CheckInScreen({ ride: propRide, managedPitStopStageNumber, onCheckInComplete, onClose }: CheckInScreenProps) {
  const { user } = useAuth();
  const { tour } = useTour();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const {
    currentRide,
    isHistorical,
    selectedStageNumber,
    selectedSpecial,
    setSelectedStage: setContextSelectedStage,
    setSelectedSpecial,
    autoCheckIn,
    toggleAutoCheckIn,
    setCheckIns,
    checkIns,
  } = useRideSession();
  const isFocused = useIsFocused();

  const [phase, setPhase] = useState<Phase>('type_select');
  const [checkInType, setCheckInType] = useState<CheckInType>('regular');
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const [scannedRiderName, setScannedRiderName] = useState<string>('');
  const [scannedRiderId, setScannedRiderId] = useState<string>('');
  const [manualRiderId, setManualRiderId] = useState<string>('');
  const [scanAttempts, setScanAttempts] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [errorPresentation, setErrorPresentation] = useState<ErrorPresentation>('error');
  const processingRef = useRef(false);
  const autoStartAppliedRef = useRef(false);
  const bottomInsetPadding = Math.max(insets.bottom, 12);

  // Determine available check-in types based on role
  const canCheckInRegular = user ? hasPermission(user.userRole, Permission.CHECKIN_RIDER) : false;
  const canCheckInNR = user ? hasPermission(user.userRole, Permission.CHECKIN_NOT_RIDING) : false;
  const canCheckInQR = user ? hasPermission(user.userRole, Permission.CHECKIN_QUIT_RIDING) : false;
  const canManualCheckIn = user ? hasPermission(user.userRole, Permission.MANUAL_CHECKIN) : false;

  const isPitStopPrimaryRole = user ? isPitStopUserRole(user.userRole) : false;

  const pitStopRoleStageNumbers = useMemo(() => getPitStopStageNumbersFromRoles(user?.userRoles ?? []), [user?.userRoles]);
  // Use ride from prop or RideSession context.
  const activeRide = propRide ?? currentRide;

  const allowedRegularStageNumbers = useMemo(() => {
    if (!isPitStopPrimaryRole || !activeRide) return [] as number[];

    const ridePitStopStages = activeRide.stages
      .filter((s) => s.type === StageType.PIT_STOP)
      .map((s) => s.stageNumber);

    const roleAllowedStages = ridePitStopStages.filter((n) => pitStopRoleStageNumbers.includes(n));
    if (managedPitStopStageNumber !== undefined && roleAllowedStages.includes(managedPitStopStageNumber)) {
      return [managedPitStopStageNumber];
    }
    return roleAllowedStages;
  }, [isPitStopPrimaryRole, activeRide, pitStopRoleStageNumbers, managedPitStopStageNumber]);

  const hasSingleRegularPitStopStage = isPitStopPrimaryRole && allowedRegularStageNumbers.length === 1;

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!activeRide) return counts;

    for (const stage of activeRide.stages) {
      counts[stage.stageId] = 0;
    }

    let nr = 0;
    let qr = 0;
    for (const ci of checkIns ?? []) {
      if (ci.rideId !== activeRide.rideId) continue;
      if (ci.isNotRiding) nr += 1;
      else if (ci.isQuitRiding) qr += 1;
      else if (ci.stageId && counts[ci.stageId] !== undefined) counts[ci.stageId] += 1;
    }

    counts.NR = nr;
    counts.QR = qr;
    return counts;
  }, [activeRide, checkIns]);

  // Auto-select Start stage for NR
  useEffect(() => {
    if (checkInType === 'not_riding' && activeRide) {
      const startStage = activeRide.stages.find((s) => s.type === StageType.START);
      if (startStage) setSelectedStage(startStage);
    }
  }, [checkInType, activeRide]);

  // Sync local selectedStage from RideSession context selection (stageNumber)
  useEffect(() => {
    if (!activeRide) return;
    if (selectedStageNumber == null) return;
    const stage = activeRide.stages.find((s) => s.stageNumber === selectedStageNumber);
    if (stage) setSelectedStage(stage);
  }, [selectedStageNumber, activeRide]);

  // Resolve rider name from local cache for confirmation UI
  useEffect(() => {
    let mounted = true;
    if (!scannedRiderId) {
      setScannedRiderName('');
      return;
    }

    (async () => {
      try {
        const r = await getRiderById(scannedRiderId);
        if (!mounted) return;
        setScannedRiderName(r?.name ?? '');
      } catch (err) {
        logger.warn(TAG, 'Failed to resolve rider name', err);
      }
    })();

    return () => { mounted = false; };
  }, [scannedRiderId]);

  // If the component becomes focused and a managed pit-stop stage is provided, apply it to context.
  useEffect(() => {
    if (!isFocused || !isPitStopPrimaryRole || !managedPitStopStageNumber) return;
    if (!allowedRegularStageNumbers.includes(managedPitStopStageNumber)) return;
    if (selectedStageNumber == null) {
      setContextSelectedStage(managedPitStopStageNumber);
    }
  }, [isFocused, isPitStopPrimaryRole, managedPitStopStageNumber, allowedRegularStageNumbers, selectedStageNumber, setContextSelectedStage]);

  // -----------------------------------------------------------------------
  // Check-in type selection
  // -----------------------------------------------------------------------

  const getValidationMessage = useCallback((type: CheckInType, stage: Stage | null): string | null => {
    if (type === 'not_riding') {
      if (!activeRide || activeRide.status !== RideStatus.OPEN) {
        return `Not Riding check-ins are allowed only when today's ride status is OPEN. Current status: ${activeRide?.status ?? 'unknown'}.`;
      }
      return null;
    }

    if (type === 'quit_riding') {
      if (!activeRide || activeRide.status !== RideStatus.STARTED) {
        return `Quit Riding check-ins are allowed only when today's ride status is STARTED. Current status: ${activeRide?.status ?? 'unknown'}.`;
      }
      return null;
    }

    if (!stage) {
      return 'Please select a stage before continuing.';
    }

    if (type === 'regular' && isPitStopPrimaryRole) {
      if (stage.type !== StageType.PIT_STOP) {
        return 'Your role allows regular check-in only at an assigned Pit Stop stage.';
      }
      if (!allowedRegularStageNumbers.includes(stage.stageNumber)) {
        return 'Selected stage is not permitted for your pit-stop role mapping.';
      }
    }

    if (stage.type === StageType.START && (!activeRide || activeRide.status !== RideStatus.OPEN)) {
      return `Start stage check-ins are allowed only when today's ride status is OPEN. Current status: ${activeRide?.status ?? 'unknown'}.`;
    }

    if (stage.type !== StageType.START && (!activeRide || activeRide.status !== RideStatus.STARTED)) {
      return `This check-in type is allowed only when today's ride status is STARTED. Current status: ${activeRide?.status ?? 'unknown'}.`;
    }

    return null;
  }, [activeRide, isPitStopPrimaryRole, allowedRegularStageNumbers]);
  // include activeRide in dependencies to satisfy exhaustive-deps
  // (we read activeRide object in validation checks)

  const blockWithValidationMessage = useCallback((message: string) => {
    setErrorMessage(message);
    setErrorPresentation('warning');
    setPhase('error');
  }, []);

  // Fast path for pit-stop users with only one allowed regular stage.
  useEffect(() => {
    if (phase !== 'type_select') return;
    if (autoStartAppliedRef.current) return;
    if (!hasSingleRegularPitStopStage || !activeRide) return;

    const stage = activeRide.stages.find(
      (s) => s.stageNumber === allowedRegularStageNumbers[0] && s.type === StageType.PIT_STOP,
    );
    if (!stage) return;

    const validationError = getValidationMessage('regular', stage);
    if (validationError) return;

    setCheckInType('regular');
    setContextSelectedStage(stage.stageNumber);
    setSelectedStage(stage);
    setPhase('scanning');
    setScanAttempts(0);
    setScannedRiderId('');
    processingRef.current = false;
    autoStartAppliedRef.current = true;
  }, [phase, hasSingleRegularPitStopStage, activeRide, activeRide?.stages, allowedRegularStageNumbers, getValidationMessage, setContextSelectedStage]);

  const selectCheckInType = (type: CheckInType) => {
    if (type === 'not_riding') {
      const validationError = getValidationMessage(type, activeRide ? activeRide.stages.find((s) => s.type === StageType.START) ?? null : null);
      if (validationError) {
        blockWithValidationMessage(validationError);
        return;
      }
    }

    if (type === 'quit_riding') {
      const validationError = getValidationMessage(type, null);
      if (validationError) {
        blockWithValidationMessage(validationError);
        return;
      }
    }

    setCheckInType(type);
    // Single-screen flow: go to scanner and use shared stage context from header.
    if (type === 'quit_riding') {
      setSelectedStage(null);
    }
    setPhase('scanning');
  };

  const selectStageAndScan = (stage: Stage) => {
    const validationError = getValidationMessage(checkInType, stage);
    if (validationError) {
      blockWithValidationMessage(validationError);
      return;
    }

    setSelectedStage(stage);
    setContextSelectedStage(stage.stageNumber);
    setPhase('scanning');
    setScanAttempts(0);
    setScannedRiderId('');
    processingRef.current = false;
  };

  // -----------------------------------------------------------------------
  // QR Scanning
  // -----------------------------------------------------------------------

  // Submit check-in (declared before scanner handler to satisfy TDZ)
  const submitCheckIn = useCallback(async (overrideRequested: boolean = false) => {
    if (!tour || !scannedRiderId || !activeRide) return;

    const effectiveStage =
      checkInType === 'not_riding'
        ? (selectedStage ?? activeRide.stages.find((s) => s.type === StageType.START) ?? null)
        : selectedStage ?? (selectedStageNumber != null ? activeRide.stages.find((s) => s.stageNumber === selectedStageNumber) ?? null : null);

    if (checkInType !== 'quit_riding' && !effectiveStage) {
      blockWithValidationMessage('Start stage is required for this check-in type.');
      return;
    }

    const validationError = getValidationMessage(checkInType, effectiveStage);
    if (validationError) {
      blockWithValidationMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setErrorPresentation('error');
    try {
      const method: CheckInMethod =
        phase === 'confirming' && scanAttempts >= MAX_SCAN_RETRIES
          ? CheckInMethod.FALLBACK
          : manualRiderId.trim() === scannedRiderId
            ? CheckInMethod.MANUAL
            : CheckInMethod.QR_SCAN;

      const request: CheckInRequest = checkInType === 'quit_riding'
        ? {
            riderId: scannedRiderId,
            rideId: activeRide.rideId,
            method,
            isNotRiding: false,
            isQuitRiding: true,
          }
        : {
            riderId: scannedRiderId,
            rideId: activeRide.rideId,
            stageNumber: effectiveStage!.stageNumber,
            method,
            isNotRiding: checkInType === 'not_riding',
            isQuitRiding: false,
          };

      const outcome = overrideRequested
        ? await overrideInteractiveCheckIn(tour.tourId, request)
        : await createInteractiveCheckIn(tour.tourId, request);

      if (outcome.kind === 'override_required') {
        setIsSubmitting(false);
        Alert.alert(
          'Override existing check-in?',
          `${outcome.message}\n\nCancel keeps the current check-in unchanged. Override will replace it with the new status.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Override',
              style: 'destructive',
              onPress: () => {
                void submitCheckIn(true);
              },
            },
          ],
        );
        return;
      }

      if (outcome.kind === 'info_conflict') {
        logger.info(TAG, `Check-in informational outcome: ${outcome.reason}`, {
          riderId: scannedRiderId,
          checkInType,
          stageNumber: effectiveStage?.stageNumber ?? null,
        });
        setErrorMessage(outcome.message);
        setErrorPresentation(
          outcome.reason === 'quit_riding' || outcome.reason === 'not_riding' ? 'warning' : 'info',
        );
        setPhase('error');
        void playFailure('warning');
        return;
      }

      // Notify dashboard immediately so UI updates without a full reload.
      if (onCheckInComplete) onCheckInComplete(outcome.checkIn);
      else setCheckIns([outcome.checkIn, ...(checkIns ?? [])]);
      publishDashboardCheckInEvent({ checkIn: outcome.checkIn });

      const stageName = effectiveStage?.name ?? '—';
      const typeLabel =
        checkInType === 'not_riding' ? 'Not Riding' :
        checkInType === 'quit_riding' ? 'Quit Riding' :
        stageName;
      setResultMessage(`${scannedRiderId} — ${typeLabel} ✓`);
      setPhase('success');
      void playSuccess();
      logger.info(TAG, `Check-in recorded: ${scannedRiderId} at ${stageName} (${checkInType})`);
    } catch (err) {
      logger.error(TAG, 'Check-in submission failed', err);
      const message = err instanceof Error ? err.message : 'Check-in failed. Please try again.';
      setErrorMessage(message);
      setErrorPresentation('error');
      setPhase('error');
      void playFailure('error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    tour,
    scannedRiderId,
    activeRide,
    checkInType,
    selectedStage,
    selectedStageNumber,
    phase,
    scanAttempts,
    manualRiderId,
    onCheckInComplete,
    checkIns,
    setCheckIns,
    blockWithValidationMessage,
    getValidationMessage,
  ]);

  const handleBarcodeScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (processingRef.current) return;
      const riderId = extractRiderIdFromQr(result.data);
      if (!riderId) return;

      processingRef.current = true;
      // light feedback on scan
      void playScanTick();
      setScannedRiderId(riderId);
      setPhase('confirming');

      // Auto-commit when enabled in RideSession
      if (autoCheckIn) {
        void submitCheckIn();
      }
    },
    [autoCheckIn, submitCheckIn],
  );

  const handleScanRetry = () => {
    const newAttempts = scanAttempts + 1;
    setScanAttempts(newAttempts);
    processingRef.current = false;
    setScannedRiderId('');

    if (newAttempts >= MAX_SCAN_RETRIES) {
      logger.info(TAG, `Max scan retries (${MAX_SCAN_RETRIES}) reached — showing manual entry`);
      setPhase('manual_entry');
    } else {
      setPhase('scanning');
    }
  };

  const switchToManualEntry = () => {
    setPhase('manual_entry');
  };

  const confirmManualEntry = () => {
    const trimmed = manualRiderId.trim();
    if (!trimmed) return;
    setScannedRiderId(trimmed);
    setPhase('confirming');
  };



  // After a successful check-in, allow scanning the next rider
  const scanNextRider = () => {
    setScannedRiderId('');
    setManualRiderId('');
    setScanAttempts(0);
    processingRef.current = false;
    setPhase('scanning');
  };

  // Reset to type selection
  const resetToStart = () => {
    setScannedRiderId('');
    setManualRiderId('');
    setScanAttempts(0);
    setErrorMessage('');
    setErrorPresentation('error');
    processingRef.current = false;

    if (hasSingleRegularPitStopStage && activeRide) {
      const stage = activeRide.stages.find(
        (s) => s.stageNumber === allowedRegularStageNumbers[0] && s.type === StageType.PIT_STOP,
      );

      if (stage) {
        const validationError = getValidationMessage('regular', stage);
        if (!validationError) {
          setCheckInType('regular');
          setSelectedStage(stage);
          setPhase('scanning');
          return;
        }
      }
    }

    setPhase('type_select');
    setCheckInType('regular');
    setSelectedStage(null);
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderTypeSelection = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Select Check-In Type</Text>
      {canCheckInRegular && (
        <TouchableOpacity style={styles.typeButton} onPress={() => selectCheckInType('regular')}>
          <MaterialIcons name="qr-code-scanner" size={24} color={COLORS.primary} />
          <View style={styles.typeButtonText}>
            <Text style={styles.typeButtonTitle}>Regular Check-In</Text>
            <Text style={styles.typeButtonSubtitle}>Scan rider at a stage</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={COLORS.gray[400]} />
        </TouchableOpacity>
      )}
      {canCheckInNR && (
        <TouchableOpacity
          style={[styles.typeButton, (activeRide?.status ?? RideStatus.PLANNED) !== RideStatus.OPEN && styles.typeButtonDisabled]}
          onPress={() => selectCheckInType('not_riding')}
          disabled={(activeRide?.status ?? RideStatus.PLANNED) !== RideStatus.OPEN}
        >
          <MaterialIcons name="do-not-disturb" size={24} color={COLORS.gray[500]} />
          <View style={styles.typeButtonText}>
            <Text style={styles.typeButtonTitle}>Not Riding</Text>
            <Text style={styles.typeButtonSubtitle}>
              {activeRide?.status === RideStatus.OPEN
                ? 'Mark rider as not participating today'
                : `Available only when ride is OPEN (current: ${activeRide?.status ?? 'unknown'})`}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={COLORS.gray[400]} />
        </TouchableOpacity>
      )}
      {canCheckInQR && (
        <TouchableOpacity
          style={[styles.typeButton, (activeRide?.status ?? RideStatus.PLANNED) !== RideStatus.STARTED && styles.typeButtonDisabled]}
          onPress={() => selectCheckInType('quit_riding')}
          disabled={(activeRide?.status ?? RideStatus.PLANNED) !== RideStatus.STARTED}
        >
          <MaterialIcons name="cancel" size={24} color="#B91C1C" />
          <View style={styles.typeButtonText}>
            <Text style={styles.typeButtonTitle}>Quit Riding</Text>
            <Text style={styles.typeButtonSubtitle}>
              {activeRide?.status === RideStatus.STARTED
                ? 'Rider leaving mid-ride'
                : `Available only when ride is STARTED (current: ${activeRide?.status ?? 'unknown'})`}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={COLORS.gray[400]} />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderStageSelection = () => (
    <View style={styles.section}>
      {checkInType === 'regular' && (activeRide?.status ?? RideStatus.PLANNED) === RideStatus.PLANNED && (
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={18} color={COLORS.primary} />
          <Text style={styles.infoBannerText}>
            All check-ins are unavailable while ride status is PLANNED. Ride should be OPEN for 'Start' stage check-ins.
          </Text>
        </View>
      )}
      {checkInType === 'regular' && (activeRide?.status ?? RideStatus.PLANNED) === RideStatus.OPEN && (
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={18} color={COLORS.primary} />
          <Text style={styles.infoBannerText}>
            Ride status is OPEN. Only Start stage check-ins are allowed now.{'\n'}Other stages will be activated once the ride is STARTED.
          </Text>
        </View>
      )}
      <StageSelector
        stages={activeRide?.stages ?? []}
        selectedStage={selectedStage}
        onSelect={selectStageAndScan}
        checkInType={checkInType}
        rideStatus={activeRide?.status ?? RideStatus.PLANNED}
        allowedRegularStageNumbers={isPitStopPrimaryRole ? allowedRegularStageNumbers : undefined}
      />
      {checkInType === 'regular' && isPitStopPrimaryRole && allowedRegularStageNumbers.length === 0 && (
        <View style={styles.infoBanner}>
          <MaterialIcons name="warning-amber" size={18} color={COLORS.warning} />
          <Text style={styles.infoBannerText}>
            No valid pit-stop stage is available for your role in this ride. Please contact your administrator.
          </Text>
        </View>
      )}
      {checkInType === 'not_riding' && selectedStage && (
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            const validationError = getValidationMessage('not_riding', selectedStage);
            if (validationError) {
              blockWithValidationMessage(validationError);
              return;
            }
            setPhase('scanning');
          }}
        >
          <Text style={styles.primaryButtonText}>Continue to Scan</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderScanner = () => {
    if (!permission?.granted) {
      return (
        <View style={styles.permissionContainer}>
          <MaterialIcons name="camera-alt" size={48} color={COLORS.gray[400]} />
          <Text style={styles.permissionText}>Camera access is required for QR scanning.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.scannerContainer}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcodeScan}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerFrame} />
        </View>
        <View style={[styles.scannerFooter, { paddingBottom: bottomInsetPadding }]}>
          <Text style={styles.scanHint}>
            Scan rider QR code{scanAttempts > 0 ? ` (attempt ${scanAttempts + 1}/${MAX_SCAN_RETRIES})` : ''}
          </Text>
          {canManualCheckIn && (
            <TouchableOpacity style={styles.manualEntryLink} onPress={switchToManualEntry}>
              <Text style={styles.manualEntryLinkText}>Enter Rider ID manually</Text>
            </TouchableOpacity>
          )}
          <View style={styles.autoCheckRow}>
            <Text style={styles.scanHint}>Auto check-in</Text>
            <Switch value={autoCheckIn} onValueChange={(v) => toggleAutoCheckIn(v)} />
          </View>
        </View>
      </View>
    );
  };

  const renderManualEntry = () => (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.section}
    >
      <Text style={styles.sectionTitle}>Enter Rider ID</Text>
      {scanAttempts >= MAX_SCAN_RETRIES && (
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={18} color={COLORS.primary} />
          <Text style={styles.infoBannerText}>
            QR scan failed after {MAX_SCAN_RETRIES} attempts. Enter the rider ID manually.
          </Text>
        </View>
      )}
      <View style={[styles.manualInputRow, { paddingBottom: bottomInsetPadding }]}>
        <TextInput
          style={styles.manualInput}
          value={manualRiderId}
          onChangeText={setManualRiderId}
          placeholder="e.g. R1, R57"
          placeholderTextColor={COLORS.textDisabled}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={confirmManualEntry}
        />
        <TouchableOpacity
          style={[styles.primaryButton, styles.manualSubmitButton, !manualRiderId.trim() && styles.disabledButton]}
          onPress={confirmManualEntry}
          disabled={!manualRiderId.trim()}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  const renderConfirmation = () => {
    const typeLabel =
      checkInType === 'not_riding' ? 'Not Riding' :
      checkInType === 'quit_riding' ? 'Quit Riding' :
      'Check-In';

    const stageName = selectedStage?.name ?? (activeRide ? activeRide.stages.find((s) => s.stageNumber === selectedStageNumber)?.name : undefined) ?? '—';

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Confirm {typeLabel}</Text>
        <View style={styles.confirmCard}>
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Rider ID</Text>
            <Text style={styles.confirmValue}>{scannedRiderId}</Text>
          </View>
          {scannedRiderName ? (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Name</Text>
              <Text style={styles.confirmValue}>{scannedRiderName}</Text>
            </View>
          ) : null}
          {checkInType !== 'quit_riding' && (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmLabel}>Stage</Text>
              <Text style={styles.confirmValue}>{stageName}</Text>
            </View>
          )}
          <View style={styles.confirmRow}>
            <Text style={styles.confirmLabel}>Type</Text>
            <Text style={styles.confirmValue}>{typeLabel}</Text>
          </View>
        </View>
        <View style={[styles.confirmButtons, { paddingBottom: bottomInsetPadding }]}>
          <TouchableOpacity
            style={[styles.primaryButton, isSubmitting && styles.disabledButton, { flex: 1, marginRight: 8 }]}
            onPress={() => {
              void submitCheckIn();
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Confirm</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, { width: 120 }]} onPress={handleScanRetry} disabled={isSubmitting}>
            <Text style={styles.secondaryButtonText}>Re-scan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSuccess = () => (
    <View style={styles.resultContainer}>
      <MaterialIcons name="check-circle" size={64} color={COLORS.success} />
      <Text style={styles.resultText}>{resultMessage}</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={scanNextRider}>
        <Text style={styles.primaryButtonText}>Scan Next Rider</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={() => onClose && onClose()}>
        <Text style={styles.secondaryButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );

  const renderError = () => (
    <View style={styles.resultContainer}>
      <MaterialIcons
        name={
          errorPresentation === 'warning'
            ? 'warning-amber'
            : errorPresentation === 'info'
              ? 'info-outline'
              : 'error'
        }
        size={64}
        color={
          errorPresentation === 'warning'
            ? COLORS.warning
            : errorPresentation === 'info'
              ? COLORS.primary
              : COLORS.danger
        }
      />
      <HighlightedText
        text={errorMessage}
        highlight={['Not Riding', 'Quit Riding']}
        style={errorPresentation === 'error' ? styles.errorResultText : styles.infoResultText}
        highlightStyle={styles.highlightedText}
      />
      {errorPresentation === 'error' && (
        <TouchableOpacity style={styles.primaryButton} onPress={() => {
          void submitCheckIn();
        }}>
          <Text style={styles.primaryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.secondaryButton} onPress={resetToStart}>
        <Text style={styles.secondaryButtonText}>Start Over</Text>
      </TouchableOpacity>
    </View>
  );

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  // If there's no active ride in context or props, show a placeholder.
  if (!activeRide) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}> 
          <View style={styles.headerRow}>
            <Text style={styles.rideTitle}>No active ride</Text>
          </View>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <Text style={{ color: COLORS.textSecondary, textAlign: 'center' }}>Select a ride from the Dashboard to enable Check-In.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}> 
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.rideTitleButton}
            onPress={() => navigation.navigate('RideInfo', { ride: activeRide, source: 'dashboard' })}
            accessibilityRole="button"
            accessibilityLabel="Open ride details"
            accessibilityHint="Shows details for the selected ride"
          >
            <Text style={styles.rideTitle}>{activeRide.name}</Text>
            <MaterialIcons name="info-outline" size={18} color={COLORS.white} />
          </TouchableOpacity>

          {isHistorical && (
            <View style={styles.historicalBadge}>
              <Text style={styles.historicalBadgeText}>Historical</Text>
            </View>
          )}
        </View>

        <StageFilterBar
          stages={activeRide.stages}
          stageCounts={stageCounts}
          totalStages={activeRide.stages.length}
          selectedStageNumber={selectedStageNumber}
          selectedSpecial={selectedSpecial}
          isSorted={false}
          onToggleSort={() => {}}
          onSelectStage={(n) => {
            setContextSelectedStage(n);
            if (n !== null) setSelectedSpecial(null);
          }}
          onSelectSpecial={(s) => {
            setSelectedSpecial(s);
            if (s !== null) setContextSelectedStage(null);
          }}
        />
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInsetPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        {phase === 'type_select' && renderTypeSelection()}
        {phase === 'stage_select' && renderStageSelection()}
        {phase === 'scanning' && renderScanner()}
        {phase === 'manual_entry' && renderManualEntry()}
        {phase === 'confirming' && renderConfirmation()}
        {phase === 'success' && renderSuccess()}
        {phase === 'error' && renderError()}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
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
  rideTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
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
  content: {
    flexGrow: 1,
    padding: 16,
  },
  section: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },

  // Type selection
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  typeButtonDisabled: {
    opacity: 0.5,
  },
  typeButtonText: {
    flex: 1,
    marginLeft: 12,
  },
  typeButtonTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  typeButtonSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Scanner
  scannerContainer: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 350,
  },
  camera: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: QR_SCANNER_COLORS.overlay,
  },
  scannerFrame: {
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: QR_SCANNER_COLORS.frame,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  scannerFooter: {
    padding: 12,
    backgroundColor: COLORS.white,
    alignItems: 'center',
  },
  scanHint: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  manualEntryLink: {
    marginTop: 8,
  },
  manualEntryLinkText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Permission
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionText: {
    marginTop: 16,
    marginBottom: 16,
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Manual entry
  manualInputRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  manualSubmitButton: {
    paddingHorizontal: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  infoBannerText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginLeft: 8,
    flex: 1,
  },

  // Confirmation
  confirmCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 20,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  confirmLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  confirmValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  confirmButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },

  autoCheckRow: {
    marginTop: 8,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Result
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  resultText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  errorResultText: {
    fontSize: 15,
    color: COLORS.danger,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  infoResultText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  highlightedText: {
    fontWeight: '700',
    color: COLORS.warning,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: COLORS.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
