import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { NotificationCategory, NotificationRule, NotificationTarget, UpsertNotificationRuleRequest } from '../../types/api';
import {
  createNotificationRule,
  deleteNotificationRule,
  describeUnexpectedNotificationRuleError,
  listNotificationRules,
  updateNotificationRule,
} from '../../services/api/notificationRuleApi';
import { splitAudienceExpressions, validateAudienceExpression, validateTemplate } from '../../utils/notificationRules';
import {
  isNotificationAndroidChannel,
  isNotificationCategory,
  isNotificationPriority,
} from '../../utils/notificationRuleForm';

interface NotificationRulesScreenProps {
  onClose: () => void;
}

interface RuleFormState {
  ruleId: string;
  enabled: boolean;
  category: NotificationCategory;
  audiences: string;
  titleTemplate: string;
  bodyTemplate: string;
  push: boolean;
  priority: 'URGENT' | 'NORMAL';
  androidChannel: 'urgent' | 'general';
  targetScreen: string;
  targetParamKeys: string;
  ttlHours: string;
  quietFrom: string;
  quietTo: string;
  quietTz: string;
  allowOverride: boolean;
  version: string;
}

function initialForm(): RuleFormState {
  return {
    ruleId: '',
    enabled: true,
    category: 'ANNOUNCEMENT',
    audiences: 'ALL',
    titleTemplate: '',
    bodyTemplate: '',
    push: true,
    priority: 'NORMAL',
    androidChannel: 'general',
    targetScreen: '',
    targetParamKeys: '',
    ttlHours: '24',
    quietFrom: '',
    quietTo: '',
    quietTz: '',
    allowOverride: true,
    version: '0',
  };
}

function toForm(rule: NotificationRule): RuleFormState {
  return {
    ruleId: rule.ruleId,
    enabled: rule.enabled,
    category: rule.category,
    audiences: rule.audiences.join('\n'),
    titleTemplate: rule.titleTemplate,
    bodyTemplate: rule.bodyTemplate,
    push: rule.push,
    priority: rule.priority,
    androidChannel: rule.androidChannel,
    targetScreen: rule.target?.screen ?? '',
    targetParamKeys: (rule.target?.paramKeys ?? []).join(','),
    ttlHours: String(rule.ttlHours),
    quietFrom: rule.quietHours?.from ?? '',
    quietTo: rule.quietHours?.to ?? '',
    quietTz: rule.quietHours?.tz ?? '',
    allowOverride: rule.allowOverride,
    version: String(rule.version ?? 0),
  };
}

function toPayload(form: RuleFormState): UpsertNotificationRuleRequest {
  const audiences = splitAudienceExpressions(form.audiences);
  const target: NotificationTarget | undefined = form.targetScreen.trim()
    ? {
      screen: form.targetScreen.trim(),
      paramKeys: form.targetParamKeys
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    }
    : undefined;

  const quietHours = form.quietFrom && form.quietTo && form.quietTz
    ? { from: form.quietFrom.trim(), to: form.quietTo.trim(), tz: form.quietTz.trim() }
    : undefined;

  return {
    ruleId: form.ruleId.trim(),
    enabled: form.enabled,
    category: form.category,
    audiences,
    titleTemplate: form.titleTemplate.trim(),
    bodyTemplate: form.bodyTemplate.trim(),
    push: form.push,
    priority: form.priority,
    androidChannel: form.androidChannel,
    target,
    ttlHours: Number.parseInt(form.ttlHours, 10) || 24,
    quietHours,
    allowOverride: form.allowOverride,
    version: Number.parseInt(form.version, 10) || 0,
  };
}

function validateForm(form: RuleFormState): string | null {
  if (!form.ruleId.trim()) return 'Rule ID is required.';
  const audiences = splitAudienceExpressions(form.audiences);
  if (audiences.length === 0) return 'At least one audience expression is required.';
  const invalidAudience = audiences.find((entry) => !validateAudienceExpression(entry));
  if (invalidAudience) return `Invalid audience expression: ${invalidAudience}`;
  if (!isNotificationCategory(form.category)) return 'Category must be ANNOUNCEMENT, ALERT, PERSONAL, or SYSTEM.';
  if (!isNotificationPriority(form.priority)) return 'Priority must be URGENT or NORMAL.';
  if (!isNotificationAndroidChannel(form.androidChannel)) return 'Android channel must be urgent or general.';
  if (!validateTemplate(form.titleTemplate)) return 'Title template is required and braces must be balanced.';
  if (!validateTemplate(form.bodyTemplate)) return 'Body template is required and braces must be balanced.';
  const ttlHours = Number.parseInt(form.ttlHours, 10);
  if (!Number.isFinite(ttlHours) || ttlHours < 1) return 'TTL hours must be a positive integer.';
  return null;
}

