import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { listEvents, listOccurrences } from '../../services/api/eventsApi';
import {
  createNotificationReminder,
  describeUnexpectedNotificationError,
} from '../../services/api/notificationApi';
import { listRides } from '../../services/api/rideApi';
import { EventDefinition, EventOccurrence, OccurrenceStatus, Ride, RideStatus } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'NotificationRemindersScreen';

interface NotificationRemindersScreenProps {
  onClose: () => void;
}

function isActiveRide(ride: Ride): boolean {
  return [RideStatus.ACTIVE, RideStatus.OPEN, RideStatus.STARTED].includes(ride.status);
}

export default function NotificationRemindersScreen({ onClose }: NotificationRemindersScreenProps) {
  const insets = useSafeAreaInsets();
  const { isOffline } = useOffline();
  const { tour } = useTour();
  const [rides, setRides] = useState<Ride[]>([]);
  const [eventRows, setEventRows] = useState<Array<{ event: EventDefinition; occurrence: EventOccurrence }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!tour?.tourId || isOffline) return;
    setIsLoading(true);
    try {
      const [ridesData, eventsOutcome] = await Promise.all([
        listRides(tour.tourId, { limit: 200 }),
        listEvents(tour.tourId),
      ]);
      setRides(ridesData.filter(isActiveRide));

      if (eventsOutcome.kind !== 'success') {
        setEventRows([]);
        return;
      }
      const occurrences = await Promise.all(eventsOutcome.data.map((event) =>
        listOccurrences(tour.tourId, event.eventId, { status: OccurrenceStatus.ACTIVE })));
      const rows: Array<{ event: EventDefinition; occurrence: EventOccurrence }> = [];
      occurrences.forEach((outcome, index) => {
        if (outcome.kind !== 'success') return;
        const event = eventsOutcome.data[index];
        outcome.data.forEach((occurrence) => rows.push({ event, occurrence }));
      });
      setEventRows(rows);
    } catch (error) {
      logger.error(TAG, 'Unable to load reminder candidates', error);
      Alert.alert('Unable to load', 'Could not load active rides/events. Please retry.');
    } finally {
      setIsLoading(false);
    }
  }, [isOffline, tour?.tourId]);

  const sendRideReminder = async (ride: Ride) => {
    if (!tour?.tourId) return;
    setIsSending((current) => ({ ...current, [`ride:${ride.rideId}`]: true }));
    try {
      const outcome = await createNotificationReminder({
        reminderType: 'RIDE_CHECKIN_NOT_STARTED',
        tourId: tour.tourId,
        rideId: ride.rideId,
      });
      if (outcome.kind === 'success') {
        Alert.alert(
          'Reminder sent',
          `Notified ${outcome.data.targetCount} rider(s).${outcome.data.riderIds?.length ? `\nRiders: ${outcome.data.riderIds.join(', ')}` : ''}`,
        );
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Notifications unavailable', 'Reminder API is not deployed yet.');
        return;
      }
      Alert.alert('Unable to send', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to send', describeUnexpectedNotificationError(error));
    } finally {
      setIsSending((current) => {
        const next = { ...current };
        delete next[`ride:${ride.rideId}`];
        return next;
      });
    }
  };

  const sendEventReminder = async (event: EventDefinition, occurrence: EventOccurrence) => {
    if (!tour?.tourId) return;
    const key = `event:${occurrence.occurrenceId}`;
    setIsSending((current) => ({ ...current, [key]: true }));
    try {
      const outcome = await createNotificationReminder({
        reminderType: 'EVENT_CHECKIN_NOT_STARTED',
        tourId: tour.tourId,
        eventId: event.eventId,
        occurrenceId: occurrence.occurrenceId,
      });
      if (outcome.kind === 'success') {
        Alert.alert(
          'Reminder sent',
          `Notified ${outcome.data.targetCount} rider(s).${outcome.data.riderIds?.length ? `\nRiders: ${outcome.data.riderIds.join(', ')}` : ''}`,
        );
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Notifications unavailable', 'Reminder API is not deployed yet.');
        return;
      }
      Alert.alert('Unable to send', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to send', describeUnexpectedNotificationError(error));
    } finally {
      setIsSending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  useEffect(() => {
    if (!isOffline) void load();
  }, [isOffline, load]);

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Close reminders screen">
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send Reminders</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={() => void load()} disabled={isLoading || isOffline}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void load()} />}
      >
        {isOffline ? <Text style={styles.infoText}>Reminder actions need internet connectivity.</Text> : null}
        {!tour?.tourId ? <Text style={styles.infoText}>No active tour selected.</Text> : null}
        {!isOffline && tour?.tourId && rides.length === 0 && eventRows.length === 0 && !isLoading ? (
          <Text style={styles.infoText}>No active rides or events found.</Text>
        ) : null}

        <Text style={styles.sectionTitle}>Active rides</Text>
        {rides.map((ride) => {
          const key = `ride:${ride.rideId}`;
          const busy = Boolean(isSending[key]);
          return (
            <View key={ride.rideId} style={styles.item}>
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{ride.name || ride.rideId}</Text>
                <Text style={styles.itemMeta}>{ride.date} · {ride.status}</Text>
              </View>
              <TouchableOpacity style={[styles.actionButton, busy && styles.disabled]} disabled={busy || isOffline} onPress={() => void sendRideReminder(ride)}>
                <Text style={styles.actionButtonText}>{busy ? 'Sending…' : 'Send reminder'}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Active events</Text>
        {eventRows.map(({ event, occurrence }) => {
          const key = `event:${occurrence.occurrenceId}`;
          const busy = Boolean(isSending[key]);
          return (
            <View key={occurrence.occurrenceId} style={styles.item}>
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{event.eventName}</Text>
                <Text style={styles.itemMeta}>
                  {occurrence.date} #{occurrence.seq} · {occurrence.status}
                </Text>
              </View>
              <TouchableOpacity style={[styles.actionButton, busy && styles.disabled]} disabled={busy || isOffline} onPress={() => void sendEventReminder(event, occurrence)}>
                <Text style={styles.actionButtonText}>{busy ? 'Sending…' : 'Send reminder'}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, marginLeft: 6, color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  refreshButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  content: { padding: 16, gap: 8 },
  sectionTitle: { marginTop: 8, color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  infoText: { color: COLORS.textSecondary, fontSize: 13 },
  item: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  itemText: { gap: 2 },
  itemTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  itemMeta: { color: COLORS.textSecondary, fontSize: 12 },
  actionButton: {
    alignSelf: 'flex-start',
    borderColor: COLORS.primary,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  loader: { marginVertical: 24 },
  disabled: { opacity: 0.6 },
});
