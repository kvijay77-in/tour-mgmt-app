import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { COLORS, OCCURRENCE_STATUS_COLORS } from '../../constants/colors';
import { OccurrenceStatus } from '../../types/models';

export default function OccurrenceStatusBadge({ status }: { status: OccurrenceStatus }) {
  return (
    <Text accessibilityLabel={`Status ${status}`} style={[styles.badge, statusStyles[status]]}>
      {status}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});

const statusStyles = StyleSheet.create({
  [OccurrenceStatus.PLANNED]: { backgroundColor: OCCURRENCE_STATUS_COLORS.PLANNED },
  [OccurrenceStatus.ACTIVE]: { backgroundColor: OCCURRENCE_STATUS_COLORS.ACTIVE },
  [OccurrenceStatus.COMPLETED]: { backgroundColor: OCCURRENCE_STATUS_COLORS.COMPLETED },
  [OccurrenceStatus.CANCELLED]: { backgroundColor: OCCURRENCE_STATUS_COLORS.CANCELLED },
});
