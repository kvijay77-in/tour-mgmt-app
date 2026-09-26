/**
 * Occurrence management (MANAGE_EVENT_OCCURRENCES): read-only definition
 * header, occurrence lifecycle (start/complete/cancel), create (single or
 * REPEATING date range), occurrence edit, and per-activity overrides with
 * quick toggles. Online-only. See docs/Event-Engine-Design.md § Screens.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_VALIDATION_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import {
  cancelOccurrence,
  completeOccurrence,
  createOccurrence,
  describeUnexpectedEventError,
  EventApiError,
  getEvent,
  getOccurrenceProgress,
  listEvents,
  listOccurrences,
  startOccurrence,
  updateOccurrence,
  upsertActivityOverride,
} from '../../services/api/eventsApi';
import { CreateOccurrenceRequest, UpdateOccurrenceRequest, UpsertActivityOverrideRequest } from '../../types/api';
import { EventActivity, EventDefinition, EventOccurrence, EventType, OccurrenceStatus, Permission } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import {
  findActivityOverride,
  getEffectiveActivityEnabled,
  getEffectiveSelfService,
  isValidDateString,
  listDatesInRange,
  toLocalDateString,
} from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import { hasPermission } from '../../utils/permissions';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import ActivityChipList, { getOverrideBadges } from '../../components/events/ActivityChipList';
import ActivityOverrideEditor from '../../components/events/ActivityOverrideEditor';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../../components/events/OccurrenceStatusBadge';
import StatusBanner from '../../components/events/StatusBanner';
import { useIdCodeTypeOptions } from '../../components/events/TypeCodeMultiSelect';

const TAG = 'OccurrenceManagementScreen';
const TOAST_DURATION_MS = 4000;
const MAX_BULK_DAYS = 60;

interface OccurrenceManagementScreenProps {
  eventId: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'OccurrenceManagement'>;
}

type Banner = { kind: EventMessageKind; message: string };

type PendingAction =
  | { type: 'start'; occurrence: EventOccurrence }
  | { type: 'complete'; occurrence: EventOccurrence; checking: boolean; outstanding: number | null }
  | { type: 'cancel'; occurrence: EventOccurrence };

interface CreateForm {
  mode: 'single' | 'range';
  date: string;
  toDate: string;
  seq: string;
  selfServiceEnabled: boolean;
  linkedOccurrenceRef: string | null;
}

interface BulkResult {
  date: string;
  ok: boolean;
  message: string;
}

interface EditForm {
  occurrence: EventOccurrence;
  selfServiceEnabled: boolean;
  linkedOccurrenceRef: string | null;
}

interface LinkCandidate {
  occurrenceId: string;
  label: string;
}

type FormErrors = Partial<Record<'date' | 'toDate' | 'seq' | 'form', string>>;

function sortOccurrences(items: EventOccurrence[]): EventOccurrence[] {
  return [...items].sort((a, b) => (a.date === b.date ? a.seq - b.seq : a.date.localeCompare(b.date)));
}

function isClosed(occurrence: EventOccurrence): boolean {
  return occurrence.status === OccurrenceStatus.COMPLETED || occurrence.status === OccurrenceStatus.CANCELLED;
}

function occurrenceLabel(occurrence: Pick<EventOccurrence, 'date' | 'seq'>): string {
  return `${occurrence.date} #${occurrence.seq}`;
}

function parseSeq(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const seq = Number.parseInt(value.trim(), 10);
  return seq >= 1 ? seq : null;
}

// ---------------------------------------------------------------------------
// Linked occurrence picker
// ---------------------------------------------------------------------------

interface LinkPickerProps {
  value: string | null;
  candidates: LinkCandidate[] | undefined;
  disabled: boolean;
  onChange: (value: string | null) => void;
}

function LinkPicker({ value, candidates, disabled, onChange }: LinkPickerProps) {
  const options: Array<{ id: string | null; label: string }> = [{ id: null, label: 'None' }];
  (candidates ?? []).forEach((candidate) => options.push({ id: candidate.occurrenceId, label: candidate.label }));
  if (value && !options.some((option) => option.id === value)) options.push({ id: value, label: value });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Linked occurrence (same date, for reconciliation)</Text>
      {candidates === undefined ? <ActivityIndicator color={COLORS.primary} size="small" style={styles.inlineLoader} /> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <TouchableOpacity
              key={option.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(option.id)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {candidates && candidates.length === 0 ? (
        <Text style={styles.hint}>No other event has an occurrence on this date.</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function OccurrenceManagementScreen({ eventId, navigation }: OccurrenceManagementScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const { tour } = useTour();
  const { user } = useAuth();
  const canScan = user ? hasPermission(user.userRole, Permission.EVENT_SCAN) : false;
  const canViewDashboard = user ? hasPermission(user.userRole, Permission.VIEW_DASHBOARD) : false;
  const { isOffline } = useOffline();
  const typeOptions = useIdCodeTypeOptions();
  const tourId = tour?.tourId;

  const [event, setEvent] = useState<EventDefinition | null>(null);
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);

  const [createForm, setCreateForm] = useState<CreateForm | null>(null);
  const [createErrors, setCreateErrors] = useState<FormErrors>({});
  const [isCreating, setIsCreating] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);

  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [overrideTarget, setOverrideTarget] = useState<{ occurrenceId: string; activityId: string } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const [otherEvents, setOtherEvents] = useState<EventDefinition[] | null>(null);
  const [linkCandidates, setLinkCandidates] = useState<Record<string, LinkCandidate[] | undefined>>({});
  const linkRequests = useRef(new Set<string>());

  const activities = event ? [...event.activities].sort((a, b) => a.sequenceNo - b.sequenceNo) : [];
  const actionsDisabled = isOffline;

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const load = useCallback(async () => {
    if (!tourId) return;
    setIsLoading(true);
    setBanner(null);
    try {
      const [eventOutcome, occurrenceOutcome] = await Promise.all([
        getEvent(tourId, eventId),
        listOccurrences(tourId, eventId),
      ]);
      if (eventOutcome.kind === 'error') {
        if (eventOutcome.error.status === 404) setNotFound(true);
        else setBanner({ kind: eventOutcome.error.kind, message: eventOutcome.error.message });
        return;
      }
      setEvent(eventOutcome.data);
      if (occurrenceOutcome.kind === 'error') {
        setBanner({ kind: occurrenceOutcome.error.kind, message: occurrenceOutcome.error.message });
        return;
      }
      setOccurrences(sortOccurrences(occurrenceOutcome.data));
    } catch (err) {
      logger.error(TAG, 'Loading occurrences failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsLoading(false);
    }
  }, [eventId, tourId]);

  useEffect(() => {
    if (!isOffline) void load();
    else setIsLoading(false);
  }, [isOffline, load]);

  const reloadOccurrences = useCallback(async () => {
    if (!tourId) return;
    try {
      const outcome = await listOccurrences(tourId, eventId);
      if (outcome.kind === 'success') setOccurrences(sortOccurrences(outcome.data));
    } catch (err) {
      logger.warn(TAG, 'Reloading occurrences failed', err);
    }
  }, [eventId, tourId]);

  const replaceOccurrence = (updated: EventOccurrence) => {
    setOccurrences((current) => current.map((item) => (item.occurrenceId === updated.occurrenceId ? updated : item)));
  };

  /** Row-level expected errors: show them and refresh when state changed elsewhere. */
  const handleRowError = (error: EventApiError) => {
    if (error.code === 'EVENT_NOT_FOUND') {
      setNotFound(true);
      return;
    }
    setBanner({ kind: error.kind, message: error.message });
    if (error.status === 404 || error.code === 'OCCURRENCE_CLOSED' || error.code === 'INVALID_OCCURRENCE_TRANSITION') {
      void reloadOccurrences();
    }
  };

  const setBusy = (key: string, busy: boolean) => {
    setBusyKeys((current) => {
      const next = { ...current };
      if (busy) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  // ---- Linked occurrence candidates -------------------------------------

  const ensureLinkCandidates = useCallback(async (date: string) => {
    if (!tourId || !isValidDateString(date) || linkRequests.current.has(date)) return;
    linkRequests.current.add(date);
    try {
      let others = otherEvents;
      if (!others) {
        const eventsOutcome = await listEvents(tourId);
        others = eventsOutcome.kind === 'success'
          ? eventsOutcome.data.filter((item) => item.eventId !== eventId)
          : [];
        setOtherEvents(others);
      }
      const outcomes = await Promise.all(others.map((item) => listOccurrences(tourId, item.eventId, { date })));
      const candidates: LinkCandidate[] = [];
      outcomes.forEach((outcome, index) => {
        if (outcome.kind !== 'success') return;
        outcome.data.forEach((occurrence) => candidates.push({
          occurrenceId: occurrence.occurrenceId,
          label: `${others![index].eventName} #${occurrence.seq} (${occurrence.status})`,
        }));
      });
      setLinkCandidates((current) => ({ ...current, [date]: candidates }));
    } catch (err) {
      logger.warn(TAG, 'Loading link candidates failed', err);
      linkRequests.current.delete(date);
      setLinkCandidates((current) => ({ ...current, [date]: [] }));
    }
  }, [eventId, otherEvents, tourId]);

  useEffect(() => {
    if (createForm?.mode === 'single' && isValidDateString(createForm.date)) void ensureLinkCandidates(createForm.date);
  }, [createForm?.date, createForm?.mode, ensureLinkCandidates]);

  useEffect(() => {
    if (editForm) void ensureLinkCandidates(editForm.occurrence.date);
  }, [editForm, ensureLinkCandidates]);

  // ---- Lifecycle actions -------------------------------------------------

  const requestComplete = async (occurrence: EventOccurrence) => {
    if (!tourId) return;
    setPending({ type: 'complete', occurrence, checking: true, outstanding: null });
    let outstanding: number | null = null;
    try {
      const outcome = await getOccurrenceProgress(tourId, eventId, occurrence.occurrenceId);
      if (outcome.kind === 'success') outstanding = outcome.data.data?.outstandingMandatoryCount ?? null;
      else logger.warn(TAG, 'Progress unavailable before complete', { code: outcome.error.code });
    } catch (err) {
      logger.warn(TAG, 'Progress fetch failed before complete', err);
    }
    setPending((current) => (current?.type === 'complete' && current.occurrence.occurrenceId === occurrence.occurrenceId
      ? { ...current, checking: false, outstanding }
      : current));
  };

  const confirmPending = async () => {
    if (!pending || !tourId) return;
    const { occurrence } = pending;
    setIsConfirming(true);
    try {
      if (pending.type === 'start') {
        const outcome = await startOccurrence(tourId, eventId, occurrence.occurrenceId);
        if (outcome.kind === 'error') handleRowError(outcome.error);
        else {
          replaceOccurrence(outcome.data);
          setToast(`Occurrence ${occurrenceLabel(occurrence)} started.`);
        }
      } else if (pending.type === 'complete') {
        const outcome = await completeOccurrence(tourId, eventId, occurrence.occurrenceId);
        if (outcome.kind === 'error') handleRowError(outcome.error);
        else {
          const { outstandingMandatoryCount, ...completed } = outcome.data;
          replaceOccurrence(completed);
          setToast(`Occurrence ${occurrenceLabel(occurrence)} completed. ${outstandingMandatoryCount ?? 0} mandatory rider-activity item(s) were outstanding.`);
        }
      } else {
        const reason = cancelReason.trim();
        const outcome = await cancelOccurrence(tourId, eventId, occurrence.occurrenceId, reason ? { cancelReason: reason } : {});
        if (outcome.kind === 'error') handleRowError(outcome.error);
        else {
          replaceOccurrence(outcome.data);
          setToast(`Occurrence ${occurrenceLabel(occurrence)} cancelled.`);
        }
      }
    } catch (err) {
      logger.error(TAG, `Occurrence ${pending.type} failed`, err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsConfirming(false);
      setPending(null);
      setCancelReason('');
    }
  };

  const confirmContent = (() => {
    if (!pending) return { title: '', message: '', label: '' };
    const label = occurrenceLabel(pending.occurrence);
    if (pending.type === 'start') {
      return { title: 'Start occurrence', message: `Start ${label}? Scanning opens for this occurrence.`, label: 'Start' };
    }
    if (pending.type === 'complete') {
      let message = 'Checking outstanding mandatory items…';
      if (!pending.checking) {
        message = pending.outstanding === null
          ? `The outstanding item count is unavailable. Complete ${label} anyway?`
          : pending.outstanding > 0
            ? `${pending.outstanding} rider-activity item(s) outstanding. Complete anyway?`
            : `No mandatory items are outstanding. Complete ${label}?`;
      }
      return { title: 'Complete occurrence', message, label: 'Complete' };
    }
    return { title: 'Cancel occurrence', message: `Cancel ${label}? Scanning will no longer be possible.`, label: 'Cancel occurrence' };
  })();

  // ---- Create ------------------------------------------------------------

  const openCreate = (mode: CreateForm['mode']) => {
    const today = toLocalDateString();
    setCreateForm({
      mode,
      date: today,
      toDate: today,
      seq: '1',
      selfServiceEnabled: Boolean(event?.allowSelfService),
      linkedOccurrenceRef: null,
    });
    setCreateErrors({});
    setBulkResults([]);
  };

  const submitCreate = async () => {
    if (!createForm || !tourId) return;
    const errors: FormErrors = {};
    const seq = parseSeq(createForm.seq);
    if (!isValidDateString(createForm.date)) errors.date = EVENT_VALIDATION_MESSAGES.DATE_FORMAT;
    if (seq === null) errors.seq = EVENT_VALIDATION_MESSAGES.SEQ_POSITIVE;
    if (createForm.mode === 'range') {
      if (!isValidDateString(createForm.toDate)) errors.toDate = EVENT_VALIDATION_MESSAGES.DATE_FORMAT;
      else if (!errors.date && createForm.toDate < createForm.date) errors.toDate = EVENT_VALIDATION_MESSAGES.DATE_RANGE_ORDER;
      else if (!errors.date && listDatesInRange(createForm.date, createForm.toDate).length > MAX_BULK_DAYS) {
        errors.toDate = `A range can cover at most ${MAX_BULK_DAYS} days.`;
      }
    }
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0 || seq === null) return;

    setIsCreating(true);
    try {
      if (createForm.mode === 'single') {
        const body: CreateOccurrenceRequest = {
          date: createForm.date,
          seq,
          selfServiceEnabled: createForm.selfServiceEnabled,
          ...(createForm.linkedOccurrenceRef ? { linkedOccurrenceRef: createForm.linkedOccurrenceRef } : {}),
        };
        const outcome = await createOccurrence(tourId, eventId, body);
        if (outcome.kind === 'error') {
          if (outcome.error.code === 'EVENT_NOT_FOUND') setNotFound(true);
          else if (outcome.error.code === 'OCCURRENCE_ALREADY_EXISTS') setCreateErrors({ seq: outcome.error.message });
          else setCreateErrors({ form: outcome.error.message });
          return;
        }
        setOccurrences((current) => sortOccurrences([...current, outcome.data]));
        setCreateForm(null);
        setToast(`Occurrence ${occurrenceLabel(outcome.data)} created.`);
        return;
      }

      const results: BulkResult[] = [];
      setBulkResults([]);
      for (const date of listDatesInRange(createForm.date, createForm.toDate)) {
        const outcome = await createOccurrence(tourId, eventId, {
          date,
          seq,
          selfServiceEnabled: createForm.selfServiceEnabled,
        });
        if (outcome.kind === 'success') {
          results.push({ date, ok: true, message: 'Created' });
          setOccurrences((current) => sortOccurrences([...current, outcome.data]));
        } else {
          results.push({ date, ok: false, message: outcome.error.message });
          if (outcome.error.code === 'EVENT_NOT_FOUND') {
            setNotFound(true);
            break;
          }
        }
        setBulkResults([...results]);
      }
    } catch (err) {
      logger.error(TAG, 'Creating occurrence failed', err);
      setCreateErrors({ form: describeUnexpectedEventError(err) });
    } finally {
      setIsCreating(false);
    }
  };

  // ---- Edit --------------------------------------------------------------

  const submitEdit = async () => {
    if (!editForm || !tourId) return;
    const { occurrence } = editForm;
    const body: UpdateOccurrenceRequest = {};
    if (editForm.selfServiceEnabled !== Boolean(occurrence.selfServiceEnabled)) body.selfServiceEnabled = editForm.selfServiceEnabled;
    if ((editForm.linkedOccurrenceRef ?? null) !== (occurrence.linkedOccurrenceRef ?? null)) {
      body.linkedOccurrenceRef = editForm.linkedOccurrenceRef;
    }
    if (Object.keys(body).length === 0) {
      setEditForm(null);
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const outcome = await updateOccurrence(tourId, eventId, occurrence.occurrenceId, body);
      if (outcome.kind === 'error') {
        setEditError(outcome.error.message);
        if (outcome.error.status === 404 || outcome.error.code === 'OCCURRENCE_CLOSED') void reloadOccurrences();
        return;
      }
      replaceOccurrence(outcome.data);
      setEditForm(null);
      setToast(`Occurrence ${occurrenceLabel(occurrence)} updated.`);
    } catch (err) {
      logger.error(TAG, 'Updating occurrence failed', err);
      setEditError(describeUnexpectedEventError(err));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ---- Overrides ---------------------------------------------------------

  const applyOverrideItems = (occurrence: EventOccurrence, items: EventOccurrence['activityOverrides']) => {
    replaceOccurrence({ ...occurrence, activityOverrides: items });
  };

  const quickToggle = async (
    occurrence: EventOccurrence,
    activity: EventActivity,
    field: 'enabled' | 'selfServiceEnabled',
    nextValue: boolean,
  ) => {
    if (!tourId) return;
    const inherited = field === 'enabled' ? activity.enabled : Boolean(occurrence.selfServiceEnabled);
    const body: UpsertActivityOverrideRequest = {
      activityId: activity.activityId,
      // Matching the inherited value clears the field instead of pinning it.
      [field]: nextValue === inherited ? null : nextValue,
    };
    const key = `${occurrence.occurrenceId}|${activity.activityId}|${field}`;
    setBusy(key, true);
    try {
      const outcome = await upsertActivityOverride(tourId, eventId, occurrence.occurrenceId, body);
      if (outcome.kind === 'error') {
        handleRowError(outcome.error);
        return;
      }
      applyOverrideItems(occurrence, outcome.data);
      const fieldLabel = field === 'enabled' ? 'Enabled' : 'Self-service';
      setToast(`${activity.name}: ${fieldLabel} ${nextValue ? 'on' : 'off'} for ${occurrenceLabel(occurrence)}.`);
    } catch (err) {
      logger.error(TAG, 'Quick override toggle failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setBusy(key, false);
    }
  };

  const overrideOccurrence = overrideTarget
    ? occurrences.find((item) => item.occurrenceId === overrideTarget.occurrenceId) ?? null
    : null;
  const overrideActivity = overrideTarget
    ? activities.find((item) => item.activityId === overrideTarget.activityId) ?? null
    : null;

  const saveOverride = async (request: UpsertActivityOverrideRequest) => {
    if (!tourId || !overrideOccurrence) return;
    setIsSavingOverride(true);
    setOverrideError(null);
    try {
      const outcome = await upsertActivityOverride(tourId, eventId, overrideOccurrence.occurrenceId, request);
      if (outcome.kind === 'error') {
        setOverrideError(outcome.error.message);
        if (outcome.error.status === 404 || outcome.error.code === 'OCCURRENCE_CLOSED') void reloadOccurrences();
        return;
      }
      applyOverrideItems(overrideOccurrence, outcome.data);
      const removed = !outcome.data.some((item) => item.activityId === request.activityId);
      setOverrideTarget(null);
      setToast(removed ? 'Override removed.' : 'Override saved.');
    } catch (err) {
      logger.error(TAG, 'Saving override failed', err);
      setOverrideError(describeUnexpectedEventError(err));
    } finally {
      setIsSavingOverride(false);
    }
  };

  // ---- Rendering ---------------------------------------------------------

  if (notFound) {
    return (
      <View style={styles.container}>
        <EventScreenHeader title="Occurrences" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="event-busy" size={48} color={COLORS.textSecondary} />
          <Text style={styles.notFoundText}>This event no longer exists. It may have been removed elsewhere.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to events</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderCreateForm = () => {
    if (!createForm) return null;
    const isRange = createForm.mode === 'range';
    const disabled = isCreating || actionsDisabled;
    const update = (patch: Partial<CreateForm>) => setCreateForm((current) => (current ? { ...current, ...patch } : current));
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{isRange ? 'Generate occurrences for a date range' : 'New occurrence'}</Text>
        {createErrors.form ? <StatusBanner kind="error" message={createErrors.form} /> : null}
        <View style={styles.formRow}>
          <View style={styles.formCell}>
            <Text style={styles.label}>{isRange ? 'From date' : 'Date'} (YYYY-MM-DD)</Text>
            <TextInput
              accessibilityLabel={isRange ? 'From date' : 'Date'}
              editable={!disabled}
              onChangeText={(date) => update({ date, linkedOccurrenceRef: null })}
              placeholder="2026-02-12"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, createErrors.date ? styles.inputError : null]}
              value={createForm.date}
            />
            {createErrors.date ? <Text style={styles.errorText}>{createErrors.date}</Text> : null}
          </View>
          {isRange ? (
            <View style={styles.formCell}>
              <Text style={styles.label}>To date (YYYY-MM-DD)</Text>
              <TextInput
                accessibilityLabel="To date"
                editable={!disabled}
                onChangeText={(toDate) => update({ toDate })}
                placeholder="2026-02-20"
                placeholderTextColor={COLORS.textDisabled}
                style={[styles.input, createErrors.toDate ? styles.inputError : null]}
                value={createForm.toDate}
              />
              {createErrors.toDate ? <Text style={styles.errorText}>{createErrors.toDate}</Text> : null}
            </View>
          ) : null}
          <View style={styles.formCellSmall}>
            <Text style={styles.label}>Sequence</Text>
            <TextInput
              accessibilityLabel="Sequence"
              editable={!disabled}
              keyboardType="number-pad"
              onChangeText={(seq) => update({ seq })}
              style={[styles.input, createErrors.seq ? styles.inputError : null]}
              value={createForm.seq}
            />
          </View>
        </View>
        {createErrors.seq ? <Text style={styles.errorText}>{createErrors.seq}</Text> : null}
        <View style={styles.toggle}>
          <Switch
            accessibilityLabel="Self-service by default"
            disabled={disabled}
            onValueChange={(selfServiceEnabled) => update({ selfServiceEnabled })}
            value={createForm.selfServiceEnabled}
          />
          <Text style={styles.toggleLabel}>Self-service by default (informational)</Text>
        </View>
        {!isRange && isValidDateString(createForm.date) ? (
          <LinkPicker
            value={createForm.linkedOccurrenceRef}
            candidates={linkCandidates[createForm.date]}
            disabled={disabled}
            onChange={(linkedOccurrenceRef) => update({ linkedOccurrenceRef })}
          />
        ) : null}
        {isRange ? <Text style={styles.hint}>Links to paired occurrences can be set per occurrence afterwards.</Text> : null}

        {bulkResults.length > 0 ? (
          <View style={styles.results}>
            {bulkResults.map((result) => (
              <View key={result.date} style={styles.resultRow}>
                <MaterialIcons
                  name={result.ok ? 'check-circle' : 'error-outline'}
                  size={16}
                  color={result.ok ? COLORS.success : COLORS.danger}
                />
                <Text style={styles.resultText}>{result.date}: {result.message}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.panelActions}>
          <TouchableOpacity accessibilityRole="button" disabled={isCreating} onPress={() => setCreateForm(null)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{bulkResults.length > 0 && !isCreating ? 'Done' : 'Close'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void submitCreate()}
            style={[styles.primaryButton, disabled && styles.disabled]}
          >
            {isCreating ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>{isRange ? 'Generate' : 'Create'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEditForm = (occurrence: EventOccurrence) => {
    if (!editForm || editForm.occurrence.occurrenceId !== occurrence.occurrenceId) return null;
    const disabled = isSavingEdit || actionsDisabled || isClosed(occurrence);
    return (
      <View style={styles.innerPanel}>
        <Text style={styles.panelTitle}>Edit occurrence</Text>
        {editError ? <StatusBanner kind="error" message={editError} /> : null}
        <View style={styles.toggle}>
          <Switch
            accessibilityLabel="Self-service by default"
            disabled={disabled}
            onValueChange={(selfServiceEnabled) => setEditForm((current) => (current ? { ...current, selfServiceEnabled } : current))}
            value={editForm.selfServiceEnabled}
          />
          <Text style={styles.toggleLabel}>Self-service by default (informational)</Text>
        </View>
        <LinkPicker
          value={editForm.linkedOccurrenceRef}
          candidates={linkCandidates[occurrence.date]}
          disabled={disabled}
          onChange={(linkedOccurrenceRef) => setEditForm((current) => (current ? { ...current, linkedOccurrenceRef } : current))}
        />
        <View style={styles.panelActions}>
          <TouchableOpacity accessibilityRole="button" onPress={() => setEditForm(null)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void submitEdit()}
            style={[styles.primaryButton, disabled && styles.disabled]}
          >
            {isSavingEdit ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderActivityPanel = (occurrence: EventOccurrence) => {
    const closed = isClosed(occurrence);
    return (
      <View style={styles.innerPanel}>
        <Text style={styles.panelTitle}>Activity overrides</Text>
        {closed ? <Text style={styles.hint}>This occurrence is closed; overrides cannot be changed.</Text> : null}
        {activities.map((activity) => {
          const override = findActivityOverride(occurrence, activity.activityId);
          const enabled = getEffectiveActivityEnabled(activity, override);
          const selfService = getEffectiveSelfService(occurrence, override);
          const badges = getOverrideBadges(activity, override, occurrence);
          const enabledKey = `${occurrence.occurrenceId}|${activity.activityId}|enabled`;
          const selfServiceKey = `${occurrence.occurrenceId}|${activity.activityId}|selfServiceEnabled`;
          const disabled = closed || actionsDisabled;
          return (
            <View key={activity.activityId} style={[styles.activityRow, isDesktop && styles.activityRowDesktop]}>
              <View style={styles.activityInfo}>
                <Text style={[styles.activityName, !enabled && styles.activityNameDisabled]}>
                  {activity.sequenceNo}. {activity.name}
                </Text>
                {badges.map((badge) => <Text key={badge} style={styles.overrideBadge}>{badge}</Text>)}
                {override?.note ? <Text style={styles.noteText}>{override.note}</Text> : null}
              </View>
              <View style={styles.activityControls}>
                <View style={styles.toggle}>
                  <Switch
                    accessibilityLabel={`${activity.name} enabled on ${occurrenceLabel(occurrence)}`}
                    disabled={disabled || busyKeys[enabledKey]}
                    onValueChange={(value) => void quickToggle(occurrence, activity, 'enabled', value)}
                    value={enabled}
                  />
                  <Text style={styles.toggleLabel}>Enabled</Text>
                </View>
                <View style={styles.toggle}>
                  <Switch
                    accessibilityLabel={`${activity.name} self-service on ${occurrenceLabel(occurrence)}`}
                    disabled={disabled || busyKeys[selfServiceKey]}
                    onValueChange={(value) => void quickToggle(occurrence, activity, 'selfServiceEnabled', value)}
                    value={selfService}
                  />
                  <Text style={styles.toggleLabel}>Self-service</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel={`Adjust ${activity.name} for this occurrence`}
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => {
                    setOverrideError(null);
                    setOverrideTarget({ occurrenceId: occurrence.occurrenceId, activityId: activity.activityId });
                  }}
                  style={[styles.smallButton, disabled && styles.disabled]}
                >
                  <Text style={styles.smallButtonText}>Adjust…</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderOccurrence = (occurrence: EventOccurrence) => {
    const isExpanded = Boolean(expanded[occurrence.occurrenceId]);
    const closed = isClosed(occurrence);
    const isEditing = editForm?.occurrence.occurrenceId === occurrence.occurrenceId;
    return (
      <View key={occurrence.occurrenceId} style={styles.occurrenceCard}>
        <View style={styles.occurrenceHeader}>
          <View style={styles.occurrenceInfo}>
            <View style={styles.occurrenceTitleRow}>
              <Text style={styles.occurrenceTitle}>{occurrenceLabel(occurrence)}</Text>
              <OccurrenceStatusBadge status={occurrence.status} />
              {occurrence.selfServiceEnabled ? <Text style={styles.infoBadge}>Self-service</Text> : null}
            </View>
            {occurrence.linkedOccurrenceRef ? (
              <Text style={styles.metaText}>Linked: {occurrence.linkedOccurrenceRef}</Text>
            ) : null}
            {occurrence.status === OccurrenceStatus.CANCELLED && occurrence.cancelReason ? (
              <Text style={styles.metaText}>Reason: {occurrence.cancelReason}</Text>
            ) : null}
          </View>
          <View style={styles.occurrenceActions}>
            {occurrence.status === OccurrenceStatus.PLANNED ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled}
                onPress={() => setPending({ type: 'start', occurrence })}
                style={[styles.actionButton, styles.actionPrimary, actionsDisabled && styles.disabled]}
              >
                <Text style={styles.actionPrimaryText}>Start</Text>
              </TouchableOpacity>
            ) : null}
            {occurrence.status === OccurrenceStatus.ACTIVE ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled}
                onPress={() => void requestComplete(occurrence)}
                style={[styles.actionButton, styles.actionPrimary, actionsDisabled && styles.disabled]}
              >
                <Text style={styles.actionPrimaryText}>Complete</Text>
              </TouchableOpacity>
            ) : null}
            {occurrence.status === OccurrenceStatus.ACTIVE && canScan ? (
              <TouchableOpacity
                accessibilityLabel={`Scan for ${occurrenceLabel(occurrence)}`}
                accessibilityRole="button"
                onPress={() => navigation.navigate('EventScan', {
                  eventId: occurrence.eventId,
                  occurrenceId: occurrence.occurrenceId,
                })}
                style={styles.actionButton}
              >
                <MaterialIcons name="qr-code-scanner" size={18} color={COLORS.textPrimary} />
                <Text style={styles.actionText}>Scan</Text>
              </TouchableOpacity>
            ) : null}
            {occurrence.status !== OccurrenceStatus.PLANNED && canViewDashboard ? (
              <TouchableOpacity
                accessibilityLabel={`Dashboard for ${occurrenceLabel(occurrence)}`}
                accessibilityRole="button"
                onPress={() => navigation.navigate('OccurrenceDashboard', {
                  eventId: occurrence.eventId,
                  occurrenceId: occurrence.occurrenceId,
                })}
                style={styles.actionButton}
              >
                <MaterialIcons name="insights" size={18} color={COLORS.textPrimary} />
                <Text style={styles.actionText}>Dashboard</Text>
              </TouchableOpacity>
            ) : null}
            {!closed ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled}
                onPress={() => setPending({ type: 'cancel', occurrence })}
                style={[styles.actionButton, styles.actionDanger, actionsDisabled && styles.disabled]}
              >
                <Text style={styles.actionDangerText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            {!closed ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled}
                onPress={() => {
                  setEditError(null);
                  setEditForm(isEditing ? null : {
                    occurrence,
                    selfServiceEnabled: Boolean(occurrence.selfServiceEnabled),
                    linkedOccurrenceRef: occurrence.linkedOccurrenceRef ?? null,
                  });
                }}
                style={[styles.actionButton, actionsDisabled && styles.disabled]}
              >
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} activities for ${occurrenceLabel(occurrence)}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              onPress={() => setExpanded((current) => ({ ...current, [occurrence.occurrenceId]: !isExpanded }))}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Activities</Text>
              <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={18} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
        {renderEditForm(occurrence)}
        {isExpanded ? renderActivityPanel(occurrence) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title={event?.eventName ?? 'Occurrences'}
        subtitle={event ? `${event.eventId} · Occurrences` : undefined}
        onBack={() => navigation.goBack()}
      />

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {isOffline ? (
            <StatusBanner kind="warning" message="Occurrence management requires a connection. Actions are disabled while offline." />
          ) : null}
          {toast ? <StatusBanner kind="info" message={toast} onDismiss={() => setToast(null)} /> : null}
          {banner ? (
            <StatusBanner
              kind={banner.kind}
              message={banner.message}
              onDismiss={() => setBanner(null)}
              primaryAction={!event ? { label: 'Retry', onPress: () => void load() } : undefined}
            />
          ) : null}

          {event ? (
            <View style={styles.definitionHeader}>
              <Text style={styles.definitionMeta}>
                {event.eventType} · {event.location} · Sequence {event.sequenceEnforced ? 'enforced' : 'not enforced'}
              </Text>
              <ActivityChipList activities={activities} />
            </View>
          ) : null}

          {event ? (
            <View style={styles.toolbar}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled || Boolean(createForm)}
                onPress={() => openCreate('single')}
                style={[styles.toolbarButton, (actionsDisabled || Boolean(createForm)) && styles.disabled]}
              >
                <MaterialIcons name="add" size={18} color={COLORS.primary} />
                <Text style={styles.toolbarButtonText}>New occurrence</Text>
              </TouchableOpacity>
              {event.eventType === EventType.REPEATING ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={actionsDisabled || Boolean(createForm)}
                  onPress={() => openCreate('range')}
                  style={[styles.toolbarButton, (actionsDisabled || Boolean(createForm)) && styles.disabled]}
                >
                  <MaterialIcons name="date-range" size={18} color={COLORS.primary} />
                  <Text style={styles.toolbarButtonText}>Generate for date range</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {renderCreateForm()}

          {event && occurrences.length === 0 ? (
            <Text style={styles.empty}>No occurrences yet for this event.</Text>
          ) : null}
          {occurrences.map(renderOccurrence)}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={Boolean(pending)}
        title={confirmContent.title}
        message={confirmContent.message}
        confirmLabel={confirmContent.label}
        cancelLabel="Back"
        confirmTone={pending?.type === 'cancel' ? 'danger' : 'primary'}
        isSubmitting={isConfirming || (pending?.type === 'complete' && pending.checking)}
        onCancel={() => {
          if (isConfirming) return;
          setPending(null);
          setCancelReason('');
        }}
        onConfirm={() => void confirmPending()}
      >
        {pending?.type === 'cancel' ? (
          <TextInput
            accessibilityLabel="Cancel reason (optional)"
            editable={!isConfirming}
            onChangeText={setCancelReason}
            placeholder="Reason (optional)"
            placeholderTextColor={COLORS.textDisabled}
            style={[styles.input, styles.reasonInput]}
            value={cancelReason}
          />
        ) : null}
      </ConfirmDialog>

      {event ? (
        <ActivityOverrideEditor
          visible={Boolean(overrideTarget && overrideOccurrence && overrideActivity)}
          event={event}
          activity={overrideActivity}
          occurrence={overrideOccurrence}
          typeOptions={typeOptions}
          isDesktop={isDesktop}
          isSubmitting={isSavingOverride}
          disabled={actionsDisabled || (overrideOccurrence ? isClosed(overrideOccurrence) : false)}
          errorMessage={overrideError}
          onSave={(request) => void saveOverride(request)}
          onClose={() => setOverrideTarget(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  centered: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  notFoundText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  content: { alignSelf: 'center', maxWidth: 1100, padding: 16, paddingBottom: 32, width: '100%' },
  definitionHeader: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    marginBottom: 12,
    padding: 14,
  },
  definitionMeta: { color: COLORS.textSecondary, fontSize: 13 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  toolbarButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  toolbarButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    padding: 14,
  },
  innerPanel: { borderTopColor: COLORS.borderLight, borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  panelTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  panelActions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  formCell: { flexBasis: 180, flexGrow: 1 },
  formCellSmall: { width: 100 },
  field: { marginTop: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
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
  inputError: { borderColor: COLORS.danger },
  reasonInput: { marginTop: 12 },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  inlineLoader: { alignSelf: 'flex-start', marginBottom: 6 },
  toggle: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 40 },
  toggleLabel: { color: COLORS.textPrimary, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textPrimary, fontSize: 13 },
  chipTextSelected: { color: COLORS.white, fontWeight: '600' },
  results: { gap: 4, marginTop: 12 },
  resultRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  resultText: { color: COLORS.textPrimary, fontSize: 13 },
  empty: { color: COLORS.textSecondary, paddingVertical: 24, textAlign: 'center' },
  occurrenceCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  occurrenceHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  occurrenceInfo: { flexBasis: 220, flexGrow: 1, gap: 4 },
  occurrenceTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  occurrenceTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  metaText: { color: COLORS.textSecondary, fontSize: 12 },
  infoBadge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  occurrenceActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionButton: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  actionText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  actionPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionPrimaryText: { color: COLORS.white, fontSize: 13, fontWeight: '700' },
  actionDanger: { borderColor: COLORS.danger },
  actionDangerText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  activityRow: {
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    gap: 6,
    paddingVertical: 8,
  },
  activityRowDesktop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  activityInfo: { flex: 1, gap: 4, minWidth: 0 },
  activityName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  activityNameDisabled: { color: COLORS.textDisabled, textDecorationLine: 'line-through' },
  overrideBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  noteText: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
  activityControls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  smallButton: {
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  smallButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  secondaryButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  secondaryButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 110,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
