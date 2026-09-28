/**
 * EventScanScreen — record event activity scans for one occurrence (FE design §4.3).
 *
 * Modelled on CheckInScreen without changing it:
 * 1. Activity picker (effective-enabled activities the user may scan, D-O) + camera
 *    scanner with scan-pause cooldown; manual rider-ID entry for MANUAL_CHECKIN roles.
 * 2. ScanConfirmationCard: variant choice (default = rider dietaryPreference), opt-out,
 *    optional auto-submit.
 * 3. Recent scans on this device with sync state, cancel, and "Sync issues".
 *
 * Write-local-first: every scan is stored in SQLite and queued; online it is sent at
 * once, offline it waits for the event sync loop. Web (always online) sends scans and
 * cancels directly; its recent list is kept in memory for the browser session only.
 * See docs/Event-Engine-Design.md.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, QR_SCANNER_COLORS } from '../../constants/colors';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { ID_CODE_TYPE } from '../../constants/idCodes';
import {
  EVENT_ERROR_MESSAGES,
  EVENT_SCAN_MESSAGES,
  EventMessageKind,
} from '../../constants/eventMessages';
import { useAuth } from '../../context/AuthContext';
import { useEventSession } from '../../context/EventSessionContext';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError, getEvent, getOccurrence } from '../../services/api/eventsApi';
import { getRiderById as fetchTourRider, getRiderProfileDietaryPreference } from '../../services/api/riderApi';
import { getIdCodeTypeMap } from '../../services/database/appConfigStore';
import {
  findActiveEventRecord,
  getFailedEventRecords,
  LocalEventActivityRecord,
} from '../../services/database/eventRecordStore';
import { retryFailedOperations } from '../../services/sync/outboundSyncService';
import {
  getEventById,
  getOccurrenceById,
  getRiderBaggageStatus,
  upsertEvent,
  upsertOccurrence,
} from '../../services/database/eventStore';
import {
  getRiderById as getCachedRider,
  setRiderDietaryPreference,
  upsertRiders,
} from '../../services/database/riderStore';
import { loadScanPauseSeconds } from '../../services/config/scanPauseConfigService';
import { OFFLINE_CACHE_ENABLED } from '../../services/offline/offlineDataService';
import { playFailure, playScanTick, playSuccess } from '../../services/feedback/feedbackService';
import { formatTypeNotAllowedMessage, resolveScannedRiderId } from '../../services/idcode/idCodeService';
import {
  cancelEventRecordOnline,
  discardUnsyncedEventRecord,
  EventOperationResult,
  NewEventScan,
  processEventOperationNow,
  queueEventRecord,
  queueEventRecordCancel,
  sendEventRecordOnline,
  toRecordTimestamp,
} from '../../services/sync/eventSyncService';
import { IdCodeTypeConfig } from '../../types/config';
import {
  ActivityOutcome,
  BaggageStatus,
  DietaryPreference,
  EventActivity,
  EventDefinition,
  EventOccurrence,
  EventRecordMethod,
  OccurrenceStatus,
  Permission,
  UserRole,
} from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import {
  findActivityOverride,
  getEffectiveActivityEnabled,
  getEffectiveAllowedTypeCodes,
  getEffectiveSelfService,
  isActivityAvailableToUser,
} from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import { hasPermission } from '../../utils/permissions';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../../components/events/OccurrenceStatusBadge';
import OfflineBanner from '../../components/common/OfflineBanner';
import ScanConfirmationCard from '../../components/events/ScanConfirmationCard';
import StatusBanner, { StatusBannerAction } from '../../components/events/StatusBanner';

const TAG = 'EventScanScreen';
const SYNC_ISSUES_LIMIT = 50;

interface EventScanScreenProps {
  eventId: string;
  occurrenceId: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'EventScan'>;
}

interface PendingScan {
  riderId: string;
  method: EventRecordMethod;
  typeCode: string | null;
  bagLabel: string | null;
}

interface Banner {
  kind: EventMessageKind;
  message: string;
  secondaryAction?: StatusBannerAction;
}

type LoadState = 'loading' | 'ready' | 'notFound' | 'unavailable';

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);
}

function normalizeOption(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function matchVariant(options: string[], preference: DietaryPreference | null): string | null {
  if (!preference) return null;
  const wanted = normalizeOption(preference);
  return options.find((option) => normalizeOption(option) === wanted) ?? null;
}

/** Online: fresh from the rider profile (cached in SQLite). Offline: cache only (D-C). */
async function loadDietaryPreference(
  tourId: string,
  riderId: string,
  isOffline: boolean,
): Promise<DietaryPreference | null> {
  const cached = await getCachedRider(riderId).catch(() => null);
  if (isOffline) return cached?.dietaryPreference ?? null;

  try {
    let profileId = cached?.profileId;
    let fetched = null;
    if (!profileId) {
      fetched = await fetchTourRider(tourId, riderId);
      profileId = fetched?.profileId;
    }
    if (!profileId) return cached?.dietaryPreference ?? null;

    const preference = await getRiderProfileDietaryPreference(profileId);
    if (preference === undefined) return cached?.dietaryPreference ?? null;
    if (!cached && fetched) await upsertRiders([fetched]);
    await setRiderDietaryPreference(riderId, preference);
    return preference;
  } catch (error) {
    logger.warn(TAG, 'Dietary preference lookup failed; using cache', error);
    return cached?.dietaryPreference ?? null;
  }
}

