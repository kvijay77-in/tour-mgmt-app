/**
 * CheckInScreen — QR-code-based rider check-in (Check-In tab).
 *
 * Single-screen, 3-section layout:
 * 1. Top: compact check-in type selector + QR scanner (mounts only while focused) + manual Rider ID entry.
 * 2. Middle: auto check-in toggle + scanned rider confirmation card + Confirm/Re-scan.
 * 3. Bottom: rolling log of the last 5 check-ins done on this device this session.
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
  Switch,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTour } from '../../context/TourContext';
import { useRideSession } from '../../context/RideSessionContext';
import { createInteractiveCheckIn, overrideInteractiveCheckIn } from '../../services/api/checkInApi';
import { publishDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { COLORS, QR_SCANNER_COLORS } from '../../constants/colors';
import { CheckInMethod, Permission, RideStatus, Stage, StageType } from '../../types/models';
import { CheckInRequest } from '../../types/api';
import { getPitStopStageNumbersFromRoles, hasPermission, isPitStopUserRole } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import { getRiderById } from '../../services/database/riderStore';
import { loadPitStopContextStageNumber } from '../../services/config/pitStopContextService';
import { playSuccess, playFailure, playScanTick } from '../../services/feedback/feedbackService';

const TAG = 'CheckInScreen';
const RECENT_CHECKINS_LIMIT = 5;

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
type StatusKind = 'error' | 'info' | 'warning';

interface StatusMessage {
  kind: StatusKind;
  text: string;
}

interface RecentCheckInEntry {
  riderId: string;
  riderName: string;
  ts: number;
}

const monospaceFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'Courier' }) ?? 'monospace';

export default function CheckInScreen() {
  const { user } = useAuth();
  const { tour } = useTour();
  const [permission, requestPermission] = useCameraPermissions();
  const {
    currentRide: activeRide,
    isHistorical,
    selectedStageNumber,
    setSelectedStage: setContextSelectedStage,
    autoCheckIn,
    toggleAutoCheckIn,
    setCheckIns,
    checkIns,
  } = useRideSession();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottomInsetPadding = Math.max(insets.bottom, 12);

  const [checkInType, setCheckInType] = useState<CheckInType>('regular');
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);
  const [scannedRiderId, setScannedRiderId] = useState<string>('');
  const [scannedRiderName, setScannedRiderName] = useState<string>('');
  const [pendingMethod, setPendingMethod] = useState<CheckInMethod>(CheckInMethod.QR_SCAN);
  const [manualRiderId, setManualRiderId] = useState<string>('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [recentCheckIns, setRecentCheckIns] = useState<RecentCheckInEntry[]>([]);
  const [managedPitStopStageNumber, setManagedPitStopStageNumber] = useState<number | null>(null);
  const processingRef = useRef(false);
  const autoStartAppliedRef = useRef(false);

  // Determine available check-in types based on role
  const canCheckInRegular = user ? hasPermission(user.userRole, Permission.CHECKIN_RIDER) : false;
  const canCheckInNR = user ? hasPermission(user.userRole, Permission.CHECKIN_NOT_RIDING) : false;
  const canCheckInQR = user ? hasPermission(user.userRole, Permission.CHECKIN_QUIT_RIDING) : false;
  const canManualCheckIn = user ? hasPermission(user.userRole, Permission.MANUAL_CHECKIN) : false;

  const isPitStopPrimaryRole = user ? isPitStopUserRole(user.userRole) : false;
  const pitStopRoleStageNumbers = useMemo(() => getPitStopStageNumbersFromRoles(user?.userRoles ?? []), [user?.userRoles]);

  // Load the persisted pit-stop context stage (set via the Dashboard menu) for this user.
  useEffect(() => {
    let mounted = true;
    if (!isPitStopPrimaryRole) {
      setManagedPitStopStageNumber(null);
      return undefined;
    }
    (async () => {
      const stageNumber = await loadPitStopContextStageNumber();
      if (mounted) setManagedPitStopStageNumber(stageNumber);
    })();
    return () => { mounted = false; };
  }, [isPitStopPrimaryRole]);

  const allowedRegularStageNumbers = useMemo(() => {
    if (!isPitStopPrimaryRole || !activeRide) return [] as number[];

    const ridePitStopStages = activeRide.stages
      .filter((s) => s.type === StageType.PIT_STOP)
      .map((s) => s.stageNumber);

    const roleAllowedStages = ridePitStopStages.filter((n) => pitStopRoleStageNumbers.includes(n));
    if (managedPitStopStageNumber !== null && roleAllowedStages.includes(managedPitStopStageNumber)) {
      return [managedPitStopStageNumber];
    }
    return roleAllowedStages;
  }, [isPitStopPrimaryRole, activeRide, pitStopRoleStageNumbers, managedPitStopStageNumber]);

  const hasSingleRegularPitStopStage = isPitStopPrimaryRole && allowedRegularStageNumbers.length === 1;

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
    if (checkInType !== 'regular') return;
    if (selectedStageNumber == null) {
      setSelectedStage(null);
      return;
    }
    const stage = activeRide.stages.find((s) => s.stageNumber === selectedStageNumber);
    setSelectedStage(stage ?? null);
  }, [selectedStageNumber, activeRide, checkInType]);

  // Resolve rider name from local cache for the confirmation card
  useEffect(() => {
    let mounted = true;
    if (!scannedRiderId) {
      setScannedRiderName('');
      return undefined;
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

  // For PS_n users, default-select their managed pit-stop stage once a ride is active.
  useEffect(() => {
    if (!isFocused || !isPitStopPrimaryRole || managedPitStopStageNumber === null) return;
    if (!allowedRegularStageNumbers.includes(managedPitStopStageNumber)) return;
    if (selectedStageNumber == null) {
      setContextSelectedStage(managedPitStopStageNumber);
    }
  }, [isFocused, isPitStopPrimaryRole, managedPitStopStageNumber, allowedRegularStageNumbers, selectedStageNumber, setContextSelectedStage]);

  // Fast path for pit-stop users with only one allowed regular stage.
  useEffect(() => {
    if (autoStartAppliedRef.current) return;
    if (checkInType !== 'regular' || !hasSingleRegularPitStopStage || !activeRide) return;

    const stage = activeRide.stages.find(
      (s) => s.stageNumber === allowedRegularStageNumbers[0] && s.type === StageType.PIT_STOP,
    );
    if (!stage) return;

    setContextSelectedStage(stage.stageNumber);
    autoStartAppliedRef.current = true;
  }, [checkInType, hasSingleRegularPitStopStage, activeRide, allowedRegularStageNumbers, setContextSelectedStage]);

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
      return 'Select a stage from the Dashboard header to enable check-in.';
    }

    if (isPitStopPrimaryRole) {
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

  const stageValidationMessage = activeRide ? getValidationMessage(checkInType, selectedStage) : null;

  const resetPendingEntry = () => {
    setScannedRiderId('');
    setScannedRiderName('');
    setManualRiderId('');
    setShowManualEntry(false);
    setStatusMessage(null);
    processingRef.current = false;
  };

  const handleSelectType = (type: CheckInType, enabled: boolean) => {
    if (!enabled) {
      const reason = type === 'not_riding'
        ? `Not Riding check-ins are allowed only when today's ride status is OPEN. Current status: ${activeRide?.status ?? 'unknown'}.`
        : `Quit Riding check-ins are allowed only when today's ride status is STARTED. Current status: ${activeRide?.status ?? 'unknown'}.`;
      setStatusMessage({ kind: 'warning', text: reason });
      return;
    }

    setCheckInType(type);
    resetPendingEntry();
    if (type === 'quit_riding') {
      setSelectedStage(null);
    }
  };

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  const submitCheckIn = useCallback(async (riderId: string, method: CheckInMethod, overrideRequested: boolean = false) => {
    if (!tour || !riderId || !activeRide) return;

    const effectiveStage =
      checkInType === 'not_riding'
        ? (selectedStage ?? activeRide.stages.find((s) => s.type === StageType.START) ?? null)
        : selectedStage;

    if (checkInType !== 'quit_riding' && !effectiveStage) {
      setStatusMessage({ kind: 'warning', text: 'Select a stage from the Dashboard header to enable check-in.' });
      return;
    }

    const validationError = getValidationMessage(checkInType, effectiveStage);
    if (validationError) {
      setStatusMessage({ kind: 'warning', text: validationError });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const request: CheckInRequest = checkInType === 'quit_riding'
        ? {
            riderId,
            rideId: activeRide.rideId,
            method,
            isNotRiding: false,
            isQuitRiding: true,
          }
        : {
            riderId,
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
                void submitCheckIn(riderId, method, true);
              },
            },
          ],
        );
        return;
      }

      if (outcome.kind === 'info_conflict') {
        logger.info(TAG, `Check-in informational outcome: ${outcome.reason}`, {
          riderId,
          checkInType,
          stageNumber: effectiveStage?.stageNumber ?? null,
        });
        setStatusMessage({
          kind: outcome.reason === 'quit_riding' || outcome.reason === 'not_riding' ? 'warning' : 'info',
          text: outcome.message,
        });
        void playFailure('warning');
        return;
      }

      setCheckIns([outcome.checkIn, ...(checkIns ?? [])]);
      publishDashboardCheckInEvent({ checkIn: outcome.checkIn });
      void playSuccess();
      logger.info(TAG, `Check-in recorded: ${riderId} at ${effectiveStage?.name ?? 'N/A'} (${checkInType})`);

      let riderName = scannedRiderName;
      try {
        const r = await getRiderById(riderId);
        riderName = r?.name ?? riderName;
      } catch {
        // best-effort name lookup for the recent list; keep whatever was already resolved
      }

      setRecentCheckIns((prev) => [{ riderId, riderName, ts: Date.now() }, ...prev].slice(0, RECENT_CHECKINS_LIMIT));
      resetPendingEntry();
    } catch (err) {
      logger.error(TAG, 'Check-in submission failed', err);
      const message = err instanceof Error ? err.message : 'Check-in failed. Please try again.';
      setStatusMessage({ kind: 'error', text: message });
      void playFailure('error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    tour,
    activeRide,
    checkInType,
    selectedStage,
    scannedRiderName,
    checkIns,
    setCheckIns,
    getValidationMessage,
  ]);

  // -----------------------------------------------------------------------
  // Scan / manual entry handlers
  // -----------------------------------------------------------------------

  const handleBarcodeScan = useCallback(
    (result: BarcodeScanningResult) => {
      if (processingRef.current) return;
      const riderId = extractRiderIdFromQr(result.data);
      if (!riderId) return;

      processingRef.current = true;
      void playScanTick();
      setPendingMethod(CheckInMethod.QR_SCAN);
      setScannedRiderId(riderId);
      setStatusMessage(null);

      if (autoCheckIn) {
        void submitCheckIn(riderId, CheckInMethod.QR_SCAN);
      }
    },
    [autoCheckIn, submitCheckIn],
  );

  const confirmManualEntry = () => {
    const trimmed = manualRiderId.trim();
    if (!trimmed) return;

    setPendingMethod(CheckInMethod.MANUAL);
    setScannedRiderId(trimmed);
    setShowManualEntry(false);
    setStatusMessage(null);
    processingRef.current = true;

    if (autoCheckIn) {
      void submitCheckIn(trimmed, CheckInMethod.MANUAL);
    }
  };

  const handleRescan = () => {
    resetPendingEntry();
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!activeRide) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderCenter}>
          <Text style={styles.placeholderText}>Select a ride from the Dashboard to enable Check-In.</Text>
        </View>
      </View>
    );
  }

  if (isHistorical) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholderCenter}>
          <MaterialIcons name="lock-outline" size={40} color={COLORS.gray[400]} />
          <Text style={styles.placeholderText}>Check-in is disabled while viewing a historical ride.</Text>
        </View>
      </View>
    );
  }

  const typeOptions: { type: CheckInType; label: string; icon: keyof typeof MaterialIcons.glyphMap; enabled: boolean }[] = [];
  if (canCheckInRegular) typeOptions.push({ type: 'regular', label: 'Regular', icon: 'qr-code-scanner', enabled: true });
  if (canCheckInNR) {
    typeOptions.push({
      type: 'not_riding',
      label: 'Not Riding',
      icon: 'do-not-disturb',
      enabled: activeRide.status === RideStatus.OPEN,
    });
  }
  if (canCheckInQR) {
    typeOptions.push({
      type: 'quit_riding',
      label: 'Quit Riding',
      icon: 'cancel',
      enabled: activeRide.status === RideStatus.STARTED,
    });
  }

  const typeLabel = checkInType === 'not_riding' ? 'Not Riding' : checkInType === 'quit_riding' ? 'Quit Riding' : 'Check-In';
  const stageDisplayName = selectedStage?.name
    ?? (selectedStageNumber != null ? activeRide.stages.find((s) => s.stageNumber === selectedStageNumber)?.name : undefined)
    ?? '—';

  const showConfirmCard = !!scannedRiderId && (!autoCheckIn || !!statusMessage);
  const showAutoSubmitting = !!scannedRiderId && autoCheckIn && isSubmitting && !statusMessage;

  const statusColor = statusMessage
    ? statusMessage.kind === 'error' ? COLORS.danger : statusMessage.kind === 'warning' ? COLORS.warning : COLORS.primary
    : COLORS.primary;
  const statusIconName = statusMessage
    ? statusMessage.kind === 'error' ? 'error' : statusMessage.kind === 'warning' ? 'warning-amber' : 'info-outline'
    : 'info-outline';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Section 1: type selector + scanner + manual entry */}
      <View style={styles.topSection}>
        {typeOptions.length > 0 && (
          <View style={styles.typeSelectorRow}>
            {typeOptions.map((opt) => {
              const isSelected = checkInType === opt.type;
              return (
                <TouchableOpacity
                  key={opt.type}
                  style={[styles.typeChip, isSelected && styles.typeChipSelected, !opt.enabled && styles.typeChipDisabled]}
                  onPress={() => handleSelectType(opt.type, opt.enabled)}
                >
                  <MaterialIcons name={opt.icon} size={16} color={isSelected ? COLORS.white : COLORS.textPrimary} />
                  <Text style={[styles.typeChipText, isSelected && styles.typeChipTextSelected]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {stageValidationMessage ? (
          <View style={styles.hintBox}>
            <MaterialIcons name="info-outline" size={20} color={COLORS.primary} />
            <Text style={styles.hintText}>{stageValidationMessage}</Text>
          </View>
        ) : !permission?.granted ? (
          <View style={styles.permissionContainer}>
            <MaterialIcons name="camera-alt" size={40} color={COLORS.gray[400]} />
            <Text style={styles.permissionText}>Camera access is required for QR scanning.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.scannerContainer}>
            {isFocused && (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scannedRiderId ? undefined : handleBarcodeScan}
              />
            )}
            <View style={styles.scannerOverlay}>
              <View style={styles.scannerFrame} />
            </View>
          </View>
        )}

        {canManualCheckIn && !stageValidationMessage && !scannedRiderId && (
          <View style={styles.manualEntryArea}>
            <TouchableOpacity onPress={() => setShowManualEntry((s) => !s)}>
              <Text style={styles.manualEntryLinkText}>
                {showManualEntry ? 'Cancel manual entry' : 'Enter Rider ID manually'}
              </Text>
            </TouchableOpacity>
            {showManualEntry && (
              <View style={styles.manualInputRow}>
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
                  <Text style={styles.primaryButtonText}>Go</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Section 2: auto check-in toggle + confirm card */}
      <View style={styles.middleSection}>
        <View style={styles.autoCheckRow}>
          <Text style={styles.autoCheckLabel}>Auto check-in</Text>
          <Switch value={autoCheckIn} onValueChange={(v: boolean) => toggleAutoCheckIn(v)} />
        </View>

        {statusMessage && (
          <View style={styles.statusBanner}>
            <MaterialIcons name={statusIconName} size={18} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusMessage.text}</Text>
          </View>
        )}

        {showConfirmCard ? (
          <>
            <View style={styles.confirmCard}>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Rider ID</Text>
                <Text style={styles.confirmRiderId}>{scannedRiderId}</Text>
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
                  <Text style={styles.confirmValue}>{stageDisplayName}</Text>
                </View>
              )}
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Type</Text>
                <Text style={styles.confirmValue}>{typeLabel}</Text>
              </View>
            </View>
            <View style={styles.confirmButtonsRow}>
              <TouchableOpacity
                style={[styles.primaryButton, styles.confirmButton, isSubmitting && styles.disabledButton]}
                onPress={() => void submitCheckIn(scannedRiderId, pendingMethod)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Confirm</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryButton, styles.rescanButton]} onPress={handleRescan} disabled={isSubmitting}>
                <Text style={styles.secondaryButtonText}>Re-scan</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : showAutoSubmitting ? (
          <View style={styles.autoSubmittingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.autoSubmittingText}>Checking in {scannedRiderId}…</Text>
          </View>
        ) : (
          <Text style={styles.placeholderHint}>
            Scan a rider QR code{canManualCheckIn ? ' or enter a Rider ID manually' : ''} to begin.
          </Text>
        )}
      </View>

      {/* Section 3: recent check-ins on this device */}
      <View style={[styles.recentSection, { paddingBottom: bottomInsetPadding }]}>
        <Text style={styles.recentTitle}>Recent Check-ins</Text>
        {recentCheckIns.length === 0 ? (
          <Text style={styles.recentEmpty}>No check-ins yet this session.</Text>
        ) : (
          recentCheckIns.map((entry, idx) => (
            <Text key={`${entry.riderId}-${entry.ts}-${idx}`} style={styles.recentLine} numberOfLines={1}>
              <Text style={styles.recentRiderId}>{entry.riderId}</Text>
              <Text> - </Text>
              <Text style={styles.recentRiderName}>{entry.riderName || 'Unknown'}</Text>
            </Text>
          ))
        )}
      </View>
    </KeyboardAvoidingView>
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
  placeholderCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  placeholderText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },

  // Section 1 — top
  topSection: {
    flex: 1,
    padding: 12,
    minHeight: 220,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  typeChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeChipDisabled: {
    opacity: 0.45,
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  typeChipTextSelected: {
    color: COLORS.white,
  },
  hintBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  scannerContainer: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    minHeight: 160,
    backgroundColor: COLORS.gray[100],
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
    width: 180,
    height: 180,
    borderWidth: 3,
    borderColor: QR_SCANNER_COLORS.frame,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 10,
  },
  permissionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Manual entry
  manualEntryArea: {
    marginTop: 10,
  },
  manualEntryLinkText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  manualInput: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  manualSubmitButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },

  // Section 2 — middle
  middleSection: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
  },
  autoCheckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  autoCheckLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  placeholderHint: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
  autoSubmittingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  autoSubmittingText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // Confirmation card
  confirmCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  confirmLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  confirmValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  confirmRiderId: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontFamily: monospaceFont,
  },
  confirmButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmButton: {
    flex: 1,
  },
  rescanButton: {
    width: 110,
  },

  // Section 3 — recent check-ins
  recentSection: {
    maxHeight: 150,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  recentEmpty: {
    fontSize: 12,
    color: COLORS.textDisabled,
  },
  recentLine: {
    fontSize: 13,
    color: COLORS.textPrimary,
    paddingVertical: 2,
    flexDirection: 'row',
  },
  recentRiderId: {
    fontFamily: monospaceFont,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  recentRiderName: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },

  // Buttons
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
