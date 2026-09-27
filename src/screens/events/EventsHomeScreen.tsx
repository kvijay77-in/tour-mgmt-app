/**
 * Events hub — "Scan" list of today's ACTIVE occurrences (EVENT_SCAN; PS_x/Hotel
 * Staff filtered by their assignment, D-O) and, for other roles, the event list
 * with today's occurrences and entry points to definition/occurrence management.
 * Online data comes from the API; offline it is read from the bootstrap cache.
 *
 * See docs/Event-Engine-Design.md § Screens.
 */

import React, { useCallback, useRef, useState } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_SCAN_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { useAuth } from '../../context/AuthContext';
import { useEventSession } from '../../context/EventSessionContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { navigateToModuleAction, useVisibleModules } from '../../navigation/modules';
import { describeUnexpectedEventError, listEvents, listOccurrences } from '../../services/api/eventsApi';
import { getEvents, getOccurrences } from '../../services/database/eventStore';
import { EventDefinition, EventOccurrence, OccurrenceStatus, Permission, UserRole } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import {
  findActivityOverride,
  getEffectiveActivityEnabled,
  isActivityAvailableToUser,
  toLocalDateString,
} from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import { hasPermission } from '../../utils/permissions';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../../components/events/OccurrenceStatusBadge';
import OfflineBanner from '../../components/common/OfflineBanner';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'EventsHomeScreen';

interface EventsHomeScreenProps {
  navigation: NativeStackNavigationProp<AppStackParamList, 'EventsHome'>;
}

