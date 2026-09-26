import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import { getIdCodeTypeMap } from '../../services/database/appConfigStore';
import { IdCodeTypeConfig } from '../../types/config';
import { logger } from '../../utils/logger';

const TAG = 'TypeCodeMultiSelect';

export interface TypeCodeMultiSelectProps {
  label: string;
  /** Enabled ID_CODE_TYPE entries (from getIdCodeTypeMap) */
  options: IdCodeTypeConfig[];
  value: string[];
  onChange: (codes: string[]) => void;
  /** Codes used when value is empty; shown as "Inherits: …" */
  inheritedCodes?: string[];
  /** Restricts selectable options (e.g. override narrowing) */
  allowedCodes?: string[];
  disabled?: boolean;
  error?: string;
}

function sameCode(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

export function formatTypeCodeNames(codes: readonly string[], options: IdCodeTypeConfig[]): string {
  return codes
    .map((code) => options.find((option) => sameCode(option.code, code))?.name ?? code)
    .join(', ');
}

/** Enabled ID_CODE_TYPE entries from the local config cache, sorted by code. */
export function useIdCodeTypeOptions(): IdCodeTypeConfig[] {
  const [options, setOptions] = useState<IdCodeTypeConfig[]>([]);

  useEffect(() => {
    let active = true;
    getIdCodeTypeMap()
      .then((map) => {
        if (!active) return;
        setOptions(Object.values(map).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
      })
      .catch((err) => logger.warn(TAG, 'Unable to load ID code types', err));
    return () => {
      active = false;
    };
  }, []);

  return options;
}

export default function TypeCodeMultiSelect({
  label,
  options,
  value,
  onChange,
  inheritedCodes,
  allowedCodes,
  disabled = false,
  error,
}: TypeCodeMultiSelectProps) {
  const choices = useMemo(() => {
    const base = allowedCodes
      ? options.filter((option) => allowedCodes.some((code) => sameCode(code, option.code)))
      : options;
    // Keep selected codes that are no longer enabled so they can be removed.
    const stale = value
      .filter((code) => !base.some((option) => sameCode(option.code, code)))
      .map((code): IdCodeTypeConfig => ({ code, type: null, name: `${code} (not enabled)`, description: null }));
    return [...base, ...stale];
  }, [allowedCodes, options, value]);

  const toggle = (code: string) => {
    const selected = value.some((item) => sameCode(item, code));
    onChange(selected ? value.filter((item) => !sameCode(item, code)) : [...value, code]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {choices.length === 0 ? <Text style={styles.hint}>No ID types available.</Text> : null}
        {choices.map((option) => {
          const selected = value.some((item) => sameCode(item, option.code));
          return (
            <TouchableOpacity
              key={option.code}
              accessibilityLabel={`${option.name} (${option.code})`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => toggle(option.code)}
              style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {option.name} ({option.code})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value.length === 0 && inheritedCodes ? (
        <Text style={styles.hint}>
          Inherits: {inheritedCodes.length > 0 ? formatTypeCodeNames(inheritedCodes, options) : 'none'}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipDisabled: { opacity: 0.6 },
  chipText: { color: COLORS.textPrimary, fontSize: 13 },
  chipTextSelected: { color: COLORS.white, fontWeight: '600' },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  error: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
});
