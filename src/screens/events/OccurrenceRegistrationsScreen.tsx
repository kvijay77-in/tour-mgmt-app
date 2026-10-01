import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { REGISTRATION_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { useAuth } from '../../context/AuthContext';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import {
  describeUnexpectedEventError,
  getEvent,
  getOccurrence,
  listOccurrenceRegistrations,
  registerRiderForOccurrence,
  unregisterRiderFromOccurrence,
} from '../../services/api/eventsApi';
import { EventDefinition, EventOccurrence, EventRegistration, Permission } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import {
  addRegistration,
  filterRegistrations,
  formatRegistrationSource,
  getRegistrableRiders,
  getRegistrationEditState,
  removeRegistration,
} from '../../utils/eventRegistrations';
import { hasPermission } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OfflineBanner from '../../components/common/OfflineBanner';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'OccurrenceRegistrationsScreen';
const MAX_RIDER_RESULTS = 20;

interface OccurrenceRegistrationsScreenProps {
  eventId: string;
  occurrenceId: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'OccurrenceRegistrations'>;
}

type Banner = { kind: EventMessageKind; message: string };

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

export default function OccurrenceRegistrationsScreen({
  eventId,
  occurrenceId,
  navigation,
}: OccurrenceRegistrationsScreenProps) {
  const { tour } = useTour();
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const { riderNamesById } = useNameDirectory();
  const tourId = tour?.tourId;
  const canManage = user ? hasPermission(user.userRole, Permission.MANAGE_EVENT_REGISTRATIONS) : false;

  const [event, setEvent] = useState<EventDefinition | null>(null);
  const [occurrence, setOccurrence] = useState<EventOccurrence | null>(null);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [registeredCount, setRegisteredCount] = useState(0);
  const [search, setSearch] = useState('');
  const [riderQuery, setRiderQuery] = useState('');
  const [showRiderPicker, setShowRiderPicker] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<EventRegistration | null>(null);
  const [busyRiderId, setBusyRiderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const load = useCallback(async (refreshing = false) => {
    if (!tourId) {
      setIsLoading(false);
      setBanner({ kind: 'info', message: REGISTRATION_MESSAGES.NO_TOUR });
      return;
    }
    if (isOffline) {
      setIsLoading(false);
      setBanner({ kind: 'warning', message: REGISTRATION_MESSAGES.OFFLINE });
      return;
    }

    if (refreshing) setIsRefreshing(true);
    setBanner(null);
    try {
      const [eventOutcome, occurrenceOutcome, registrationsOutcome] = await Promise.all([
        getEvent(tourId, eventId),
        getOccurrence(tourId, eventId, occurrenceId),
        listOccurrenceRegistrations(tourId, eventId, occurrenceId),
      ]);
      if (eventOutcome.kind === 'success') setEvent(eventOutcome.data);
      else if (eventOutcome.error.status === 404) {
        setBanner({ kind: eventOutcome.error.kind, message: eventOutcome.error.message });
        return;
      }

      if (occurrenceOutcome.kind === 'error') {
        setBanner({ kind: occurrenceOutcome.error.kind, message: occurrenceOutcome.error.message });
        return;
      }
      setOccurrence(occurrenceOutcome.data);

      if (registrationsOutcome.kind === 'error') {
        setBanner({ kind: registrationsOutcome.error.kind, message: registrationsOutcome.error.message });
        return;
      }
      setRegistrationEnabled(registrationsOutcome.data.registrationEnabled);
      setRegisteredCount(registrationsOutcome.data.count);
      setRegistrations(registrationsOutcome.data.items);
    } catch (error) {
      logger.error(TAG, 'Loading occurrence registrations failed', error);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(error) });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [eventId, isOffline, occurrenceId, tourId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const editState = occurrence
    ? getRegistrationEditState(occurrence.status, registrationEnabled, !isOffline, canManage)
    : { editable: false, notice: null };
  const visibleRegistrations = filterRegistrations(registrations, search);
  const normalizedRiderQuery = riderQuery.trim().toLocaleLowerCase();
  const riderOptions = normalizedRiderQuery
    ? getRegistrableRiders(riderNamesById, registrations)
      .filter((rider) => rider.riderId.toLocaleLowerCase().includes(normalizedRiderQuery)
        || rider.name.toLocaleLowerCase().includes(normalizedRiderQuery))
      .slice(0, MAX_RIDER_RESULTS)
    : [];

  const registerRider = async (riderId: string, name: string) => {
    if (!tourId || !editState.editable) return;
    setBusyRiderId(riderId);
    setBanner(null);
    try {
      const outcome = await registerRiderForOccurrence(tourId, eventId, occurrenceId, riderId);
      if (outcome.kind === 'error') {
        setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      const registration = { ...outcome.data, name: outcome.data.name ?? name };
      const next = addRegistration(registrations, registration);
      setRegistrations(next);
      setRegisteredCount(next.length);
      setShowRiderPicker(false);
      setRiderQuery('');
      setBanner({
        kind: 'info',
        message: fill(REGISTRATION_MESSAGES.REGISTERED, { rider: `${name} (${riderId})` }),
      });
    } catch (error) {
      logger.error(TAG, 'Registering rider failed', error);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(error) });
    } finally {
      setBusyRiderId(null);
    }
  };

  const unregisterRider = async () => {
    if (!tourId || !confirmTarget || !editState.editable) return;
    const target = confirmTarget;
    setBusyRiderId(target.riderId);
    setBanner(null);
    try {
      const outcome = await unregisterRiderFromOccurrence(tourId, eventId, occurrenceId, target.riderId);
      if (outcome.kind === 'error') {
        setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      const next = removeRegistration(registrations, target.riderId);
      setRegistrations(next);
      setRegisteredCount(next.length);
      setBanner({
        kind: 'info',
        message: fill(REGISTRATION_MESSAGES.UNREGISTERED, {
          rider: `${target.name ?? riderNamesById[target.riderId] ?? 'Rider'} (${target.riderId})`,
        }),
      });
    } catch (error) {
      logger.error(TAG, 'Unregistering rider failed', error);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(error) });
    } finally {
      setBusyRiderId(null);
      setConfirmTarget(null);
    }
  };

  const title = event?.eventName ?? 'Registrations';
  const subtitle = occurrence
    ? `${occurrence.date} #${occurrence.seq} · ${occurrence.status}`
    : 'Occurrence registrations';

  return (
    <View style={styles.container}>
      <EventScreenHeader title={title} subtitle={subtitle} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void load(true)} />}
      >
        <OfflineBanner />
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} /> : null}
        {editState.notice ? <StatusBanner kind="warning" message={editState.notice} /> : null}
        {!tourId ? <StatusBanner kind="info" message={REGISTRATION_MESSAGES.NO_TOUR} /> : null}

        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.count}>{registeredCount}</Text>
            <Text style={styles.meta}>registered</Text>
          </View>
          <Text style={styles.status}>{occurrence?.status ?? 'Loading'}</Text>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.searchWrap}>
            <MaterialIcons name="search" size={20} color={COLORS.textSecondary} />
            <TextInput
              accessibilityLabel="Search registrations"
              onChangeText={setSearch}
              placeholder="Search rider ID or name"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.searchInput}
              value={search}
            />
          </View>
          {editState.editable ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: showRiderPicker }}
              disabled={showRiderPicker}
              onPress={() => setShowRiderPicker(true)}
              style={[styles.primaryButton, showRiderPicker && styles.disabled]}
            >
              <MaterialIcons name="person-add" size={18} color={COLORS.white} />
              <Text style={styles.primaryButtonText}>Register rider</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {showRiderPicker ? (
          <View style={styles.picker}>
            <Text style={styles.sectionTitle}>Choose a tour rider</Text>
            <TextInput
              accessibilityLabel="Find a rider to register"
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setRiderQuery}
              placeholder="Enter rider ID or name"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              value={riderQuery}
            />
            {normalizedRiderQuery.length === 0 ? (
              <Text style={styles.hint}>Type a rider ID or name to search the tour directory.</Text>
            ) : riderOptions.length === 0 ? (
              <Text style={styles.hint}>{REGISTRATION_MESSAGES.NO_RIDERS}</Text>
            ) : (
              riderOptions.map((rider) => (
                <TouchableOpacity
                  accessibilityLabel={`Register ${rider.name}, ${rider.riderId}`}
                  accessibilityRole="button"
                  disabled={busyRiderId !== null}
                  key={rider.riderId}
                  onPress={() => void registerRider(rider.riderId, rider.name)}
                  style={styles.riderOption}
                >
                  <View style={styles.flex}>
                    <Text style={styles.riderName}>{rider.name}</Text>
                    <Text style={styles.meta}>{rider.riderId}</Text>
                  </View>
                  {busyRiderId === rider.riderId ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : (
                    <MaterialIcons name="add-circle-outline" size={22} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => {
                setShowRiderPicker(false);
                setRiderQuery('');
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}
        {!isLoading && visibleRegistrations.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim() ? 'No registrations match this search.' : REGISTRATION_MESSAGES.NO_REGISTRATIONS}
          </Text>
        ) : null}
        {visibleRegistrations.map((registration) => {
          const name = registration.name ?? riderNamesById[registration.riderId] ?? 'Unknown';
          const busy = busyRiderId === registration.riderId;
          return (
            <View key={registration.riderId} style={styles.registrationRow}>
              <View style={styles.flex}>
                <Text style={styles.riderName}>{name}</Text>
                <Text style={styles.meta}>{registration.riderId}</Text>
                <Text style={styles.meta}>
                  {formatDateTime(registration.registeredAt)} · {formatRegistrationSource(registration.source)}
                </Text>
              </View>
              {editState.editable ? (
                <TouchableOpacity
                  accessibilityLabel={`Unregister ${registration.riderId}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => setConfirmTarget(registration)}
                  style={styles.removeButton}
                >
                  {busy ? <ActivityIndicator color={COLORS.danger} /> : <MaterialIcons name="person-remove" size={20} color={COLORS.danger} />}
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <ConfirmDialog
        visible={Boolean(confirmTarget)}
        title="Unregister rider"
        message={confirmTarget
          ? `Remove ${confirmTarget.name ?? riderNamesById[confirmTarget.riderId] ?? 'this rider'} (${confirmTarget.riderId}) from this occurrence?`
          : ''}
        confirmLabel="Unregister"
        isSubmitting={Boolean(confirmTarget && busyRiderId === confirmTarget.riderId)}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => void unregisterRider()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 960, padding: 16, paddingBottom: 32, width: '100%' },
  summaryRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
  },
  count: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '700' },
  meta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  status: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  toolbar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    flexBasis: 250,
    flexDirection: 'row',
    flexGrow: 1,
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  searchInput: { color: COLORS.textPrimary, flex: 1, fontSize: 14, minHeight: 42, paddingVertical: 6 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  picker: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
    padding: 12,
  },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  hint: { color: COLORS.textSecondary, fontSize: 12 },
  riderOption: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingVertical: 6,
  },
  riderName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  flex: { flex: 1, minWidth: 0 },
  secondaryButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gray[100],
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  registrationRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  removeButton: { alignItems: 'center', borderRadius: 6, justifyContent: 'center', minHeight: 44, minWidth: 44 },
  empty: { color: COLORS.textSecondary, paddingVertical: 24, textAlign: 'center' },
  loader: { marginVertical: 24 },
  disabled: { opacity: 0.5 },
});
