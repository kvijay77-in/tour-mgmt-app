import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, EVENT_ACTIVITY_STEP_COLORS } from '../../constants/colors';
import { ActivityStep, ActivityStepStatus } from '../../utils/eventActivity';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export const ACTIVITY_STEP_LABELS: Record<ActivityStepStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  OPTED_OUT: 'Opted out',
  FLAGGED: 'Flagged',
  BLOCKED: 'Waiting for earlier activity',
  QUEUED: 'Saved on this device',
};

const ICONS: Record<ActivityStepStatus, IconName> = {
  PENDING: 'radio-button-unchecked',
  COMPLETED: 'check-circle',
  OPTED_OUT: 'remove-circle-outline',
  FLAGGED: 'flag',
  BLOCKED: 'lock-outline',
  QUEUED: 'schedule',
};

export interface ActivityStepperProps {
  steps: ActivityStep[];
}

/** Vertical stepper, one node per activity in sequence order. */
export default function ActivityStepper({ steps }: ActivityStepperProps) {
  return (
    <View accessibilityRole="list">
      {steps.map((step, index) => {
        const color = EVENT_ACTIVITY_STEP_COLORS[step.status];
        const label = ACTIVITY_STEP_LABELS[step.status];
        return (
          <View
            accessible
            accessibilityLabel={`${step.name}, ${label}${step.mandatory ? ', mandatory' : ''}`}
            key={step.activityId}
            style={styles.step}
          >
            <View style={styles.rail}>
              <MaterialIcons name={ICONS[step.status]} size={22} color={color} />
              {index < steps.length - 1 ? <View style={styles.connector} /> : null}
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>
                {step.name}
                {step.mandatory ? <Text style={styles.mandatory}> · Mandatory</Text> : null}
              </Text>
              <Text style={[styles.status, { color }]}>{label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 10, minHeight: 48 },
  rail: { alignItems: 'center', width: 24 },
  connector: { backgroundColor: COLORS.border, flex: 1, marginVertical: 2, width: 2 },
  body: { flex: 1, paddingBottom: 12 },
  name: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  mandatory: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '400' },
  status: { fontSize: 12, marginTop: 2 },
});
