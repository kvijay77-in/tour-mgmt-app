/**
 * Rider pop-up for the event dashboard: initials avatar, contact and emergency
 * contact (tap to call) and the per-occurrence activity stepper. Uses dashboard
 * data only (no extra API call).
 */

import React, { useMemo } from 'react';
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { DashboardActivityStatus, EventDashboardRider } from '../../types/api';
import { EventActivityRecord, EventDefinition, EventOccurrence, EventRecordMethod } from '../../types/models';
import { buildActivitySteps } from '../../utils/eventActivity';
import { formatLocalTime, findRecord, isDoneStatus, ProgressStatus } from '../../utils/eventProgress';
import { isExitedTourRider } from '../../utils/riderStatus';
import ActivityStepper from './ActivityStepper';

export interface EventRiderCardModalProps {
  visible: boolean;
  rider: EventDashboardRider | null;
  event: EventDefinition | null;
  occurrence: EventOccurrence | null;
  activityIds: readonly string[];
  statuses: Readonly<Record<string, ProgressStatus>> | undefined;
  records: readonly EventActivityRecord[];
  onClose: () => void;
}

const METHOD_LABELS: Record<EventRecordMethod, string> = {
  QR_SCAN: 'QR',
  MANUAL: 'Manual',
  SELF_SERVICE: 'Self',
};

function initialsOf(name?: string, riderId?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (riderId ?? '?').slice(0, 2).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function callNumber(phone?: string) {
  const digits = (phone ?? '').replace(/[^0-9+]/g, '');
  if (digits) void Linking.openURL(`tel:${digits}`).catch(() => undefined);
}

export default function EventRiderCardModal({
  visible,
  rider,
  event,
  occurrence,
  activityIds,
  statuses,
  records,
  onClose,
}: EventRiderCardModalProps) {
  const { width, height } = useWindowDimensions();
  const { getAppUserDisplayName } = useNameDirectory();

  const steps = useMemo(() => {
    if (!rider || !event || !statuses) return [];
    const recorded: Record<string, DashboardActivityStatus> = {};
    const queued = new Set<string>();
    Object.entries(statuses).forEach(([activityId, status]) => {
      if (status === 'QUEUED') queued.add(activityId);
      else recorded[activityId] = status;
    });
    const allowed = new Set(activityIds);
    return buildActivitySteps(event, occurrence, recorded, queued)
      .filter((step) => allowed.has(step.activityId))
      .map((step) => {
        const record = findRecord(records, rider.riderId, step.activityId);
        const isDone = step.status !== 'BLOCKED' && isDoneStatus(step.status);
        const meta = record && isDone
          ? [
            formatLocalTime(record.timestamp),
            METHOD_LABELS[record.method],
            record.scannedBy ? getAppUserDisplayName(record.scannedBy) : '',
            record.variantSelected ?? '',
          ].filter(Boolean).join(' · ')
          : undefined;
        return { ...step, isSelf: record?.method === 'SELF_SERVICE', meta };
      });
  }, [rider, event, occurrence, activityIds, statuses, records, getAppUserDisplayName]);

  if (!rider) return null;

  const emergency = rider.emergencyContact;
  const emergencyLabel = [emergency?.name, emergency?.relation ? `(${emergency.relation})` : ''].filter(Boolean).join(' ');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.overlay}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.card, { maxHeight: height * 0.9, width: Math.min(width * 0.92, 460) }]}
        >
          <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.close}>
            <MaterialIcons name="close" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(rider.name, rider.riderId)}</Text>
              </View>
              <Text style={styles.riderId}>{rider.riderId}</Text>
              {rider.name ? <Text style={styles.name}>{rider.name}</Text> : null}
              {isExitedTourRider(rider.status) ? (
                <View style={styles.exitedChip}>
                  <Text style={styles.exitedChipText}>Exited tour</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              {rider.phone ? (
                <TouchableOpacity
                  accessibilityLabel={`Call ${rider.phone}`}
                  accessibilityRole="button"
                  onPress={() => callNumber(rider.phone)}
                  style={styles.contactRow}
                >
                  <MaterialIcons name="phone" size={18} color={COLORS.primary} />
                  <Text style={styles.link}>{rider.phone}</Text>
                </TouchableOpacity>
              ) : null}
              {emergency && (emergency.name || emergency.phone) ? (
                <View>
                  <Text style={styles.sectionTitle}>Emergency contact</Text>
                  {emergencyLabel ? <Text style={styles.value}>{emergencyLabel}</Text> : null}
                  {emergency.phone ? (
                    <TouchableOpacity
                      accessibilityLabel={`Call emergency contact ${emergency.phone}`}
                      accessibilityRole="button"
                      onPress={() => callNumber(emergency.phone)}
                      style={styles.contactRow}
                    >
                      <MaterialIcons name="phone" size={18} color={COLORS.primary} />
                      <Text style={styles.link}>{emergency.phone}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Activities</Text>
              <ActivityStepper steps={steps} />
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', flex: 1, justifyContent: 'center' },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, overflow: 'hidden' },
  close: { alignItems: 'center', height: 44, justifyContent: 'center', position: 'absolute', right: 4, top: 4, width: 44, zIndex: 1 },
  content: { padding: 20 },
  header: { alignItems: 'center', gap: 4, marginBottom: 12 },
  avatar: {
    alignItems: 'center',
    backgroundColor: COLORS.gray[200],
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  avatarText: { color: COLORS.gray[700], fontSize: 28, fontWeight: '700' },
  riderId: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 6 },
  name: { color: COLORS.textPrimary, fontSize: 16 },
  exitedChip: { backgroundColor: COLORS.gray[200], borderRadius: 12, marginTop: 4, paddingHorizontal: 10, paddingVertical: 4 },
  exitedChipText: { color: COLORS.gray[700], fontSize: 12, fontWeight: '700' },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase' },
  value: { color: COLORS.textPrimary, fontSize: 14 },
  contactRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 36 },
  link: { color: COLORS.primary, fontSize: 14 },
});
