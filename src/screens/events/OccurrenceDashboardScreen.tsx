/**
 * Occurrence dashboard (VIEW_DASHBOARD, mobile-first responsive): count tiles
 * (total, completed, outstanding mandatory → rider list, opted out, flagged),
 * a reconciliation tile when the occurrence has a linkedOccurrenceRef, and the
 * cancelled records list. Progress is polled while focused for ACTIVE
 * occurrences; offline (or when the server is unreachable) the last saved
 * snapshot is shown with a "stale data" banner.
 *
 * See docs/Event-Engine-Design.md § OccurrenceDashboardScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_DASHBOARD_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError, EventApiError, getEvent } from '../../services/api/eventsApi';
import { getEventById } from '../../services/database/eventStore';
import {
  fetchOccurrenceDashboard,
  fetchOccurrenceProgress,
  fetchOccurrenceReconciliation,
  readOccurrenceSnapshot,
  saveOccurrenceSnapshotEvent,
} from '../../services/events/eventDashboardService';
import {
  OccurrenceDashboardResponse,
  OccurrenceProgressResponse,
  ReconciliationResponse,
} from '../../types/api';
import { EventDefinition, EventOccurrence, OccurrenceStatus } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { logger } from '../../utils/logger';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../../components/events/OccurrenceStatusBadge';
import OfflineBanner from '../../components/common/OfflineBanner';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'OccurrenceDashboardScreen';
const PROGRESS_POLL_INTERVAL_MS = 15_000;

interface OccurrenceDashboardScreenProps {
  eventId: string;
  occurrenceId: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'OccurrenceDashboard'>;
}

type Banner = { kind: EventMessageKind; message: string };

interface OutstandingRider {
  riderId: string;
  activityNames: string[];
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function sameProgress(a: OccurrenceProgressResponse | null, b: OccurrenceProgressResponse): boolean {
  return Boolean(a)
    && a?.totalRiders === b.totalRiders
    && a.completedCount === b.completedCount
    && a.outstandingMandatoryCount === b.outstandingMandatoryCount
    && a.optedOutCount === b.optedOutCount
    && a.flaggedCount === b.flaggedCount;
}

/** Counts from the full payload, used when no progress response is available. */
function countsFromDashboard(
  dashboard: OccurrenceDashboardResponse,
  mandatoryIds: ReadonlySet<string>,
): OccurrenceProgressResponse {
  const counts: OccurrenceProgressResponse = {
    totalRiders: dashboard.riders.length,
    completedCount: 0,
    outstandingMandatoryCount: 0,
    optedOutCount: 0,
    flaggedCount: 0,
  };
  dashboard.riders.forEach((rider) => rider.activities.forEach((activity) => {
    if (activity.status === 'COMPLETED') counts.completedCount += 1;
    else if (activity.status === 'OPTED_OUT') counts.optedOutCount += 1;
    else if (activity.status === 'FLAGGED') counts.flaggedCount += 1;
    else if (mandatoryIds.has(activity.activityId)) counts.outstandingMandatoryCount += 1;
  }));
  return counts;
}

