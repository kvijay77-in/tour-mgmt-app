/**
 * Event progress tab: per-rider compact stepper for every activity, or one
 * activity zoomed in via the filter dropdown. Totals, sort toggle, reconciliation
 * tile and a rider pop-up. See docs/design/events.md.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_DASHBOARD_MESSAGES } from '../../constants/eventMessages';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useOccurrenceDashboard } from '../../context/OccurrenceDashboardContext';
import { EventDashboardRider } from '../../types/api';
import { AppStackParamList } from '../../types/navigation';
import {
  DashboardActivity,
  findRecord,
  getActivityTotals,
  getOverallTotals,
  ProgressRow,
  ProgressStatus,
  sortRidersDefault,
  sortRidersForActivity,
} from '../../utils/eventProgress';
import { isExitedTourRider } from '../../utils/riderStatus';
import { SortIcon } from '../../components/common/SortIcon';
import ActivityFilterDropdown from '../../components/events/ActivityFilterDropdown';
import ActivityProgressStrip from '../../components/events/ActivityProgressStrip';
import ActivityZoomNode from '../../components/events/ActivityZoomNode';
import EventRiderCardModal from '../../components/events/EventRiderCardModal';
import StatusBanner from '../../components/events/StatusBanner';

interface RiderRowProps {
  riderId: string;
  exited: boolean;
  activities: readonly DashboardActivity[];
  statuses: Readonly<Record<string, ProgressStatus>>;
  zoomActivityId: string | null;
  zoomTimestamp: string | null;
  onPress: (riderId: string) => void;
}

const RiderRow = React.memo(function RiderRow({
  riderId,
  exited,
  activities,
  statuses,
  zoomActivityId,
  zoomTimestamp,
  onPress,
}: RiderRowProps) {
  return (
    <TouchableOpacity
      accessibilityLabel={`Rider ${riderId}${exited ? ', exited tour' : ''}`}
      accessibilityRole="button"
      onPress={() => onPress(riderId)}
      style={styles.row}
    >
      <View style={styles.idCell}>
        <Text style={styles.riderId}>{riderId}</Text>
        {exited ? <MaterialIcons name="close" size={18} color={COLORS.black} style={styles.exitedMark} /> : null}
      </View>
      {zoomActivityId ? (
        <ActivityZoomNode status={statuses[zoomActivityId] ?? 'PENDING'} timestamp={zoomTimestamp} />
      ) : (
        <ActivityProgressStrip riderId={riderId} activities={activities} statuses={statuses} />
      )}
    </TouchableOpacity>
  );
});

export default function EventProgressTab() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const {
    eventId,
    occurrenceId,
    dashboard,
    event,
    occurrence,
    summary,
    activities,
    riderStatuses,
    reconciliation,
    reconciliationError,
    isRefreshing,
    reload,
    activityFilter,
    setActivityFilter,
    isSorted,
    toggleSort,
  } = useOccurrenceDashboard();
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);

  const activityIds = useMemo(() => activities.map((activity) => activity.activityId), [activities]);
  const zoomActivity = activities.find((activity) => activity.activityId === activityFilter) ?? null;
  const records = dashboard?.records;

  const rows = useMemo(() => {
    const base: ProgressRow[] = (dashboard?.riders ?? []).map((rider) => ({
      riderId: rider.riderId,
      statuses: riderStatuses.get(rider.riderId) ?? {},
    }));
    return zoomActivity
      ? sortRidersForActivity(base, zoomActivity.activityId, isSorted)
      : sortRidersDefault(base, activityIds, isSorted);
  }, [dashboard?.riders, riderStatuses, zoomActivity, activityIds, isSorted]);

  const ridersById = useMemo(
    () => new Map((dashboard?.riders ?? []).map((rider) => [rider.riderId, rider])),
    [dashboard?.riders],
  );

  const totals = useMemo(() => {
    if (!summary) return [];
    if (zoomActivity) {
      const t = getActivityTotals(summary, zoomActivity);
      return [
        { label: 'Total', value: t.total },
        { label: 'Completed', value: t.completed },
        { label: 'Pending', value: t.pending },
        ...(t.optedOut !== null ? [{ label: 'Opted out', value: t.optedOut }] : []),
        ...(t.flagged !== null ? [{ label: 'Flagged', value: t.flagged }] : []),
      ];
    }
    const t = getOverallTotals(summary, riderStatuses, activityIds);
    return [
      { label: 'Total riders', value: t.totalRiders },
      { label: 'Fully done', value: t.fullyDone },
      { label: 'With pending', value: t.withPending },
      { label: 'Outstanding mandatory', value: t.outstandingMandatory },
      ...(t.registered !== null ? [{ label: 'Registered', value: t.registered }] : []),
      ...(t.flagged !== null ? [{ label: 'Flagged', value: t.flagged }] : []),
    ];
  }, [summary, zoomActivity, riderStatuses, activityIds]);

  const openRider = useCallback((riderId: string) => setSelectedRiderId(riderId), []);

  const renderItem = useCallback(({ item }: { item: ProgressRow }) => {
    const rider: EventDashboardRider | undefined = ridersById.get(item.riderId);
    const zoomRecord = zoomActivity && records ? findRecord(records, item.riderId, zoomActivity.activityId) : undefined;
    return (
      <RiderRow
        riderId={item.riderId}
        exited={isExitedTourRider(rider?.status)}
        activities={activities}
        statuses={item.statuses}
        zoomActivityId={zoomActivity?.activityId ?? null}
        zoomTimestamp={zoomRecord?.timestamp ?? null}
        onPress={openRider}
      />
    );
  }, [ridersById, zoomActivity, records, activities, openRider]);

  const linkedRef = occurrence?.linkedOccurrenceRef ?? null;
  const renderReconciliationTile = () => {
    if (!linkedRef) return null;
    const text = reconciliation
      ? `${reconciliation.loadedCount} loaded vs ${reconciliation.unloadedCount} unloaded`
      : reconciliationError?.message ?? 'Not available';
    const missing = reconciliation?.missingRiderIds.length ?? 0;
    return (
      <TouchableOpacity
        accessibilityLabel={`Reconciliation: ${text}${missing ? `, ${missing} missing` : ''}`}
        accessibilityRole="button"
        onPress={() => navigation.navigate('BaggageReconciliation', { eventId, occurrenceId })}
        style={[styles.reconTile, missing > 0 && styles.reconTileWarning]}
      >
        <MaterialIcons name="compare-arrows" size={22} color={missing > 0 ? COLORS.warning : COLORS.primary} />
        <View style={styles.flex}>
          <Text style={styles.reconTitle}>Reconciliation</Text>
          <Text style={styles.reconText}>{text}</Text>
          {missing > 0 ? <Text style={styles.reconMissing}>{missing} bag(s) missing</Text> : null}
        </View>
        <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  const hasRecords = Boolean(summary && summary.completedCount + summary.optedOutCount + summary.flaggedCount > 0);
  const selectedRider = selectedRiderId ? ridersById.get(selectedRiderId) ?? null : null;

  const header = (
    <View>
      <View style={styles.controls}>
        <ActivityFilterDropdown
          activities={activities}
          selectedActivityId={activityFilter}
          onSelect={setActivityFilter}
        />
        {zoomActivity ? (
          <TouchableOpacity
            accessibilityLabel="Show all activities"
            accessibilityRole="button"
            onPress={() => setActivityFilter(null)}
            style={styles.iconButton}
          >
            <MaterialIcons name="zoom-out" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityLabel={isSorted ? 'Reset sort' : 'Sort by progress'}
          accessibilityRole="button"
          accessibilityState={{ selected: isSorted }}
          onPress={toggleSort}
          style={[styles.iconButton, isSorted && styles.iconButtonActive]}
        >
          <SortIcon size={22} color={isSorted ? COLORS.white : COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tiles}>
        {totals.map((tile) => (
          <View
            accessible
            accessibilityLabel={`${tile.label}: ${tile.value}`}
            key={tile.label}
            style={[styles.tile, isDesktop ? styles.tileDesktop : styles.tileMobile]}
          >
            <Text style={styles.tileValue}>{tile.value}</Text>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </View>
        ))}
      </View>

      {renderReconciliationTile()}
      {dashboard && !hasRecords ? <StatusBanner kind="info" message={EVENT_DASHBOARD_MESSAGES.NO_RECORDS} /> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
        data={rows}
        keyExtractor={(row) => row.riderId}
        ListEmptyComponent={dashboard ? <Text style={styles.empty}>No riders to show.</Text> : null}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void reload()} />}
        renderItem={renderItem}
      />
      <EventRiderCardModal
        activityIds={activityIds}
        event={event}
        occurrence={occurrence}
        onClose={() => setSelectedRiderId(null)}
        records={records ?? []}
        rider={selectedRider}
        statuses={selectedRiderId ? riderStatuses.get(selectedRiderId) : undefined}
        visible={Boolean(selectedRider)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: { padding: 12, paddingBottom: 24 },
  contentDesktop: { alignSelf: 'center', maxWidth: 960, width: '100%' },
  controls: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tile: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 68,
    padding: 8,
  },
  tileMobile: { flexBasis: '30%' },
  tileDesktop: { flexBasis: '15%' },
  tileValue: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  tileLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2, textAlign: 'center' },
  reconTile: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    minHeight: 56,
    padding: 14,
  },
  reconTileWarning: { borderColor: COLORS.warning },
  reconTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  reconText: { color: COLORS.textPrimary, fontSize: 14, marginTop: 2 },
  reconMissing: { color: COLORS.warning, fontSize: 13, fontWeight: '600', marginTop: 2 },
  flex: { flex: 1, minWidth: 0 },
  row: {
    alignItems: 'center',
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingVertical: 6,
  },
  idCell: { alignItems: 'center', flexDirection: 'row', gap: 2, width: 64 },
  riderId: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  exitedMark: { opacity: 0.6 },
  empty: { color: COLORS.textSecondary, fontSize: 14, padding: 16, textAlign: 'center' },
});
