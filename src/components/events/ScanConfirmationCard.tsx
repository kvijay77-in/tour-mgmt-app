import React from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

export interface ScanConfirmationCardProps {
  riderId: string;
  riderName: string;
  /** Rider missing from the name directory */
  riderNameIsAnomaly?: boolean;
  activityName: string;
  bagLabel?: string | null;
  /** Informational only (D-B) */
  selfService: boolean;
  overrideNote?: string | null;
  variantOptions: string[];
  selectedVariant: string | null;
  onSelectVariant: (variant: string) => void;
  isLoadingVariantDefault?: boolean;
  allowOptOut: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onOptOut: () => void;
  onRescan: () => void;
}

const monospaceFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'Courier' });

export default function ScanConfirmationCard({
  riderId,
  riderName,
  riderNameIsAnomaly = false,
  activityName,
  bagLabel,
  selfService,
  overrideNote,
  variantOptions,
  selectedVariant,
  onSelectVariant,
  isLoadingVariantDefault = false,
  allowOptOut,
  isSubmitting,
  onConfirm,
  onOptOut,
  onRescan,
}: ScanConfirmationCardProps) {
  const needsVariant = variantOptions.length > 0 && !selectedVariant;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>Rider</Text>
        <Text style={styles.riderId}>{riderId}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Name</Text>
        <Text style={[styles.value, riderNameIsAnomaly && styles.anomaly]}>{riderName}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Activity</Text>
        <Text style={styles.value}>{activityName}</Text>
      </View>
      {bagLabel ? (
        <View style={styles.row}>
          <Text style={styles.label}>ID type</Text>
          <Text style={styles.value}>{bagLabel}</Text>
        </View>
      ) : null}
      {selfService || overrideNote ? (
        <View style={styles.badgeRow}>
          {selfService ? <Text style={styles.badge}>Self-service</Text> : null}
          {overrideNote ? <Text style={styles.note}>{overrideNote}</Text> : null}
        </View>
      ) : null}

      {variantOptions.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.variantGroup}>
          <View style={styles.variantHeader}>
            <Text style={styles.label}>Option</Text>
            {isLoadingVariantDefault ? <ActivityIndicator size="small" color={COLORS.primary} /> : null}
          </View>
          <View style={styles.variantOptions}>
            {variantOptions.map((option) => {
              const selected = option === selectedVariant;
              return (
                <TouchableOpacity
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: isSubmitting }}
                  disabled={isSubmitting}
                  key={option}
                  onPress={() => onSelectVariant(option)}
                  style={[styles.variantOption, selected && styles.variantOptionSelected]}
                >
                  <MaterialIcons
                    name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
                    size={20}
                    color={selected ? COLORS.white : COLORS.textSecondary}
                  />
                  <Text style={[styles.variantText, selected && styles.variantTextSelected]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={onRescan}
          style={[styles.button, styles.secondaryButton]}
        >
          <Text style={styles.secondaryText}>Rescan</Text>
        </TouchableOpacity>
        {allowOptOut ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={onOptOut}
            style={[styles.button, styles.outlineButton, isSubmitting && styles.disabled]}
          >
            <Text style={styles.outlineText}>Opt out</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: isSubmitting || needsVariant }}
          disabled={isSubmitting || needsVariant}
          onPress={onConfirm}
          style={[styles.button, styles.primaryButton, (isSubmitting || needsVariant) && styles.disabled]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={COLORS.white} size="small" />
          ) : (
            <Text style={styles.primaryText}>Confirm</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  row: {
    borderBottomColor: COLORS.gray[100],
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  label: { color: COLORS.textSecondary, fontSize: 13 },
  value: { color: COLORS.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  anomaly: { color: COLORS.danger },
  riderId: { color: COLORS.textPrimary, fontFamily: monospaceFont, fontSize: 13 },
  badgeRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  badge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  note: { color: COLORS.textSecondary, flexShrink: 1, fontSize: 12, fontStyle: 'italic' },
  variantGroup: { paddingTop: 10 },
  variantHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 6 },
  variantOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  variantOption: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  variantOptionSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  variantText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  variantTextSelected: { color: COLORS.white },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  button: { alignItems: 'center', borderRadius: 8, flex: 1, justifyContent: 'center', minHeight: 48 },
  primaryButton: { backgroundColor: COLORS.primary },
  primaryText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  secondaryButton: { backgroundColor: COLORS.gray[100] },
  secondaryText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  outlineButton: { borderColor: COLORS.warning, borderWidth: 1 },
  outlineText: { color: COLORS.warning, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
