/**
 * Baggage reconciliation (VIEW_DASHBOARD): loaded vs unloaded bag counts for an
 * occurrence and its linkedOccurrenceRef, and the riders whose bag was loaded
 * but not unloaded. NO_LINKED_OCCURRENCE is shown as info. Offline (or when the
 * server is unreachable) the last saved result is shown as stale.
 *
 * See docs/Event-Engine-Design.md § BaggageReconciliationScreen.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EVENT_DASHBOARD_MESSAGES, EventMessageKind } from '../../constants/eventMessages';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError } from '../../services/api/eventsApi';
import {
  fetchOccurrenceReconciliation,
  OccurrenceDashboardSnapshot,
  readOccurrenceSnapshot,
} from '../../services/events/eventDashboardService';
import { ReconciliationResponse } from '../../types/api';
import { AppStackParamList } from '../../types/navigation';
import { logger } from '../../utils/logger';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import OfflineBanner from '../../components/common/OfflineBanner';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'BaggageReconciliationScreen';

interface BaggageReconciliationScreenProps {
  eventId: string;
  occurrenceId: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'BaggageReconciliation'>;
}

type Banner = { kind: EventMessageKind; message: string };

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function BaggageReconciliationScreen({ eventId, occurrenceId, navigation }: BaggageReconciliationScreenProps) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { getRiderDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [snapshot, setSnapshot] = useState<OccurrenceDashboardSnapshot | null>(null);
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (refreshing: boolean) => {
    if (!tourId) {
      setIsLoading(false);
      return;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    if (refreshing) setIsRefreshing(true);
    setBanner(null);

    const applySnapshot = async (): Promise<boolean> => {
      const stored = await readOccurrenceSnapshot(tourId, occurrenceId);
      if (current !== requestId.current) return true;
      setSnapshot(stored?.snapshot ?? null);
      if (!stored?.snapshot.reconciliation) return false;
      setResult(stored.snapshot.reconciliation);
      setStaleAt(stored.fetchedAt);
      return true;
    };

    try {
      if (isOffline) {
        if (!(await applySnapshot())) {
          setBanner({ kind: 'info', message: EVENT_DASHBOARD_MESSAGES.NOT_SAVED_OFFLINE });
        }
        return;
      }

      const outcome = await fetchOccurrenceReconciliation(tourId, eventId, occurrenceId);
      const stored = await readOccurrenceSnapshot(tourId, occurrenceId);
      if (current !== requestId.current) return;
      setSnapshot(stored?.snapshot ?? null);
      if (outcome.kind === 'error') {
        if (outcome.error.status === 404) setNotFound(true);
        else setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        setResult(null);
        return;
      }
      setResult(outcome.data);
      setStaleAt(null);
    } catch (err) {
      logger.error(TAG, 'Loading reconciliation failed', err);
      if (current !== requestId.current) return;
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      await applySnapshot().catch((snapshotError: unknown) => {
        logger.warn(TAG, 'Snapshot fallback failed', snapshotError);
      });
    } finally {
      if (current === requestId.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [tourId, eventId, occurrenceId, isOffline]);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  const occurrence = snapshot?.dashboard?.occurrence ?? null;
  const title = snapshot?.dashboard?.event?.eventName ?? 'Baggage reconciliation';
  const subtitle = occurrence ? `${occurrence.date} #${occurrence.seq} · Reconciliation` : 'Reconciliation';

  if (notFound) {
    return (
      <View style={styles.container}>
        <EventScreenHeader title={title} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <MaterialIcons name="event-busy" size={48} color={COLORS.textSecondary} />
          <Text style={styles.centeredText}>{EVENT_DASHBOARD_MESSAGES.OCCURRENCE_GONE}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const missing = [...(result?.missingRiderIds ?? [])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            accessibilityLabel="Refresh reconciliation"
            accessibilityRole="button"
            disabled={isRefreshing}
            onPress={() => void load(true)}
            style={styles.headerButton}
          >
            <MaterialIcons name="refresh" size={24} color={COLORS.white} />
          </TouchableOpacity>
        )}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void load(true)} />}
      >
        <OfflineBanner />
        {!tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} /> : null}
        {staleAt ? (
          <StatusBanner kind="warning" message={EVENT_DASHBOARD_MESSAGES.STALE.replace('{time}', formatDateTime(staleAt))} />
        ) : null}
        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {occurrence?.linkedOccurrenceRef ? (
          <Text style={styles.metaText}>Linked occurrence: {occurrence.linkedOccurrenceRef}</Text>
        ) : null}

        {result ? (
          <>
            <View style={styles.columns}>
              <View accessible accessibilityLabel={`Loaded: ${result.loadedCount}`} style={styles.column}>
                <Text style={styles.columnValue}>{result.loadedCount}</Text>
                <Text style={styles.columnLabel}>Loaded</Text>
              </View>
              <View accessible accessibilityLabel={`Unloaded: ${result.unloadedCount}`} style={styles.column}>
                <Text style={styles.columnValue}>{result.unloadedCount}</Text>
                <Text style={styles.columnLabel}>Unloaded</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Loaded but not unloaded ({missing.length})</Text>
              {missing.length === 0 ? (
                <Text style={styles.emptyText}>{EVENT_DASHBOARD_MESSAGES.NO_VARIANCE}</Text>
              ) : (
                missing.map((riderId) => (
                  <TouchableOpacity
                    accessibilityLabel={`View progress for ${getRiderDisplayName(riderId).name} ${riderId}`}
                    accessibilityRole="button"
                    key={riderId}
                    onPress={() => navigation.navigate('RiderProgress', { riderId, eventId, occurrenceId })}
                    style={styles.row}
                  >
                    <MaterialIcons name="luggage" size={20} color={COLORS.warning} />
                    <Text style={styles.rowTitle}>{getRiderDisplayName(riderId).name} · {riderId}</Text>
                    <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  content: { alignSelf: 'center', maxWidth: 960, padding: 16, width: '100%' },
  loader: { marginVertical: 24 },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  metaText: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 },
  columns: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  column: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 88,
    justifyContent: 'center',
    padding: 12,
  },
  columnValue: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '700' },
  columnLabel: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 14 },
  row: {
    alignItems: 'center',
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
  },
  rowTitle: { color: COLORS.textPrimary, flex: 1, fontSize: 14, fontWeight: '600' },
});
