/**
 * Events hub — today's occurrences grouped by event (PS_x/Hotel Staff filtered by
 * their assignment, D-O) plus a compact Manage section for admins.
 * Online data comes from the API; offline it is read from the bootstrap cache.
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
  const canManageRegistrations = role ? hasPermission(role, Permission.MANAGE_EVENT_REGISTRATIONS) : false;
  const canScan = role ? hasPermission(role, Permission.EVENT_SCAN) : false;
  const canViewDashboard = role ? hasPermission(role, Permission.VIEW_DASHBOARD) : false;
  const isFilteredRole = Boolean(role && role !== UserRole.ADMINISTRATOR && role !== UserRole.SUPER_USER);
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

  const hasTab = (occurrence: EventOccurrence) => {
    if (occurrence.status !== OccurrenceStatus.ACTIVE && occurrence.status !== OccurrenceStatus.COMPLETED) return false;
    return canViewDashboard || canScan;
  };

  const groups = events
    .map((event) => ({
      event,
      occurrences: (todayByEvent[event.eventId] ?? []).filter((occurrence) => canViewDashboard
        || !isFilteredRole
        || event.activities.some((activity) =>
          getEffectiveActivityEnabled(activity, findActivityOverride(occurrence, activity.activityId))
          && isActivityAvailableToUser(role ?? null, myAssignment ?? null, event, occurrence, activity))),
    }))
    .filter((group) => group.occurrences.length > 0);

  const showManage = !isOffline && (canManageEvents || canManageOccurrences || canManageRegistrations);

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

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        <Text style={styles.sectionTitle}>Today · {today}</Text>

        {!isLoading && tourId && !banner && groups.length === 0 ? (
          <Text style={styles.empty}>
            {isFilteredRole && canScan ? EVENT_SCAN_MESSAGES.NOT_ASSIGNED_TODAY : 'No events today.'}
          </Text>
        ) : null}

        {groups.map(({ event, occurrences }) => (
          <View key={event.eventId} style={styles.card}>
            <Text style={styles.cardTitle}>{event.eventName}</Text>
            <Text style={styles.cardMeta}>{event.location}</Text>
            {occurrences.map((occurrence) => {
              const enabled = hasTab(occurrence);
              return (
                <TouchableOpacity
                  accessibilityLabel={`${event.eventName} #${occurrence.seq}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !enabled }}
                  disabled={!enabled}
                  key={occurrence.occurrenceId}
                  onPress={() => navigation.navigate('EventOccurrence', {
                    eventId: event.eventId,
                    occurrenceId: occurrence.occurrenceId,
                  })}
                  style={[styles.occurrenceRow, !enabled && styles.disabled]}
                >
                  <Text style={styles.occurrenceText}>#{occurrence.seq}</Text>
                  <OccurrenceStatusBadge status={occurrence.status} />
                  {enabled ? (
                    <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} style={styles.chevron} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {showManage ? (
          <View style={styles.manageSection}>
            <Text style={styles.sectionTitle}>Manage</Text>
            {canManageEvents ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => navigation.navigate('EventDefinitionList')}
                style={styles.manageButton}
              >
                <MaterialIcons name="event-note" size={20} color={COLORS.primary} />
                <Text style={styles.manageText}>Manage definitions</Text>
              </TouchableOpacity>
            ) : null}
            {events.map((event) => {
              const registrable = canManageRegistrations && event.registrationEnabled
                ? (todayByEvent[event.eventId] ?? [])
                : [];
              if (!canManageOccurrences && registrable.length === 0) return null;
              return (
                <View key={event.eventId} style={styles.manageRow}>
                  <Text style={styles.manageEventName}>{event.eventName}</Text>
                  {canManageOccurrences ? (
                    <TouchableOpacity
                      accessibilityLabel={`Manage occurrences for ${event.eventName}`}
                      accessibilityRole="button"
                      onPress={() => navigation.navigate('OccurrenceManagement', { eventId: event.eventId })}
                      style={styles.cardAction}
                    >
                      <Text style={styles.cardActionText}>Occurrences</Text>
                    </TouchableOpacity>
                  ) : null}
                  {registrable.map((occurrence) => (
                    <TouchableOpacity
                      accessibilityLabel={`Registrations for ${event.eventName} #${occurrence.seq}`}
                      accessibilityRole="button"
                      key={occurrence.occurrenceId}
                      onPress={() => navigation.navigate('OccurrenceRegistrations', {
                        eventId: event.eventId,
                        occurrenceId: occurrence.occurrenceId,
                      })}
                      style={styles.cardAction}
                    >
                      <Text style={styles.cardActionText}>Registrations #{occurrence.seq}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })}
          </View>
        ) : null}
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
  disabled: { opacity: 0.5 },
  occurrenceRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, marginTop: 6 },
  occurrenceText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  chevron: { marginLeft: 'auto' },
  manageSection: { marginTop: 8 },
  manageRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  manageEventName: { color: COLORS.textPrimary, flexBasis: '100%', fontSize: 14, fontWeight: '600' },
});