function recordBadge(record: LocalEventActivityRecord): { label: string; color: string } {
  if (record.isCancelled) return { label: 'Cancelled', color: COLORS.gray[500] };
  if (record.syncStatus === 'PENDING') return { label: 'Queued', color: COLORS.warning };
  if (record.isFlagged) return { label: 'Flagged', color: COLORS.danger };
  return { label: 'Synced', color: COLORS.success };
}

export default function EventScanScreen({ eventId, occurrenceId, navigation }: EventScanScreenProps) {
  const { user } = useAuth();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { riderNamesById, getRiderDisplayName } = useNameDirectory();
  const {
    setSelection,
    selectedActivityId,
    setSelectedActivityId,
    recentRecords,
    failedCount,
    myAssignment,
    cacheVersion,
    refreshBootstrap,
  } = useEventSession();
  const [permission, requestPermission] = useCameraPermissions();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const tourId = tour?.tourId;
  const role = user?.userRole ?? null;
  const canManualEntry = role ? hasPermission(role, Permission.MANUAL_CHECKIN) : false;

  const [event, setEvent] = useState<EventDefinition | null>(null);
  const [occurrence, setOccurrence] = useState<EventOccurrence | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [typeMap, setTypeMap] = useState<Record<string, IdCodeTypeConfig>>({});
  const [scanPauseSeconds, setScanPauseSeconds] = useState(3);

  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [isLoadingVariantDefault, setIsLoadingVariantDefault] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualRiderId, setManualRiderId] = useState('');
  const [manualTypeCode, setManualTypeCode] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<LocalEventActivityRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [issues, setIssues] = useState<LocalEventActivityRecord[]>([]);
  const [showSessionInfo, setShowSessionInfo] = useState(false);

  const processingRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variantTouchedRef = useRef(false);
  const scanTokenRef = useRef(0);

  useEffect(() => {
    setSelection(eventId, occurrenceId, null);
  }, [eventId, occurrenceId, setSelection]);

  // Sync issues of this occurrence only (reloaded when records or the failed count change).
  useEffect(() => {
    let active = true;
    getFailedEventRecords(occurrenceId, SYNC_ISSUES_LIMIT)
      .then((records) => {
        if (active) setIssues(records);
      })
      .catch((error) => logger.warn(TAG, 'Reading sync issues failed', error));
    return () => {
      active = false;
    };
  }, [occurrenceId, recentRecords, failedCount]);

  useEffect(() => {
    let active = true;
    void loadScanPauseSeconds().then((seconds) => {
      if (active) setScanPauseSeconds(seconds);
    });
    getIdCodeTypeMap()
      .then((map) => {
        if (active) setTypeMap(map);
      })
      .catch((error) => logger.warn(TAG, 'Unable to load ID code types', error));
    return () => {
      active = false;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Load event + occurrence (API when online, SQLite cache otherwise)
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    const [cachedEvent, cachedOccurrence] = await Promise.all([
      getEventById(eventId).catch(() => null),
      getOccurrenceById(occurrenceId).catch(() => null),
    ]);

    let nextEvent = cachedEvent;
    let nextOccurrence = cachedOccurrence;
    let notFound = false;

    if (tourId && !isOffline) {
      try {
        const [eventOutcome, occurrenceOutcome] = await Promise.all([
          getEvent(tourId, eventId),
          getOccurrence(tourId, eventId, occurrenceId),
        ]);
        if (eventOutcome.kind === 'success') {
          nextEvent = eventOutcome.data;
          await upsertEvent(eventOutcome.data);
        } else if (eventOutcome.error.status === 404) {
          notFound = true;
        }
        if (occurrenceOutcome.kind === 'success') {
          nextOccurrence = occurrenceOutcome.data;
          await upsertOccurrence(occurrenceOutcome.data);
        } else if (occurrenceOutcome.error.status === 404) {
          notFound = true;
        }
        if (!notFound) {
          const failed = eventOutcome.kind === 'error'
            ? eventOutcome.error
            : occurrenceOutcome.kind === 'error' ? occurrenceOutcome.error : null;
          if (failed) setBanner({ kind: failed.kind, message: failed.message });
        }
      } catch (error) {
        logger.warn(TAG, 'Loading occurrence online failed; using cache', error);
        if (!cachedEvent || !cachedOccurrence) {
          setBanner({ kind: 'error', message: describeUnexpectedEventError(error) });
        }
      }
    }

    if (notFound) {
      setLoadState('notFound');
      return;
    }
    setEvent(nextEvent);
    setOccurrence(nextOccurrence);
    setLoadState(nextEvent && nextOccurrence ? 'ready' : 'unavailable');
  }, [eventId, occurrenceId, tourId, isOffline]);

  useEffect(() => {
    void load();
  }, [load]);

  // A bootstrap rewrite may carry a newer occurrence state (e.g. started elsewhere).
  useEffect(() => {
    if (cacheVersion === 0) return;
    let active = true;
    void Promise.all([getEventById(eventId), getOccurrenceById(occurrenceId)])
      .then(([cachedEvent, cachedOccurrence]) => {
        if (!active) return;
        if (cachedEvent) setEvent(cachedEvent);
        if (cachedOccurrence) setOccurrence(cachedOccurrence);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [cacheVersion, eventId, occurrenceId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setBanner(null);
    try {
      await refreshBootstrap();
      await load();
    } finally {
      setIsRefreshing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Activity selection
  // ---------------------------------------------------------------------------

  const isFilteredRole = Boolean(role && role !== UserRole.ADMINISTRATOR && role !== UserRole.SUPER_USER);

  const availableActivities = useMemo<EventActivity[]>(() => {
    if (!event || !occurrence) return [];
    return [...event.activities]
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .filter((activity) => getEffectiveActivityEnabled(activity, findActivityOverride(occurrence, activity.activityId)))
      .filter((activity) => isActivityAvailableToUser(role, myAssignment ?? null, event, occurrence, activity));
  }, [event, occurrence, role, myAssignment]);

  useEffect(() => {
    if (availableActivities.length === 1) {
      setSelectedActivityId(availableActivities[0].activityId);
    } else if (selectedActivityId && !availableActivities.some((a) => a.activityId === selectedActivityId)) {
      setSelectedActivityId(null);
    }
  }, [availableActivities, selectedActivityId, setSelectedActivityId]);

  const activity = availableActivities.find((item) => item.activityId === selectedActivityId) ?? null;
  const override = activity ? findActivityOverride(occurrence, activity.activityId) : undefined;
  const allowedTypeCodes = useMemo(
    () => (event && activity ? getEffectiveAllowedTypeCodes(event, activity, override) : []),
    [event, activity, override],
  );
  const variantOptions = useMemo(() => activity?.variantOptions ?? [], [activity]);
  const requiresVariant = variantOptions.length > 0;
  const isActive = occurrence?.status === OccurrenceStatus.ACTIVE;
  const canScan = loadState === 'ready' && isActive && Boolean(activity);

  // ---------------------------------------------------------------------------
  // Scan flow
  // ---------------------------------------------------------------------------

  const releaseScanner = useCallback((withCooldown: boolean) => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    if (!withCooldown) {
      processingRef.current = false;
      return;
    }
    cooldownTimerRef.current = setTimeout(() => {
      processingRef.current = false;
      cooldownTimerRef.current = null;
    }, scanPauseSeconds * 1000);
  }, [scanPauseSeconds]);

  const resetPending = useCallback(() => {
    scanTokenRef.current += 1;
    setPendingScan(null);
    setSelectedVariant(null);
    setIsLoadingVariantDefault(false);
    variantTouchedRef.current = false;
  }, []);

  const dismissBanner = useCallback(() => {
    setBanner(null);
    releaseScanner(false);
  }, [releaseScanner]);

  const riderLabel = useCallback((riderId: string) => {
    const display = getRiderDisplayName(riderId);
    return display.isAnomaly ? riderId : `${display.name} (${riderId})`;
  }, [getRiderDisplayName]);

  const renderResult = useCallback((
    result: EventOperationResult | null,
    scan: PendingScan,
    typeCode: string | null,
  ) => {
    const values = { rider: riderLabel(scan.riderId), activity: activity?.name ?? '' };
    if (!result || result.status === 'queued') {
      void playSuccess();
      setLastResult(fill(EVENT_SCAN_MESSAGES.QUEUED, values));
      return;
    }
    if (result.status === 'synced' || result.status === 'skipped') {
      void playSuccess();
      const flagged = result.status === 'synced' && result.isFlagged;
      setLastResult(fill(flagged ? EVENT_SCAN_MESSAGES.RECORDED_FLAGGED : EVENT_SCAN_MESSAGES.RECORDED, values));
      return;
    }
    const { error } = result;
    const message = error.code === 'SCAN_TYPE_NOT_ALLOWED' && typeCode
      ? formatTypeNotAllowedMessage(typeCode, allowedTypeCodes, typeMap)
      : error.message;
    void playFailure(error.kind === 'error' ? 'error' : 'warning');
    setLastResult(null);
    setBanner({ kind: error.kind, message });
  }, [activity?.name, allowedTypeCodes, riderLabel, typeMap]);

  const submit = useCallback(async (scan: PendingScan, outcome: ActivityOutcome, variant: string | null) => {
    if (!event || !occurrence || !activity || !tourId) return;
    setIsSubmitting(true);
    setBanner(null);
    const optedOut = outcome === ActivityOutcome.OPTED_OUT;
    const scanRecord: NewEventScan = {
      occurrenceId: occurrence.occurrenceId,
      eventId: event.eventId,
      activityId: activity.activityId,
      activityName: activity.name,
      riderId: scan.riderId,
      typeCode: optedOut ? null : scan.typeCode,
      bagLabel: optedOut ? null : scan.bagLabel,
      outcome,
      variantSelected: optedOut ? null : variant,
      method: scan.method,
      timestamp: toRecordTimestamp(),
    };
    try {
      let result: EventOperationResult | null;
      if (OFFLINE_CACHE_ENABLED) {
        const localId = await queueEventRecord(scanRecord, user?.userId ?? null);
        result = isOffline ? null : await processEventOperationNow(localId);
      } else {
        result = await sendEventRecordOnline(tourId, scanRecord);
      }
      renderResult(result, scan, scan.typeCode);
      resetPending();
      releaseScanner(true);
    } catch (error) {
      logger.error(TAG, 'Saving scan failed', error);
      void playFailure('error');
      setBanner({
        kind: 'error',
        message: OFFLINE_CACHE_ENABLED ? EVENT_SCAN_MESSAGES.SAVE_FAILED : describeUnexpectedEventError(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [event, occurrence, activity, tourId, isOffline, user?.userId, renderResult, resetPending, releaseScanner]);

  const handleResolved = useCallback(async (scan: PendingScan) => {
    if (!occurrence || !activity || !tourId) return;
    setLastResult(null);

    const isBaggageType = scan.typeCode ? typeMap[scan.typeCode.toUpperCase()]?.type === ID_CODE_TYPE.BAGGAGE : false;
    if (isOffline && isBaggageType) {
      const baggage = await getRiderBaggageStatus(scan.riderId).catch(() => null);
      if (baggage?.baggageStatus === BaggageStatus.WITH_RIDER) {
        void playFailure('warning');
        const releasedAt = baggage.baggageReleasedAt
          ? ` on ${new Date(baggage.baggageReleasedAt).toLocaleString()}`
          : '';
        setBanner({
          kind: 'warning',
          message: fill(EVENT_SCAN_MESSAGES.BAGGAGE_WITH_RIDER_OFFLINE, { rider: riderLabel(scan.riderId), releasedAt }),
          secondaryAction: {
            label: 'Escalate',
            onPress: () => setBanner({ kind: 'info', message: EVENT_SCAN_MESSAGES.ESCALATE_HINT }),
          },
        });
        return;
      }
    }

    const existing = await findActiveEventRecord(occurrence.occurrenceId, scan.riderId, activity.activityId)
      .catch(() => null);
    if (existing) {
      void playFailure('warning');
      setBanner({ kind: 'info', message: EVENT_ERROR_MESSAGES.DUPLICATE_ACTIVITY_RECORD.message ?? '' });
      return;
    }

    setPendingScan(scan);
    releaseScanner(true);

    if (requiresVariant) {
      const token = scanTokenRef.current;
      setIsLoadingVariantDefault(true);
      const preference = await loadDietaryPreference(tourId, scan.riderId, isOffline);
      if (token !== scanTokenRef.current) return;
      setIsLoadingVariantDefault(false);
      if (!variantTouchedRef.current) {
        setSelectedVariant(matchVariant(variantOptions, preference));
      }
      return;
    }

    if (autoSubmit) {
      await submit(scan, ActivityOutcome.COMPLETED, null);
    }
  }, [
    occurrence,
    activity,
    tourId,
    typeMap,
    isOffline,
    riderLabel,
    releaseScanner,
    requiresVariant,
    variantOptions,
    autoSubmit,
    submit,
  ]);

  const handleBarcodeScan = useCallback((result: BarcodeScanningResult) => {
    if (processingRef.current || !canScan) return;
    processingRef.current = true;
    void playScanTick();

    void (async () => {
      try {
        const resolution = await resolveScannedRiderId(result.data, allowedTypeCodes);
        if (!resolution.ok) {
          void playFailure('error');
          setBanner({ kind: resolution.reason === 'TYPE_NOT_ALLOWED_FOR_EVENT' ? 'warning' : 'error', message: resolution.message });
          return;
        }
        await handleResolved({
          riderId: resolution.riderId,
          method: 'QR_SCAN',
          typeCode: resolution.typeCode,
          bagLabel: resolution.bagLabel ?? typeMap[resolution.typeCode]?.name ?? null,
        });
      } catch (error) {
        logger.error(TAG, 'Scan handling failed', error);
        void playFailure('error');
        setBanner({ kind: 'error', message: error instanceof Error ? error.message : EVENT_SCAN_MESSAGES.SAVE_FAILED });
      }
    })();
  }, [canScan, allowedTypeCodes, handleResolved, typeMap]);

  const openManualEntry = () => {
    setManualRiderId('');
    setManualError(null);
    setManualTypeCode(allowedTypeCodes.length === 1 ? allowedTypeCodes[0] : null);
    setShowManualEntry(true);
  };

  const confirmManualEntry = async () => {
    const riderId = manualRiderId.trim().toUpperCase();
    if (!riderId) return;
    const directoryLoaded = Object.keys(riderNamesById).length > 0;
    if (directoryLoaded && !(riderId in riderNamesById)) {
      setManualError(fill(EVENT_SCAN_MESSAGES.RIDER_NOT_IN_TOUR, { riderId }));
      return;
    }
    if (!manualTypeCode) {
      setManualError(EVENT_SCAN_MESSAGES.MANUAL_TYPE_REQUIRED);
      return;
    }
    setShowManualEntry(false);
    processingRef.current = true;
    await handleResolved({
      riderId,
      method: 'MANUAL',
      typeCode: manualTypeCode,
      bagLabel: typeMap[manualTypeCode.toUpperCase()]?.name ?? null,
    });
  };

  const handleRescan = () => {
    resetPending();
    releaseScanner(false);
  };

  // ---------------------------------------------------------------------------
  // Cancel / dismiss
  // ---------------------------------------------------------------------------

  const confirmCancel = async () => {
    const record = cancelTarget;
    if (!record || !tourId) return;
    setIsCancelling(true);
    try {
      if (!OFFLINE_CACHE_ENABLED) {
        const result = await cancelEventRecordOnline(tourId, record, cancelReason);
        setBanner(result.status === 'rejected' || result.status === 'duplicate'
          ? { kind: result.error.kind, message: result.error.message }
          : { kind: 'info', message: EVENT_SCAN_MESSAGES.SCAN_CANCELLED });
        return;
      }
      if (record.syncStatus !== 'SYNCED') {
        const removed = await discardUnsyncedEventRecord(record.localId);
        setBanner({ kind: 'info', message: removed ? EVENT_SCAN_MESSAGES.UNSENT_REMOVED : EVENT_SCAN_MESSAGES.ALREADY_SENT });
        return;
      }
      const opLocalId = await queueEventRecordCancel(record, user?.userId ?? null, cancelReason);
      if (!opLocalId) return;
      if (isOffline) {
        setBanner({ kind: 'info', message: EVENT_SCAN_MESSAGES.CANCEL_QUEUED });
        return;
      }
      const result = await processEventOperationNow(opLocalId);
      if (result.status === 'rejected' || result.status === 'duplicate') {
        setBanner({ kind: result.error.kind, message: result.error.message });
      } else if (result.status === 'queued') {
        setBanner({ kind: 'info', message: EVENT_SCAN_MESSAGES.CANCEL_QUEUED });
      } else {
        setBanner({ kind: 'info', message: EVENT_SCAN_MESSAGES.SCAN_CANCELLED });
      }
    } catch (error) {
      logger.error(TAG, 'Cancelling scan failed', error);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(error) });
    } finally {
      setIsCancelling(false);
      setCancelTarget(null);
      setCancelReason('');
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const header = (
    <EventScreenHeader
      title={event?.eventName ?? 'Event scan'}
      subtitle={occurrence ? `${occurrence.date} · #${occurrence.seq}` : undefined}
      onBack={() => navigation.goBack()}
      right={(
        <TouchableOpacity
          accessibilityLabel="Refresh occurrence"
          accessibilityRole="button"
          disabled={isOffline || isRefreshing}
          onPress={() => void handleRefresh()}
          style={styles.headerButton}
        >
          {isRefreshing
            ? <ActivityIndicator color={COLORS.white} size="small" />
            : <MaterialIcons name="refresh" size={24} color={COLORS.white} />}
        </TouchableOpacity>
      )}
    />
  );

  if (loadState === 'loading') {
    return (
      <View style={styles.container}>
        {header}
        <ActivityIndicator color={COLORS.primary} style={styles.loader} />
      </View>
    );
  }

  if (loadState === 'notFound' || loadState === 'unavailable') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <MaterialIcons name={loadState === 'notFound' ? 'event-busy' : 'cloud-off'} size={40} color={COLORS.gray[400]} />
          <Text style={styles.centeredText}>
            {loadState === 'notFound'
              ? EVENT_ERROR_MESSAGES.OCCURRENCE_NOT_FOUND.message
              : EVENT_SCAN_MESSAGES.NOT_AVAILABLE_OFFLINE}
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to events</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const recent = recentRecords.filter((record) => record.syncStatus !== 'FAILED');
  const pendingDisplay = pendingScan ? getRiderDisplayName(pendingScan.riderId) : null;
  const scannerActive = canScan && !pendingScan && !banner && !showManualEntry && isFocused;

  const renderScanner = () => {
    if (!isActive) {
      return (
        <StatusBanner
          kind="warning"
          message={EVENT_ERROR_MESSAGES.OCCURRENCE_NOT_ACTIVE.message ?? ''}
          title={EVENT_SCAN_MESSAGES.OCCURRENCE_NOT_ACTIVE_HINT}
        />
      );
    }
    if (!activity) {
      return <Text style={styles.hint}>{availableActivities.length > 0 ? EVENT_SCAN_MESSAGES.SELECT_ACTIVITY : ''}</Text>;
    }
    if (showManualEntry) {
      return (
        <View style={styles.manualBox}>
          <Text style={styles.manualTitle}>Manual entry</Text>
          <TextInput
            accessibilityLabel="Rider ID"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onChangeText={(text) => {
              setManualRiderId(text);
              setManualError(null);
            }}
            onSubmitEditing={() => void confirmManualEntry()}
            placeholder="e.g. R1, R57"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            value={manualRiderId}
          />
          {allowedTypeCodes.length > 1 ? (
            <View style={styles.chipRow}>
              {allowedTypeCodes.map((code) => {
                const selected = manualTypeCode === code;
                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={code}
                    onPress={() => {
                      setManualTypeCode(code);
                      setManualError(null);
                    }}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {typeMap[code.toUpperCase()]?.name ?? code}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {manualError ? <Text accessibilityRole="alert" style={styles.fieldError}>{manualError}</Text> : null}
          <View style={styles.manualActions}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setShowManualEntry(false);
                releaseScanner(false);
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={!manualRiderId.trim()}
              onPress={() => void confirmManualEntry()}
              style={[styles.primaryButton, !manualRiderId.trim() && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>Go</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (!permission?.granted) {
      return (
        <View style={styles.permissionBox}>
          <MaterialIcons name="camera-alt" size={36} color={COLORS.gray[400]} />
          <Text style={styles.hint}>Camera access is required for QR scanning.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={requestPermission} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
          </TouchableOpacity>
          {canManualEntry ? (
            <TouchableOpacity accessibilityRole="button" onPress={openManualEntry} style={styles.linkButton}>
              <Text style={styles.linkText}>Enter Rider ID manually</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }
    return (
      <View style={styles.scannerBox}>
        {scannerActive ? (
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            facing="back"
            onBarcodeScanned={handleBarcodeScan}
            style={styles.camera}
          />
        ) : (
          <View style={styles.scannerPaused}>
            <Text style={styles.hint}>Scanner paused</Text>
          </View>
        )}
        <View pointerEvents="box-none" style={styles.scannerOverlay}>
          <View pointerEvents="none" style={styles.scannerFrame} />
          {canManualEntry && scannerActive ? (
            <TouchableOpacity accessibilityRole="button" onPress={openManualEntry} style={styles.manualPrompt}>
              <Text style={styles.linkText}>Enter Rider ID manually</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      {header}
      <ScrollView
        contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
        keyboardShouldPersistTaps="handled"
      >
        <OfflineBanner />

        <View style={styles.occurrenceRow}>
          {occurrence ? <OccurrenceStatusBadge status={occurrence.status} /> : null}
          {event?.location ? <Text style={styles.meta}>{event.location}</Text> : null}
        </View>

        {availableActivities.length === 0 ? (
          <StatusBanner
            kind="info"
            message={isFilteredRole ? EVENT_SCAN_MESSAGES.NO_ACTIVITIES_ASSIGNED : EVENT_SCAN_MESSAGES.NO_ACTIVITIES_ENABLED}
          />
        ) : (
          <View accessibilityRole="radiogroup" style={styles.chipRow}>
            {availableActivities.map((item) => {
              const selected = item.activityId === selectedActivityId;
              return (
                <TouchableOpacity
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: Boolean(pendingScan) || isSubmitting }}
                  disabled={Boolean(pendingScan) || isSubmitting}
                  key={item.activityId}
                  onPress={() => {
                    setSelectedActivityId(item.activityId);
                    setBanner(null);
                    setLastResult(null);
                  }}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {item.sequenceNo}. {item.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {banner ? (
          <StatusBanner
            kind={banner.kind}
            message={banner.message}
            primaryAction={{ label: 'OK', onPress: dismissBanner }}
            secondaryAction={banner.secondaryAction}
          />
        ) : null}
        {lastResult && !banner ? (
          <StatusBanner kind="info" message={lastResult} onDismiss={() => setLastResult(null)} />
        ) : null}

        {pendingScan && activity ? (
          <ScanConfirmationCard
            activityName={activity.name}
            allowOptOut={activity.allowOptOut}
            bagLabel={pendingScan.bagLabel}
            isLoadingVariantDefault={isLoadingVariantDefault}
            isSubmitting={isSubmitting}
            onConfirm={() => void submit(pendingScan, ActivityOutcome.COMPLETED, selectedVariant)}
            onOptOut={() => void submit(pendingScan, ActivityOutcome.OPTED_OUT, null)}
            onRescan={handleRescan}
            onSelectVariant={(variant) => {
              variantTouchedRef.current = true;
              setSelectedVariant(variant);
            }}
            overrideNote={override?.note}
            riderId={pendingScan.riderId}
            riderName={pendingDisplay?.name ?? ''}
            riderNameIsAnomaly={pendingDisplay?.isAnomaly}
            selectedVariant={selectedVariant}
            selfService={getEffectiveSelfService(occurrence, override)}
            variantOptions={variantOptions}
          />
        ) : (
          renderScanner()
        )}

        {activity && isActive ? (
          <View style={styles.autoRow}>
            <Text style={styles.autoLabel}>
              Auto-submit{requiresVariant ? ' (off: this activity needs an option)' : ''}
            </Text>
            <Switch
              accessibilityLabel="Auto-submit"
              disabled={requiresVariant}
              onValueChange={setAutoSubmit}
              value={autoSubmit && !requiresVariant}
            />
          </View>
        ) : null}

        {issues.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sync issues</Text>
            {issues.map((record) => (
              <View key={record.localId} style={styles.issueRow}>
                <View style={styles.recordBody}>
                  <Text style={styles.recordTitle} numberOfLines={1}>
                    {riderLabel(record.riderId)} · {record.activityName}
                  </Text>
                  <Text style={styles.issueText}>{record.syncError}</Text>
                </View>
                {!isOffline ? (
                  <TouchableOpacity
                    accessibilityLabel={`Retry failed scan for ${record.riderId}`}
                    accessibilityRole="button"
                    onPress={() => {
                      retryFailedOperations([record.localId]).catch((error) =>
                        logger.warn(TAG, 'Retrying failed scan failed', error),
                      );
                    }}
                    style={styles.smallButton}
                  >
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  accessibilityLabel={`Dismiss failed scan for ${record.riderId}`}
                  accessibilityRole="button"
                  onPress={() => setCancelTarget(record)}
                  style={styles.smallButton}
                >
                  <Text style={styles.smallButtonText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent scans on this device</Text>
            {!OFFLINE_CACHE_ENABLED ? (
              <TouchableOpacity
                accessibilityLabel="About recent scans on web"
                accessibilityRole="button"
                accessibilityState={{ expanded: showSessionInfo }}
                hitSlop={12}
                onPress={() => setShowSessionInfo((shown) => !shown)}
                style={styles.infoButton}
              >
                <MaterialIcons name="info-outline" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {showSessionInfo ? (
            <StatusBanner
              kind="info"
              message={EVENT_SCAN_MESSAGES.WEB_SESSION_ONLY}
              onDismiss={() => setShowSessionInfo(false)}
            />
          ) : null}
          {recent.length === 0 ? <Text style={styles.hint}>No scans yet.</Text> : null}
          {recent.map((record) => {
            const badge = recordBadge(record);
            const details = [
              record.outcome === ActivityOutcome.OPTED_OUT ? 'Opted out' : record.bagLabel,
              record.variantSelected,
              new Date(record.timestamp).toLocaleTimeString(),
            ].filter(Boolean).join(' · ');
            return (
              <View key={record.localId} style={styles.recordRow}>
                <View style={styles.recordBody}>
                  <Text style={styles.recordTitle} numberOfLines={1}>
                    {riderLabel(record.riderId)} · {record.activityName}
                  </Text>
                  <Text style={styles.recordMeta}>{details}</Text>
                </View>
                <Text style={[styles.recordBadge, { borderColor: badge.color, color: badge.color }]}>{badge.label}</Text>
                {!record.isCancelled ? (
                  <TouchableOpacity
                    accessibilityLabel={`Cancel scan for ${record.riderId}`}
                    accessibilityRole="button"
                    onPress={() => setCancelTarget(record)}
                    style={styles.smallButton}
                  >
                    <MaterialIcons name="undo" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Back"
        confirmLabel={cancelTarget?.syncStatus === 'SYNCED' ? 'Cancel scan' : 'Remove'}
        isSubmitting={isCancelling}
        message={cancelTarget
          ? cancelTarget.syncStatus === 'SYNCED'
            ? `Cancel ${cancelTarget.activityName} for ${riderLabel(cancelTarget.riderId)}? The record is kept on the server and marked cancelled.`
            : `Remove the unsent ${cancelTarget.activityName} scan for ${riderLabel(cancelTarget.riderId)} from this device?`
          : ''}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
        onConfirm={() => void confirmCancel()}
        title={cancelTarget?.syncStatus === 'SYNCED' ? 'Cancel scan' : 'Remove scan'}
        visible={Boolean(cancelTarget)}
      >
        {cancelTarget?.syncStatus === 'SYNCED' ? (
          <TextInput
            accessibilityLabel="Cancel reason (optional)"
            maxLength={200}
            onChangeText={setCancelReason}
            placeholder="Reason (optional)"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            value={cancelReason}
          />
        ) : null}
      </ConfirmDialog>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  loader: { marginVertical: 32 },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
  content: { padding: 12, paddingBottom: 32 },
  contentDesktop: { alignSelf: 'center', maxWidth: 720, width: '100%' },
  occurrenceRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 10 },
  meta: { color: COLORS.textSecondary, fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: COLORS.white },
  hint: { color: COLORS.textSecondary, fontSize: 13, paddingVertical: 8, textAlign: 'center' },
  scannerBox: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 12,
    height: 280,
    marginBottom: 12,
    overflow: 'hidden',
  },
  camera: { flex: 1 },
  scannerPaused: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  scannerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: QR_SCANNER_COLORS.overlay,
    justifyContent: 'center',
  },
  scannerFrame: {
    borderColor: QR_SCANNER_COLORS.frame,
    borderRadius: 16,
    borderWidth: 3,
    height: 180,
    width: 180,
  },
  manualPrompt: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 999,
    borderWidth: 1,
    bottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'absolute',
  },
  permissionBox: { alignItems: 'center', gap: 10, marginBottom: 12, padding: 16 },
  manualBox: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  manualTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  manualActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 12 },
  input: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldError: { color: COLORS.danger, fontSize: 13, marginTop: 4 },
  linkButton: { padding: 8 },
  linkText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  autoRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  autoLabel: { color: COLORS.textSecondary, flex: 1, fontSize: 13, fontWeight: '600' },
  section: { marginTop: 8 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  infoButton: { marginBottom: 6, padding: 2 },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  recordRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.gray[100],
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
  },
  issueRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.danger,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
    padding: 8,
  },
  recordBody: { flex: 1, minWidth: 0 },
  recordTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  recordMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  issueText: { color: COLORS.danger, fontSize: 12, marginTop: 2 },
  recordBadge: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  smallButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 40, paddingHorizontal: 8 },
  smallButtonText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  retryButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
