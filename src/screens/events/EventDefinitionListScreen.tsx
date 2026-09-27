/**
 * Event definition list (MANAGE_EVENTS). Web-first, responsive.
 * See docs/Event-Engine-Design.md § Screens.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { EventMessageKind } from '../../constants/eventMessages';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError, listEvents } from '../../services/api/eventsApi';
import { EventDefinition, Permission } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { logger } from '../../utils/logger';
import { hasPermission } from '../../utils/permissions';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'EventDefinitionListScreen';

interface EventDefinitionListScreenProps {
  navigation: NativeStackNavigationProp<AppStackParamList, 'EventDefinitionList'>;
}

export default function EventDefinitionListScreen({ navigation }: EventDefinitionListScreenProps) {
  const { user } = useAuth();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<{ kind: EventMessageKind; message: string } | null>(null);
  const requestId = useRef(0);
  const tourId = tour?.tourId;
  const canManageOccurrences = user ? hasPermission(user.userRole, Permission.MANAGE_EVENT_OCCURRENCES) : false;

  const load = useCallback(async () => {
    if (!tourId || isOffline) {
      setIsLoading(false);
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    setIsLoading(true);
    setBanner(null);
    try {
      const outcome = await listEvents(tourId);
      if (current !== requestId.current) return;
      if (outcome.kind === 'error') {
        setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      setEvents([...outcome.data].sort((a, b) => a.eventName.localeCompare(b.eventName)));
    } catch (err) {
      logger.error(TAG, 'Loading event definitions failed', err);
      if (current === requestId.current) setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      if (current === requestId.current) setIsLoading(false);
    }
  }, [isOffline, tourId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title="Event Definitions"
        subtitle={tour?.name}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isOffline}
            onPress={() => navigation.navigate('EventDefinitionEditor', {})}
            style={[styles.newButton, isOffline && styles.disabled]}
          >
            <MaterialIcons name="add" size={20} color={COLORS.primary} />
            <Text style={styles.newButtonText}>New Event</Text>
          </TouchableOpacity>
        )}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {isOffline ? <StatusBanner kind="warning" message="Event definitions require a connection to edit." /> : null}
        {banner ? (
          <StatusBanner kind={banner.kind} message={banner.message} primaryAction={{ label: 'Retry', onPress: () => void load() }} />
        ) : null}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {!isLoading && !isOffline && !banner && events.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>No events yet.</Text>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => navigation.navigate('EventDefinitionEditor', {})}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Create the first event</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.grid}>
          {events.map((event) => (
            <TouchableOpacity
              key={event.eventId}
              accessibilityLabel={`Edit ${event.eventName}`}
              accessibilityRole="button"
              onPress={() => navigation.navigate('EventDefinitionEditor', { eventId: event.eventId })}
              style={styles.card}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>{event.eventName}</Text>
                <Text style={styles.typeBadge}>{event.eventType}</Text>
              </View>
              <Text style={styles.cardMeta}>{event.eventId}</Text>
              <Text style={styles.cardMeta}>{event.location}</Text>
              <Text style={styles.cardMeta}>{event.activities.length} activities</Text>
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
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  newButton: {
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 10,
  },
  newButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  content: { alignSelf: 'center', maxWidth: 1280, padding: 16, width: '100%' },
  loader: { marginVertical: 24 },
  emptyWrap: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  empty: { color: COLORS.textSecondary, fontSize: 15 },
  emptyButton: { backgroundColor: COLORS.primary, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 10 },
  emptyButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: 280,
    gap: 4,
    maxWidth: 420,
    padding: 14,
  },
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  cardTitle: { color: COLORS.textPrimary, flex: 1, fontSize: 16, fontWeight: '700' },
  typeBadge: {
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  cardMeta: { color: COLORS.textSecondary, fontSize: 13 },
  cardAction: {
    alignSelf: 'flex-start',
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cardActionText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
});
