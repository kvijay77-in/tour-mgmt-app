import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { EVENT_ACTIVITY_STEP_COLORS } from '../../constants/colors';
import { describeProgressStatus, ProgressStatus } from '../../utils/eventProgress';
import { ACTIVITY_STEP_ICONS } from './ActivityStepper';

export interface ActivityZoomNodeProps {
  status: ProgressStatus;
  /** Timestamp of the matching record, shown as local time for done statuses */
  timestamp?: string | null;
}

/** Enlarged single status node with text, used when the dashboard is zoomed on one activity. */
function ActivityZoomNode({ status, timestamp }: ActivityZoomNodeProps) {
  const color = EVENT_ACTIVITY_STEP_COLORS[status];
  const text = describeProgressStatus(status, timestamp);
  return (
    <View accessible accessibilityLabel={text} style={styles.container}>
      <MaterialIcons name={ACTIVITY_STEP_ICONS[status]} size={28} color={color} />
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
}

export default memo(ActivityZoomNode);

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8 },
  text: { fontSize: 14, fontWeight: '600' },
});
