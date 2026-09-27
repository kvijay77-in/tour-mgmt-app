/**
 * Tour assignment for a managed user (MANAGE_TOUR_USERS, online-only):
 * creates or updates the user's User-{tourId} record. Role is derived from
 * the user's Cognito groups (read-only); assignedStage comes from the user's
 * own PS group numbers; hotelId applies to HOTEL_STAFF only.
 * assignedActivityIds is a flat, de-duplicated list (D-P): an ID applies to
 * every assigned event that has it, and a warning names the events sharing it.
 * POST vs PUT is decided from GET /v1/tours/{tourId}/users; PUT sends only
 * changed fields (null removes a field).
 *
 * See docs/Event-Engine-Design.md § TourUserAssignmentScreen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EventMessageKind, TOUR_USER_MESSAGES } from '../../constants/eventMessages';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError, EventApiOutcome, listEvents } from '../../services/api/eventsApi';
import { listHotels } from '../../services/api/hotelsApi';
import { createTourUser, listTourUsers, updateTourUser } from '../../services/api/tourUserApi';
import { CognitoManagedUser, listCognitoUsersWithRoles } from '../../services/auth/cognitoUserManagementService';
import { CreateTourUserRequest, UpdateTourUserRequest } from '../../types/api';
import { EventAssignment, EventDefinition, Hotel, TourUserAssignment, UserRole } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { isValidDateString, listDatesInRange } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import {
  getPitStopStageNumbersFromRoles,
  getStageNumberFromPitStopRole,
  isPitStopUserRole,
  resolvePrimaryRole,
} from '../../utils/permissions';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'TourUserAssignmentScreen';
const MAX_USER_RESULTS = 12;
const MAX_TOUR_DAYS = 62;

interface TourUserAssignmentScreenProps {
  userId?: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'TourUserAssignment'>;
}

type Banner = { kind: EventMessageKind; message: string };

interface EventSelection {
  mode: 'ALL' | 'DATES';
  dates: string[];
}

interface AssignmentForm {
  assignedStage: number | null;
  hotelId: string | null;
  events: Record<string, EventSelection>;
  activityIds: string[];
}

interface AssignmentFields {
  role: string;
  assignedStage: number | null;
  hotelId: string | null;
  eventAssignments: EventAssignment[] | null;
  assignedActivityIds: string[] | null;
}

type FieldErrors = Partial<Record<'events' | 'hotel', string>>;

const EMPTY_FORM: AssignmentForm = { assignedStage: null, hotelId: null, events: {}, activityIds: [] };

function toForm(record: TourUserAssignment | undefined, role: string | null, roles: readonly string[]): AssignmentForm {
  const isPs = role !== null && isPitStopUserRole(role);
  const stages = getPitStopStageNumbersFromRoles(roles);
  const recordStage = record?.assignedStage ?? null;
  const events: Record<string, EventSelection> = {};
  for (const entry of record?.eventAssignments ?? []) {
    events[entry.eventId] = entry.dates === 'ALL'
      ? { mode: 'ALL', dates: [] }
      : { mode: 'DATES', dates: [...entry.dates].sort() };
  }
  return {
    assignedStage: isPs && role
      ? (recordStage !== null && stages.includes(recordStage) ? recordStage : getStageNumberFromPitStopRole(role))
      : null,
    hotelId: role === UserRole.HOTEL_STAFF ? record?.hotelId ?? null : null,
    events,
    activityIds: [...new Set(record?.assignedActivityIds ?? [])],
  };
}

function normaliseAssignments(list: EventAssignment[] | null | undefined): EventAssignment[] | null {
  if (!list || list.length === 0) return null;
  return [...list]
    .map((entry) => ({ eventId: entry.eventId, dates: entry.dates === 'ALL' ? 'ALL' as const : [...entry.dates].sort() }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
}

function normaliseIds(ids: string[] | null | undefined): string[] | null {
  if (!ids || ids.length === 0) return null;
  return [...new Set(ids)].sort();
}

function existingFields(record: TourUserAssignment): AssignmentFields {
  return {
    role: record.role,
    assignedStage: record.assignedStage ?? null,
    hotelId: record.hotelId ?? null,
    eventAssignments: normaliseAssignments(record.eventAssignments),
    assignedActivityIds: normaliseIds(record.assignedActivityIds),
  };
}

function displayName(user: CognitoManagedUser): string {
  return user.name?.trim() || user.email;
}

export default function TourUserAssignmentScreen({ userId, navigation }: TourUserAssignmentScreenProps) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const tourId = tour?.tourId;

  const [managedUsers, setManagedUsers] = useState<CognitoManagedUser[]>([]);
  const [tourUsers, setTourUsers] = useState<Record<string, TourUserAssignment>>({});
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userId ?? null);
  const [userQuery, setUserQuery] = useState('');
  const [form, setForm] = useState<AssignmentForm>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [dateErrors, setDateErrors] = useState<Record<string, string>>({});
  const [userGone, setUserGone] = useState(false);

  const loadTourUsers = useCallback(async (): Promise<boolean> => {
    if (!tourId) return false;
    const outcome = await listTourUsers(tourId);
    if (outcome.kind === 'error') {
      setBanner({ kind: outcome.error.kind, message: outcome.error.message });
      return false;
    }
    setTourUsers(Object.fromEntries(outcome.data.map((item) => [item.userId, item])));
    return true;
  }, [tourId]);

  const load = useCallback(async () => {
    if (!tourId || isOffline) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setBanner(null);
    try {
      const [users, , eventsOutcome, hotelsOutcome] = await Promise.all([
        listCognitoUsersWithRoles(),
        loadTourUsers(),
        listEvents(tourId),
        listHotels(tourId),
      ]);
      setManagedUsers(users);
      if (eventsOutcome.kind === 'error') setBanner({ kind: eventsOutcome.error.kind, message: eventsOutcome.error.message });
      else setEvents([...eventsOutcome.data].sort((a, b) => a.eventName.localeCompare(b.eventName)));
      if (hotelsOutcome.kind === 'error') setBanner({ kind: hotelsOutcome.error.kind, message: hotelsOutcome.error.message });
      else setHotels([...hotelsOutcome.data].sort((a, b) => a.name.localeCompare(b.name)));
      if (userId && !users.some((user) => user.cognitoUserId === userId)) {
        setSelectedUserId(null);
        setBanner({ kind: 'warning', message: TOUR_USER_MESSAGES.USER_NOT_LISTED });
      }
    } catch (err) {
      logger.error(TAG, 'Loading tour assignment data failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsLoading(false);
    }
  }, [isOffline, loadTourUsers, tourId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedUser = useMemo(
    () => managedUsers.find((user) => user.cognitoUserId === selectedUserId) ?? null,
    [managedUsers, selectedUserId],
  );
  const existing = selectedUserId ? tourUsers[selectedUserId] : undefined;
  const role = useMemo(() => (selectedUser ? resolvePrimaryRole(selectedUser.roles) : null), [selectedUser]);
  const isPs = role !== null && isPitStopUserRole(role);
  const isHotelStaff = role === UserRole.HOTEL_STAFF;
  const psStages = useMemo(() => getPitStopStageNumbersFromRoles(selectedUser?.roles ?? []), [selectedUser]);

  useEffect(() => {
    if (!selectedUser) return;
    setForm(toForm(existing, role, selectedUser.roles));
    setFieldErrors({});
    setDateErrors({});
  }, [existing, role, selectedUser]);

  const eventsById = useMemo(() => Object.fromEntries(events.map((event) => [event.eventId, event])), [events]);

  const tourDates = useMemo(() => {
    if (!tour || !isValidDateString(tour.startDate) || !isValidDateString(tour.endDate) || tour.startDate > tour.endDate) return [];
    const dates = listDatesInRange(tour.startDate, tour.endDate);
    return dates.length <= MAX_TOUR_DAYS ? dates : [];
  }, [tour]);

  const assignedEventIds = useMemo(() => Object.keys(form.events).sort(), [form.events]);

  const eventRows = useMemo(() => {
    const unknown = assignedEventIds.filter((id) => !eventsById[id]);
    return [...events.map((event) => event.eventId), ...unknown];
  }, [assignedEventIds, events, eventsById]);

  const desired = useMemo((): AssignmentFields | null => {
    if (!role) return null;
    const pool = new Set(assignedEventIds.flatMap((id) => eventsById[id]?.activities.map((activity) => activity.activityId) ?? []));
    return {
      role,
      assignedStage: isPs ? form.assignedStage : null,
      hotelId: isHotelStaff ? form.hotelId : null,
      eventAssignments: normaliseAssignments(assignedEventIds.map((id) => ({
        eventId: id,
        dates: form.events[id].mode === 'ALL' ? 'ALL' : form.events[id].dates,
      }))),
      assignedActivityIds: normaliseIds(form.activityIds.filter((id) => pool.has(id))),
    };
  }, [assignedEventIds, eventsById, form, isHotelStaff, isPs, role]);

  const changes = useMemo((): UpdateTourUserRequest | null => {
    if (!desired || !existing) return null;
    const before = existingFields(existing);
    const diff: UpdateTourUserRequest = {};
    (Object.keys(desired) as Array<keyof AssignmentFields>).forEach((key) => {
      if (JSON.stringify(desired[key]) !== JSON.stringify(before[key])) {
        (diff as Record<string, unknown>)[key] = desired[key];
      }
    });
    return diff;
  }, [desired, existing]);

  const sharedWarnings = useMemo(() => (desired?.assignedActivityIds ?? []).flatMap((activityId) => {
    const sharing = assignedEventIds.filter((id) => eventsById[id]?.activities.some((activity) => activity.activityId === activityId));
    if (sharing.length < 2) return [];
    return [TOUR_USER_MESSAGES.SHARED_ACTIVITY_ID
      .replace('{activityId}', activityId)
      .replace('{events}', sharing.map((id) => eventsById[id]?.eventName ?? id).join(', '))];
  }), [assignedEventIds, desired, eventsById]);

  const userResults = useMemo(() => {
    const text = userQuery.trim().toLowerCase();
    const matches = text
      ? managedUsers.filter((user) => displayName(user).toLowerCase().includes(text) || user.email.toLowerCase().includes(text))
      : managedUsers;
    return matches.slice(0, MAX_USER_RESULTS);
  }, [managedUsers, userQuery]);

  const hasChanges = existing ? Boolean(changes && Object.keys(changes).length > 0) : true;
  const disabled = isOffline || isSaving || isLoading || !role;

  const updateEvent = (eventId: string, selection: EventSelection | null) => {
    setForm((current) => {
      const nextEvents = { ...current.events };
      if (selection) nextEvents[eventId] = selection;
      else delete nextEvents[eventId];
      return { ...current, events: nextEvents };
    });
    setDateErrors((current) => {
      const next = { ...current };
      delete next[eventId];
      return next;
    });
    setFieldErrors((current) => ({ ...current, events: undefined }));
  };

  const toggleDate = (eventId: string, date: string) => {
    const selection = form.events[eventId];
    if (!selection) return;
    const dates = selection.dates.includes(date)
      ? selection.dates.filter((item) => item !== date)
      : [...selection.dates, date].sort();
    updateEvent(eventId, { mode: 'DATES', dates });
  };

  const toggleActivity = (activityId: string) => {
    setForm((current) => ({
      ...current,
      activityIds: current.activityIds.includes(activityId)
        ? current.activityIds.filter((id) => id !== activityId)
        : [...current.activityIds, activityId],
    }));
  };

  const selectUser = (id: string) => {
    setSelectedUserId(id);
    setUserQuery('');
    setBanner(null);
  };

  const backToUserList = () => {
    setUserGone(false);
    setSelectedUserId(null);
    void load();
  };

  const save = async () => {
    if (!tourId || !selectedUser || !desired) return;
    const nextDateErrors: Record<string, string> = {};
    for (const id of assignedEventIds) {
      const selection = form.events[id];
      if (selection.mode === 'DATES' && selection.dates.length === 0) nextDateErrors[id] = TOUR_USER_MESSAGES.DATES_REQUIRED;
    }
    setDateErrors(nextDateErrors);
    setFieldErrors({});
    if (Object.keys(nextDateErrors).length > 0) return;

    setIsSaving(true);
    setBanner(null);
    try {
      let outcome: EventApiOutcome<TourUserAssignment>;
      if (existing) {
        if (!changes || Object.keys(changes).length === 0) {
          setBanner({ kind: 'info', message: TOUR_USER_MESSAGES.NO_CHANGES });
          return;
        }
        outcome = await updateTourUser(tourId, selectedUser.cognitoUserId, changes);
      } else {
        const body: CreateTourUserRequest = {
          userId: selectedUser.cognitoUserId,
          role: desired.role,
          ...(desired.assignedStage !== null ? { assignedStage: desired.assignedStage } : {}),
          ...(desired.hotelId ? { hotelId: desired.hotelId } : {}),
          ...(desired.eventAssignments ? { eventAssignments: desired.eventAssignments } : {}),
          ...(desired.assignedActivityIds ? { assignedActivityIds: desired.assignedActivityIds } : {}),
        };
        outcome = await createTourUser(tourId, body);
      }

      if (outcome.kind === 'success') {
        setTourUsers((current) => ({ ...current, [outcome.data.userId]: outcome.data }));
        setBanner({ kind: 'info', message: TOUR_USER_MESSAGES.SAVED.replace('{user}', displayName(selectedUser)) });
        return;
      }
      const { code, message, kind } = outcome.error;
      if (code === 'INVALID_EVENT_ASSIGNMENT') {
        setFieldErrors({ events: message, ...(desired.hotelId ? { hotel: message } : {}) });
      } else if (code === 'USER_NOT_FOUND') {
        setUserGone(true);
      } else if (code === 'USER_ALREADY_EXISTS') {
        if (await loadTourUsers()) setBanner({ kind: 'info', message: TOUR_USER_MESSAGES.RECORD_EXISTS_RELOADED });
      } else {
        setBanner({ kind, message });
      }
    } catch (err) {
      logger.error(TAG, 'Saving tour assignment failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsSaving(false);
    }
  };

  if (userGone) {
    return (
      <View style={styles.container}>
        <EventScreenHeader title="Tour assignments" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="person-off" size={48} color={COLORS.textSecondary} />
          <Text style={styles.centeredText}>{TOUR_USER_MESSAGES.USER_GONE}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={backToUserList} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to user list</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderChip = (key: string, label: string, selected: boolean, onPress: () => void, chipDisabled = disabled) => (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: chipDisabled }}
      disabled={chipDisabled}
      key={key}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, chipDisabled && !selected && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderUserPicker = () => (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Choose a user</Text>
      <TextInput
        accessibilityLabel="Search users by name or email"
        autoCapitalize="none"
        onChangeText={setUserQuery}
        placeholder="Search by name or email"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        value={userQuery}
      />
      {userResults.map((user) => (
        <TouchableOpacity
          accessibilityLabel={`Select ${displayName(user)}`}
          accessibilityRole="button"
          key={user.cognitoUserId}
          onPress={() => selectUser(user.cognitoUserId)}
          style={styles.resultRow}
        >
          <MaterialIcons name="person" size={18} color={COLORS.primary} />
          <View style={styles.resultBody}>
            <Text style={styles.resultText}>{displayName(user)}</Text>
            <Text style={styles.resultMeta}>{user.email} · {user.roles.join(', ') || 'No groups'}</Text>
          </View>
          {tourUsers[user.cognitoUserId] ? <Text style={styles.badge}>Assigned</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderEventRow = (eventId: string) => {
    const event = eventsById[eventId];
    const selection = form.events[eventId];
    const dateChoices = selection ? [...new Set([...tourDates, ...selection.dates])].sort() : [];
    return (
      <View key={eventId} style={styles.eventRow}>
        <TouchableOpacity
          accessibilityLabel={`Assign ${event?.eventName ?? eventId}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Boolean(selection), disabled }}
          disabled={disabled}
          onPress={() => updateEvent(eventId, selection ? null : { mode: 'ALL', dates: [] })}
          style={styles.checkRow}
        >
          <MaterialIcons
            name={selection ? 'check-box' : 'check-box-outline-blank'}
            size={22}
            color={selection ? COLORS.primary : COLORS.textSecondary}
          />
          <View style={styles.resultBody}>
            <Text style={styles.resultText}>{event?.eventName ?? eventId}</Text>
            <Text style={styles.resultMeta}>{event ? `${eventId} · ${event.eventType}` : `${eventId} · not found in this tour`}</Text>
          </View>
        </TouchableOpacity>
        {selection ? (
          <View style={styles.eventOptions}>
            <View style={styles.chips}>
              {renderChip('ALL', 'All dates', selection.mode === 'ALL', () => updateEvent(eventId, { mode: 'ALL', dates: [] }))}
              {renderChip('DATES', 'Specific dates', selection.mode === 'DATES', () => updateEvent(eventId, { mode: 'DATES', dates: selection.dates }))}
            </View>
            {selection.mode === 'DATES' ? (
              dateChoices.length > 0 ? (
                <View style={[styles.chips, styles.dateChips]}>
                  {dateChoices.map((date) => renderChip(date, date, selection.dates.includes(date), () => toggleDate(eventId, date)))}
                </View>
              ) : (
                <Text style={styles.hint}>{TOUR_USER_MESSAGES.NO_TOUR_DATES}</Text>
              )
            ) : null}
            {dateErrors[eventId] ? <Text style={styles.errorText}>{dateErrors[eventId]}</Text> : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderForm = () => {
    if (!selectedUser) return null;
    return (
      <>
        <View style={styles.panel}>
          <View style={styles.identityRow}>
            <View style={styles.resultBody}>
              <Text style={styles.identityName}>{displayName(selectedUser)}</Text>
              <Text style={styles.resultMeta}>{selectedUser.email}</Text>
              <Text style={styles.resultMeta}>Username: {selectedUser.username}</Text>
              <Text style={styles.resultMeta}>Groups: {selectedUser.roles.join(', ') || 'None'}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" disabled={isSaving} onPress={() => setSelectedUserId(null)} style={styles.linkButton}>
              <Text style={styles.linkText}>Change user</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.metaText}>
            {existing
              ? `Tour record: ${existing.status ?? 'ACTIVE'}${existing.updatedAt ? ` · updated ${new Date(existing.updatedAt).toLocaleString()}` : ''}`
              : 'No tour record yet — saving creates one.'}
          </Text>
        </View>

        {!role ? <StatusBanner kind="warning" message={TOUR_USER_MESSAGES.NO_SUPPORTED_ROLE} /> : (
          <>
            <View style={styles.panel}>
              <Text style={styles.label}>Role (from Cognito groups)</Text>
              <Text style={styles.roleText}>{role}</Text>
              {isPs ? (
                <View style={styles.field}>
                  <Text style={styles.label}>Assigned stage</Text>
                  <View style={styles.chips}>
                    {psStages.map((stage) => renderChip(
                      String(stage),
                      `Stage ${stage}`,
                      form.assignedStage === stage,
                      () => setForm((current) => ({ ...current, assignedStage: stage })),
                      disabled || psStages.length < 2,
                    ))}
                  </View>
                </View>
              ) : null}
              {isHotelStaff ? (
                <View style={styles.field}>
                  <Text style={styles.label}>Hotel</Text>
                  <View style={styles.chips}>
                    {renderChip('none', 'None', form.hotelId === null, () => setForm((current) => ({ ...current, hotelId: null })))}
                    {hotels.map((hotel) => renderChip(
                      hotel.hotelId,
                      `${hotel.name} · ${hotel.city}`,
                      form.hotelId === hotel.hotelId,
                      () => {
                        setForm((current) => ({ ...current, hotelId: hotel.hotelId }));
                        setFieldErrors((current) => ({ ...current, hotel: undefined }));
                      },
                    ))}
                  </View>
                  {hotels.length === 0 ? <Text style={styles.hint}>{TOUR_USER_MESSAGES.NO_HOTELS}</Text> : null}
                  {fieldErrors.hotel ? <Text style={styles.errorText}>{fieldErrors.hotel}</Text> : null}
                </View>
              ) : null}
            </View>

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Event assignments</Text>
              {eventRows.length === 0 ? <Text style={styles.hint}>{TOUR_USER_MESSAGES.NO_EVENTS}</Text> : null}
              {eventRows.map(renderEventRow)}
              {fieldErrors.events ? <Text style={styles.errorText}>{fieldErrors.events}</Text> : null}
            </View>

            {assignedEventIds.length > 0 ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Activities</Text>
                <Text style={styles.hint}>
                  {form.activityIds.length === 0 ? TOUR_USER_MESSAGES.NO_ACTIVITY_RESTRICTION : 'Only the selected activities can be scanned.'}
                </Text>
                {assignedEventIds.filter((id) => eventsById[id]).map((id) => (
                  <View key={id} style={styles.field}>
                    <Text style={styles.label}>{eventsById[id].eventName}</Text>
                    <View style={styles.chips}>
                      {[...eventsById[id].activities]
                        .sort((a, b) => a.sequenceNo - b.sequenceNo)
                        .map((activity) => renderChip(
                          `${id}-${activity.activityId}`,
                          `${activity.activityId} · ${activity.name}`,
                          form.activityIds.includes(activity.activityId),
                          () => toggleActivity(activity.activityId),
                        ))}
                    </View>
                  </View>
                ))}
                {sharedWarnings.map((message) => <StatusBanner key={message} kind="warning" message={message} />)}
              </View>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" disabled={isSaving} onPress={() => navigation.goBack()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: disabled || !hasChanges }}
                disabled={disabled || !hasChanges}
                onPress={() => void save()}
                style={[styles.primaryButton, (disabled || !hasChanges) && styles.disabled]}
              >
                {isSaving
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.primaryButtonText}>{existing ? 'Save changes' : 'Create assignment'}</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <EventScreenHeader title="Tour assignments" subtitle={tour?.name} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!tourId ? <StatusBanner kind="warning" message={TOUR_USER_MESSAGES.NO_TOUR} /> : null}
        {isOffline ? <StatusBanner kind="warning" message={TOUR_USER_MESSAGES.OFFLINE} /> : null}
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} /> : null}
        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : (
          selectedUser ? renderForm() : (tourId && !isOffline ? renderUserPicker() : null)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: { alignSelf: 'center', gap: 12, maxWidth: 860, padding: 16, paddingBottom: 32, width: '100%' },
  loader: { marginVertical: 24 },
  centered: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  panelTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  field: { marginTop: 10 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  roleText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  metaText: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resultRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingVertical: 6,
  },
  resultBody: { flex: 1, minWidth: 0 },
  resultText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  resultMeta: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  badge: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 10,
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  identityRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  identityName: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  linkButton: { justifyContent: 'center', minHeight: 36, paddingHorizontal: 8 },
  linkText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  eventRow: { borderBottomColor: COLORS.borderLight, borderBottomWidth: 1, paddingVertical: 6 },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44 },
  eventOptions: { gap: 6, marginLeft: 30, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dateChips: { marginTop: 4 },
  chip: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: COLORS.textPrimary, fontSize: 13 },
  chipTextSelected: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  secondaryButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  secondaryButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 140,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
