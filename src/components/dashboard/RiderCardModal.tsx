/**
 * Rider Card popup — shared by the Dashboard tab (rider icon tap) and the
 * Check-In Log tab (row action sheet). Fetches rider profile + timeline for
 * the given ride/rider on demand and renders the same read-only card.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, ActivityIndicator, useWindowDimensions, Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { loadRideRiderDetails, OfflineDataUnavailableError } from '../../services/offline/offlineDataService';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import { getRiderProfileAttributeDownloadUrl } from '../../services/api/riderApi';
import { loadEnabledRiderProfileDefinitions } from '../../services/riderProfile/riderProfileConfigService';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { buildRiderStatuses, getRiderFloatDefinition, resolveStageForCheckIn } from '../../utils/riderStatus';
import { canEditAdminOnlyRiderProfileAttributes } from '../../utils/riderProfilePermissions';
import { orderDefinitionsIntoSections } from '../../utils/riderProfileDefinitions';
import { logger } from '../../utils/logger';
import { CheckIn, CheckInStatus, isCancelledCheckIn, Ride, RiderDetailsData, RiderStatus, Stage, TourRiderStatus } from '../../types/models';
import { COLORS, getStageColor } from '../../constants/colors';
import { navigationRef } from '../../navigation/navigationRef';
import { OrderedRiderProfileSection, RiderProfileLovDefinition } from '../../types/riderProfile';
import RiderProfileRenderer from '../riderProfile/RiderProfileRenderer';
import RiderProfileAdminEditModal from '../riderProfile/RiderProfileAdminEditModal';

interface RiderCardModalProps {
  visible: boolean;
  tourId: string | undefined;
  ride: Ride | null;
  riderId: string | null;
  onClose: () => void;
}

function getStageLabel(stageNumber: number, totalStages: number): string {
  if (stageNumber === 0) return 'Start';
  if (stageNumber === totalStages - 1) return 'Finish';
  return `PS${stageNumber}`;
}

function getFloatTargetLabel(floatToStage: number, totalStages: number): string {
  return getStageLabel(floatToStage, totalStages);
}

function getStageDisplayName(stage: Stage, totalStages: number): string {
  const name = stage.name?.trim();
  if (name) return name;
  return getStageLabel(stage.stageNumber, totalStages);
}

function formatDateTimeForDisplay(value?: string): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function getLatestCheckInForStage(ride: Ride, riderStatus: RiderStatus, stageNumber: number): CheckIn | undefined {
  const targetStage = ride.stages.find((stage) => stage.stageNumber === stageNumber);
  if (!targetStage) return undefined;

  return riderStatus.checkInHistory
    .filter((ci) => ci.stageId === targetStage.stageId || ci.stageNumber === targetStage.stageNumber)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .pop();
}

function getLatestSpecialCheckIn(riderStatus: RiderStatus, kind: 'NR' | 'QR'): CheckIn | undefined {
  return riderStatus.checkInHistory
    .filter((ci) => (kind === 'NR' ? ci.isNotRiding : ci.isQuitRiding))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .pop();
}

function hasRegularCheckInAtStage(ride: Ride, riderStatus: RiderStatus, stageNumber: number): boolean {
  const targetStage = ride.stages.find((stage) => stage.stageNumber === stageNumber);
  if (!targetStage) return false;

  return riderStatus.checkInHistory.some((ci) => {
    const matchedStage = resolveStageForCheckIn(ride, ci);
    return matchedStage?.stageId === targetStage.stageId && !ci.isNotRiding && !ci.isQuitRiding && !isCancelledCheckIn(ci);
  });
}

function hasRegularCheckInAfterStage(ride: Ride, riderStatus: RiderStatus, stageNumber: number): boolean {
  const targetStage = ride.stages.find((stage) => stage.stageNumber === stageNumber);
  if (!targetStage) return false;

  return riderStatus.checkInHistory.some((ci) => {
    const matchedStage = resolveStageForCheckIn(ride, ci);
    return matchedStage !== undefined
      && matchedStage.stageNumber > targetStage.stageNumber
      && !ci.isNotRiding && !ci.isQuitRiding && !isCancelledCheckIn(ci);
  });
}

function isExitedTourRider(status?: string): boolean {
  return typeof status === 'string' && status.trim().toUpperCase() === TourRiderStatus.EXITED;
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function hasDisplayValue(value: unknown): boolean {
  return value !== null
    && value !== undefined
    && value !== ''
    && (!Array.isArray(value) || value.length > 0);
}

export default function RiderCardModal({ visible, tourId, ride, riderId, onClose }: RiderCardModalProps) {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const { width, height } = useWindowDimensions();
  const [details, setDetails] = useState<RiderDetailsData | null>(null);
  const [profileSections, setProfileSections] = useState<OrderedRiderProfileSection[]>([]);
  const [lovsById, setLovsById] = useState<Record<string, RiderProfileLovDefinition>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isAdminEditVisible, setIsAdminEditVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEditAdminFields = user ? canEditAdminOnlyRiderProfileAttributes(user.userRole) && !isOffline : false;

  const load = useCallback(async () => {
    if (!tourId || !ride || !riderId) return;

    setIsLoading(true);
    setError(null);
    setDownloadError(null);
    setDetails(null);
    try {
      const [{ data }, definitions] = await Promise.all([
        loadRideRiderDetails(tourId, ride.rideId, riderId),
        loadEnabledRiderProfileDefinitions().catch(() => null),
      ]);
      if (!data) {
        setError('Rider details are not available for this rider.');
        return;
      }

      // Rider-details timeline entries may omit riderId/rideId since they are
      // already scoped to this rider + ride; backfill for buildRiderStatuses().
      setDetails({
        ...data,
        checkInTimeline: data.checkInTimeline.map((ci) => ({
          ...ci,
          riderId: ci.riderId || data.rider.riderId,
          rideId: ci.rideId || ride.rideId,
        })),
      });
      if (definitions) {
        setProfileSections(orderDefinitionsIntoSections(definitions.sections, definitions.attributes));
        setLovsById(Object.fromEntries(definitions.lovs.map((lov) => [lov.configId, lov])));
      } else {
        setProfileSections([]);
        setLovsById({});
      }
    } catch (err) {
      logger.error('RiderCardModal', 'Failed to load rider details', err);
      const isApiError = err instanceof ApiError || (err as ApiError)?.name === 'ApiError';
      if (err instanceof OfflineDataUnavailableError) {
        setError(err.message);
      } else if (isApiError) {
        const apiErr = err as ApiError;
        setError(apiErr.statusCode >= 500
          ? 'The server encountered an error. Please try again later.'
          : (apiErr.message || 'Failed to load rider details. Please try again.'));
      } else if (isNetworkError(err)) {
        setError('Unable to reach the server. Please check your internet connection and try again.');
      } else {
        setError('Failed to load rider details. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [tourId, ride, riderId]);

  useEffect(() => {
    if (visible && riderId) {
      void load();
    } else if (!visible) {
      setDetails(null);
      setProfileSections([]);
      setLovsById({});
      setRevealedKeys(new Set());
      setDownloadError(null);
      setIsAdminEditVisible(false);
      setError(null);
      setIsLoading(false);
    }
  }, [visible, riderId, load]);

  const selectedRider: RiderStatus | null = ride && details
    ? buildRiderStatuses(ride, [details.rider], details.checkInTimeline)[0] ?? null
    : null;
  const hasExitedTour = selectedRider ? isExitedTourRider(selectedRider.rider.status) : false;
  const riderFloatDef = ride && selectedRider ? getRiderFloatDefinition(ride, selectedRider) : null;
  const floatChipLabel = riderFloatDef && ride
    ? `Float${riderFloatDef.floatNo > 1 ? `-${riderFloatDef.floatNo}` : ''} → ${getFloatTargetLabel(riderFloatDef.floatToStage, ride.stages.length)}`
    : null;
  const profileValues = useMemo(() => {
    if (!details) return {};
    const backendValues = details.profileAttributes ?? details.rider.attributes ?? {};
    const values: Record<string, unknown> = { ...backendValues };
    profileSections.forEach((section) => {
      section.attributes.forEach((attribute) => {
        if (Object.prototype.hasOwnProperty.call(values, attribute.configId)) {
          return;
        }
        if (attribute.config.storage.scope === 'CORE') {
          values[attribute.configId] = getPathValue(details.rider as unknown as Record<string, unknown>, attribute.config.storage.path);
        }
      });
    });
    return values;
  }, [details, profileSections]);
  const hasProfileValues = useMemo(
    () => profileSections.some((section) =>
      section.attributes.some((attribute) => hasDisplayValue(profileValues[attribute.configId]))),
    [profileSections, profileValues],
  );

  const handleViewProfileFile = useCallback(async (key: string) => {
    if (!details?.rider.profileId) {
      setDownloadError('This rider profile does not have a downloadable file for that attribute.');
      return;
    }

    try {
      const url = await getRiderProfileAttributeDownloadUrl(details.rider.profileId, key);
      if (!url) {
        setDownloadError('File download is not available for that attribute.');
        return;
      }
      await Linking.openURL(url);
      setDownloadError(null);
    } catch (err) {
      const apiError = err instanceof ApiError ? err.message : 'Failed to open the file. Please try again.';
      setDownloadError(apiError);
    }
  }, [details?.rider.profileId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[styles.riderCard, { width: Math.min(width * 0.92, 460), maxHeight: height * 0.9 }]}
          activeOpacity={1}
          onPress={() => {
            // Keep modal open while interacting inside the rider card.
          }}
        >
          {isLoading && (
            <View style={styles.riderCardLoadingState}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.riderCardLoadingText}>Loading rider details...</Text>
            </View>
          )}

          {!isLoading && error && (
            <View style={styles.riderCardLoadingState}>
              <Text style={styles.riderCardErrorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void load()}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isLoading && !error && selectedRider && ride && (
            <ScrollView style={styles.riderCardScroll} contentContainerStyle={styles.riderCardScrollContent} showsVerticalScrollIndicator>
              <View style={styles.riderCardHeader}>
                <MaterialIcons name="account-circle" size={80} color={COLORS.gray[400]} style={styles.riderCardIcon} />
                <Text style={styles.riderCardId}>{selectedRider.rider.riderId}</Text>
                <Text style={styles.riderCardName}>{selectedRider.rider.name}</Text>
                <Text style={styles.riderCardContact}>{selectedRider.rider.phone || 'N/A'}</Text>
                {hasExitedTour && (
                  <View style={styles.exitedStatusChip}>
                    <Text style={styles.exitedStatusChipText}>Exited tour</Text>
                  </View>
                )}
                {floatChipLabel && (
                  <View style={styles.floatStatusChip}>
                    <Text style={styles.floatStatusChipText}>{floatChipLabel}</Text>
                  </View>
                )}
              </View>

              <View style={styles.riderCardSection}>
                {profileSections.length > 0 && hasProfileValues ? (
                  <>
                    <Text style={styles.riderCardSectionTitle}>Profile attributes</Text>
                    {downloadError ? <Text style={styles.riderCardErrorText}>{downloadError}</Text> : null}
                    <RiderProfileRenderer
                      sections={profileSections}
                      values={profileValues}
                      lovsById={lovsById}
                      sensitiveKeys={details?.sensitiveKeys}
                      revealedKeys={revealedKeys}
                      onToggleReveal={(key) => setRevealedKeys((current) => {
                        const next = new Set(current);
                        if (next.has(key)) {
                          next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      })}
                      onViewFile={(key) => void handleViewProfileFile(key)}
                      filterAttribute={(attribute) => hasDisplayValue(profileValues[attribute.configId])}
                    />
                  </>
                ) : null}

                {selectedRider.overallStatus === CheckInStatus.NOT_RIDING ? (
                  (() => {
                    const notRidingCheckIn = getLatestSpecialCheckIn(selectedRider, 'NR');
                    return (
                      <>
                        <Text style={styles.riderCardSectionTitle}>Not Riding</Text>
                        <Text style={styles.riderSpecialStatusTime}>
                          {notRidingCheckIn
                            ? `Marked at ${formatDateTimeForDisplay(notRidingCheckIn.timestamp)}`
                            : 'Marked as Not Riding'}
                        </Text>
                      </>
                    );
                  })()
                ) : (
                  <>
                    <Text style={styles.riderCardSectionTitle}>Stage Check-ins</Text>
                    {(() => {
                      const sortedStages = [...ride.stages].sort((a, b) => a.stageNumber - b.stageNumber);

                      if (selectedRider.overallStatus === CheckInStatus.QUIT_RIDING) {
                        const quitCheckIn = getLatestSpecialCheckIn(selectedRider, 'QR');
                        const quitTime = quitCheckIn ? new Date(quitCheckIn.timestamp).getTime() : Number.POSITIVE_INFINITY;

                        const regularStages = sortedStages.filter((stage) => {
                          const checkIn = getLatestCheckInForStage(ride, selectedRider, stage.stageNumber);
                          if (!checkIn || checkIn.isNotRiding || checkIn.isQuitRiding) return false;
                          return new Date(checkIn.timestamp).getTime() <= quitTime;
                        });

                        return (
                          <>
                            {regularStages.map((stage) => {
                              const checkIn = getLatestCheckInForStage(ride, selectedRider, stage.stageNumber);
                              const stageColor = getStageColor(stage.stageNumber, ride.stages.length);

                              return (
                                <View key={stage.stageId} style={styles.riderStageRow}>
                                  <View style={styles.riderStageHeaderRow}>
                                    <View style={[styles.riderStageNameChip, { backgroundColor: stageColor }]}>
                                      <Text style={styles.riderStageNameChipText}>
                                        {getStageDisplayName(stage, ride.stages.length)}
                                      </Text>
                                    </View>
                                  </View>
                                  <Text style={styles.riderStageTime}>{formatDateTimeForDisplay(checkIn?.timestamp)}</Text>
                                </View>
                              );
                            })}

                            <View style={styles.riderStageRow}>
                              <View style={styles.riderStageHeaderRow}>
                                <View style={[styles.riderStageNameChip, styles.riderQuitChip]}>
                                  <Text style={styles.riderStageNameChipText}>Quit Riding</Text>
                                </View>
                              </View>
                              <Text style={styles.riderStageTime}>
                                {quitCheckIn ? formatDateTimeForDisplay(quitCheckIn.timestamp) : 'Marked as Quit Riding'}
                              </Text>
                            </View>
                          </>
                        );
                      }

                      return sortedStages.map((stage) => {
                        const checkIn = getLatestCheckInForStage(ride, selectedRider, stage.stageNumber);
                        const stageColor = getStageColor(stage.stageNumber, ride.stages.length);
                        const isSkippedStage = hasRegularCheckInAfterStage(ride, selectedRider, stage.stageNumber)
                          && !hasRegularCheckInAtStage(ride, selectedRider, stage.stageNumber);

                        return (
                          <View key={stage.stageId} style={styles.riderStageRow}>
                            <View style={styles.riderStageHeaderRow}>
                              <View style={[styles.riderStageNameChip, { backgroundColor: stageColor }]}>
                                <Text style={styles.riderStageNameChipText}>
                                  {getStageDisplayName(stage, ride.stages.length)}
                                </Text>
                              </View>
                              {isSkippedStage && (
                                <View style={styles.riderStageWarningBadge}>
                                  <Text style={styles.riderStageWarningMark}>!</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.riderStageTime}>
                              {checkIn ? formatDateTimeForDisplay(checkIn.timestamp) : 'Not checked in'}
                            </Text>
                          </View>
                        );
                      });
                    })()}
                  </>
                )}
              </View>

              {canEditAdminFields && details ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.secondaryButton}
                  onPress={() => setIsAdminEditVisible(true)}
                >
                  <Text style={styles.secondaryButtonText}>Edit admin fields</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={() => {
                  const targetRiderId = selectedRider.rider.riderId;
                  onClose();
                  if (navigationRef.isReady()) navigationRef.navigate('RiderProgress', { riderId: targetRiderId });
                }}
              >
                <Text style={styles.secondaryButtonText}>View event progress</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
      {details ? (
        <RiderProfileAdminEditModal
          visible={isAdminEditVisible}
          rider={details.rider}
          details={details}
          sections={profileSections}
          lovsById={lovsById}
          onClose={() => setIsAdminEditVisible(false)}
          onSaved={load}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  riderCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    maxWidth: 420,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  riderCardScroll: {
    flexGrow: 0,
  },
  riderCardScrollContent: {
    paddingBottom: 4,
  },
  riderCardLoadingState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  riderCardLoadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  riderCardErrorText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  riderCardHeader: {
    alignItems: 'center',
  },
  riderCardIcon: {
    marginBottom: 8,
  },
  riderCardId: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  riderCardName: {
    fontSize: 16,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  riderCardContact: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  exitedStatusChip: {
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
  },
  exitedStatusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#991B1B',
  },
  floatStatusChip: {
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#DBEAFE',
  },
  floatStatusChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  riderCardSection: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  riderCardSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  riderStageRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  riderStageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  riderStageNameChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  riderQuitChip: {
    backgroundColor: COLORS.danger,
  },
  riderStageNameChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.white,
  },
  riderStageTime: {
    marginTop: 4,
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  riderStageWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFF8E1',
  },
  riderStageWarningMark: {
    fontSize: 14,
    lineHeight: 14,
    fontWeight: '900',
    color: '#92400E',
  },
  riderSpecialStatusTime: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  secondaryButton: {
    borderColor: COLORS.primary,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'center',
  },
  closeButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
