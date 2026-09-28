/**
 * Sync Status Screen — everything captured on this device that has not
 * reached the server yet (ride check-ins and event scans/cancels).
 *
 * Shows the connection and sending status, the offline-data readiness time
 * and each queued item with its error. Failed items can be retried or, after
 * confirmation, discarded — nothing is dropped silently.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, STATUS_BANNER_COLORS } from '../../constants/colors';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { useTour } from '../../context/TourContext';
import {
  CancelEventRecordPayload,
  CreateEventRecordPayload,
  getAllQueuedOperations,
  PendingOperation,
} from '../../services/database/pendingStore';
import { discardOperation, retryFailedOperations } from '../../services/sync/outboundSyncService';
import { CrossCheckResult, resendMissingCheckIn, verifySentCheckIns } from '../../services/sync/checkInCrossCheck';
import { describeClockSkew } from '../../services/sync/clockSkew';
import { SentCheckIn } from '../../services/database/sentCheckInStore';
import { OFFLINE_CACHE_ENABLED } from '../../services/offline/offlineDataService';
import { isNetworkError } from '../../services/api/apiClient';
import { CheckInRequest } from '../../types/api';
import { logger } from '../../utils/logger';

const TAG = 'SyncStatusScreen';
const LIST_LIMIT = 200;

interface SyncStatusScreenProps {
  onClose: () => void;
}

interface QueuedItemView {
  op: PendingOperation;
  title: string;
  subtitle: string;
  capturedAt: string;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function parsePayload<T>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function describeCheckIn(request: CheckInRequest): string {
  if (request.isQuitRiding) return 'Quit riding';
  if (request.isNotRiding) return 'Not riding';
  if (request.isFloat) return `Float${request.floatNo ? ` ${request.floatNo}` : ''}`;
  return request.stageNumber !== undefined ? `Stage ${request.stageNumber}` : 'Check-in';
}

export default function SyncStatusScreen({ onClose }: SyncStatusScreenProps) {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const { getRiderDisplayName } = useNameDirectory();
  const {
    pendingCount,
    failedCount,
    oldestPendingAt,
    isStale,
    readinessSyncedAt,
    clockSkewMs,
    isClockSkewed,
    engine,
    syncNow,
    retryAllFailed,
  } = useSyncStatus();
  const { tour } = useTour();
  const [crossCheck, setCrossCheck] = useState<CrossCheckResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [crossCheckError, setCrossCheckError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [operations, setOperations] = useState<PendingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<QueuedItemView | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const canSend = !isOffline && !user?.isOfflineSession;

  const loadOperations = useCallback(async () => {
    if (!OFFLINE_CACHE_ENABLED) {
      setIsLoading(false);
      return;
    }
    try {
      setOperations(await getAllQueuedOperations(LIST_LIMIT));
    } catch (error) {
      logger.error(TAG, 'Loading queued operations failed', error);
      setActionError('Could not read the data saved on this device.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations, pendingCount, failedCount, engine.isRunning, engine.lastRunAt]);

  const items = useMemo<QueuedItemView[]>(() => operations.map((op) => {
    if (op.operationType === 'CHECK_IN') {
      const request = parsePayload<CheckInRequest>(op.payload);
      return {
        op,
        title: request ? `${getRiderDisplayName(request.riderId).name} · ${describeCheckIn(request)}` : 'Ride check-in',
        subtitle: 'Ride check-in',
        capturedAt: request?.timestamp ?? op.createdAt,
      };
    }
    if (op.operationType === 'CREATE_EVENT_ACTIVITY_RECORD') {
      const payload = parsePayload<CreateEventRecordPayload>(op.payload);
      return {
        op,
        title: payload ? getRiderDisplayName(payload.request.riderId).name : 'Event scan',
        subtitle: payload?.request.outcome === 'OPTED_OUT' ? 'Event scan · opted out' : 'Event scan',
        capturedAt: payload?.request.timestamp ?? op.createdAt,
      };
    }
    const payload = parsePayload<CancelEventRecordPayload>(op.payload);
    return {
      op,
      title: 'Cancel event scan',
      subtitle: payload?.cancelReason ? `Reason: ${payload.cancelReason}` : 'Event scan cancellation',
      capturedAt: op.createdAt,
    };
  }), [operations, getRiderDisplayName]);

  const handleRetry = useCallback(async (localId: string) => {
    setActionError(null);
    setBusyId(localId);
    try {
      await retryFailedOperations([localId]);
    } catch (error) {
      logger.error(TAG, 'Retry failed', error);
      setActionError('Retry could not be started. Please try again.');
    } finally {
      setBusyId(null);
      void loadOperations();
    }
  }, [loadOperations]);

  const handleRetryAll = useCallback(async () => {
    setActionError(null);
    try {
      await retryAllFailed();
    } catch (error) {
      logger.error(TAG, 'Retry all failed', error);
      setActionError('Retry could not be started. Please try again.');
    } finally {
      void loadOperations();
    }
  }, [retryAllFailed, loadOperations]);

  const confirmDiscard = useCallback(async () => {
    if (!discardTarget) return;
    setIsDiscarding(true);
    setActionError(null);
    try {
      await discardOperation(discardTarget.op.localId);
      setDiscardTarget(null);
    } catch (error) {
      logger.error(TAG, 'Discard failed', error);
      setActionError('The item could not be discarded. Please try again.');
    } finally {
      setIsDiscarding(false);
      void loadOperations();
    }
  }, [discardTarget, loadOperations]);

  const handleVerify = useCallback(async () => {
    if (!tour) return;
    setIsVerifying(true);
    setCrossCheckError(null);
    try {
      setCrossCheck(await verifySentCheckIns(tour.tourId));
    } catch (error) {
      logger.warn(TAG, 'Server cross-check failed', error);
      setCrossCheckError(isNetworkError(error)
        ? 'The server could not be reached. Try again when online.'
        : 'The server check could not be completed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  }, [tour]);

  const handleResend = useCallback(async (entries: SentCheckIn[]) => {
    if (!user || entries.length === 0) return;
    setCrossCheckError(null);
    setResendingId(entries.length === 1 ? entries[0].localId : 'all');
    const resent = new Set<string>();
    try {
      for (const entry of entries) {
        await resendMissingCheckIn(entry, { userId: user.userId, checkedInBy: user.username });
        resent.add(entry.localId);
      }
    } catch (error) {
      logger.error(TAG, 'Queuing missing check-in failed', error);
      setCrossCheckError('Some check-ins could not be queued again. Please try again.');
    } finally {
      setResendingId(null);
      setCrossCheck((current) => current
        ? { ...current, missing: current.missing.filter((entry) => !resent.has(entry.localId)) }
        : current);
      void loadOperations();
    }
  }, [user, loadOperations]);

  const describeSent = (entry: SentCheckIn) =>
    `${getRiderDisplayName(entry.riderId).name} · ${describeCheckIn(entry.request)} · captured ${formatDateTime(entry.request.timestamp ?? entry.sentAt)}`;

  const connectionText = isOffline
    ? 'Offline — data is saved on this device'
    : user?.isOfflineSession
      ? 'Signed in offline — sign in online to send data'
      : engine.isRunning
        ? 'Sending…'
        : 'Online';

  const renderItem = ({ item }: { item: QueuedItemView }) => {
    const { op } = item;
    const isFailed = op.syncStatus === 'FAILED';
    const isOtherUser = Boolean(user && op.ownerUserId && op.ownerUserId !== user.userId);
    const statusLabel = isFailed ? 'Needs attention' : op.syncStatus === 'SYNCING' ? 'Sending' : 'Waiting to send';
    return (
      <View style={[styles.item, isFailed && styles.itemFailed]}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.itemStatus, isFailed ? styles.itemStatusFailed : styles.itemStatusPending]}>
            {statusLabel}
          </Text>
        </View>
        <Text style={styles.itemMeta}>
          {`${item.subtitle} · captured ${formatDateTime(item.capturedAt)}`}
          {op.retryCount > 0 ? ` · ${op.retryCount} attempt${op.retryCount === 1 ? '' : 's'}` : ''}
        </Text>
        {isOtherUser ? <Text style={styles.itemError}>Captured by another user on this device.</Text> : null}
        {op.syncError ? <Text style={styles.itemError}>{op.syncError}</Text> : null}
        {!isFailed && op.nextAttemptAt ? (
          <Text style={styles.itemMeta}>{`Next try ${formatDateTime(op.nextAttemptAt)}`}</Text>
        ) : null}
        {isFailed ? (
          <View style={styles.itemActions}>
            {canSend ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={busyId === op.localId}
                onPress={() => void handleRetry(op.localId)}
                style={styles.actionButton}
              >
                {busyId === op.localId
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Text style={styles.actionText}>Retry</Text>}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setDiscardTarget(item)}
              style={styles.actionButton}
            >
              <Text style={styles.discardText}>Discard</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" onPress={onClose} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sync status</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.op.localId}
        renderItem={renderItem}
        ListHeaderComponent={(
          <View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{connectionText}</Text>
              <Text style={styles.summaryLine}>{`Waiting to send: ${pendingCount}`}</Text>
              <Text style={styles.summaryLine}>{`Needs attention: ${failedCount}`}</Text>
              {oldestPendingAt ? (
                <Text style={styles.summaryLine}>{`Oldest unsent: ${formatDateTime(oldestPendingAt)}`}</Text>
              ) : null}
              <Text style={styles.summaryLine}>{`Last send attempt: ${formatDateTime(engine.lastRunAt)}`}</Text>
              {engine.nextRetryAt ? (
                <Text style={styles.summaryLine}>{`Next automatic try: ${formatDateTime(engine.nextRetryAt)}`}</Text>
              ) : null}
              {engine.lastError ? <Text style={styles.itemError}>{engine.lastError}</Text> : null}
              {Platform.OS !== 'web' ? (
                <Text style={styles.summaryLine}>
                  {readinessSyncedAt
                    ? `Offline data as of ${formatDateTime(readinessSyncedAt)}`
                    : 'Offline data not downloaded yet — open the ride or event while online'}
                </Text>
              ) : null}
            </View>

            {isStale ? (
              <View style={styles.warningBanner}>
                <MaterialIcons name="warning" size={18} color={STATUS_BANNER_COLORS.warning.text} />
                <Text style={styles.warningText}>
                  Some data has not been sent for a while. Connect to the internet and tap Sync now.
                </Text>
              </View>
            ) : null}

            {isClockSkewed && clockSkewMs !== null ? (
              <View style={styles.warningBanner}>
                <MaterialIcons name="schedule" size={18} color={STATUS_BANNER_COLORS.warning.text} />
                <Text style={styles.warningText}>
                  {`The device clock is ${describeClockSkew(clockSkewMs)}. Check-ins and scans saved offline use this clock — set the date and time to automatic.`}
                </Text>
              </View>
            ) : null}

            {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

            <View style={styles.toolbar}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!canSend || engine.isRunning}
                onPress={syncNow}
                style={[styles.toolbarButton, (!canSend || engine.isRunning) && styles.toolbarButtonDisabled]}
              >
                <Text style={styles.toolbarButtonText}>Sync now</Text>
              </TouchableOpacity>
              {failedCount > 0 && canSend ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void handleRetryAll()}
                  style={[styles.toolbarButton, styles.toolbarButtonSecondary]}
                >
                  <Text style={styles.toolbarButtonSecondaryText}>Retry all</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
        ListFooterComponent={tour && Platform.OS !== 'web' ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Verify with server</Text>
            <Text style={styles.summaryLine}>
              Checks that every check-in sent from this device's queue is on the server.
            </Text>
            {crossCheck ? (
              <Text style={styles.summaryLine}>
                {crossCheck.missing.length === 0
                  ? `All ${crossCheck.checkedCount} sent check-in${crossCheck.checkedCount === 1 ? '' : 's'} found on the server (${formatDateTime(crossCheck.verifiedAt)}).`
                  : `${crossCheck.missing.length} of ${crossCheck.checkedCount} sent check-ins are not on the server.`}
              </Text>
            ) : null}
            {crossCheck?.missing.map((entry) => (
              <View key={entry.localId} style={styles.missingRow}>
                <Text style={styles.missingText}>{describeSent(entry)}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!canSend || resendingId !== null}
                  onPress={() => void handleResend([entry])}
                  style={styles.actionButton}
                >
                  {resendingId === entry.localId
                    ? <ActivityIndicator size="small" color={COLORS.primary} />
                    : <Text style={styles.actionText}>Send again</Text>}
                </TouchableOpacity>
              </View>
            ))}
            {crossCheckError ? <Text style={styles.itemError}>{crossCheckError}</Text> : null}
            <View style={styles.toolbar}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!canSend || isVerifying}
                onPress={() => void handleVerify()}
                style={[styles.toolbarButton, styles.toolbarButtonSecondary, (!canSend || isVerifying) && styles.toolbarButtonDisabled]}
              >
                {isVerifying
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Text style={styles.toolbarButtonSecondaryText}>Verify with server</Text>}
              </TouchableOpacity>
              {crossCheck && crossCheck.missing.length > 1 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={!canSend || resendingId !== null}
                  onPress={() => void handleResend(crossCheck.missing)}
                  style={[styles.toolbarButton, (!canSend || resendingId !== null) && styles.toolbarButtonDisabled]}
                >
                  <Text style={styles.toolbarButtonText}>Send all again</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}
        ListEmptyComponent={isLoading
          ? <ActivityIndicator style={styles.loader} color={COLORS.primary} />
          : <Text style={styles.emptyText}>All data on this device has been sent.</Text>}
      />

      <ConfirmDialog
        visible={discardTarget !== null}
        title="Discard this item?"
        message={`"${discardTarget?.title ?? ''}" will be removed from this device and will never reach the server. This cannot be undone.`}
        confirmLabel="Discard"
        cancelLabel="Keep"
        confirmTone="danger"
        isSubmitting={isDiscarding}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDiscardTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
    paddingBottom: 12,
    paddingHorizontal: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  backButton: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  headerSpacer: { width: 40 },
  content: { padding: 16, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  summaryTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  summaryLine: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  warningBanner: {
    alignItems: 'center',
    backgroundColor: STATUS_BANNER_COLORS.warning.background,
    borderColor: STATUS_BANNER_COLORS.warning.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    padding: 10,
  },
  warningText: { color: STATUS_BANNER_COLORS.warning.text, flex: 1, fontSize: 13 },
  actionError: { color: COLORS.danger, fontSize: 13, marginBottom: 8 },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toolbarButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    flex: 1,
    paddingVertical: 10,
  },
  toolbarButtonDisabled: { opacity: 0.5 },
  toolbarButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  toolbarButtonSecondary: { backgroundColor: COLORS.surface, borderColor: COLORS.primary, borderWidth: 1 },
  toolbarButtonSecondaryText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  item: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
    padding: 12,
  },
  itemFailed: { borderColor: STATUS_BANNER_COLORS.error.border },
  itemHeader: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  itemTitle: { color: COLORS.textPrimary, flex: 1, fontSize: 14, fontWeight: '600' },
  itemStatus: { fontSize: 12, fontWeight: '600' },
  itemStatusFailed: { color: COLORS.danger },
  itemStatusPending: { color: STATUS_BANNER_COLORS.warning.text },
  itemMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  itemError: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  itemActions: { flexDirection: 'row', gap: 16, justifyContent: 'flex-end', marginTop: 8 },
  actionButton: { minWidth: 56, paddingHorizontal: 4, paddingVertical: 6 },
  actionText: { color: COLORS.primary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  discardText: { color: COLORS.danger, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  missingRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  missingText: { color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  loader: { marginTop: 24 },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 24, textAlign: 'center' },
});
