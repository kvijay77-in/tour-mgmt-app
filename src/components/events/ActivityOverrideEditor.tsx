import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { EVENT_VALIDATION_MESSAGES } from '../../constants/eventMessages';
import { UpsertActivityOverrideRequest } from '../../types/api';
import { IdCodeTypeConfig } from '../../types/config';
import { EventActivity, EventDefinition, EventOccurrence } from '../../types/models';
import { findActivityOverride, getEffectiveSelfServiceAllowed } from '../../utils/eventActivity';
import StatusBanner from './StatusBanner';
import TypeCodeMultiSelect, { formatTypeCodeNames } from './TypeCodeMultiSelect';

type TriState = 'inherit' | 'on' | 'off';

export interface ActivityOverrideEditorProps {
  visible: boolean;
  event: EventDefinition;
  activity: EventActivity | null;
  occurrence: EventOccurrence | null;
  typeOptions: IdCodeTypeConfig[];
  /** Side panel at ≥ DESKTOP_MIN_WIDTH, full-screen sheet below. */
  isDesktop: boolean;
  isSubmitting: boolean;
  /** Closed occurrence or offline */
  disabled?: boolean;
  errorMessage?: string | null;
  onSave: (request: UpsertActivityOverrideRequest) => void;
  onClose: () => void;
}

function toTriState(value: boolean | null | undefined): TriState {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return 'inherit';
}