export default function NotificationRulesScreen({ onClose }: NotificationRulesScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(initialForm);
  const [isLoading, setIsLoading] = useState(false);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.ruleId === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const outcome = await listNotificationRules();
      if (outcome.kind === 'success') {
        setRules(outcome.data.sort((a, b) => a.ruleId.localeCompare(b.ruleId)));
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Unavailable', 'Notification rules backend is not deployed yet.');
        return;
      }
      Alert.alert('Unable to load rules', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to load rules', describeUnexpectedNotificationRuleError(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const selectRule = (rule: NotificationRule) => {
    setSelectedRuleId(rule.ruleId);
    setForm(toForm(rule));
  };

  const resetForCreate = () => {
    setSelectedRuleId(null);
    setForm(initialForm());
  };

  const saveRule = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      Alert.alert('Validation failed', validationError);
      return;
    }
    setIsLoading(true);
    try {
      const payload = toPayload(form);
      const outcome = selectedRule
        ? await updateNotificationRule(selectedRule.ruleId, payload)
        : await createNotificationRule(payload);
      if (outcome.kind === 'success') {
        await refresh();
        selectRule(outcome.data);
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Unavailable', 'Notification rules backend is not deployed yet.');
        return;
      }
      Alert.alert('Unable to save rule', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to save rule', describeUnexpectedNotificationRuleError(error));
    } finally {
      setIsLoading(false);
    }
  };

  const removeRule = async () => {
    if (!selectedRule) return;
    setIsLoading(true);
    try {
      const outcome = await deleteNotificationRule(selectedRule.ruleId);
      if (outcome.kind === 'success') {
        await refresh();
        resetForCreate();
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Unavailable', 'Notification rules backend is not deployed yet.');
        return;
      }
      Alert.alert('Unable to delete rule', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to delete rule', describeUnexpectedNotificationRuleError(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Close notification rules">
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Rules</Text>
        <TouchableOpacity style={styles.actionButton} onPress={() => void refresh()}>
          <Text style={styles.actionButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.body, isDesktop && styles.bodyDesktop]}>
        <View style={[styles.listPane, isDesktop ? styles.listPaneDesktop : undefined]}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Rules</Text>
            <TouchableOpacity style={styles.smallButton} onPress={resetForCreate}>
              <Text style={styles.smallButtonText}>New</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {rules.map((rule) => (
              <TouchableOpacity
                key={rule.ruleId}
                style={[styles.ruleItem, selectedRuleId === rule.ruleId && styles.ruleItemActive]}
                onPress={() => selectRule(rule)}
              >
                <Text style={styles.ruleId}>{rule.ruleId}</Text>
                <Text style={styles.ruleMeta}>{rule.category} · {rule.enabled ? 'Enabled' : 'Disabled'}</Text>
              </TouchableOpacity>
            ))}
            {rules.length === 0 && <Text style={styles.emptyText}>No rules loaded.</Text>}
          </ScrollView>
        </View>

        <ScrollView style={styles.formPane} contentContainerStyle={styles.formContent}>
          <Text style={styles.sectionTitle}>{selectedRule ? `Edit ${selectedRule.ruleId}` : 'Create rule'}</Text>

          <Text style={styles.label}>Rule ID</Text>
          <TextInput
            value={form.ruleId}
            editable={!selectedRule}
            onChangeText={(value) => setForm((prev) => ({ ...prev, ruleId: value }))}
            style={[styles.input, selectedRule && styles.inputDisabled]}
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Enabled</Text>
            <Switch value={form.enabled} onValueChange={(value) => setForm((prev) => ({ ...prev, enabled: value }))} />
          </View>

          <Text style={styles.label}>Category</Text>
          <TextInput value={form.category} onChangeText={(value) => setForm((prev) => ({ ...prev, category: value as NotificationCategory }))} style={styles.input} />

          <Text style={styles.label}>Audience expressions (comma or newline separated)</Text>
          <TextInput
            value={form.audiences}
            onChangeText={(value) => setForm((prev) => ({ ...prev, audiences: value }))}
            style={[styles.input, styles.textArea]}
            multiline
          />

          <Text style={styles.label}>Title template</Text>
          <TextInput value={form.titleTemplate} onChangeText={(value) => setForm((prev) => ({ ...prev, titleTemplate: value }))} style={styles.input} />

          <Text style={styles.label}>Body template</Text>
          <TextInput
            value={form.bodyTemplate}
            onChangeText={(value) => setForm((prev) => ({ ...prev, bodyTemplate: value }))}
            style={[styles.input, styles.textArea]}
            multiline
          />

          <View style={styles.switchRow}>
            <Text style={styles.label}>Push</Text>
            <Switch value={form.push} onValueChange={(value) => setForm((prev) => ({ ...prev, push: value }))} />
          </View>

          <Text style={styles.label}>Priority</Text>
          <TextInput value={form.priority} onChangeText={(value) => setForm((prev) => ({ ...prev, priority: value as 'URGENT' | 'NORMAL' }))} style={styles.input} />

          <Text style={styles.label}>Android channel</Text>
          <TextInput value={form.androidChannel} onChangeText={(value) => setForm((prev) => ({ ...prev, androidChannel: value as 'urgent' | 'general' }))} style={styles.input} />

          <Text style={styles.label}>Target screen</Text>
          <TextInput value={form.targetScreen} onChangeText={(value) => setForm((prev) => ({ ...prev, targetScreen: value }))} style={styles.input} />

          <Text style={styles.label}>Target param keys (comma separated)</Text>
          <TextInput value={form.targetParamKeys} onChangeText={(value) => setForm((prev) => ({ ...prev, targetParamKeys: value }))} style={styles.input} />

          <Text style={styles.label}>TTL hours</Text>
          <TextInput value={form.ttlHours} onChangeText={(value) => setForm((prev) => ({ ...prev, ttlHours: value.replace(/[^0-9]/g, '') }))} style={styles.input} keyboardType="number-pad" />

          <Text style={styles.label}>Quiet hours (optional)</Text>
          <View style={styles.inlineInputs}>
            <TextInput value={form.quietFrom} onChangeText={(value) => setForm((prev) => ({ ...prev, quietFrom: value }))} style={[styles.input, styles.inlineInput]} placeholder="from" />
            <TextInput value={form.quietTo} onChangeText={(value) => setForm((prev) => ({ ...prev, quietTo: value }))} style={[styles.input, styles.inlineInput]} placeholder="to" />
            <TextInput value={form.quietTz} onChangeText={(value) => setForm((prev) => ({ ...prev, quietTz: value }))} style={[styles.input, styles.inlineInput]} placeholder="tz" />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.label}>Allow override</Text>
            <Switch value={form.allowOverride} onValueChange={(value) => setForm((prev) => ({ ...prev, allowOverride: value }))} />
          </View>

          <Text style={styles.label}>Version</Text>
          <TextInput value={form.version} onChangeText={(value) => setForm((prev) => ({ ...prev, version: value.replace(/[^0-9]/g, '') }))} style={styles.input} keyboardType="number-pad" />

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
              onPress={() => void saveRule()}
              disabled={isLoading}
            >
              <Text style={styles.primaryButtonText}>{selectedRule ? 'Update Rule' : 'Create Rule'}</Text>
            </TouchableOpacity>
            {selectedRule && (
              <TouchableOpacity
                style={[styles.dangerButton, isLoading && styles.buttonDisabled]}
                onPress={() => void removeRule()}
                disabled={isLoading}
              >
                <Text style={styles.dangerButtonText}>Delete Rule</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginLeft: 6,
  },
  actionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  bodyDesktop: {
    flexDirection: 'row',
  },
  listPane: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    padding: 12,
  },
  listPaneDesktop: {
    width: 300,
    borderBottomWidth: 0,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  smallButton: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  smallButtonText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  ruleItem: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  ruleItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EAF2FF',
  },
  ruleId: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  ruleMeta: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 8,
  },
  formPane: {
    flex: 1,
  },
  formContent: {
    padding: 12,
    gap: 8,
  },
  label: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: COLORS.surface,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  inputDisabled: {
    backgroundColor: COLORS.borderLight,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  switchRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineInput: {
    flex: 1,
  },
  actions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
  dangerButton: {
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dangerButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
