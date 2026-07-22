import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { Ride, RideStatus, StageType } from '../../types/models';

const formatRideStatusLabel = (status: RideStatus): string => status.replaceAll('_', ' ');

const formatDateTimeForDisplay = (value?: string): string => {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString();
};

const getStageLabel = (stageNumber: number, totalStages: number): string => {
  if (stageNumber === 0) return 'Start';
  if (stageNumber === totalStages - 1) return 'Finish';
  return `PS${stageNumber}`;
};

export interface RideInfoContentProps {
  ride: Ride;
  showCloseButton?: boolean;
  onClose?: () => void;
  cardStyle?: StyleProp<ViewStyle>;
}

export function RideInfoContent({ ride, showCloseButton = true, onClose, cardStyle }: RideInfoContentProps) {
  const canClose = showCloseButton && typeof onClose === 'function';

  return (
    <View style={[styles.rideInfoCard, cardStyle]}>
      <View style={styles.rideInfoHeader}>
        <View style={styles.rideInfoTitleWrap}>
          <Text style={styles.rideInfoTitle}>{ride.name}</Text>
          <Text style={styles.rideInfoSubtitle}>{ride.date}</Text>
        </View>
        {canClose && (
          <TouchableOpacity style={styles.rideInfoCloseButton} onPress={onClose}>
            <MaterialIcons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.rideInfoBody}>
        <View style={styles.rideInfoStatusChip}>
          <Text style={styles.rideInfoStatusChipText}>{formatRideStatusLabel(ride.status)}</Text>
        </View>

        <View style={styles.rideInfoGrid}>
          <View style={styles.rideInfoItem}>
            <Text style={styles.rideInfoLabel}>Distance</Text>
            <Text style={styles.rideInfoValue}>{ride.totalDistance} km</Text>
          </View>
          <View style={styles.rideInfoItem}>
            <Text style={styles.rideInfoLabel}>Flag Off (Scheduled)</Text>
            <Text style={styles.rideInfoValue}>{ride.flagOffTime ?? 'N/A'}</Text>
          </View>
        </View>

        <View style={styles.rideInfoRouteStack}>
          <View style={styles.rideInfoRouteStackRow}>
            <MaterialIcons name="outlined-flag" size={14} color={COLORS.primary} />
            <Text style={styles.rideInfoRouteStackLabel}>From</Text>
            <Text style={styles.rideInfoRouteStackValue} numberOfLines={1}>{ride.startLocation}</Text>
          </View>
          <View style={styles.rideInfoRouteStackConnector} />
          <View style={styles.rideInfoRouteStackRow}>
            <MaterialIcons name="flag" size={14} color={COLORS.primary} />
            <Text style={styles.rideInfoRouteStackLabel}>To</Text>
            <Text style={styles.rideInfoRouteStackValue} numberOfLines={1}>{ride.finishLocation}</Text>
          </View>
        </View>

        <View style={styles.rideInfoSection}>
          <Text style={styles.rideInfoSectionTitle}>Timeline</Text>
          <View style={styles.rideInfoTimelineEventRow}>
            <MaterialIcons name="arrow-forward" size={13} color={COLORS.textSecondary} />
            <Text style={styles.rideInfoTimelineEventLabel}>Open Time</Text>
            <Text style={styles.rideInfoTimelineEventTime}>{formatDateTimeForDisplay(ride.openedAt)}</Text>
          </View>
          <View style={styles.rideInfoTimelineEventRow}>
            <MaterialIcons name="arrow-forward" size={13} color={COLORS.textSecondary} />
            <Text style={styles.rideInfoTimelineEventLabel}>Started</Text>
            <Text style={styles.rideInfoTimelineEventTime}>{formatDateTimeForDisplay(ride.startedAt)}</Text>
          </View>
          {ride.stages
            .filter((stage) => stage.type === StageType.PIT_STOP)
            .sort((a, b) => a.stageNumber - b.stageNumber)
            .map((stage) => (
              <View key={stage.stageId} style={styles.rideInfoPitStopGroup}>
                <View style={styles.rideInfoTimelineEventRow}>
                  <MaterialIcons name="arrow-forward" size={13} color={COLORS.textSecondary} />
                  <View style={styles.rideInfoTimelineEventLabelWrap}>
                    <View style={styles.rideInfoStageBadge}>
                      <Text style={styles.rideInfoStageBadgeText}>{getStageLabel(stage.stageNumber, ride.stages.length)}</Text>
                    </View>
                    <Text style={styles.rideInfoTimelineEventLabel}>Open</Text>
                  </View>
                  <Text style={styles.rideInfoTimelineEventTime}>{formatDateTimeForDisplay(stage.openedAt)}</Text>
                </View>
                <View style={styles.rideInfoTimelineEventRow}>
                  <MaterialIcons name="arrow-forward" size={13} color={COLORS.textSecondary} />
                  <View style={styles.rideInfoTimelineEventLabelWrap}>
                    <View style={styles.rideInfoStageBadge}>
                      <Text style={styles.rideInfoStageBadgeText}>{getStageLabel(stage.stageNumber, ride.stages.length)}</Text>
                    </View>
                    <Text style={styles.rideInfoTimelineEventLabel}>Close</Text>
                  </View>
                  <Text style={styles.rideInfoTimelineEventTime}>{formatDateTimeForDisplay(stage.closedAt)}</Text>
                </View>
              </View>
            ))}
          <View style={styles.rideInfoTimelineEventRow}>
            <MaterialIcons name="arrow-forward" size={13} color={COLORS.textSecondary} />
            <Text style={styles.rideInfoTimelineEventLabel}>Completed</Text>
            <Text style={styles.rideInfoTimelineEventTime}>{formatDateTimeForDisplay(ride.completedAt)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rideInfoCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    width: '100%',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    overflow: 'hidden',
  },
  rideInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rideInfoTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rideInfoTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rideInfoSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  rideInfoCloseButton: {
    padding: 4,
  },
  rideInfoBody: {
    padding: 14,
    gap: 10,
  },
  rideInfoStatusChip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '1A',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  rideInfoStatusChipText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  rideInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
  },
  rideInfoItem: {
    flex: 1,
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rideInfoLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  rideInfoValue: {
    fontSize: 12,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  rideInfoRouteStack: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 3,
  },
  rideInfoRouteStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rideInfoRouteStackConnector: {
    marginLeft: 7,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.gray[300],
    height: 8,
  },
  rideInfoRouteStackLabel: {
    width: 30,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  rideInfoRouteStackValue: {
    flex: 1,
    fontSize: 11,
    color: COLORS.textPrimary,
  },
  rideInfoSection: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 5,
  },
  rideInfoSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rideInfoTimelineEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rideInfoTimelineEventLabel: {
    width: 78,
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  rideInfoTimelineEventLabelWrap: {
    width: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rideInfoTimelineEventTime: {
    fontSize: 11,
    color: COLORS.textSecondary,
    flex: 1,
  },
  rideInfoPitStopGroup: {
    gap: 2,
  },
  rideInfoStageBadge: {
    backgroundColor: COLORS.primary + '1A',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    minWidth: 34,
    alignItems: 'center',
  },
  rideInfoStageBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
});
