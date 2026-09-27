import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { ActivityOverride, EventActivity, EventOccurrence } from '../../types/models';
import { findActivityOverride, getEffectiveActivityEnabled } from '../../utils/eventActivity';

export interface ActivityChipListProps {
  activities: EventActivity[];
  /** When given, per-occurrence override badges are shown. */
  occurrence?: Pick<EventOccurrence, 'activityOverrides' | 'selfServiceEnabled'> | null;
}

/** Badges for overrides that change the effective value on this occurrence only. */
export function getOverrideBadges(
  activity: Pick<EventActivity, 'enabled'>,
  override: ActivityOverride | undefined,
  occurrence: Pick<EventOccurrence, 'selfServiceEnabled'> | null | undefined,
): string[] {
  if (!override) return [];
  const badges: string[] = [];
  if (typeof override.enabled === 'boolean' && override.enabled !== activity.enabled) {
    badges.push(override.enabled ? 'Enabled (this day only)' : 'Disabled (this day only)');
  }
  if (
    typeof override.selfServiceEnabled === 'boolean'
    && override.selfServiceEnabled !== Boolean(occurrence?.selfServiceEnabled)
  ) {
    badges.push(override.selfServiceEnabled ? 'Self-service (this day only)' : 'No self-service (this day only)');
  }
  if (Array.isArray(override.allowedTypeCodes)) {
    badges.push('ID types narrowed (this day only)');
  }
  return badges;
}

export default function ActivityChipList({ activities, occurrence }: ActivityChipListProps) {
  const sorted = [...activities].sort((a, b) => a.sequenceNo - b.sequenceNo);

  if (sorted.length === 0) {
    return <Text style={styles.empty}>No activities defined.</Text>;
  }

  return (
    <View style={styles.list}>
      {sorted.map((activity) => {
        const override = occurrence ? findActivityOverride(occurrence, activity.activityId) : undefined;
        const enabled = getEffectiveActivityEnabled(activity, override);
        const badges = getOverrideBadges(activity, override, occurrence);
        return (
          <View key={activity.activityId} style={[styles.chip, !enabled && styles.chipDisabled]}>
            <View style={styles.chipRow}>
              <Text style={[styles.chipText, !enabled && styles.chipTextDisabled]}>
                {activity.sequenceNo}. {activity.name}
              </Text>
              {activity.mandatory ? (
                <MaterialIcons accessibilityLabel="Mandatory" name="star" size={14} color={COLORS.warning} />
              ) : null}
              {!enabled ? <Text style={styles.stateText}>Disabled</Text> : null}
            </View>
            {badges.map((badge) => (
              <Text key={badge} style={styles.badge}>{badge}</Text>
            ))}
            {override?.note ? <Text style={styles.note}>{override.note}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { color: COLORS.textSecondary, fontSize: 13 },
  chip: {
    backgroundColor: COLORS.gray[100],
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    maxWidth: 320,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipDisabled: { backgroundColor: COLORS.gray[50], borderStyle: 'dashed' },
  chipRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextDisabled: { color: COLORS.textDisabled, textDecorationLine: 'line-through' },
  stateText: { color: COLORS.textSecondary, fontSize: 11 },
  badge: {
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
  note: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
});
