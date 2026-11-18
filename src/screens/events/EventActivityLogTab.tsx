import React, { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOccurrenceDashboard } from '../../context/OccurrenceDashboardContext';
import { retryFailedOperations } from '../../services/sync/outboundSyncService';
import {
  discardUnsyncedEventRecord,
  processEventOperationNow,
  queueEventRecordCancel,
} from '../../services/sync/eventSyncService';
import { LocalEventActivityRecord } from '../../services/database/eventRecordStore';
import { ActivityOutcome, EventActivityRecord, Permission } from '../../types/models';
import {
  buildLogEntries,
  compareRiderIds,
  formatLocalTime,
  LogEntry,
  sortCancelled,
} from '../../utils/eventProgress';
import { hasPermission } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import ActivityFilterDropdown from '../../components/events/ActivityFilterDropdown';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import EventRiderCardModal from '../../components/events/EventRiderCardModal';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'EventActivityLogTab';
const EMPTY_RECORDS: readonly EventActivityRecord[] = [];

function outcomeBadge(entry: Pick<LogEntry, 'isFlagged' | 'outcome' | 'method'>): { label: string; color: string } {
  if (entry.isFlagged) return { label: 'Flagged', color: COLORS.danger };
  if (entry.outcome === ActivityOutcome.OPTED_OUT) return { label: 'Opted out', color: COLORS.warning };
  if (entry.method === 'SELF_SERVICE') return { label: 'Self', color: COLORS.primary };
  return { label: 'Completed', color: COLORS.success };
}

function syncBadge(syncStatus: LocalEventActivityRecord['syncStatus'] | null): { label: string; color: string } | null {
  if (!syncStatus || syncStatus === 'SYNCED') return null;
  if (syncStatus === 'PENDING') return { label: 'Queued', color: COLORS.warning };
  return { label: 'Failed', color: COLORS.danger };
}

function localCancelTime(record: EventActivityRecord): string {
  return formatLocalTime(record.cancelledAt ?? record.timestamp);
}

