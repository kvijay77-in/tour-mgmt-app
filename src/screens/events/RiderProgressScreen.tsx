/**
 * Rider progress (any authenticated role): one ActivityStepper per occurrence
 * showing the rider's activities (completed / opted out / flagged / pending /
 * blocked / saved on this device). Online it combines
 * GET /riders/{riderId}/events/progress with the event definitions and
 * occurrences; offline it uses the cached events, the focused occurrence's
 * dashboard snapshot and this device's records.
 *
 * See docs/Event-Engine-Design.md § RiderProgressScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_DASHBOARD_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { useEventSession } from '../../context/EventSessionContext';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import {
  describeUnexpectedEventError,
  getRiderEventProgress,
  listEvents,
  listOccurrences,
} from '../../services/api/eventsApi';
import { getActiveEventRecordsByRider, LocalEventActivityRecord } from '../../services/database/eventRecordStore';
import { getEvents, getOccurrences } from '../../services/database/eventStore';
import { readOccurrenceSnapshot } from '../../services/events/eventDashboardService';
import { DashboardActivityStatus } from '../../types/api';
import { ActivityOutcome, EventDefinition, EventOccurrence, OccurrenceStatus } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { ActivityStep, buildActivitySteps } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import ActivityStepper from '../../components/events/ActivityStepper';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../../components/events/OccurrenceStatusBadge';
import OfflineBanner from '../../components/common/OfflineBanner';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'RiderProgressScreen';

interface RiderProgressScreenProps {
  riderId: string;
  eventId?: string;
  occurrenceId?: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'RiderProgress'>;
}

type Banner = { kind: EventMessageKind; message: string };
type StatusMap = Record<string, DashboardActivityStatus>;

interface ProgressSection {
  occurrenceId: string;
  eventId: string;
  eventName: string;
  date: string;
  seq: number;
  status: OccurrenceStatus | null;
  steps: Array<ActivityStep & { isSelf?: boolean }> | null;
}

interface ProgressInputs {
  events: EventDefinition[];
  occurrences: EventOccurrence[];
  statusByOccurrence: Map<string, StatusMap>;
  selfServiceByOccurrence: Map<string, Set<string>>;
  localRecords: LocalEventActivityRecord[];
  focusOccurrenceId?: string;
  eventFilter?: string;
  /** Offline: synced local records stand in for the server status */
  useLocalStatus: boolean;
}

function parseOccurrenceId(occurrenceId: string): { eventId: string; date: string; seq: number } {
  const [eventId = '', date = '', seq = '0'] = occurrenceId.split('#');
  return { eventId, date, seq: Number.parseInt(seq, 10) || 0 };
}

