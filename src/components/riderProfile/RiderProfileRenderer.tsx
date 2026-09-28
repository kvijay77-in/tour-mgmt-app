import React from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../../constants/colors';
import {
  OrderedRiderProfileSection,
  RiderProfileAttributeDefinition,
  RiderProfileGroupField,
  RiderProfileLovDefinition,
} from '../../types/riderProfile';
import { evaluateVisibleWhen } from '../../utils/riderProfileDefinitions';
import { getMaskedAttributeDisplay } from '../../utils/riderProfileMasking';

interface RiderProfileRendererProps {
  sections: OrderedRiderProfileSection[];
  values: Record<string, unknown>;
  lovsById: Record<string, RiderProfileLovDefinition>;
  mode?: 'view' | 'edit';
  sensitiveKeys?: readonly string[];
  revealedKeys?: ReadonlySet<string>;
  onToggleReveal?: (key: string) => void;
  onChangeValue?: (key: string, value: unknown) => void;
  onViewFile?: (key: string) => void;
  emptyValueLabel?: string;
  filterAttribute?: (attribute: RiderProfileAttributeDefinition) => boolean;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function getLovLabels(
  lovsById: Record<string, RiderProfileLovDefinition>,
  lovId: string | undefined,
  rawValue: unknown,
): string[] {
  if (!lovId) return Array.isArray(rawValue) ? rawValue.map(toText).filter(Boolean) : [toText(rawValue)].filter(Boolean);
  const lov = lovsById[lovId];
  if (!lov) return Array.isArray(rawValue) ? rawValue.map(toText).filter(Boolean) : [toText(rawValue)].filter(Boolean);

  const valueMap = new Map(
    (lov.config.items ?? [])
      .filter((item) => item.enabled !== false)
      .map((item) => [item.value, item.label]),
  );
  const rawItems = Array.isArray(rawValue) ? rawValue : [rawValue];
  return rawItems
    .map((item) => {
      const text = toText(item);
      return valueMap.get(text) ?? text;
    })
    .filter(Boolean);
}

type LovSelectableField = {
  lovId?: string;
  dependsOn?: string;
};

function getOptionItems(
  definition: LovSelectableField,
  values: Record<string, unknown>,
  lovsById: Record<string, RiderProfileLovDefinition>,
) {
  if (!definition.lovId) return [];
  const lov = lovsById[definition.lovId];
  if (!lov) return [];

  const dependsOnValue = definition.dependsOn ? values[definition.dependsOn] : undefined;
  return (lov.config.items ?? [])
    .filter((item) => item.enabled !== false)
    .filter((item) => {
      if (!definition.dependsOn) return true;
      if (dependsOnValue === null || dependsOnValue === undefined || dependsOnValue === '') {
        return !item.parent;
      }
      return item.parent === toText(dependsOnValue);
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function parseTextInputValue(type: RiderProfileAttributeDefinition['config']['type'] | RiderProfileGroupField['type'], value: string): unknown {
  if (type === 'NUMBER') {
    if (!value.trim()) return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function renderViewValue(params: {
  definition: RiderProfileAttributeDefinition;
  value: unknown;
  lovsById: Record<string, RiderProfileLovDefinition>;
  sensitiveKeys?: readonly string[];
  revealedKeys?: ReadonlySet<string>;
  onToggleReveal?: (key: string) => void;
  onViewFile?: (key: string) => void;
  emptyValueLabel: string;
}): React.ReactNode {
  const {
    definition,
    value,
    lovsById,
    sensitiveKeys,
    revealedKeys,
    onToggleReveal,
    onViewFile,
    emptyValueLabel,
  } = params;

  if (definition.config.type === 'BOOLEAN') {
    if (value === null || value === undefined) {
      return <Text style={styles.valueText}>{emptyValueLabel}</Text>;
    }
    return <Text style={styles.valueText}>{value ? 'Yes' : 'No'}</Text>;
  }

  if (definition.config.type === 'SELECT' || definition.config.type === 'MULTI_SELECT') {
    const labels = getLovLabels(lovsById, definition.config.lovId, value);
    return <Text style={styles.valueText}>{labels.length > 0 ? labels.join(', ') : emptyValueLabel}</Text>;
  }

  if (definition.config.type === 'FILE' || definition.config.type === 'IMAGE') {
    return (
      <View style={styles.fileRow}>
        <Text style={styles.valueText}>{toText(value) || emptyValueLabel}</Text>
        {value ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => onViewFile?.(definition.configId)}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonText}>View</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (definition.config.type === 'GROUP') {
    const groups = Array.isArray(value) ? value : (value ? [value] : []);
    if (groups.length === 0) {
      return <Text style={styles.valueText}>{emptyValueLabel}</Text>;
    }

    return (
      <View style={styles.groupList}>
        {groups.map((entry, index) => (
          <View key={`${definition.configId}-${index}`} style={styles.groupCard}>
            {(definition.config.fields ?? []).map((field) => {
              const entryValue = entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>)[field.key]
                : undefined;
              const labels = field.type === 'SELECT' || field.type === 'MULTI_SELECT'
                ? getLovLabels(lovsById, field.lovId, entryValue)
                : [];
              return (
                <View key={field.key} style={styles.groupFieldRow}>
                  <Text style={styles.groupFieldLabel}>{field.label}</Text>
                  <Text style={styles.groupFieldValue}>
                    {field.type === 'SELECT' || field.type === 'MULTI_SELECT'
                      ? (labels.length > 0 ? labels.join(', ') : emptyValueLabel)
                      : (toText(entryValue) || emptyValueLabel)}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  const masked = getMaskedAttributeDisplay(
    definition.configId,
    value,
    sensitiveKeys,
    revealedKeys,
  );
  const isSensitive = Boolean(sensitiveKeys?.includes(definition.configId));

  return (
    <View style={styles.maskedRow}>
      <Text style={styles.valueText}>{masked.displayValue || emptyValueLabel}</Text>
      {isSensitive ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => onToggleReveal?.(definition.configId)}
          style={styles.actionButton}
        >
          <Text style={styles.actionButtonText}>{masked.masked ? 'Reveal' : 'Hide'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function renderEditField(params: {
  definition: RiderProfileAttributeDefinition;
  value: unknown;
  values: Record<string, unknown>;
  lovsById: Record<string, RiderProfileLovDefinition>;
  onChangeValue: (key: string, value: unknown) => void;
}): React.ReactNode {
  const { definition, value, values, lovsById, onChangeValue } = params;
  const { type } = definition.config;

  if (type === 'BOOLEAN') {
    return (
      <Switch
        accessibilityLabel={definition.config.label}
        onValueChange={(next) => onChangeValue(definition.configId, next)}
        value={Boolean(value)}
      />
    );
  }

  if (type === 'SELECT' || type === 'MULTI_SELECT') {
    const options = getOptionItems({
      lovId: definition.config.lovId,
      dependsOn: definition.config.dependsOn,
    }, values, lovsById);
    const selectedValues = Array.isArray(value) ? value.map(toText) : [toText(value)].filter(Boolean);

    if (options.length === 0 && definition.config.fallbackToText) {
      return (
        <TextInput
          accessibilityLabel={definition.config.label}
          onChangeText={(text) => onChangeValue(definition.configId, type === 'MULTI_SELECT'
            ? text.split(',').map((item) => item.trim()).filter(Boolean)
            : text)}
          placeholder={definition.config.placeholder}
          placeholderTextColor={COLORS.textDisabled}
          style={styles.input}
          value={type === 'MULTI_SELECT' ? selectedValues.join(', ') : selectedValues[0] ?? ''}
        />
      );
    }

    return (
      <View style={styles.optionWrap}>
        {options.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <TouchableOpacity
              key={option.value}
              accessibilityRole="button"
              onPress={() => {
                if (type === 'SELECT') {
                  onChangeValue(definition.configId, option.value);
                  return;
                }
                const next = selected
                  ? selectedValues.filter((item) => item !== option.value)
                  : [...selectedValues, option.value];
                onChangeValue(definition.configId, next);
              }}
              style={[styles.optionChip, selected && styles.optionChipSelected]}
            >
              <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  if (type === 'GROUP') {
    const entries = Array.isArray(value)
      ? value
      : (value && typeof value === 'object' ? [value] : []);
    const groupEntries = definition.config.repeatable ? entries : [entries[0] ?? {}];

    return (
      <View style={styles.groupList}>
        {groupEntries.map((entry, index) => {
          const entryRecord = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
          const updateEntry = (fieldKey: string, nextValue: unknown) => {
            const nextEntries = [...groupEntries];
            nextEntries[index] = {
              ...entryRecord,
              [fieldKey]: nextValue,
            };
            onChangeValue(definition.configId, definition.config.repeatable ? nextEntries : nextEntries[0]);
          };

          return (
            <View key={`${definition.configId}-${index}`} style={styles.groupCard}>
              {(definition.config.fields ?? []).map((field) => {
                const fieldValue = entryRecord[field.key];
                const fieldOptions = getOptionItems(field, entryRecord, lovsById);

                return (
                  <View key={field.key} style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    {field.type === 'BOOLEAN' ? (
                      <Switch
                        accessibilityLabel={field.label}
                        onValueChange={(next) => updateEntry(field.key, next)}
                        value={Boolean(fieldValue)}
                      />
                    ) : field.type === 'SELECT' || field.type === 'MULTI_SELECT' ? (
                      fieldOptions.length === 0 && field.fallbackToText ? (
                        <TextInput
                          accessibilityLabel={field.label}
                          onChangeText={(text) => updateEntry(
                            field.key,
                            field.type === 'MULTI_SELECT'
                              ? text.split(',').map((item) => item.trim()).filter(Boolean)
                              : text,
                          )}
                          placeholder={field.placeholder}
                          placeholderTextColor={COLORS.textDisabled}
                          style={styles.input}
                          value={field.type === 'MULTI_SELECT'
                            ? (Array.isArray(fieldValue) ? fieldValue.map(toText).join(', ') : '')
                            : toText(fieldValue)}
                        />
                      ) : (
                        <View style={styles.optionWrap}>
                          {fieldOptions.map((option) => {
                            const selectedValues = Array.isArray(fieldValue) ? fieldValue.map(toText) : [toText(fieldValue)].filter(Boolean);
                            const selected = selectedValues.includes(option.value);
                            return (
                              <TouchableOpacity
                                key={option.value}
                                accessibilityRole="button"
                                onPress={() => {
                                  if (field.type === 'SELECT') {
                                    updateEntry(field.key, option.value);
                                    return;
                                  }
                                  const next = selected
                                    ? selectedValues.filter((item) => item !== option.value)
                                    : [...selectedValues, option.value];
                                  updateEntry(field.key, next);
                                }}
                                style={[styles.optionChip, selected && styles.optionChipSelected]}
                              >
                                <Text style={[styles.optionChipText, selected && styles.optionChipTextSelected]}>{option.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )
                    ) : (
                      <TextInput
                        accessibilityLabel={field.label}
                        onChangeText={(text) => updateEntry(field.key, parseTextInputValue(field.type, text))}
                        placeholder={field.placeholder}
                        placeholderTextColor={COLORS.textDisabled}
                        style={[styles.input, field.type === 'TEXTAREA' && styles.multilineInput]}
                        multiline={field.type === 'TEXTAREA'}
                        value={toText(fieldValue)}
                      />
                    )}
                  </View>
                );
              })}
              {definition.config.repeatable ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => {
                    const nextEntries = groupEntries.filter((_, entryIndex) => entryIndex !== index);
                    onChangeValue(definition.configId, nextEntries);
                  }}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
        {definition.config.repeatable ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => {
              const nextEntries = [...groupEntries, {}];
              onChangeValue(definition.configId, nextEntries);
            }}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonText}>Add item</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <TextInput
      accessibilityLabel={definition.config.label}
      onChangeText={(text) => onChangeValue(definition.configId, parseTextInputValue(type, text))}
      placeholder={definition.config.placeholder}
      placeholderTextColor={COLORS.textDisabled}
      style={[styles.input, type === 'TEXTAREA' && styles.multilineInput]}
      multiline={type === 'TEXTAREA'}
      value={toText(value)}
    />
  );
}

function AttributeBlock(props: {
  definition: RiderProfileAttributeDefinition;
  value: unknown;
  values: Record<string, unknown>;
  lovsById: Record<string, RiderProfileLovDefinition>;
  mode: 'view' | 'edit';
  sensitiveKeys?: readonly string[];
  revealedKeys?: ReadonlySet<string>;
  onToggleReveal?: (key: string) => void;
  onChangeValue?: (key: string, value: unknown) => void;
  onViewFile?: (key: string) => void;
  emptyValueLabel: string;
}) {
  const {
    definition,
    value,
    values,
    lovsById,
    mode,
    sensitiveKeys,
    revealedKeys,
    onToggleReveal,
    onChangeValue,
    onViewFile,
    emptyValueLabel,
  } = props;

  return (
    <View style={styles.fieldBlock}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{definition.config.label}</Text>
        <View style={styles.badgeRow}>
          {definition.config.required ? <Text style={styles.badge}>Required</Text> : null}
          {definition.config.adminOnly ? <Text style={styles.badge}>Admin-only</Text> : null}
          {definition.config.sensitive ? <Text style={styles.badge}>Sensitive</Text> : null}
        </View>
      </View>
      {definition.config.helpText ? <Text style={styles.helpText}>{definition.config.helpText}</Text> : null}
      {mode === 'edit' && onChangeValue
        ? renderEditField({ definition, value, values, lovsById, onChangeValue })
        : renderViewValue({
          definition,
          value,
          lovsById,
          sensitiveKeys,
          revealedKeys,
          onToggleReveal,
          onViewFile,
          emptyValueLabel,
        })}
    </View>
  );
}

export default function RiderProfileRenderer({
  sections,
  values,
  lovsById,
  mode = 'view',
  sensitiveKeys,
  revealedKeys,
  onToggleReveal,
  onChangeValue,
  onViewFile,
  emptyValueLabel = '—',
  filterAttribute,
}: RiderProfileRendererProps) {
  const visibleSections = sections
    .map((section) => ({
      ...section,
      attributes: section.attributes.filter((attribute) => {
        if (filterAttribute && !filterAttribute(attribute)) return false;
        return evaluateVisibleWhen(attribute.config.visibleWhen, values);
      }),
    }))
    .filter((section) => section.attributes.length > 0);

  if (visibleSections.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>No profile fields available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.sectionList}>
      {visibleSections.map((section) => (
        <View key={section.sectionId} style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{section.section.config.label}</Text>
          {section.section.config.description ? (
            <Text style={styles.sectionDescription}>{section.section.config.description}</Text>
          ) : null}
          {section.attributes.map((attribute) => (
            <AttributeBlock
              key={attribute.configId}
              definition={attribute}
              value={values[attribute.configId]}
              values={values}
              lovsById={lovsById}
              mode={mode}
              sensitiveKeys={sensitiveKeys}
              revealedKeys={revealedKeys}
              onToggleReveal={onToggleReveal}
              onChangeValue={onChangeValue}
              onViewFile={onViewFile}
              emptyValueLabel={emptyValueLabel}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionList: {
    gap: 12,
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  fieldBlock: {
    gap: 6,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  fieldLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textSecondary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  helpText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  valueText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  maskedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  actionButton: {
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionButtonText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  optionChipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionChipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  optionChipTextSelected: {
    color: COLORS.white,
  },
  groupList: {
    gap: 10,
  },
  groupCard: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  groupFieldRow: {
    gap: 2,
  },
  groupFieldLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  groupFieldValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  removeButton: {
    alignSelf: 'flex-start',
    borderColor: COLORS.danger,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeButtonText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyStateText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
});