export default function EventsHomeScreen({ navigation }: EventsHomeScreenProps) {
  const { user } = useAuth();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { hasHome } = useVisibleModules();
  const { myAssignment, refreshBootstrap } = useEventSession();
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [todayByEvent, setTodayByEvent] = useState<Record<string, EventOccurrence[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ kind: EventMessageKind; message: string } | null>(null);
  const requestId = useRef(0);

  const role = user?.userRole;
  const canManageEvents = role ? hasPermission(role, Permission.MANAGE_EVENTS) : false;
  const canManageOccurrences = role ? hasPermission(role, Permission.MANAGE_EVENT_OCCURRENCES) : false;
  const canScan = role ? hasPermission(role, Permission.EVENT_SCAN) : false;
  const canViewDashboard = role ? hasPermission(role, Permission.VIEW_DASHBOARD) : false;
  const isFilteredRole = Boolean(role && role !== UserRole.ADMINISTRATOR && role !== UserRole.SUPER_USER);
  const showOverview = !(canScan && isFilteredRole);
  const today = toLocalDateString();
  const tourId = tour?.tourId;

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
      const date = toLocalDateString();
      if (isOffline) {
        const [cachedEvents, cachedOccurrences] = await Promise.all([getEvents(), getOccurrences({ date })]);
        if (current !== requestId.current) return;
        const byEvent: Record<string, EventOccurrence[]> = {};
        cachedOccurrences.forEach((occurrence) => {
          (byEvent[occurrence.eventId] ??= []).push(occurrence);
        });
        setEvents([...cachedEvents].sort((a, b) => a.eventName.localeCompare(b.eventName)));
        setTodayByEvent(byEvent);
        return;
      }

      if (refreshing) void refreshBootstrap();
      const outcome = await listEvents(tourId);
      if (current !== requestId.current) return;
      if (outcome.kind === 'error') {
        setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      const sorted = [...outcome.data].sort((a, b) => a.eventName.localeCompare(b.eventName));
      const occurrenceOutcomes = await Promise.all(
        sorted.map((event) => listOccurrences(tourId, event.eventId, { date })),
      );
      if (current !== requestId.current) return;
      const byEvent: Record<string, EventOccurrence[]> = {};
      occurrenceOutcomes.forEach((result, index) => {
        const eventId = sorted[index].eventId;
        if (result.kind === 'success') {
          byEvent[eventId] = result.data;
        } else {
          logger.warn(TAG, 'Unable to list today\'s occurrences', { eventId, code: result.error.code });
          byEvent[eventId] = [];
        }
      });
      setEvents(sorted);
      setTodayByEvent(byEvent);
    } catch (err) {
      logger.error(TAG, 'Loading events failed', err);
      if (current === requestId.current) {
        setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      }
    } finally {
      if (current === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [isOffline, tourId, refreshBootstrap]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const goHome = () => navigation.dispatch(navigateToModuleAction({ route: 'Home', params: undefined }));
  const openDashboard = (occurrence: EventOccurrence) => navigation.navigate('OccurrenceDashboard', {
    eventId: occurrence.eventId,
    occurrenceId: occurrence.occurrenceId,
  });

  const scanRows = canScan
    ? events.flatMap((event) => (todayByEvent[event.eventId] ?? [])
      .filter((occurrence) => occurrence.status === OccurrenceStatus.ACTIVE)
      .filter((occurrence) => !isFilteredRole || event.activities.some((activity) =>
        getEffectiveActivityEnabled(activity, findActivityOverride(occurrence, activity.activityId))
        && isActivityAvailableToUser(role ?? null, myAssignment ?? null, event, occurrence, activity)))
      .map((occurrence) => ({ event, occurrence })))
    : [];

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title="Events"
        subtitle={tour?.name}
        onBack={hasHome ? goHome : undefined}
        backIcon="home"
        right={(
          <TouchableOpacity
            accessibilityLabel="Refresh events"
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
        {isOffline ? (
          <StatusBanner kind="info" message="Showing events saved on this device. Management actions need a connection." />
        ) : null}
        {!tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
        {banner ? (
          <StatusBanner
            kind={banner.kind}
            message={banner.message}
            primaryAction={{ label: 'Retry', onPress: () => void load(true) }}
          />
        ) : null}

        {canScan ? (
          <View style={styles.scanSection}>
            <Text style={styles.sectionTitle}>Scan · active now</Text>
            {!isLoading && scanRows.length === 0 ? (
              <Text style={styles.noOccurrences}>
                {isFilteredRole ? EVENT_SCAN_MESSAGES.NOT_ASSIGNED_TODAY : EVENT_SCAN_MESSAGES.NO_ACTIVE_OCCURRENCES}
              </Text>
            ) : null}
            {scanRows.map(({ event, occurrence }) => (
              <TouchableOpacity
                accessibilityLabel={`Scan for ${event.eventName} #${occurrence.seq}`}
                accessibilityRole="button"
                key={occurrence.occurrenceId}
                onPress={() => navigation.navigate('EventScan', {
                  eventId: event.eventId,
                  occurrenceId: occurrence.occurrenceId,
                })}
                style={styles.scanRow}
              >
                <MaterialIcons name="qr-code-scanner" size={22} color={COLORS.primary} />
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>{event.eventName}</Text>
                  <Text style={styles.cardMeta}>#{occurrence.seq} · {event.location}</Text>
                </View>
                {canViewDashboard && !showOverview ? (
                  <TouchableOpacity
                    accessibilityLabel={`Dashboard for ${event.eventName} #${occurrence.seq}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => openDashboard(occurrence)}
                    style={styles.iconButton}
                  >
                    <MaterialIcons name="insights" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                ) : null}
                <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {canManageEvents && !isOffline ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => navigation.navigate('EventDefinitionList')}
            style={styles.manageButton}
          >
            <MaterialIcons name="event-note" size={20} color={COLORS.primary} />
            <Text style={styles.manageText}>Manage definitions</Text>
          </TouchableOpacity>
        ) : null}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {showOverview ? <Text style={styles.sectionTitle}>Today · {today}</Text> : null}

        {showOverview && !isLoading && tourId && !banner && events.length === 0 ? (
          <Text style={styles.empty}>
            {isOffline ? 'No events are saved on this device yet.' : 'No events are defined for this tour yet.'}
          </Text>
        ) : null}

        {showOverview && events.map((event) => {
          const occurrences = todayByEvent[event.eventId] ?? [];
          return (
            <View key={event.eventId} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle}>{event.eventName}</Text>
                  <Text style={styles.cardMeta}>
                    {event.eventType} · {event.location} · {event.activities.length} activities
                  </Text>
                </View>
                {canManageOccurrences && !isOffline ? (
                  <TouchableOpacity
                    accessibilityLabel={`Manage occurrences for ${event.eventName}`}
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('OccurrenceManagement', { eventId: event.eventId })}
                    style={styles.cardAction}
                  >
                    <Text style={styles.cardActionText}>Occurrences</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {occurrences.length === 0 ? (
                <Text style={styles.noOccurrences}>No occurrences today.</Text>
              ) : (
                occurrences.map((occurrence) => (
                  <View key={occurrence.occurrenceId} style={styles.occurrenceRow}>
                    <Text style={styles.occurrenceText}>#{occurrence.seq}</Text>
                    <OccurrenceStatusBadge status={occurrence.status} />
                    {occurrence.selfServiceEnabled ? <Text style={styles.infoBadge}>Self-service</Text> : null}
                    {canViewDashboard && occurrence.status !== OccurrenceStatus.PLANNED ? (
                      <TouchableOpacity
                        accessibilityLabel={`Dashboard for ${event.eventName} #${occurrence.seq}`}
                        accessibilityRole="button"
                        onPress={() => openDashboard(occurrence)}
                        style={[styles.cardAction, styles.rowAction]}
                      >
                        <Text style={styles.cardActionText}>Dashboard</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  content: { alignSelf: 'center', maxWidth: 960, padding: 16, width: '100%' },
  manageButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    minHeight: 44,
    paddingHorizontal: 14,
  },
  manageText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  scanSection: { marginBottom: 16 },
  scanRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
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
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  cardAction: {
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  cardActionText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  rowAction: { marginLeft: 'auto' },
  iconButton: { padding: 6 },
  noOccurrences: { color: COLORS.textSecondary, fontSize: 13, marginTop: 10 },
  occurrenceRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  occurrenceText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  infoBadge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
