import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { COLORS } from '../../constants/colors';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import {
  closeRide,
  listRides,
  openTodayRide,
  startTodayRide,
} from '../../services/api/rideApi';
import { Ride, RideStatus } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'RideStatusManagementScreen';

interface RideStatusManagementScreenProps {
  tourId: string;
  onClose: () => void;
  onStatusChanged?: () => void;
}

function statusBadgeStyle(status: RideStatus) {
  if (status === RideStatus.OPEN) {
    return { backgroundColor: '#DBEAFE', color: '#1E40AF' };
  }
  if (status === RideStatus.STARTED) {
    return { backgroundColor: '#FEF3C7', color: '#92400E' };
  }
  if (status === RideStatus.COMPLETED || status === RideStatus.CLOSED) {
    return { backgroundColor: '#DCFCE7', color: '#166534' };
  }
  return { backgroundColor: '#F3F4F6', color: COLORS.textSecondary };
}

function getFriendlyError(err: unknown): string {
  if (err instanceof ApiError || (err as ApiError)?.name === 'ApiError') {
    const apiErr = err as ApiError;
    if (apiErr.statusCode === 0) {
      return 'Unable to reach the server. Please check your internet connection and try again.';
    }
    return apiErr.message || 'Request failed. Please try again.';
  }
  if (isNetworkError(err)) {
    return 'Unable to reach the server. Please check your internet connection and try again.';
  }
  return 'An unexpected error occurred. Please try again.';
}

export default function RideStatusManagementScreen({
  tourId,
  onClose,
  onStatusChanged,
}: RideStatusManagementScreenProps) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingRideId, setSubmittingRideId] = useState<string | null>(null);

  const loadRides = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fetchedRides = await listRides(tourId);
      const sorted = [...fetchedRides].sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return (b.rideNo ?? 0) - (a.rideNo ?? 0);
      });
      setRides(sorted);
    } catch (err) {
      logger.error(TAG, 'loadRides failed', err);
      setError(getFriendlyError(err));
    } finally {
      setIsLoading(false);
    }
  }, [tourId]);

  React.useEffect(() => {
    loadRides();
  }, [loadRides]);

  const today = new Date().toISOString().split('T')[0];

  const todayRide = useMemo(
    () => rides.find((ride) => ride.date === today),
    [rides, today],
  );

  const completableRides = useMemo(
    () => rides.filter((ride) => ride.status === RideStatus.STARTED && ride.date <= today),
    [rides, today],
  );

  const withSubmission = useCallback(async (work: () => Promise<void>) => {
    setIsSubmitting(true);
    try {
      await work();
      await loadRides();
      if (onStatusChanged) {
        onStatusChanged();
      }
    } finally {
      setIsSubmitting(false);
      setSubmittingRideId(null);
    }
  }, [loadRides, onStatusChanged]);

  const handleOpenRide = useCallback(async () => {
    if (!todayRide || todayRide.status !== RideStatus.PLANNED) {
      Alert.alert('Action not allowed', 'Only today\'s ride in PLANNED status can be moved to OPEN.');
      return;
    }

    try {
      await withSubmission(async () => {
        await openTodayRide(tourId);
      });
    } catch (err) {
      logger.error(TAG, 'handleOpenRide failed', err);
      Alert.alert('Unable to open ride', getFriendlyError(err));
    }
  }, [todayRide, tourId, withSubmission]);

  const handleStartRide = useCallback(async () => {
    if (!todayRide || todayRide.status !== RideStatus.OPEN) {
      Alert.alert('Action not allowed', 'Only today\'s ride in OPEN status can be moved to STARTED.');
      return;
    }

    try {
      await withSubmission(async () => {
        await startTodayRide(tourId);
      });
    } catch (err) {
      logger.error(TAG, 'handleStartRide failed', err);
      Alert.alert('Unable to start ride', getFriendlyError(err));
    }
  }, [todayRide, tourId, withSubmission]);

  const handleCompleteRide = useCallback(async (ride: Ride) => {
    if (ride.status !== RideStatus.STARTED || ride.date > today) {
      Alert.alert('Action not allowed', 'Only STARTED rides dated today or earlier can be marked as completed.');
      return;
    }

    setSubmittingRideId(ride.rideId);
    try {
      await withSubmission(async () => {
        await closeRide(tourId, ride.rideId);
      });
    } catch (err) {
      logger.error(TAG, 'handleCompleteRide failed', err);
      Alert.alert('Unable to complete ride', getFriendlyError(err));
    }
  }, [today, tourId, withSubmission]);

  const todayBadge = todayRide ? statusBadgeStyle(todayRide.status) : null;
  const canOpenTodayRide = Boolean(todayRide && todayRide.status === RideStatus.PLANNED);
  const canStartTodayRide = Boolean(todayRide && todayRide.status === RideStatus.OPEN);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>Ride Status Management</Text>
          <Text style={styles.subtitle}>Allowed transitions: PLANNED → OPEN, OPEN → STARTED, STARTED → COMPLETED</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading rides...</Text>
        </View>
      ) : error ? (
        <View style={styles.centeredState}>
          <MaterialIcons name="error-outline" size={44} color={COLORS.danger} />
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadRides}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today&apos;s Ride</Text>
            {todayRide ? (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.rideName}>{todayRide.name}</Text>
                    <Text style={styles.rideMeta}>{todayRide.date} · {todayRide.rideId}</Text>
                  </View>
                  {todayBadge && (
                    <View style={[styles.statusBadge, { backgroundColor: todayBadge.backgroundColor }]}>
                      <Text style={[styles.statusBadgeText, { color: todayBadge.color }]}>{todayRide.status}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, !canOpenTodayRide && styles.actionButtonDisabled]}
                    disabled={!canOpenTodayRide || isSubmitting}
                    onPress={handleOpenRide}
                  >
                    <Text style={styles.actionButtonText}>Set OPEN</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, !canStartTodayRide && styles.actionButtonDisabled]}
                    disabled={!canStartTodayRide || isSubmitting}
                    onPress={handleStartRide}
                  >
                    <Text style={styles.actionButtonText}>Set STARTED</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.noteText}>
                  OPEN and STARTED changes are allowed only for today&apos;s ride.
                </Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>No ride found for today.</Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Set Completed (STARTED rides only)</Text>
            {completableRides.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>No STARTED rides found for today or past dates.</Text>
              </View>
            ) : (
              completableRides.map((item) => {
                const badge = statusBadgeStyle(item.status);
                const isThisSubmitting = submittingRideId === item.rideId;

                return (
                  <View style={styles.card} key={item.rideId}>
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.rideName}>{item.name}</Text>
                        <Text style={styles.rideMeta}>{item.date} · {item.rideId}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: badge.backgroundColor }]}>
                        <Text style={[styles.statusBadgeText, { color: badge.color }]}>{item.status}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.completeButton]}
                      disabled={isSubmitting}
                      onPress={() => handleCompleteRide(item)}
                    >
                      {isThisSubmitting ? (
                        <ActivityIndicator size="small" color={COLORS.white} />
                      ) : (
                        <Text style={styles.actionButtonText}>Set COMPLETED</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  closeButton: {
    padding: 4,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  stateText: {
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: COLORS.white,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  rideName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  rideMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  completeButton: {
    backgroundColor: COLORS.success,
  },
  actionButtonDisabled: {
    backgroundColor: COLORS.gray[300],
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  noteText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  emptyCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyCardText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
});