function fromTriState(value: TriState): boolean | null {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

interface TriStateFieldProps {
  label: string;
  value: TriState;
  inheritedValue: boolean;
  disabled: boolean;
  onChange: (value: TriState) => void;
  inheritLabel?: string;
  onLabel?: string;
  offLabel?: string;
}

function TriStateField({
  label,
  value,
  inheritedValue,
  disabled,
  onChange,
  inheritLabel = `Inherit (${inheritedValue ? 'On' : 'Off'})`,
  onLabel = 'On',
  offLabel = 'Off',
}: TriStateFieldProps) {
  const options: Array<{ key: TriState; text: string }> = [
    { key: 'inherit', text: inheritLabel },
    { key: 'on', text: onLabel },
    { key: 'off', text: offLabel },
  ];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((option) => (
          <TouchableOpacity
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option.key, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.key)}
            style={[styles.segment, value === option.key && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, value === option.key && styles.segmentTextSelected]}>
              {option.text}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ActivityOverrideEditor({
  visible,
  event,
  activity,
  occurrence,
  typeOptions,
  isDesktop,
  isSubmitting,
  disabled = false,
  errorMessage,
  onSave,
  onClose,
}: ActivityOverrideEditorProps) {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState<TriState>('inherit');
  const [selfService, setSelfService] = useState<TriState>('inherit');
  const [skipped, setSkipped] = useState<TriState>('inherit');
  const [narrowTypes, setNarrowTypes] = useState(false);
  const [typeCodes, setTypeCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [typesError, setTypesError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !activity) return;
    const override = findActivityOverride(occurrence, activity.activityId);
    setEnabled(toTriState(override?.enabled));
    setSelfService(toTriState(override?.selfServiceAllowed));
    setSkipped(toTriState(override?.skipped));
    setNarrowTypes(Array.isArray(override?.allowedTypeCodes));
    setTypeCodes(override?.allowedTypeCodes ?? []);
    setNote(override?.note ?? '');
    setTypesError(null);
  }, [activity, occurrence, visible]);

  if (!activity || !occurrence) return null;

  const baseCodes = activity.allowedTypeCodes.length > 0 ? activity.allowedTypeCodes : event.defaultAllowedTypeCodes;
  const allInherit = enabled === 'inherit' && selfService === 'inherit' && skipped === 'inherit' && !narrowTypes;
  const fieldsDisabled = disabled || isSubmitting;

  const handleSave = () => {
    if (narrowTypes && typeCodes.length === 0) {
      setTypesError(EVENT_VALIDATION_MESSAGES.OVERRIDE_TYPES_REQUIRED);
      return;
    }
    setTypesError(null);
    onSave({
      activityId: activity.activityId,
      enabled: fromTriState(enabled),
      selfServiceAllowed: fromTriState(selfService),
      skipped: fromTriState(skipped),
      allowedTypeCodes: narrowTypes ? typeCodes : null,
      note: note.trim() || null,
    });
  };

  const content = (
    <View style={[styles.panel, isDesktop ? styles.panelDesktop : styles.panelMobile, { paddingTop: isDesktop ? 0 : insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>Adjust for this occurrence</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {activity.name} · {occurrence.date} #{occurrence.seq}
          </Text>
        </View>
        <TouchableOpacity accessibilityLabel="Close override editor" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
        {errorMessage ? <StatusBanner kind="error" message={errorMessage} /> : null}

        <TriStateField
          label="Enabled"
          value={enabled}
          inheritedValue={activity.enabled}
          disabled={fieldsDisabled}
          onChange={setEnabled}
        />
        <TriStateField
          label="Self-service"
          value={selfService}
          inheritedValue={getEffectiveSelfServiceAllowed(event, activity, occurrence)}
          disabled={fieldsDisabled}
          onChange={setSelfService}
          inheritLabel="Follow event/activity"
          onLabel="Allowed"
          offLabel="Not allowed"
        />
        <TriStateField
          label="Skipped"
          value={skipped}
          inheritedValue={false}
          disabled={fieldsDisabled}
          onChange={setSkipped}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Allowed ID types</Text>
          <View style={styles.segmented}>
            {[false, true].map((narrow) => (
              <TouchableOpacity
                key={String(narrow)}
                accessibilityRole="radio"
                accessibilityState={{ selected: narrowTypes === narrow, disabled: fieldsDisabled }}
                disabled={fieldsDisabled}
                onPress={() => {
                  setNarrowTypes(narrow);
                  setTypesError(null);
                }}
                style={[styles.segment, narrowTypes === narrow && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, narrowTypes === narrow && styles.segmentTextSelected]}>
                  {narrow ? 'Narrow for this day' : 'Inherit'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!narrowTypes ? (
            <Text style={styles.hint}>Inherits: {formatTypeCodeNames(baseCodes, typeOptions) || 'none'}</Text>
          ) : (
            <TypeCodeMultiSelect
              label="Allowed on this occurrence"
              options={typeOptions}
              allowedCodes={baseCodes}
              value={typeCodes}
              onChange={(codes) => {
                setTypeCodes(codes);
                setTypesError(null);
              }}
              disabled={fieldsDisabled}
              error={typesError ?? undefined}
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Note</Text>
          <TextInput
            accessibilityLabel="Override note"
            editable={!fieldsDisabled}
            multiline
            onChangeText={setNote}
            placeholder="Reason for the change on this day"
            placeholderTextColor={COLORS.textDisabled}
            style={[styles.input, styles.noteInput]}
            value={note}
          />
        </View>

        {allInherit ? (
          <Text style={styles.hint}>No override fields are set — saving removes this activity&apos;s override for this occurrence.</Text>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={fieldsDisabled}
            onPress={handleSave}
            style={[styles.saveButton, fieldsDisabled && styles.disabledButton]}
          >
            {isSubmitting ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.saveText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  if (isDesktop) {
    return (
      <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
        <View style={styles.desktopOverlay}>
          <TouchableOpacity accessibilityLabel="Close override editor" activeOpacity={1} onPress={onClose} style={styles.desktopBackdrop} />
          {content}
        </View>
      </Modal>
    );
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  desktopOverlay: { backgroundColor: 'rgba(0, 0, 0, 0.35)', flex: 1, flexDirection: 'row' },
  desktopBackdrop: { flex: 1 },
  panel: { backgroundColor: COLORS.surface },
  panelDesktop: { borderLeftColor: COLORS.border, borderLeftWidth: 1, height: '100%', maxWidth: '100%', width: 440 },
  panelMobile: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    padding: 16,
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  closeButton: { padding: 4 },
  body: { padding: 16 },
  field: { marginBottom: 16 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  segmented: { backgroundColor: COLORS.gray[200], borderRadius: 6, flexDirection: 'row', padding: 3 },
  segment: { alignItems: 'center', borderRadius: 4, flex: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  segmentSelected: { backgroundColor: COLORS.surface },
  segmentText: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  segmentTextSelected: { color: COLORS.primary, fontWeight: '700' },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
  cancelButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  saveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: 16,
  },
  saveText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
});