export default function OccurrenceDashboardScreen({ eventId, occurrenceId, navigation }: OccurrenceDashboardScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { getRiderDisplayName, getAppUserDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [event, setEvent] = useState<EventDefinition | null>(null);
  const [dashboard, setDashboard] = useState<OccurrenceDashboardResponse | null>(null);
  const [progress, setProgress] = useState<OccurrenceProgressResponse | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [reconciliationError, setReconciliationError] = useState<EventApiError | null>(null);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showOutstanding, setShowOutstanding] = useState(false);

  const requestId = useRef(0);
  const progressRef = useRef<OccurrenceProgressResponse | null>(null);
  progressRef.current = progress;
  const pollingRef = useRef(false);

  const occurrence: EventOccurrence | null = dashboard?.occurrence ?? null;
  const linkedRef = occurrence?.linkedOccurrenceRef ?? null;

  const refreshReconciliation = useCallback(async (target: EventOccurrence) => {
    if (!tourId) return;
    if (!target.linkedOccurrenceRef) {
      setReconciliation(null);
      setReconciliationError(null);
      return;
    }
    const outcome = await fetchOccurrenceReconciliation(tourId, eventId, occurrenceId);
    if (outcome.kind === 'success') {
      setReconciliation(outcome.data);
      setReconciliationError(null);
    } else {
      setReconciliation(null);
      setReconciliationError(outcome.error);
    }
  }, [tourId, eventId, occurrenceId]);

  const refreshProgress = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false;
    const outcome = await fetchOccurrenceProgress(tourId, eventId, occurrenceId);
    if (outcome.kind === 'error') {
      logger.warn(TAG, 'Progress unavailable', { code: outcome.error.code });
      return false;
    }
    const changed = !outcome.data.notModified && !sameProgress(progressRef.current, outcome.data.progress);
    setProgress(outcome.data.progress);
    return changed;
  }, [tourId, eventId, occurrenceId]);

  const loadFromSnapshot = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false;
    const stored = await readOccurrenceSnapshot(tourId, occurrenceId);
    if (!stored?.snapshot.dashboard) return false;
    const cachedEvent = stored.snapshot.event ?? await getEventById(eventId);
    setEvent(cachedEvent);
    setDashboard(stored.snapshot.dashboard);
    setProgress(stored.snapshot.progress);
    setReconciliation(stored.snapshot.reconciliation);
    setReconciliationError(null);
    setStaleAt(stored.fetchedAt);
    setUnavailable(null);
    return true;
  }, [tourId, eventId, occurrenceId]);

  const load = useCallback(async (refreshing: boolean) => {
    if (!tourId) {
      setIsLoading(false);
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    if (refreshing) setIsRefreshing(true);
    setBanner(null);
    try {
      if (isOffline) {
        const found = await loadFromSnapshot();
        if (current === requestId.current && !found) setUnavailable(EVENT_DASHBOARD_MESSAGES.NOT_SAVED_OFFLINE);
        return;
      }

      const [eventOutcome, dashboardOutcome] = await Promise.all([
        getEvent(tourId, eventId),
        fetchOccurrenceDashboard(tourId, eventId, occurrenceId),
      ]);
      if (current !== requestId.current) return;
      if (dashboardOutcome.kind === 'error') {
        if (dashboardOutcome.error.status === 404) setNotFound(true);
        else setBanner({ kind: dashboardOutcome.error.kind, message: dashboardOutcome.error.message });
        return;
      }

      let definition: EventDefinition | null;
      if (eventOutcome.kind === 'success') {
        definition = eventOutcome.data;
        void saveOccurrenceSnapshotEvent(tourId, occurrenceId, definition);
      } else {
        logger.warn(TAG, 'Event definition unavailable', { code: eventOutcome.error.code });
        definition = await getEventById(eventId);
      }
      if (current !== requestId.current) return;

      setEvent(definition);
      setDashboard(dashboardOutcome.data);
      setStaleAt(null);
      setUnavailable(null);
      await Promise.all([refreshProgress(), refreshReconciliation(dashboardOutcome.data.occurrence)]);
    } catch (err) {
      logger.error(TAG, 'Loading occurrence dashboard failed', err);
      if (current !== requestId.current) return;
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      await loadFromSnapshot().catch((snapshotError: unknown) => {
        logger.warn(TAG, 'Snapshot fallback failed', snapshotError);
      });
    } finally {
      if (current === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tourId, eventId, occurrenceId, isOffline, loadFromSnapshot, refreshProgress, refreshReconciliation]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const occurrenceRef = useRef<EventOccurrence | null>(null);
  occurrenceRef.current = occurrence;
  const canPoll = Boolean(tourId) && !isOffline && !staleAt && occurrence?.status === OccurrenceStatus.ACTIVE;

  const poll = useCallback(async () => {
    const target = occurrenceRef.current;
    if (pollingRef.current || !tourId || !target) return;
    pollingRef.current = true;
    try {
      const changed = await refreshProgress();
      if (!changed) return;
      const outcome = await fetchOccurrenceDashboard(tourId, eventId, occurrenceId);
      if (outcome.kind === 'success') setDashboard(outcome.data);
      await refreshReconciliation(outcome.kind === 'success' ? outcome.data.occurrence : target);
    } catch (err) {
      logger.warn(TAG, 'Progress poll failed', err);
    } finally {
      pollingRef.current = false;
    }
  }, [tourId, eventId, occurrenceId, refreshProgress, refreshReconciliation]);

  const isFocused = useIsFocused();
  useEffect(() => {
    if (!canPoll || !isFocused) return undefined;
    const timer = setInterval(() => void poll(), PROGRESS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canPoll, isFocused, poll]);

  // ---- Derived -----------------------------------------------------------

  const activityNames = new Map((event?.activities ?? []).map((activity) => [activity.activityId, activity.name]));
  const mandatoryIds = new Set((event?.activities ?? []).filter((a) => a.mandatory).map((a) => a.activityId));
  const counts = progress ?? (dashboard ? countsFromDashboard(dashboard, mandatoryIds) : null);
  const hasRecords = Boolean(counts && counts.completedCount + counts.optedOutCount + counts.flaggedCount > 0);

  const outstandingRiders: OutstandingRider[] = (dashboard?.riders ?? [])
    .map((rider) => ({
      riderId: rider.riderId,
      activityNames: rider.activities
        .filter((activity) => activity.status === 'PENDING' && mandatoryIds.has(activity.activityId))
        .map((activity) => activityNames.get(activity.activityId) ?? activity.activityId),
    }))
    .filter((rider) => rider.activityNames.length > 0)
    .sort((a, b) => a.riderId.localeCompare(b.riderId, undefined, { numeric: true }));

  const openRider = (riderId: string) => navigation.navigate('RiderProgress', { riderId, eventId, occurrenceId });

  // ---- Rendering ---------------------------------------------------------

  const title = event?.eventName ?? 'Event dashboard';
  const subtitle = occurrence ? `${occurrence.date} #${occurrence.seq} · Dashboard` : 'Dashboard';

  if (notFound) {
    return (
      <View style={styles.container}>
        <EventScreenHeader title={title} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="event-busy" size={48} color={COLORS.textSecondary} />
          <Text style={styles.centeredText}>{EVENT_DASHBOARD_MESSAGES.OCCURRENCE_GONE}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const tileStyle = [styles.tile, isDesktop ? styles.tileDesktop : styles.tileMobile];

  const renderTile = (label: string, value: number | undefined, onPress?: () => void, selected = false) => {
    const content = (
      <>
        <Text style={styles.tileValue}>{value ?? '—'}</Text>
        <Text style={styles.tileLabel}>{label}</Text>
        {onPress ? <MaterialIcons name={selected ? 'expand-less' : 'expand-more'} size={18} color={COLORS.primary} /> : null}
      </>
    );
    return onPress ? (
      <TouchableOpacity
        accessibilityLabel={`${label}: ${value ?? 'unknown'}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: selected }}
        key={label}
        onPress={onPress}
        style={[...tileStyle, styles.tileTappable, selected && styles.tileSelected]}
      >
        {content}
      </TouchableOpacity>
    ) : (
      <View accessible accessibilityLabel={`${label}: ${value ?? 'unknown'}`} key={label} style={tileStyle}>
        {content}
      </View>
    );
  };

  const renderReconciliationTile = () => {
    if (!linkedRef) return null;
    let text: string;
    if (reconciliation) {
      text = `${reconciliation.loadedCount} loaded vs ${reconciliation.unloadedCount} unloaded`;
    } else if (reconciliationError) {
      text = reconciliationError.message;
    } else {
      text = 'Not available';
    }
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
          <Text style={styles.metaText}>Linked: {linkedRef}</Text>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            accessibilityLabel="Refresh dashboard"
            accessibilityRole="button"
            disabled={isRefreshing}
            onPress={() => void load(true)}
            style={styles.headerButton}
          >
            <MaterialIcons name="refresh" size={24} color={COLORS.white} />
          </TouchableOpacity>
        )}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void load(true)} />}
      >
        <OfflineBanner />
        {!tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
        {banner ? (
          <StatusBanner
            kind={banner.kind}
            message={banner.message}
            primaryAction={isOffline ? undefined : { label: 'Retry', onPress: () => void load(true) }}
          />
        ) : null}
        {staleAt ? (
          <StatusBanner
            kind="warning"
            message={EVENT_DASHBOARD_MESSAGES.STALE.replace('{time}', formatDateTime(staleAt))}
          />
        ) : null}
        {unavailable ? <StatusBanner kind="info" message={unavailable} /> : null}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {occurrence ? (
          <View style={styles.occurrenceHeader}>
            <Text style={styles.occurrenceTitle}>{occurrence.date} #{occurrence.seq}</Text>
            <OccurrenceStatusBadge status={occurrence.status} />
            {event?.location ? <Text style={styles.metaText}>{event.location}</Text> : null}
          </View>
        ) : null}

        {dashboard ? (
          <>
            <View style={styles.tiles}>
              {renderTile('Total riders', counts?.totalRiders)}
              {renderTile('Completed', counts?.completedCount)}
              {renderTile(
                'Outstanding mandatory',
                counts?.outstandingMandatoryCount,
                () => setShowOutstanding((value) => !value),
                showOutstanding,
              )}
              {renderTile('Opted out', counts?.optedOutCount)}
              {renderTile('Flagged', counts?.flaggedCount)}
            </View>

            {renderReconciliationTile()}

            {!hasRecords ? <StatusBanner kind="info" message={EVENT_DASHBOARD_MESSAGES.NO_RECORDS} /> : null}

            {showOutstanding ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Riders with outstanding mandatory activities</Text>
                {!event ? (
                  <Text style={styles.emptyText}>Activity details are not available.</Text>
                ) : outstandingRiders.length === 0 ? (
                  <Text style={styles.emptyText}>{EVENT_DASHBOARD_MESSAGES.NO_OUTSTANDING}</Text>
                ) : (
                  outstandingRiders.map((rider) => (
                    <TouchableOpacity
                      accessibilityLabel={`View progress for ${getRiderDisplayName(rider.riderId).name} ${rider.riderId}`}
                      accessibilityRole="button"
                      key={rider.riderId}
                      onPress={() => openRider(rider.riderId)}
                      style={styles.row}
                    >
                      <View style={styles.flex}>
                        <Text style={styles.rowTitle}>
                          {getRiderDisplayName(rider.riderId).name} · {rider.riderId}
                        </Text>
                        <Text style={styles.metaText}>{rider.activityNames.join(', ')}</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  ))
                )}
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cancelled records ({dashboard.cancelled.length})</Text>
              {dashboard.cancelled.length === 0 ? (
                <Text style={styles.emptyText}>No cancelled records.</Text>
              ) : (
                dashboard.cancelled.map((record) => (
                  <View key={record.recordId} style={styles.row}>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>
                        {record.activityName} · {getRiderDisplayName(record.riderId).name} ({record.riderId})
                      </Text>
                      <Text style={styles.metaText}>
                        Cancelled {formatDateTime(record.cancelledAt)} by {getAppUserDisplayName(record.cancelledBy)}
                      </Text>
                      {record.cancelReason ? <Text style={styles.metaText}>Reason: {record.cancelReason}</Text> : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  content: { alignSelf: 'center', maxWidth: 960, padding: 16, width: '100%' },
  loader: { marginVertical: 24 },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  occurrenceHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  occurrenceTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  tile: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 88,
    justifyContent: 'center',
    padding: 12,
  },
  tileMobile: { flexBasis: '45%' },
  tileDesktop: { flexBasis: '30%' },
  tileTappable: { borderColor: COLORS.primary },
  tileSelected: { backgroundColor: COLORS.gray[100] },
  tileValue: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '700' },
  tileLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
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
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
  row: {
    alignItems: 'center',
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingVertical: 8,
  },
  rowTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  metaText: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
});