export default function EventActivityLogTab() {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const { tour } = useTour();
  const { getRiderDisplayName, getAppUserDisplayName } = useNameDirectory();
  const {
    dashboard,
    event,
    occurrence,
    activities,
    riderStatuses,
    localRecords,
    isRefreshing,
    reload,
    refreshProgressSoon,
    activityFilter,
    setActivityFilter,
    canViewDashboard,
  } = useOccurrenceDashboard();

  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LocalEventActivityRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const canCancel = Boolean(user?.userRole && hasPermission(user.userRole, Permission.EVENT_SCAN))
    && occurrence?.status === 'ACTIVE';

  const records = dashboard?.records ?? EMPTY_RECORDS;
  const activityNames = useMemo(
    () => new Map(activities.map((item) => [item.activityId, item.name])),
    [activities],
  );

  const entries = useMemo(() => {
    const serverRecords = canViewDashboard ? records : [];
    const merged = buildLogEntries(serverRecords, localRecords, activityFilter);
    return merged.sort((a, b) => {
      const byTime = b.timestamp.localeCompare(a.timestamp);
      if (byTime !== 0) return byTime;
      return compareRiderIds(a.riderId, b.riderId);
    });
  }, [canViewDashboard, records, localRecords, activityFilter]);

  const failedRecords = useMemo(
    () => localRecords.filter((record) => record.syncStatus === 'FAILED')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [localRecords],
  );

  const cancelled = useMemo(
    () => (canViewDashboard ? sortCancelled(dashboard?.cancelled ?? []) : []),
    [canViewDashboard, dashboard?.cancelled],
  );

  const ridersById = useMemo(
    () => new Map((dashboard?.riders ?? []).map((rider) => [rider.riderId, rider])),
    [dashboard?.riders],
  );

  const selectedRider = selectedRiderId ? ridersById.get(selectedRiderId) ?? null : null;
  const activityIds = useMemo(() => activities.map((item) => item.activityId), [activities]);

  const confirmCancel = async () => {
    const record = cancelTarget;
    const tourId = tour?.tourId;
    if (!record || !tourId) return;

    setIsCancelling(true);
    try {
      if (record.syncStatus !== 'SYNCED') {
        await discardUnsyncedEventRecord(record.localId);
      } else {
        const opLocalId = await queueEventRecordCancel(record, user?.userId ?? null, cancelReason);
        if (opLocalId && !isOffline) {
          await processEventOperationNow(opLocalId);
        }
      }
      refreshProgressSoon();
    } catch (error) {
      logger.warn(TAG, 'Cancelling event log record failed', error);
    } finally {
      setIsCancelling(false);
      setCancelTarget(null);
      setCancelReason('');
    }
  };

  const renderEntry = ({ item }: { item: LogEntry }) => {
    const rider = getRiderDisplayName(item.riderId);
    const outcome = outcomeBadge(item);
    const sync = syncBadge(item.syncStatus);
    const recordForCancel = item.source === 'DEVICE'
      ? localRecords.find((record) => `local:${record.localId}` === item.key) ?? null
      : null;

    return (
      <TouchableOpacity
        accessibilityRole={canViewDashboard ? 'button' : undefined}
        disabled={!canViewDashboard}
        onPress={() => canViewDashboard && setSelectedRiderId(item.riderId)}
        style={styles.row}
      >
        <View style={styles.rowHeader}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {formatLocalTime(item.timestamp)} · {item.riderId} · {rider.name}
          </Text>
          <Text style={[styles.badge, { borderColor: outcome.color, color: outcome.color }]}>{outcome.label}</Text>
        </View>

        <Text style={styles.rowMeta}>
          {activityNames.get(item.activityId) ?? item.activityName}
          {item.variantSelected ? ` · ${item.variantSelected}` : ''}
          {item.scannedBy ? ` · ${getAppUserDisplayName(item.scannedBy)}` : ''}
        </Text>

        <View style={styles.rowFooter}>
          {sync ? <Text style={[styles.badge, { borderColor: sync.color, color: sync.color }]}>{sync.label}</Text> : null}
          {recordForCancel && canCancel ? (
            <TouchableOpacity
              accessibilityLabel={`Cancel scan for ${item.riderId}`}
              accessibilityRole="button"
              onPress={() => setCancelTarget(recordForCancel)}
              style={styles.iconButton}
            >
              <MaterialIcons name="undo" size={18} color={COLORS.danger} />
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={entries}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={(
          <View>
            <View style={styles.controls}>
              <ActivityFilterDropdown
                activities={activities}
                selectedActivityId={activityFilter}
                onSelect={setActivityFilter}
              />
              {activityFilter ? (
                <TouchableOpacity
                  accessibilityLabel="Show all activities"
                  accessibilityRole="button"
                  onPress={() => setActivityFilter(null)}
                  style={styles.iconButton}
                >
                  <MaterialIcons name="zoom-out" size={24} color={COLORS.primary} />
                </TouchableOpacity>
              ) : null}
            </View>

            {!canViewDashboard ? (
              <StatusBanner kind="info" message="Showing scans from this device." />
            ) : null}

            {failedRecords.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sync issues</Text>
                {failedRecords.map((record) => (
                  <View key={record.localId} style={styles.issueRow}>
                    <View style={styles.flex}>
                      <Text numberOfLines={1} style={styles.rowTitle}>{record.riderId} · {record.activityName}</Text>
                      <Text style={styles.issueText}>{record.syncError}</Text>
                    </View>
                    {!isOffline ? (
                      <TouchableOpacity
                        accessibilityLabel={`Retry failed scan for ${record.riderId}`}
                        accessibilityRole="button"
                        onPress={() => {
                          retryFailedOperations([record.localId]).catch((error) =>
                            logger.warn(TAG, 'Retrying failed event log record failed', error),
                          );
                        }}
                        style={styles.smallButton}
                      >
                        <Text style={styles.retryText}>Retry</Text>
                      </TouchableOpacity>
                    ) : null}
                    {canCancel ? (
                      <TouchableOpacity
                        accessibilityLabel={`Dismiss failed scan for ${record.riderId}`}
                        accessibilityRole="button"
                        onPress={() => setCancelTarget(record)}
                        style={styles.smallButton}
                      >
                        <Text style={styles.dismissText}>Dismiss</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {cancelled.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Cancelled</Text>
                {cancelled.map((record) => (
                  <View key={record.recordId} style={styles.cancelledRow}>
                    <Text style={styles.rowTitle}>{record.activityName} · {record.riderId}</Text>
                    <Text style={styles.rowMeta}>
                      {localCancelTime(record)}
                      {record.cancelledBy ? ` · ${getAppUserDisplayName(record.cancelledBy)}` : ''}
                      {record.cancelReason ? ` · ${record.cancelReason}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Activity records</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No records to show.</Text>}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void reload()} />}
        renderItem={renderEntry}
      />

      <ConfirmDialog
        cancelLabel="Back"
        confirmLabel={cancelTarget?.syncStatus === 'SYNCED' ? 'Cancel scan' : 'Remove'}
        isSubmitting={isCancelling}
        message={cancelTarget
          ? cancelTarget.syncStatus === 'SYNCED'
            ? `Cancel ${cancelTarget.activityName} for ${cancelTarget.riderId}? The record is kept on the server and marked cancelled.`
            : `Remove the unsent ${cancelTarget.activityName} scan for ${cancelTarget.riderId} from this device?`
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

      <EventRiderCardModal
        activityIds={activityIds}
        event={event}
        occurrence={occurrence}
        onClose={() => setSelectedRiderId(null)}
        records={records}
        rider={selectedRider}
        statuses={selectedRiderId ? riderStatuses.get(selectedRiderId) : undefined}
        visible={Boolean(selectedRider)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: {
    alignSelf: 'center',
    maxWidth: DESKTOP_MIN_WIDTH,
    padding: 12,
    paddingBottom: 28,
    width: '100%',
  },
  controls: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  section: { marginBottom: 10 },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  row: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
  },
  rowHeader: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  rowTitle: { color: COLORS.textPrimary, flex: 1, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  rowFooter: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
  badge: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  iconButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
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
  flex: { flex: 1 },
  issueText: { color: COLORS.danger, fontSize: 12, marginTop: 2 },
  smallButton: { alignItems: 'center', justifyContent: 'center', minHeight: 38, minWidth: 38, paddingHorizontal: 6 },
  retryText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  dismissText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  cancelledRow: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
    padding: 8,
  },
  input: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  empty: { color: COLORS.textSecondary, fontSize: 13, paddingVertical: 8, textAlign: 'center' },
});