function buildSections(inputs: ProgressInputs): ProgressSection[] {
  const eventById = new Map(inputs.events.map((event) => [event.eventId, event]));
  const occurrenceById = new Map(inputs.occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]));
  const statusByOccurrence = new Map(inputs.statusByOccurrence);
  const selfServiceByOccurrence = new Map(inputs.selfServiceByOccurrence);
  const queuedByOccurrence = new Map<string, Set<string>>();

  inputs.localRecords.forEach((record) => {
    if (record.method === 'SELF_SERVICE') {
      const selfActivityIds = selfServiceByOccurrence.get(record.occurrenceId) ?? new Set<string>();
      selfActivityIds.add(record.activityId);
      selfServiceByOccurrence.set(record.occurrenceId, selfActivityIds);
    }
    if (record.syncStatus === 'PENDING') {
      const queued = queuedByOccurrence.get(record.occurrenceId) ?? new Set<string>();
      queued.add(record.activityId);
      queuedByOccurrence.set(record.occurrenceId, queued);
    } else if (inputs.useLocalStatus && record.syncStatus === 'SYNCED') {
      const statuses = { ...(statusByOccurrence.get(record.occurrenceId) ?? {}) };
      statuses[record.activityId] ??= record.isFlagged ? ActivityOutcome.FLAGGED : record.outcome;
      statusByOccurrence.set(record.occurrenceId, statuses);
    }
  });

  const ids = new Set<string>([...statusByOccurrence.keys(), ...queuedByOccurrence.keys()]);
  inputs.occurrences
    .filter((occurrence) => occurrence.status === OccurrenceStatus.ACTIVE)
    .forEach((occurrence) => ids.add(occurrence.occurrenceId));
  if (inputs.focusOccurrenceId) ids.add(inputs.focusOccurrenceId);

  const sections = [...ids]
    .map((occurrenceId): ProgressSection => {
      const occurrence = occurrenceById.get(occurrenceId) ?? null;
      const parsed = parseOccurrenceId(occurrenceId);
      const eventId = occurrence?.eventId ?? parsed.eventId;
      const event = eventById.get(eventId) ?? null;
      return {
        occurrenceId,
        eventId,
        eventName: event?.eventName ?? eventId,
        date: occurrence?.date ?? parsed.date,
        seq: occurrence?.seq ?? parsed.seq,
        status: occurrence?.status ?? null,
        steps: event
          ? buildActivitySteps(
            event,
            occurrence,
            statusByOccurrence.get(occurrenceId) ?? {},
            queuedByOccurrence.get(occurrenceId) ?? new Set(),
          ).map((step) => ({
            ...step,
            isSelf: selfServiceByOccurrence.get(occurrenceId)?.has(step.activityId) ?? false,
          }))
          : null,
      };
    })
    .filter((section) => !inputs.eventFilter || section.eventId === inputs.eventFilter);

  return sections.sort((a, b) => {
    if (a.occurrenceId === inputs.focusOccurrenceId) return -1;
    if (b.occurrenceId === inputs.focusOccurrenceId) return 1;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.eventName !== b.eventName) return a.eventName.localeCompare(b.eventName);
    return a.seq - b.seq;
  });
}

