import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { FontAwesome6, MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { Ride, RideStatus, Stage, StageType } from '../../types/models';

const formatRideStatusLabel = (status: RideStatus): string => status.replaceAll('_', ' ');

const formatTimeOnly = (value?: string): string => {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateShort = (value?: string): string => {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getStageLabel = (stageNumber: number, totalStages: number): string => {
  if (stageNumber === 0) return 'Start';
  if (stageNumber === totalStages - 1) return 'Finish';
  return `PS${stageNumber}`;
};

const buildRideDateTime = (rideDate: string, time?: string): string | null => {
  if (!time) return null;

  const parsed = new Date(`${rideDate}T${time.length === 5 ? `${time}:00` : time}Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
};

const addMinutes = (value: string, minutes: number): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Date(parsed.getTime() + minutes * 60_000).toISOString();
};

const getRideTimelineStart = (ride: Ride): string | null => {
  return ride.openedAt ?? ride.startedAt ?? buildRideDateTime(ride.date, ride.flagOffTime ?? ride.openTime) ?? null;
};

const getPlannedRideStart = (ride: Ride): string | null => {
  return buildRideDateTime(ride.date, ride.flagOffTime ?? ride.openTime);
};

const getPitStopWindow = (ride: Ride, stage: Stage): { openedAt?: string; closedAt?: string } => {
  const rideStart = getRideTimelineStart(ride);
  const plannedOpenAt = rideStart && typeof stage.estimatedOpenTime === 'number' ? addMinutes(rideStart, stage.estimatedOpenTime) : undefined;
  const openedAt = stage.openedAt ?? plannedOpenAt;
  const closedAt = stage.closedAt ?? (openedAt && typeof stage.pitStopDuration === 'number' ? addMinutes(openedAt, stage.pitStopDuration) : undefined);

  return { openedAt, closedAt };
};

const getTimelineTone = (index: number): string => {
  const tones = [COLORS.accent, COLORS.primary, COLORS.success, COLORS.warning, COLORS.danger];
  return tones[index % tones.length];
};

const getFloatTargetStageName = (ride: Ride, floatToStage: number): string => {
  const targetStage = ride.stages.find((stage) => stage.stageNumber === floatToStage);
  return targetStage?.name ?? `Stage ${floatToStage}`;
};

export interface RideInfoContentProps {
  ride: Ride;
  showCloseButton?: boolean;
  onClose?: () => void;
  cardStyle?: StyleProp<ViewStyle>;
}

export function RideInfoContent({ ride, showCloseButton = true, onClose, cardStyle }: RideInfoContentProps) {
  const canClose = showCloseButton && typeof onClose === 'function';
  const pitStops = ride.stages.filter((stage) => stage.type === StageType.PIT_STOP).sort((a, b) => a.stageNumber - b.stageNumber);
  const floats = [...(ride.floats ?? [])].sort((a, b) => a.floatNo - b.floatNo);
  const hasFloats = floats.length > 0;
  const hasMultipleFloats = floats.length > 1;
  const isFutureRide = ride.status === 'PLANNED';
  const plannedRideStart = getPlannedRideStart(ride);
  const rideTimelineStart = isFutureRide
    ? plannedRideStart
    : (ride.openedAt ?? ride.startedAt ?? plannedRideStart ?? getRideTimelineStart(ride));

  return (
    <View style={[styles.rideInfoCard, cardStyle]}>
      <View style={styles.rideInfoHeader}>
        <View style={styles.rideInfoTitleWrap}>
          <Text style={styles.rideInfoTitle}>{ride.name}</Text>
          <View style={styles.rideInfoHeaderMetaRow}>
            <Text style={styles.rideInfoSubtitle}>{formatDateShort(ride.date)}</Text>
            <View style={styles.rideInfoStatusChip}>
              <Text style={styles.rideInfoStatusChipText}>{formatRideStatusLabel(ride.status)}</Text>
            </View>
          </View>
        </View>
        {canClose && (
          <TouchableOpacity style={styles.rideInfoCloseButton} onPress={onClose}>
            <MaterialIcons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.rideInfoBody}>
        <View style={styles.rideInfoRouteStack}>
          <View style={styles.rideInfoRouteStackRow}>
            <View style={[styles.rideInfoRouteIcon, { backgroundColor: COLORS.success + '1A' }]}>
              <MaterialIcons name="flag" size={22} color={COLORS.success} />
            </View>
            <View style={styles.rideInfoRouteTextWrap}>
              <Text style={styles.rideInfoRouteStackLabel}>Start</Text>
              <Text style={styles.rideInfoRouteStackValue} numberOfLines={1}>{ride.startLocation}</Text>
            </View>
          </View>
          <View style={styles.rideInfoRouteCenterRow}>
            <View style={styles.rideInfoRouteStackConnector} />
            <View style={styles.rideInfoRouteDistanceBadge}>
              <MaterialIcons name="route" size={12} color={COLORS.textSecondary} />
              <Text style={styles.rideInfoRouteDistanceText}>{ride.totalDistance} km</Text>
            </View>
          </View>
          <View style={styles.rideInfoRouteStackRow}>
            <View style={[styles.rideInfoRouteIcon, { backgroundColor: COLORS.danger + '1A' }]}>
              <MaterialIcons name="flag" size={22} color={COLORS.danger} />
            </View>
            <View style={styles.rideInfoRouteTextWrap}>
              <Text style={styles.rideInfoRouteStackLabel}>Finish</Text>
              <Text style={styles.rideInfoRouteStackValue} numberOfLines={1}>{ride.finishLocation}</Text>
            </View>
          </View>
        </View>

        {hasFloats && (
          <View style={styles.rideInfoSection}>
            <View style={styles.rideInfoSectionHeader}>
              <View style={styles.rideInfoFloatHeaderTitle}>
                <FontAwesome6 name="truck-arrow-right" size={14} color={COLORS.textPrimary} />
                <Text style={styles.rideInfoSectionTitle}>{hasMultipleFloats ? 'Floats' : 'Float'}</Text>
              </View>
            </View>

            <View style={styles.rideInfoFloatList}>
              {floats.map((floatDef) => {
                const floatLabel = `Float-${floatDef.floatNo}`;
                const targetStageName = getFloatTargetStageName(ride, floatDef.floatToStage);

                return (
                  <View key={`float-${floatDef.floatNo}-${floatDef.floatToStage}`} style={styles.rideInfoFloatItem}>
                    {/* <Text style={styles.rideInfoFloatItemText}>
                      {floatLabel}From: Start  - To: {targetStageName}
                    </Text> */}
                    <View style={styles.rideInfoRouteDistanceBadge}>
                      <Text style={styles.rideInfoRouteDistanceText}>{floatLabel}</Text>
                    </View>
                    <Text style={styles.rideInfoFloatItemText}> Start  </Text>
                    <FontAwesome6 name="truck-arrow-right" size={10} color="black" />
                    <Text style={styles.rideInfoFloatItemText}>  {targetStageName}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.rideInfoSection}>
          <View style={styles.rideInfoSectionHeader}>
            <Text style={styles.rideInfoSectionTitle}>Timeline</Text>
          </View>

          <View style={styles.rideInfoTimelineRail}>
            <View style={styles.rideInfoTimelineNode}>
              <View style={[styles.rideInfoTimelineIconBubble, { backgroundColor: COLORS.success + '1A' }]}>
                <MaterialIcons name="flag" size={22} color={COLORS.success} />
              </View>
              <View style={styles.rideInfoTimelineContent}>
                <View style={styles.rideInfoTimelineHeaderRow}>
                  <Text style={styles.rideInfoTimelineStageTitle}>Flag Off</Text>
                  <Text style={styles.rideInfoTimelineStageMeta}>{ride.startLocation}</Text>
                </View>
                {isFutureRide ? (
                  <View style={styles.rideInfoTimelinePillRow}>
                    <View style={styles.rideInfoTimelinePill}>
                      <MaterialIcons name="schedule" size={12} color={COLORS.primary} />
                      <Text style={styles.rideInfoTimelinePillText}>Planned</Text>
                      <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(rideTimelineStart ?? undefined)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.rideInfoTimelinePillRow}>
                    <View style={styles.rideInfoTimelinePill}>
                      <MaterialIcons name="play-circle-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.rideInfoTimelinePillText}>Opened</Text>
                      <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(ride.openedAt ?? undefined)}</Text>
                    </View>
                    <View style={styles.rideInfoTimelinePill}>
                      <MaterialIcons name="play-arrow" size={12} color={COLORS.primary} />
                      <Text style={styles.rideInfoTimelinePillText}>Started</Text>
                      <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(ride.startedAt ?? rideTimelineStart ?? undefined)}</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {pitStops.map((stage, index) => {
              const stageWindow = getPitStopWindow(ride, stage);
              const tone = getTimelineTone(index);
              const isOpenActual = Boolean(stage.openedAt);
              const isCloseActual = Boolean(stage.closedAt);

              return (
                <View key={stage.stageId} style={styles.rideInfoTimelineNode}>
                  <View style={[styles.rideInfoTimelineIconBubble, { backgroundColor: tone + '18' }]}>
                    <MaterialIcons name="directions-bike" size={16} color={tone} />
                  </View>
                  <View style={styles.rideInfoTimelineContent}>
                    <View style={styles.rideInfoTimelineHeaderRow}>
                      <View style={[styles.rideInfoStageBadge, { backgroundColor: tone + '18' }]}>
                        <Text style={[styles.rideInfoStageBadgeText, { color: tone }]}>{getStageLabel(stage.stageNumber, ride.stages.length)}</Text>
                      </View>
                      <Text style={styles.rideInfoTimelineStageMeta} numberOfLines={1}>{stage.name}</Text>
                    </View>

                    <View style={styles.rideInfoStageMetricsRow}>
                      <View style={styles.rideInfoStageMetric}>
                        <MaterialIcons name="place" size={12} color={COLORS.textSecondary} />
                        <Text style={styles.rideInfoStageMetricText}>{stage.distanceFromStart ?? 'N/A'} km</Text>
                      </View>
                      <View style={styles.rideInfoStageMetric}>
                        <MaterialIcons name="timer" size={12} color={COLORS.textSecondary} />
                        <Text style={styles.rideInfoStageMetricText}>{typeof stage.pitStopDuration === 'number' ? `${stage.pitStopDuration} min` : 'N/A'}</Text>
                      </View>
                    </View>

                    <View style={styles.rideInfoTimelinePillRow}>
                      <View style={styles.rideInfoTimelinePill}>
                        <MaterialIcons name="login" size={12} color={COLORS.primary} />
                        <Text style={styles.rideInfoTimelinePillText}>{isOpenActual ? 'Opened' : 'Opens'}</Text>
                        <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(stageWindow.openedAt)}</Text>
                      </View>
                      <View style={styles.rideInfoTimelinePill}>
                        <MaterialIcons name="logout" size={12} color={COLORS.primary} />
                        <Text style={styles.rideInfoTimelinePillText}>{isCloseActual ? 'Closed' : 'Closes'}</Text>
                        <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(stageWindow.closedAt)}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              );
            })}

            <View style={styles.rideInfoTimelineNode}>
              <View style={[styles.rideInfoTimelineIconBubble, { backgroundColor: COLORS.danger + '1A' }]}>
                <MaterialIcons name="flag" size={22} color={COLORS.danger} />
              </View>
              <View style={styles.rideInfoTimelineContent}>
                <View style={styles.rideInfoTimelineHeaderRow}>
                  <Text style={styles.rideInfoTimelineStageTitle}>Finish at</Text>
                  <Text style={styles.rideInfoTimelineStageMeta}>{ride.finishLocation}</Text>
                  <Text style={styles.rideInfoTimelineStageTitle}>by</Text>
                </View>
                <View style={styles.rideInfoTimelinePillRow}>
                  <View style={styles.rideInfoTimelinePill}>
                    <MaterialIcons name="flag" size={12} color={COLORS.primary} />
                    <Text style={styles.rideInfoTimelinePillText}>{ride.completedAt || ride.closedAt ? 'Arrived' : 'Planned'}</Text>
                    <Text style={styles.rideInfoTimelinePillTime}>{formatTimeOnly(ride.completedAt ?? ride.closedAt ?? buildRideDateTime(ride.date, ride.closeTime) ?? undefined)}</Text>
                  </View>
                </View>
              </View>
            </View>
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
    // Both removed to allow the card to expand and scroll if content exceeds available space
    // maxHeight: '100%',
    // overflow: 'hidden',
  },
  rideInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rideInfoTitleWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rideInfoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rideInfoSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  rideInfoCloseButton: {
    padding: 4,
  },
  rideInfoBody: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  rideInfoStatusChip: {
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
  rideInfoHeaderMetaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rideInfoRouteIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rideInfoRouteTextWrap: {
    flex: 1,
  },
  rideInfoRouteStack: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 4,
  },
  rideInfoRouteStackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rideInfoRouteStackConnector: {
    marginLeft: 13,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.gray[300],
    height: 10,
  },
  rideInfoRouteCenterRow: {
    marginLeft: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rideInfoRouteDistanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rideInfoRouteDistanceText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  rideInfoRouteStackLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  rideInfoRouteStackValue: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  rideInfoSection: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  rideInfoSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rideInfoSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rideInfoFloatHeaderTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rideInfoFloatList: {
    gap: 6,
  },
  rideInfoFloatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rideInfoFloatItemText: {
    fontSize: 11,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  rideInfoTimelineRail: {
    gap: 7,
  },
  rideInfoTimelineNode: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  rideInfoTimelineIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rideInfoTimelineContent: {
    flex: 1,
    gap: 5,
  },
  rideInfoTimelineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  rideInfoTimelineStageTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rideInfoTimelineStageMeta: {
    fontSize: 11,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  rideInfoStageBadge: {
    backgroundColor: COLORS.primary + '1A',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  rideInfoStageBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  rideInfoStageMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  rideInfoStageMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.gray[100],
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  rideInfoStageMetricText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  rideInfoTimelinePillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  rideInfoTimelinePill: {
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  rideInfoTimelinePillText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  rideInfoTimelinePillTime: {
    marginLeft: 'auto',
    fontSize: 10,
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
});
