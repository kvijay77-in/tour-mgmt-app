/**
 * Advanced Settings Screen — per-device overrides of the offline sync
 * settings (mobile only, every role except GUEST).
 *
 * Defaults come from AppConfig OFFLINE_SYNC (or built-in values). Changes are
 * clamped to safe limits and persisted on this device; Reset returns to the
 * organisation defaults.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  SYNC_SETTING_LIMITS,
  SyncSettingOverrides,
  USER_EDITABLE_SYNC_SETTINGS,
  UserEditableSyncSettingKey,
} from '../../services/sync/syncSettings';
import {
  getOrgSyncSettings,
  getSyncSettings,
  resetSyncSettingOverrides,
  saveSyncSettingOverrides,
} from '../../services/sync/syncSettingsService';
import { logger } from '../../utils/logger';

const TAG = 'AdvancedSettingsScreen';

const STEP: Record<UserEditableSyncSettingKey, number> = {
  readinessRefreshMinutes: 1,
  maxSyncAttempts: 1,
  staleQueueAlertMinutes: 5,
  retentionDays: 1,
  maxBackoffMinutes: 1,
};

type Draft = Record<UserEditableSyncSettingKey, number>;

interface AdvancedSettingsScreenProps {
  onClose: () => void;
}

function pickEditable(source: Record<UserEditableSyncSettingKey, number>): Draft {
  const result = {} as Draft;
  for (const key of USER_EDITABLE_SYNC_SETTINGS) result[key] = source[key];
  return result;
}

export default function AdvancedSettingsScreen({ onClose }: AdvancedSettingsScreenProps) {
  const orgSettings = useMemo(() => pickEditable(getOrgSyncSettings()), []);
  const [draft, setDraft] = useState<Draft>(() => pickEditable(getSyncSettings()));
  const [saved, setSaved] = useState<Draft>(() => pickEditable(getSyncSettings()));
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = USER_EDITABLE_SYNC_SETTINGS.some((key) => draft[key] !== saved[key]);
  const hasOverrides = USER_EDITABLE_SYNC_SETTINGS.some((key) => saved[key] !== orgSettings[key]);

  const adjust = useCallback((key: UserEditableSyncSettingKey, direction: 1 | -1) => {
    const { min, max } = SYNC_SETTING_LIMITS[key];
    setMessage(null);
    setDraft((current) => ({
      ...current,
      [key]: Math.min(max, Math.max(min, current[key] + direction * STEP[key])),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    const overrides: SyncSettingOverrides = {};
    for (const key of USER_EDITABLE_SYNC_SETTINGS) {
      if (draft[key] !== orgSettings[key]) overrides[key] = draft[key];
    }
    setIsSaving(true);
    try {
      await saveSyncSettingOverrides(overrides);
      setSaved(pickEditable(getSyncSettings()));
      setMessage({ text: 'Settings saved on this device.', isError: false });
    } catch (error) {
      logger.error(TAG, 'Saving sync settings failed', error);
      setMessage({ text: 'Settings could not be saved. Please try again.', isError: true });
    } finally {
      setIsSaving(false);
    }
  }, [draft, orgSettings]);

  const handleReset = useCallback(async () => {
    setIsSaving(true);
    try {
      await resetSyncSettingOverrides();
      const current = pickEditable(getSyncSettings());
      setDraft(current);
      setSaved(current);
      setMessage({ text: 'Default settings restored.', isError: false });
    } catch (error) {
      logger.error(TAG, 'Resetting sync settings failed', error);
      setMessage({ text: 'Settings could not be reset. Please try again.', isError: true });
    } finally {
      setIsSaving(false);
    }
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel="Back" onPress={onClose} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Advanced settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Offline sync settings for this device. Defaults are set by your organisation; change them only if
          advised.
        </Text>

        {USER_EDITABLE_SYNC_SETTINGS.map((key) => {
          const limit = SYNC_SETTING_LIMITS[key];
          const value = draft[key];
          return (
            <View key={key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>{limit.label}</Text>
                <Text style={styles.description}>{limit.description}</Text>
                <Text style={styles.defaultText}>
                  {`Default ${orgSettings[key]} ${limit.unit} · range ${limit.min}–${limit.max}`}
                  {value !== orgSettings[key] ? ' · changed' : ''}
                </Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  accessibilityLabel={`Decrease ${limit.label}`}
                  disabled={value <= limit.min}
                  onPress={() => adjust(key, -1)}
                  style={[styles.stepButton, value <= limit.min && styles.stepButtonDisabled]}
                >
                  <MaterialIcons name="remove" size={20} color={COLORS.primary} />
                </TouchableOpacity>
                <Text accessibilityLabel={`${limit.label} ${value} ${limit.unit}`} style={styles.value}>
                  {`${value}\n`}
                  <Text style={styles.unit}>{limit.unit}</Text>
                </Text>
                <TouchableOpacity
                  accessibilityLabel={`Increase ${limit.label}`}
                  disabled={value >= limit.max}
                  onPress={() => adjust(key, 1)}
                  style={[styles.stepButton, value >= limit.max && styles.stepButtonDisabled]}
                >
                  <MaterialIcons name="add" size={20} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {message ? (
          <Text style={[styles.message, message.isError && styles.messageError]}>{message.text}</Text>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          disabled={!isDirty || isSaving}
          onPress={() => void handleSave()}
          style={[styles.primaryButton, (!isDirty || isSaving) && styles.buttonDisabled]}
        >
          <Text style={styles.primaryButtonText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={(!hasOverrides && !isDirty) || isSaving}
          onPress={() => void handleReset()}
          style={[styles.secondaryButton, ((!hasOverrides && !isDirty) || isSaving) && styles.buttonDisabled]}
        >
          <Text style={styles.secondaryButtonText}>Reset to defaults</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 28,
    paddingBottom: 12,
    paddingHorizontal: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  backButton: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  headerSpacer: { width: 40 },
  content: { padding: 16, paddingBottom: 32 },
  intro: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 },
  row: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
    padding: 12,
  },
  rowText: { flex: 1 },
  label: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  description: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  defaultText: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  stepButton: {
    alignItems: 'center',
    borderColor: COLORS.primary,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepButtonDisabled: { opacity: 0.3 },
  value: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  unit: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '400' },
  message: { color: COLORS.success, fontSize: 13, marginVertical: 8, textAlign: 'center' },
  messageError: { color: COLORS.danger },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    marginTop: 8,
    paddingVertical: 12,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.primary,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
});
