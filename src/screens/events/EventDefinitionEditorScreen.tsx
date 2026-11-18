/**
 * Event definition editor (MANAGE_EVENTS). Web-first: at ≥ DESKTOP_MIN_WIDTH
 * event fields sit in a left rail beside an activity table; below that the
 * activities are expandable cards. Reorder with Move up/down (no drag-drop).
 * Online-only. See docs/Event-Engine-Design.md § Screens.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { EVENT_VALIDATION_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import {
  createEvent,
  describeUnexpectedEventError,
  EventApiError,
  getEvent,
  updateEvent,
} from '../../services/api/eventsApi';
import { listNotificationRules } from '../../services/api/notificationRuleApi';
import { CreateEventRequest, EventActivityInput, NotificationRule, UpdateEventRequest } from '../../types/api';
import { IdCodeTypeConfig } from '../../types/config';
import { EventActivity, EventDefinition, EventType, Permission } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { nextActivityId, recomputeSequence } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import { hasPermission } from '../../utils/permissions';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import StatusBanner from '../../components/events/StatusBanner';
import TypeCodeMultiSelect, { useIdCodeTypeOptions } from '../../components/events/TypeCodeMultiSelect';

const TAG = 'EventDefinitionEditorScreen';
const EVENT_ID_PATTERN = /^EVT-[A-Z0-9]{2,20}$/;

interface EventDefinitionEditorScreenProps {
  eventId?: string;
  mode?: 'view' | 'edit';
  navigation: NativeStackNavigationProp<AppStackParamList, 'EventDefinitionEditor'>;
}

interface EventForm {
  eventId: string;
  eventName: string;
  eventType: EventType;
  location: string;
  sequenceEnforced: boolean;
  registrationEnabled: boolean;
  selfServiceAllowed: boolean;
  defaultAllowedTypeCodes: string[];
  completionNotifyEnabled: boolean;
  completionRuleId: string;
  reminderEnabled: boolean;
  reminderRuleId: string;
}

interface ActivityDraft extends EventActivity {
  isNew: boolean;
  variantText: string;
}

type FieldErrors = Record<string, string>;

const EMPTY_FORM: EventForm = {
  eventId: 'EVT-',
  eventName: '',
  eventType: EventType.SINGLE,
  location: '',
  sequenceEnforced: false,
  registrationEnabled: false,
  selfServiceAllowed: false,
  defaultAllowedTypeCodes: [],
  completionNotifyEnabled: false,
  completionRuleId: '',
  reminderEnabled: false,
  reminderRuleId: '',
};

function toDraft(activity: Partial<EventActivity> & Pick<EventActivity, 'activityId'>, isNew: boolean): ActivityDraft {
  const variantOptions = activity.variantOptions ?? [];
  return {
    activityId: activity.activityId,
    name: activity.name ?? '',
    sequenceNo: activity.sequenceNo ?? 0,
    enabled: activity.enabled ?? true,
    mandatory: activity.mandatory ?? false,
    allowedTypeCodes: activity.allowedTypeCodes ?? [],
    allowOptOut: activity.allowOptOut ?? false,
    prerequisiteActivityIds: activity.prerequisiteActivityIds ?? [],
    restrictToAssignedUsers: activity.restrictToAssignedUsers ?? true,
    variantOptions,
    notes: activity.notes ?? '',
    selfServiceAllowed: activity.selfServiceAllowed,
    isNew,
    variantText: variantOptions.join(', '),
  };
}

function parseVariants(text: string): string[] {
  return [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))];
}

function toActivityInputs(drafts: ActivityDraft[]): EventActivityInput[] {
  return recomputeSequence(drafts).map((draft) => ({
    activityId: draft.activityId,
    name: draft.name.trim(),
    sequenceNo: draft.sequenceNo,
    enabled: draft.enabled,
    mandatory: draft.mandatory,
    allowedTypeCodes: draft.allowedTypeCodes,
    allowOptOut: draft.allowOptOut,
    prerequisiteActivityIds: draft.prerequisiteActivityIds,
    restrictToAssignedUsers: draft.restrictToAssignedUsers,
    variantOptions: parseVariants(draft.variantText),
    notes: draft.notes.trim(),
    selfServiceAllowed: draft.selfServiceAllowed,
  }));
}

function toEventForm(event: EventDefinition): EventForm {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    eventType: event.eventType,
    location: event.location,
    sequenceEnforced: event.sequenceEnforced,
    registrationEnabled: Boolean(event.registrationEnabled),
    selfServiceAllowed: Boolean(event.selfServiceAllowed),
    defaultAllowedTypeCodes: event.defaultAllowedTypeCodes ?? [],
    completionNotifyEnabled: Boolean(event.notificationConfig?.completionNotifyEnabled),
    completionRuleId: event.notificationConfig?.completionRuleId ?? '',
    reminderEnabled: Boolean(event.notificationConfig?.reminderEnabled),
    reminderRuleId: event.notificationConfig?.reminderRuleId ?? '',
  };
}

function validate(form: EventForm, drafts: ActivityDraft[], isCreate: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (isCreate && !EVENT_ID_PATTERN.test(form.eventId.trim())) errors.eventId = EVENT_VALIDATION_MESSAGES.EVENT_ID_FORMAT;
  if (!form.eventName.trim()) errors.eventName = EVENT_VALIDATION_MESSAGES.EVENT_NAME_REQUIRED;
  if (!form.location.trim()) errors.location = EVENT_VALIDATION_MESSAGES.LOCATION_REQUIRED;
  if (form.completionNotifyEnabled && !form.completionRuleId.trim()) {
    errors.completionRuleId = 'Select a completion rule.';
  }
  if (form.reminderEnabled && !form.reminderRuleId.trim()) {
    errors.reminderRuleId = 'Select a reminder rule.';
  }
  if (drafts.length === 0) errors.activities = EVENT_VALIDATION_MESSAGES.ACTIVITIES_REQUIRED;

  drafts.forEach((draft, index) => {
    const key = draft.activityId;
    if (!draft.name.trim()) errors[`${key}.name`] = EVENT_VALIDATION_MESSAGES.ACTIVITY_NAME_REQUIRED;
    const earlierIds = new Set(drafts.slice(0, index).map((item) => item.activityId));
    if (draft.prerequisiteActivityIds.some((id) => !earlierIds.has(id))) {
      errors[`${key}.prerequisites`] = EVENT_VALIDATION_MESSAGES.PREREQUISITE_ORDER;
    }
    if (parseVariants(draft.variantText).length === 1) {
      errors[`${key}.variants`] = EVENT_VALIDATION_MESSAGES.VARIANT_OPTIONS_MIN;
    }
    if (draft.allowedTypeCodes.length === 0 && form.defaultAllowedTypeCodes.length === 0) {
      errors[`${key}.types`] = EVENT_VALIDATION_MESSAGES.ALLOWED_TYPES_REQUIRED;
    }
  });
  return errors;
}

function buildUpdate(original: EventDefinition, form: EventForm, activities: EventActivityInput[]): UpdateEventRequest {
  const changes: UpdateEventRequest = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (form.eventName.trim() !== original.eventName) changes.eventName = form.eventName.trim();
  if (form.eventType !== original.eventType) changes.eventType = form.eventType;
  if (form.location.trim() !== original.location) changes.location = form.location.trim();
  if (form.sequenceEnforced !== original.sequenceEnforced) changes.sequenceEnforced = form.sequenceEnforced;
  if (form.registrationEnabled !== Boolean(original.registrationEnabled)) changes.registrationEnabled = form.registrationEnabled;
  if (form.selfServiceAllowed !== Boolean(original.selfServiceAllowed)) changes.selfServiceAllowed = form.selfServiceAllowed;
  const currentNotificationConfig = {
    completionNotifyEnabled: form.completionNotifyEnabled,
    completionRuleId: form.completionRuleId.trim() || undefined,
    reminderEnabled: form.reminderEnabled,
    reminderRuleId: form.reminderRuleId.trim() || undefined,
  };
  const originalNotificationConfig = {
    completionNotifyEnabled: Boolean(original.notificationConfig?.completionNotifyEnabled),
    completionRuleId: original.notificationConfig?.completionRuleId || undefined,
    reminderEnabled: Boolean(original.notificationConfig?.reminderEnabled),
    reminderRuleId: original.notificationConfig?.reminderRuleId || undefined,
  };
  if (!same(currentNotificationConfig, originalNotificationConfig)) changes.notificationConfig = currentNotificationConfig;
  if (!same(form.defaultAllowedTypeCodes, original.defaultAllowedTypeCodes ?? [])) {
    changes.defaultAllowedTypeCodes = form.defaultAllowedTypeCodes;
  }
  const originalActivities = toActivityInputs(original.activities.map((activity) => toDraft(activity, false)));
  if (!same(activities, originalActivities)) changes.activities = activities;
  return changes;
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  placeholder?: string;
  editable?: boolean;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'sentences';
}

function TextField({ label, value, onChangeText, error, placeholder, editable = true, multiline, autoCapitalize }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        editable={editable}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, multiline && styles.multiline, !editable && styles.inputReadOnly, error ? styles.inputError : null]}
        value={value}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

function ToggleField({ label, value, onChange, disabled }: ToggleFieldProps) {
  return (
    <View style={styles.toggle}>
      <Switch accessibilityLabel={label} disabled={disabled} onValueChange={onChange} value={value} />
      <Text style={styles.toggleLabel}>{label}</Text>
    </View>
  );
}

interface RuleSelectorFieldProps {
  label: string;
  value: string;
  rules: NotificationRule[];
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}

function RuleSelectorField({ label, value, rules, disabled, error, onChange }: RuleSelectorFieldProps) {
  const [open, setOpen] = useState(false);
  const options = rules.filter((rule) => rule.enabled);
  const selected = value.trim();
  const choices = [{ ruleId: '', text: 'None' }, ...options.map((rule) => ({ ruleId: rule.ruleId, text: rule.ruleId }))];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        accessibilityLabel={`${label}: ${selected || 'None'}`}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.dropdown, disabled && styles.dropdownDisabled, error ? styles.inputError : null]}
      >
        <Text style={styles.dropdownText}>{selected || 'None'}</Text>
        <MaterialIcons name="arrow-drop-down" size={22} color={COLORS.textSecondary} />
      </TouchableOpacity>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <TouchableOpacity accessibilityLabel="Close" style={styles.dropdownBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.sectionLabel}>{label}</Text>
            <ScrollView>
              {choices.map((choice) => {
                const isSelected = selected === choice.ruleId;
                return (
                  <TouchableOpacity
                    key={choice.ruleId || 'none'}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onChange(choice.ruleId);
                      setOpen(false);
                    }}
                    style={styles.dropdownOption}
                  >
                    <Text style={[styles.dropdownText, isSelected && styles.chipTextSelectedAccent]}>{choice.text}</Text>
                    {isSelected ? <MaterialIcons name="check" size={18} color={COLORS.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      {options.length === 0 ? <Text style={styles.hint}>No enabled notification rules available.</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

interface ActivityFieldsProps {
  draft: ActivityDraft;
  earlier: ActivityDraft[];
  errors: FieldErrors;
  typeOptions: IdCodeTypeConfig[];
  inheritedCodes: string[];
  wide: boolean;
  disabled: boolean;
  onChange: (patch: Partial<ActivityDraft>) => void;
}

const SELF_SERVICE_OPTIONS = [
  { value: undefined, label: 'Follow event' },
  { value: true, label: 'Allowed' },
  { value: false, label: 'Not allowed' },
];
// Approximate glyph width at 13px plus horizontal padding.
const SELF_SERVICE_SEGMENT_WIDTH =
  Math.max(...SELF_SERVICE_OPTIONS.map((option) => option.label.length)) * 7.5 + 24;

function ActivityFields({ draft, earlier, errors, typeOptions, inheritedCodes, wide, disabled, onChange }: ActivityFieldsProps) {
  const key = draft.activityId;
  const togglePrerequisite = (id: string) => {
    const selected = draft.prerequisiteActivityIds.includes(id);
    onChange({
      prerequisiteActivityIds: selected
        ? draft.prerequisiteActivityIds.filter((item) => item !== id)
        : [...draft.prerequisiteActivityIds, id],
    });
  };
  const stalePrerequisites = draft.prerequisiteActivityIds.filter((id) => !earlier.some((item) => item.activityId === id));

  return (
    <View>
      <View style={styles.toggleRow}>
        <ToggleField label="Enabled" value={draft.enabled} onChange={(enabled) => onChange({ enabled })} disabled={disabled} />
        <ToggleField label="Mandatory" value={draft.mandatory} onChange={(mandatory) => onChange({ mandatory })} disabled={disabled} />
        <ToggleField label="Allow opt-out" value={draft.allowOptOut} onChange={(allowOptOut) => onChange({ allowOptOut })} disabled={disabled} />
        <ToggleField
          label="Assigned users only"
          value={draft.restrictToAssignedUsers}
          onChange={(restrictToAssignedUsers) => onChange({ restrictToAssignedUsers })}
          disabled={disabled}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Self-service</Text>
        <View style={[styles.segmented, styles.segmentedCompact]}>
          {SELF_SERVICE_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected: draft.selfServiceAllowed === option.value, disabled }}
              disabled={disabled}
              onPress={() => onChange({ selfServiceAllowed: option.value })}
              style={[styles.segment, styles.segmentFixed, draft.selfServiceAllowed === option.value && styles.segmentSelected]}
            >
              <Text numberOfLines={1} style={[styles.segmentText, draft.selfServiceAllowed === option.value && styles.segmentTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={wide ? styles.columns : undefined}>
        <View style={wide ? styles.column : undefined}>
          <TypeCodeMultiSelect
            label="Allowed ID types"
            options={typeOptions}
            value={draft.allowedTypeCodes}
            inheritedCodes={inheritedCodes}
            onChange={(allowedTypeCodes) => onChange({ allowedTypeCodes })}
            error={errors[`${key}.types`]}
            disabled={disabled}
          />
        </View>
        <View style={wide ? styles.column : undefined}>
          <View style={styles.field}>
            <Text style={styles.label}>Prerequisites (earlier activities)</Text>
            <View style={styles.chips}>
              {earlier.length === 0 && stalePrerequisites.length === 0 ? (
                <Text style={styles.hint}>None available — this is the first activity.</Text>
              ) : null}
              {[...earlier.map((item) => ({ id: item.activityId, text: `${item.activityId} ${item.name}`.trim() })),
                ...stalePrerequisites.map((id) => ({ id, text: `${id} (not earlier)` }))].map((item) => {
                const selected = draft.prerequisiteActivityIds.includes(item.id);
                return (
                  <TouchableOpacity
                    key={item.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled }}
                    disabled={disabled}
                    onPress={() => togglePrerequisite(item.id)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.text}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {errors[`${key}.prerequisites`] ? <Text style={styles.errorText}>{errors[`${key}.prerequisites`]}</Text> : null}
          </View>
        </View>
      </View>
      <View style={wide ? styles.columns : undefined}>
        <View style={wide ? styles.column : undefined}>
          <TextField
            label="Variant options (comma-separated)"
            value={draft.variantText}
            onChangeText={(variantText) => onChange({ variantText })}
            placeholder="e.g. VEG, NON_VEG"
            autoCapitalize="characters"
            error={errors[`${key}.variants`]}
            editable={!disabled}
          />
        </View>
        <View style={wide ? styles.column : undefined}>
          <TextField
            label="Notes"
            value={draft.notes}
            onChangeText={(notes) => onChange({ notes })}
            placeholder="Staff instructions"
            editable={!disabled}
          />
        </View>
      </View>
    </View>
  );
}

interface IconButtonProps {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function IconButton({ icon, label, onPress, disabled, danger }: IconButtonProps) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, disabled && styles.disabled]}
    >
      <MaterialIcons name={icon} size={22} color={danger ? COLORS.danger : COLORS.textPrimary} />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function EventDefinitionEditorScreen({ eventId, mode, navigation }: EventDefinitionEditorScreenProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const { user } = useAuth();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const typeOptions = useIdCodeTypeOptions();
  const isCreate = !eventId;
  const tourId = tour?.tourId;
  const [isViewMode, setIsViewMode] = useState(!isCreate && mode === 'view');
  const canEdit = !isOffline && (user ? hasPermission(user.userRole, Permission.MANAGE_EVENTS) : false);

  const [original, setOriginal] = useState<EventDefinition | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const [drafts, setDrafts] = useState<ActivityDraft[]>([]);
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ kind: EventMessageKind; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(!isCreate);
  const [isSaving, setIsSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!eventId || !tourId) return;
    setIsLoading(true);
    setBanner(null);
    try {
      const [outcome, rulesOutcome] = await Promise.all([
        getEvent(tourId, eventId),
        listNotificationRules(),
      ]);
      if (outcome.kind === 'error') {
        if (outcome.error.status === 404) setNotFound(true);
        else setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      const sortedActivities = [...(outcome.data.activities ?? [])].sort((a, b) => a.sequenceNo - b.sequenceNo);
      setOriginal({ ...outcome.data, activities: sortedActivities });
      setForm(toEventForm(outcome.data));
      setDrafts(sortedActivities.map((activity) => toDraft(activity, false)));
      if (rulesOutcome.kind === 'success') {
        setNotificationRules(rulesOutcome.data);
      }
    } catch (err) {
      logger.error(TAG, 'Loading event failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsLoading(false);
    }
  }, [eventId, tourId]);

  useEffect(() => {
    if (!isOffline) void load();
  }, [isOffline, load]);

  useEffect(() => {
    if (!isCreate || isOffline) return;
    let cancelled = false;
    void listNotificationRules().then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === 'success') {
        setNotificationRules(outcome.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isCreate, isOffline]);

  const setField = <K extends keyof EventForm>(key: K, value: EventForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateDraft = (activityId: string, patch: Partial<ActivityDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.activityId === activityId ? { ...draft, ...patch } : draft)));
  };

  const addActivity = () => {
    const activityId = nextActivityId(drafts);
    setDrafts((current) => recomputeSequence([...current, toDraft({ activityId }, true)]));
    setExpanded((state) => ({ ...state, [activityId]: true }));
    setErrors((current) => {
      if (!current.activities) return current;
      const next = { ...current };
      delete next.activities;
      return next;
    });
  };

  const moveActivity = (index: number, direction: -1 | 1) => {
    setDrafts((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return recomputeSequence(next);
    });
  };

  const removeActivity = (activityId: string) => {
    setDrafts((current) => recomputeSequence(
      current
        .filter((draft) => draft.activityId !== activityId)
        .map((draft) => ({
          ...draft,
          prerequisiteActivityIds: draft.prerequisiteActivityIds.filter((id) => id !== activityId),
        })),
    ));
  };

  const applyServerError = (error: EventApiError) => {
    if (error.status === 404 && error.code === 'EVENT_NOT_FOUND') {
      setNotFound(true);
      return;
    }
    if (error.code === 'EVENT_ALREADY_EXISTS') {
      setErrors((current) => ({ ...current, eventId: error.message }));
      return;
    }
    setBanner({ kind: error.kind, message: error.message });
  };

  const handleSave = async () => {
    if (!tourId || isOffline) return;
    const validationErrors = validate(form, drafts, isCreate);
    setErrors(validationErrors);
    setBanner(null);
    if (Object.keys(validationErrors).length > 0) {
      const invalidActivities = drafts.filter((draft) => Object.keys(validationErrors).some((key) => key.startsWith(`${draft.activityId}.`)));
      if (invalidActivities.length > 0) {
        setExpanded((state) => ({ ...state, ...Object.fromEntries(invalidActivities.map((draft) => [draft.activityId, true])) }));
      }
      setBanner({ kind: 'error', message: 'Please fix the highlighted fields.' });
      return;
    }

    const activities = toActivityInputs(drafts);
    setIsSaving(true);
    try {
      if (isCreate) {
        const request: CreateEventRequest = {
          eventId: form.eventId.trim(),
          eventName: form.eventName.trim(),
          eventType: form.eventType,
          location: form.location.trim(),
          sequenceEnforced: form.sequenceEnforced,
          registrationEnabled: form.registrationEnabled,
          selfServiceAllowed: form.selfServiceAllowed,
          notificationConfig: {
            completionNotifyEnabled: form.completionNotifyEnabled,
            completionRuleId: form.completionRuleId.trim() || undefined,
            reminderEnabled: form.reminderEnabled,
            reminderRuleId: form.reminderRuleId.trim() || undefined,
          },
          defaultAllowedTypeCodes: form.defaultAllowedTypeCodes,
          activities,
        };
        const outcome = await createEvent(tourId, request);
        if (outcome.kind === 'error') {
          applyServerError(outcome.error);
          return;
        }
      } else if (original) {
        const changes = buildUpdate(original, form, activities);
        if (Object.keys(changes).length === 0) {
          setBanner({ kind: 'info', message: 'No changes to save.' });
          return;
        }
        const outcome = await updateEvent(tourId, original.eventId, changes);
        if (outcome.kind === 'error') {
          applyServerError(outcome.error);
          return;
        }
      }
      navigation.goBack();
    } catch (err) {
      logger.error(TAG, 'Saving event failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsSaving(false);
    }
  };

  const title = isCreate ? 'New Event' : original?.eventName ?? (isViewMode ? 'View Event' : 'Edit Event');
  const inputsDisabled = isViewMode || isOffline || isSaving;

  const eventFields = (
    <View>
      <TextField
        label="Event ID"
        value={form.eventId}
        onChangeText={(value) => setField('eventId', value.toUpperCase())}
        editable={isCreate && !inputsDisabled}
        autoCapitalize="characters"
        placeholder="EVT-BAGLOAD"
        error={errors.eventId}
      />
      <TextField
        label="Event name"
        value={form.eventName}
        onChangeText={(value) => setField('eventName', value)}
        editable={!inputsDisabled}
        error={errors.eventName}
      />
      <View style={styles.field}>
        <Text style={styles.label}>Event type</Text>
        <View style={styles.segmented}>
          {[EventType.SINGLE, EventType.REPEATING].map((type) => (
            <TouchableOpacity
              key={type}
              accessibilityRole="radio"
              accessibilityState={{ selected: form.eventType === type }}
              disabled={inputsDisabled}
              onPress={() => setField('eventType', type)}
              style={[styles.segment, form.eventType === type && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, form.eventType === type && styles.segmentTextSelected]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <TextField
        label="Location"
        value={form.location}
        onChangeText={(value) => setField('location', value)}
        editable={!inputsDisabled}
        error={errors.location}
      />
      <ToggleField
        label="Sequence enforced"
        value={form.sequenceEnforced}
        onChange={(value) => setField('sequenceEnforced', value)}
        disabled={inputsDisabled}
      />
      <ToggleField
        label="Registration required"
        value={form.registrationEnabled}
        onChange={(value) => setField('registrationEnabled', value)}
        disabled={inputsDisabled}
      />
      <Text style={styles.hint}>When off, all riders on the tour are treated as registered.</Text>
      <ToggleField
        label="Riders may self-serve"
        value={form.selfServiceAllowed}
        onChange={(value) => setField('selfServiceAllowed', value)}
        disabled={inputsDisabled}
      />
      <View style={styles.sectionDivider} />
      <Text style={styles.sectionLabel}>Notification configuration</Text>
      <ToggleField
        label="Completion notifications"
        value={form.completionNotifyEnabled}
        onChange={(value) => setField('completionNotifyEnabled', value)}
        disabled={inputsDisabled}
      />
      <RuleSelectorField
        label="Completion rule"
        value={form.completionRuleId}
        rules={notificationRules}
        disabled={inputsDisabled || !form.completionNotifyEnabled}
        error={errors.completionRuleId}
        onChange={(value) => setField('completionRuleId', value)}
      />
      <ToggleField
        label="Reminders"
        value={form.reminderEnabled}
        onChange={(value) => setField('reminderEnabled', value)}
        disabled={inputsDisabled}
      />
      <RuleSelectorField
        label="Reminder rule"
        value={form.reminderRuleId}
        rules={notificationRules}
        disabled={inputsDisabled || !form.reminderEnabled}
        error={errors.reminderRuleId}
        onChange={(value) => setField('reminderRuleId', value)}
      />
      <View style={styles.spacer} />
      <TypeCodeMultiSelect
        label="Default allowed ID types"
        options={typeOptions}
        value={form.defaultAllowedTypeCodes}
        onChange={(codes) => setField('defaultAllowedTypeCodes', codes)}
        disabled={inputsDisabled}
      />
    </View>
  );

  const renderActivity = (draft: ActivityDraft, index: number) => {
    const earlier = drafts.slice(0, index);
    const nameError = errors[`${draft.activityId}.name`];
    const actions = isViewMode ? null : (
      <View style={styles.rowActions}>
        <IconButton icon="arrow-upward" label={`Move ${draft.name || draft.activityId} up`} disabled={index === 0} onPress={() => moveActivity(index, -1)} />
        <IconButton icon="arrow-downward" label={`Move ${draft.name || draft.activityId} down`} disabled={index === drafts.length - 1} onPress={() => moveActivity(index, 1)} />
        {draft.isNew ? (
          <IconButton icon="delete-outline" label={`Remove ${draft.name || draft.activityId}`} danger onPress={() => removeActivity(draft.activityId)} />
        ) : null}
      </View>
    );
    const fields = (
      <ActivityFields
        draft={draft}
        earlier={earlier}
        errors={errors}
        typeOptions={typeOptions}
        inheritedCodes={form.defaultAllowedTypeCodes}
        wide={isDesktop}
        disabled={inputsDisabled}
        onChange={(patch) => updateDraft(draft.activityId, patch)}
      />
    );

    if (isDesktop) {
      return (
        <View key={draft.activityId} style={styles.tableRow}>
          <View style={styles.tableRowHeader}>
            <Text style={styles.seqCell}>{draft.sequenceNo}</Text>
            <Text style={styles.idCell}>{draft.activityId}</Text>
            <View style={styles.nameCell}>
              <TextInput
                accessibilityLabel={`Name of ${draft.activityId}`}
                editable={!inputsDisabled}
                onChangeText={(name) => updateDraft(draft.activityId, { name })}
                placeholder="Activity name"
                placeholderTextColor={COLORS.textDisabled}
                style={[styles.input, inputsDisabled && styles.inputReadOnly, nameError ? styles.inputError : null]}
                value={draft.name}
              />
              {nameError ? <Text style={styles.errorText}>{nameError}</Text> : null}
            </View>
            {actions}
          </View>
          {fields}
        </View>
      );
    }

    const isExpanded = Boolean(expanded[draft.activityId]);
    return (
      <View key={draft.activityId} style={styles.card}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
          onPress={() => setExpanded((state) => ({ ...state, [draft.activityId]: !isExpanded }))}
          style={styles.cardHeader}
        >
          <Text style={styles.seqCell}>{draft.sequenceNo}</Text>
          <View style={styles.cardTitleWrap}>
            <Text style={[styles.cardTitle, !draft.name && styles.placeholderText]} numberOfLines={1}>
              {draft.name || 'Unnamed activity'}
            </Text>
            <View style={styles.badges}>
              <Text style={[styles.badge, draft.enabled ? styles.badgeOn : styles.badgeOff]}>{draft.enabled ? 'Enabled' : 'Disabled'}</Text>
              {draft.mandatory ? <Text style={[styles.badge, styles.badgeMandatory]}>Mandatory</Text> : null}
            </View>
          </View>
          <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={24} color={COLORS.textSecondary} />
        </TouchableOpacity>
        {isExpanded ? (
          <View style={styles.cardBody}>
            <TextField
              label={`Name (${draft.activityId})`}
              value={draft.name}
              onChangeText={(name) => updateDraft(draft.activityId, { name })}
              error={nameError}
              editable={!inputsDisabled}
            />
            {fields}
            {actions}
          </View>
        ) : null}
      </View>
    );
  };

  const activitySection = (
    <View>
      <View style={styles.activitiesHeader}>
        <Text style={styles.sectionTitle}>Activities</Text>
        {isViewMode ? null : (
          <TouchableOpacity accessibilityRole="button" disabled={inputsDisabled} onPress={addActivity} style={[styles.addButton, inputsDisabled && styles.disabled]}>
            <MaterialIcons name="add" size={18} color={COLORS.primary} />
            <Text style={styles.addButtonText}>Add Activity</Text>
          </TouchableOpacity>
        )}
      </View>
      {errors.activities ? <Text style={styles.errorText}>{errors.activities}</Text> : null}
      {drafts.length === 0 ? <Text style={styles.hint}>No activities yet.</Text> : null}
      {drafts.map(renderActivity)}
    </View>
  );

  if (notFound) {
    return (
      <View style={styles.container}>
        <EventScreenHeader title="Event" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="event-busy" size={48} color={COLORS.textSecondary} />
          <Text style={styles.notFoundText}>This event no longer exists. It may have been removed elsewhere.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to event list</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <EventScreenHeader title={title} subtitle={isCreate ? tour?.name : original?.eventId} onBack={() => navigation.goBack()} />

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <>
          <View style={styles.banners}>
            {isOffline ? <StatusBanner kind="warning" message="Event definitions require a connection to edit." /> : null}
            {banner ? (
              <StatusBanner
                kind={banner.kind}
                message={banner.message}
                onDismiss={() => setBanner(null)}
                primaryAction={!isCreate && !original ? { label: 'Retry', onPress: () => void load() } : undefined}
              />
            ) : null}
          </View>

          {isDesktop ? (
            <View style={styles.desktopBody}>
              <ScrollView style={styles.rail} contentContainerStyle={styles.railContent}>{eventFields}</ScrollView>
              <ScrollView style={styles.main} contentContainerStyle={styles.mainContent}>{activitySection}</ScrollView>
            </View>
          ) : (
            <ScrollView style={styles.main} contentContainerStyle={styles.mobileContent}>
              {eventFields}
              {activitySection}
            </ScrollView>
          )}

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.cancelButton}>
              <Text style={styles.cancelText}>{isViewMode ? 'Close' : 'Cancel'}</Text>
            </TouchableOpacity>
            {isViewMode ? (
              canEdit && original ? (
                <TouchableOpacity
                  accessibilityLabel={`Edit ${original.eventName}`}
                  accessibilityRole="button"
                  onPress={() => setIsViewMode(false)}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Edit</Text>
                </TouchableOpacity>
              ) : null
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={inputsDisabled || (!isCreate && !original)}
                onPress={() => void handleSave()}
                style={[styles.primaryButton, (inputsDisabled || (!isCreate && !original)) && styles.disabled]}
              >
                {isSaving ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>{isCreate ? 'Create event' : 'Save changes'}</Text>}
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  centered: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  notFoundText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  banners: { paddingHorizontal: 16, paddingTop: 12 },
  desktopBody: { flex: 1, flexDirection: 'row' },
  rail: { backgroundColor: COLORS.surface, borderRightColor: COLORS.border, borderRightWidth: 1, maxWidth: 360, width: 340 },
  railContent: { padding: 16 },
  main: { flex: 1 },
  mainContent: { padding: 16 },
  mobileContent: { padding: 16, paddingBottom: 32 },
  field: { marginBottom: 12 },
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
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  inputReadOnly: { backgroundColor: COLORS.gray[100], color: COLORS.textSecondary },
  inputError: { borderColor: COLORS.danger },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
  sectionDivider: { borderTopColor: COLORS.borderLight, borderTopWidth: 1, marginVertical: 8 },
  sectionLabel: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  spacer: { height: 8 },
  segmented: { backgroundColor: COLORS.gray[200], borderRadius: 6, flexDirection: 'row', padding: 3 },
  segment: { alignItems: 'center', borderRadius: 4, flex: 1, justifyContent: 'center', minHeight: 38 },
  segmentedCompact: { alignSelf: 'flex-start', flexGrow: 0, flexShrink: 0, width: SELF_SERVICE_SEGMENT_WIDTH * SELF_SERVICE_OPTIONS.length + 6 },
  segmentFixed: { flexBasis: SELF_SERVICE_SEGMENT_WIDTH, flexGrow: 0, flexShrink: 0, minHeight: 32, width: SELF_SERVICE_SEGMENT_WIDTH },
  dropdown: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  dropdownDisabled: { backgroundColor: COLORS.gray[100], opacity: 0.6 },
  dropdownText: { color: COLORS.textPrimary, fontSize: 14 },
  dropdownBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: 24 },
  dropdownSheet: { backgroundColor: COLORS.surface, borderRadius: 8, maxHeight: '70%', maxWidth: 420, padding: 16, width: '100%' },
  dropdownOption: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
  chipTextSelectedAccent: { color: COLORS.primary, fontWeight: '700' },
  segmentSelected: { backgroundColor: COLORS.surface },
  segmentText: { color: COLORS.textSecondary, fontSize: 13 },
  segmentTextSelected: { color: COLORS.primary, fontWeight: '700' },
  toggle: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 40 },
  toggleLabel: { color: COLORS.textPrimary, fontSize: 14 },
  toggleRow: { columnGap: 20, flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  columns: { flexDirection: 'row', gap: 16 },
  column: { flex: 1, minWidth: 0 },
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
  activitiesHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, marginTop: 8 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  addButton: {
    alignItems: 'center',
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  addButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  tableRow: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  tableRowHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, marginBottom: 8 },
  seqCell: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '700', minWidth: 24, paddingTop: 10, textAlign: 'center' },
  idCell: { color: COLORS.textSecondary, fontSize: 13, minWidth: 64, paddingTop: 12 },
  nameCell: { flex: 1 },
  rowActions: { flexDirection: 'row', gap: 4, justifyContent: 'flex-end' },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  disabled: { opacity: 0.4 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 },
  cardTitleWrap: { flex: 1, gap: 4, minWidth: 0 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },
  placeholderText: { color: COLORS.textDisabled, fontStyle: 'italic' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: { borderRadius: 10, fontSize: 11, fontWeight: '600', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2 },
  badgeOn: { backgroundColor: COLORS.gray[100], color: COLORS.success },
  badgeOff: { backgroundColor: COLORS.gray[100], color: COLORS.textSecondary },
  badgeMandatory: { backgroundColor: COLORS.gray[100], color: COLORS.warning },
  cardBody: { borderTopColor: COLORS.borderLight, borderTopWidth: 1, padding: 12 },
  footer: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    padding: 12,
  },
  cancelButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
});