export default function RiderProgressScreen({ riderId, eventId, occurrenceId, navigation }: RiderProgressScreenProps) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { cacheVersion, pendingCount } = useEventSession();
  const { getRiderDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [sections, setSections] = useState<ProgressSection[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestId = useRef(0);

  const loadOffline = useCallback(async (): Promise<ProgressInputs> => {
    const [events, occurrences, localRecords, stored] = await Promise.all([
      getEvents(),
      getOccurrences(),
      getActiveEventRecordsByRider(riderId),
      tourId && occurrenceId ? readOccurrenceSnapshot(tourId, occurrenceId) : Promise.resolve(null),
    ]);
    const statusByOccurrence = new Map<string, StatusMap>();
    const snapshotOccurrence = stored?.snapshot.dashboard?.occurrence;
    const riderRow = stored?.snapshot.dashboard?.riders.find((rider) => rider.riderId === riderId);
    if (occurrenceId && riderRow) {
      statusByOccurrence.set(
        occurrenceId,
        Object.fromEntries(riderRow.activities.map((activity) => [activity.activityId, activity.status])),
      );
    }
    const snapshotEvent = stored?.snapshot.dashboard?.event;
    return {
      events: snapshotEvent && !events.some((event) => event.eventId === snapshotEvent.eventId)
        ? [...events, snapshotEvent]
        : events,
      occurrences: snapshotOccurrence && !occurrences.some((o) => o.occurrenceId === snapshotOccurrence.occurrenceId)
        ? [...occurrences, snapshotOccurrence]
        : occurrences,
      statusByOccurrence,
      selfServiceByOccurrence: new Map(),
      localRecords,
      focusOccurrenceId: occurrenceId,
      eventFilter: eventId,
      useLocalStatus: true,
    };
  }, [tourId, riderId, eventId, occurrenceId]);

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
        const inputs = await loadOffline();
        if (current !== requestId.current) return;
        setSections(buildSections(inputs));
        setBanner({ kind: 'info', message: EVENT_DASHBOARD_MESSAGES.RIDER_PROGRESS_OFFLINE });
        return;
      }

      const [progressOutcome, eventsOutcome, localRecords] = await Promise.all([
        getRiderEventProgress(tourId, riderId, eventId),
        listEvents(tourId),
        getActiveEventRecordsByRider(riderId),
      ]);
      if (current !== requestId.current) return;
      if (progressOutcome.kind === 'error') {
        setBanner({ kind: progressOutcome.error.kind, message: progressOutcome.error.message });
        setSections([]);
        return;
      }

      let events: EventDefinition[];
      if (eventsOutcome.kind === 'success') {
        events = eventsOutcome.data;
      } else {
        logger.warn(TAG, 'Event definitions unavailable, using cache', { code: eventsOutcome.error.code });
        events = await getEvents();
      }

      const relevantEvents = eventId ? events.filter((event) => event.eventId === eventId) : events;
      const occurrenceOutcomes = await Promise.all(
        relevantEvents.map((event) => listOccurrences(tourId, event.eventId)),
      );
      if (current !== requestId.current) return;
      const occurrences: EventOccurrence[] = [];
      occurrenceOutcomes.forEach((outcome, index) => {
        if (outcome.kind === 'success') occurrences.push(...outcome.data);
        else logger.warn(TAG, 'Occurrences unavailable', { eventId: relevantEvents[index].eventId, code: outcome.error.code });
      });

      const statusByOccurrence = new Map<string, StatusMap>();
      const selfServiceByOccurrence = new Map<string, Set<string>>();
      progressOutcome.data.forEach((item) => {
        const statuses = statusByOccurrence.get(item.occurrenceId) ?? {};
        statuses[item.activityId] = item.status;
        statusByOccurrence.set(item.occurrenceId, statuses);
        if (item.method === 'SELF_SERVICE') {
          const selfActivityIds = selfServiceByOccurrence.get(item.occurrenceId) ?? new Set<string>();
          selfActivityIds.add(item.activityId);
          selfServiceByOccurrence.set(item.occurrenceId, selfActivityIds);
        }
      });

      setSections(buildSections({
        events,
        occurrences,
        statusByOccurrence,
        selfServiceByOccurrence,
        localRecords,
        focusOccurrenceId: occurrenceId,
        eventFilter: eventId,
        useLocalStatus: false,
      }));
    } catch (err) {
      logger.error(TAG, 'Loading rider progress failed', err);
      if (current === requestId.current) {
        setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      }
    } finally {
      if (current === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tourId, riderId, eventId, occurrenceId, isOffline, loadOffline]);

  // Reload on focus and whenever local records or the cache change.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused) void load(false);
  }, [isFocused, load, cacheVersion, pendingCount]);

  const riderName = getRiderDisplayName(riderId).name;

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title={riderName}
        subtitle={`${riderId} · Event progress`}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            accessibilityLabel="Refresh rider progress"
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
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} /> : null}
        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {!isLoading && tourId && sections.length === 0 && banner?.kind !== 'error' ? (
          <Text style={styles.empty}>{EVENT_DASHBOARD_MESSAGES.RIDER_NO_PROGRESS}</Text>
        ) : null}

        {sections.map((section) => (
          <View key={section.occurrenceId} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{section.eventName}</Text>
                <Text style={styles.cardMeta}>{section.date} #{section.seq}</Text>
              </View>
              {section.status ? <OccurrenceStatusBadge status={section.status} /> : null}
            </View>
            {section.steps ? (
              section.steps.length > 0 ? (
                <ActivityStepper steps={section.steps} />
              ) : (
                <Text style={styles.cardMeta}>No activities are enabled for this occurrence.</Text>
              )
            ) : (
              <Text style={styles.cardMeta}>Activity details are not available.</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  content: { alignSelf: 'center', maxWidth: 960, padding: 16, width: '100%' },
  loader: { marginVertical: 24 },
  empty: { color: COLORS.textSecondary, paddingVertical: 24, textAlign: 'center' },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginBottom: 12 },
  flex: { flex: 1, minWidth: 0 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
});
