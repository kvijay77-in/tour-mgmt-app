import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, EVENT_ACTIVITY_STEP_COLORS } from '../../constants/colors';
import { DashboardActivity, countDone, ProgressStatus } from '../../utils/eventProgress';
import { ACTIVITY_STEP_ICONS, ACTIVITY_STEP_LABELS } from './ActivityStepper';

export interface ActivityProgressStripProps {
  riderId: string;
  activities: readonly DashboardActivity[];
  statuses: Readonly<Record<string, ProgressStatus>>;
}

/** Compact horizontal stepper (no labels): one node per activity, equal widths, joined by connectors. */
function ActivityProgressStrip({ riderId, activities, statuses }: ActivityProgressStripProps) {
  const done = countDone(statuses, activities.map((activity) => activity.activityId));
  return (
    <View
      accessible
      accessibilityLabel={`${riderId}: ${done} of ${activities.length} done`}
      style={styles.strip}
    >
      {activities.map((activity, index) => {
        const status = statuses[activity.activityId] ?? 'PENDING';
        return (
          <View
            key={activity.activityId}
            accessibilityLabel={`${activity.name}, ${ACTIVITY_STEP_LABELS[status]}`}
            style={styles.cell}
          >
            <View style={[styles.connector, index === 0 && styles.hidden]} />
            <MaterialIcons
              name={ACTIVITY_STEP_ICONS[status]}
              size={20}
              color={EVENT_ACTIVITY_STEP_COLORS[status]}
            />
            <View style={[styles.connector, index === activities.length - 1 && styles.hidden]} />
          </View>
        );
      })}
    </View>
  );
}

export default memo(ActivityProgressStrip);

const styles = StyleSheet.create({
  strip: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  cell: { alignItems: 'center', flex: 1, flexDirection: 'row', minWidth: 0 },
  connector: { backgroundColor: COLORS.border, flex: 1, height: 2 },
  hidden: { opacity: 0 },
});
