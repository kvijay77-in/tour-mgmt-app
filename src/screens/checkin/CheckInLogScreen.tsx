import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Switch, Platform, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { useRideSession } from '../../context/RideSessionContext';
import { useTour } from '../../context/TourContext';
import { useAuth } from '../../context/AuthContext';
import { getCheckInsByRide } from '../../services/database/checkInStore';
import { subscribeDashboardCheckInEvent, subscribeDashboardCancelEvent, publishDashboardCancelEvent } from '../../services/dashboard/dashboardEvents';
import { cancelCheckIn } from '../../services/api/checkInApi';
import { CheckIn, CheckInMethod, deriveCheckInStatus, isCancelledCheckIn } from '../../types/models';
import { COLORS } from '../../constants/colors';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import RiderCardModal from '../../components/dashboard/RiderCardModal';
import { getLocalToday } from '../../utils/dates';

const monospaceFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'Courier' }) ?? 'monospace';

function sortByTimestampDesc(list: CheckIn[]): CheckIn[] {
  return [...list].sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));
}

export default function CheckInLogScreen() {
  const {
    currentRide,
    isHistorical,
    checkIns: contextCheckIns,
    cancelledCheckIns,
    setCheckIns,
    setCancelledCheckIns,
    selectedStageNumber,
    selectedSpecial,
  } = useRideSession();
  const { tour } = useTour();
  const { user } = useAuth();
  const { getRiderDisplayName, getAppUserDisplayName } = useNameDirectory();

  const [localCheckIns, setLocalCheckIns] = useState<CheckIn[]>([]);
  const [showName, setShowName] = useState(true);

  const [actionSheetEntry, setActionSheetEntry] = useState<CheckIn | null>(null);
  const [confirmCancelEntry, setConfirmCancelEntry] = useState<CheckIn | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [resultMessage, setResultMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [riderCardRiderId, setRiderCardRiderId] = useState<string | null>(null);

  const canCancelEntries = useMemo(() => {
    if (!currentRide || isHistorical) return false;
    const today = getLocalToday();
    return currentRide.date === today;
  }, [currentRide, isHistorical]);

  // Load initial data from context or DB
  useEffect(() => {
    let mounted = true;

    async function loadFromDb() {
      if (!currentRide) return setLocalCheckIns([]);

      if (contextCheckIns && contextCheckIns.length > 0) {
        const merged = [...contextCheckIns, ...cancelledCheckIns];
        if (!mounted) return;
        setLocalCheckIns(sortByTimestampDesc(merged));
        return;
      }

      try {
        const rows = await getCheckInsByRide(currentRide.rideId);
        if (!mounted) return;
        const filtered = rows.filter((ci) => !isCancelledCheckIn(ci));
        setLocalCheckIns(sortByTimestampDesc(filtered));
      } catch {
        // silently ignore DB read errors here
      }
    }

    loadFromDb();

    return () => {
      mounted = false;
    };
  }, [currentRide, contextCheckIns, cancelledCheckIns]);

  // Subscribe to live check-in events
  useEffect(() => {
    if (!currentRide) return undefined;
    const unsub = subscribeDashboardCheckInEvent((evt) => {
      const ci = evt.checkIn;
      if (ci.rideId !== currentRide.rideId) return;
      if (isCancelledCheckIn(ci)) return;
      setLocalCheckIns((prev) => {
        if (prev.some((existing) => existing.checkInId === ci.checkInId)) {
          return prev;
        }
        return sortByTimestampDesc([ci, ...prev]);
      });
    });

    return () => unsub();
  }, [currentRide]);

  // Subscribe to live cancel events (e.g. cancelled from this screen on another device)
  useEffect(() => {
    if (!currentRide) return undefined;
    const unsub = subscribeDashboardCancelEvent((evt) => {
      const ci = evt.checkIn;
      if (ci.rideId !== currentRide.rideId) return;
      setLocalCheckIns((prev) => sortByTimestampDesc([
        ci,
        ...prev.filter((existing) => existing.checkInId !== ci.checkInId),
      ]));
    });

    return () => unsub();
  }, [currentRide]);

  const filtered = useMemo(() => {
    return localCheckIns.filter((ci) => {
      if (selectedStageNumber != null) {
        if (ci.stageNumber !== selectedStageNumber) return false;
      }
      if (selectedSpecial === 'NR' && !ci.isNotRiding) return false;
      if (selectedSpecial === 'QR' && !ci.isQuitRiding) return false;
      return true;
    });
  }, [localCheckIns, selectedStageNumber, selectedSpecial]);

  const handleConfirmCancel = useCallback(async (entry: CheckIn) => {
    if (!tour || !currentRide) return;
    if (!canCancelEntries) {
      setResultMessage({ kind: 'error', text: 'Cancel Entry is available only for today\'s ride.' });
      setConfirmCancelEntry(null);
      return;
    }

    setIsCancelling(true);
    try {
      const previousStatus = deriveCheckInStatus(entry);
      await cancelCheckIn(tour.tourId, currentRide.rideId, entry.checkInId, previousStatus);

      const cancelledRecord: CheckIn = {
        ...entry,
        status: 'CANCELLED',
        prevStatus: previousStatus,
        cancelledAt: new Date().toISOString(),
        cancelledBy: user?.userId,
      };

      setLocalCheckIns((prev) => sortByTimestampDesc([
        cancelledRecord,
        ...prev.filter((ci) => ci.checkInId !== entry.checkInId),
      ]));
      setCheckIns((prev) => prev.filter((ci) => ci.checkInId !== entry.checkInId));
      setCancelledCheckIns((prev) => [cancelledRecord, ...prev]);
      publishDashboardCancelEvent({ checkIn: cancelledRecord });

      setResultMessage({ kind: 'success', text: 'Entry cancelled successfully.' });
    } catch (err) {
      setResultMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Failed to cancel entry. Please try again.',
      });
    } finally {
      setIsCancelling(false);
      setConfirmCancelEntry(null);
    }
  }, [tour, currentRide, canCancelEntries, setCheckIns, setCancelledCheckIns, user]);

  const renderItem = useCallback(({ item, index }: { item: CheckIn; index: number }) => {
    const riderDisplay = getRiderDisplayName(item.riderId);
    let stageLabel = '—';
    if (item.isNotRiding) stageLabel = 'NR';
    else if (item.isQuitRiding) stageLabel = 'Quit';
    else if (item.isFloat) stageLabel = item.floatNo ? `Float-${item.floatNo}` : 'Float';
    else if (currentRide) {
      const s = currentRide.stages.find((x) => x.stageNumber === item.stageNumber);
      stageLabel = s?.name ?? `PS${item.stageNumber}`;
    }

    const time = new Date(item.createdAt ?? item.timestamp).toLocaleTimeString();
    const checkedBy = getAppUserDisplayName(item.checkedInBy);
    const isManual = item.method === CheckInMethod.MANUAL || item.isManualEntry;
    const isCancelled = isCancelledCheckIn(item);

    const riderIdText = isManual ? `# ${item.riderId}` : `  ${item.riderId}`;

    return (
      <TouchableOpacity
        style={[styles.logRow, index % 2 === 0 ? styles.logRowEven : styles.logRowOdd]}
        onPress={() => {
          if (canCancelEntries) {
            setActionSheetEntry(item);
            return;
          }

          setRiderCardRiderId(item.riderId);
        }}
        activeOpacity={0.6}
      >
        <Text style={[styles.logText, isCancelled ? styles.logCancelledText : undefined]} numberOfLines={1}>
          <Text>{riderIdText}</Text>
          {showName ? (
            <Text>
              {' | '}
              <Text style={riderDisplay.isAnomaly ? styles.logAnomalyText : undefined}>{riderDisplay.name}</Text>
            </Text>
          ) : null}
          <Text>{` | ${stageLabel} | ${time} | ${checkedBy}`}</Text>
        </Text>
      </TouchableOpacity>
    );
  }, [canCancelEntries, currentRide, getAppUserDisplayName, getRiderDisplayName, showName]);

  if (!currentRide) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Select a ride from the Dashboard to view the Check-In log.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.contentArea}>
        <View style={styles.controlsRow}>
          <Text style={styles.legendText}># Manual Check-in</Text>
          <View style={styles.controlsGroup}>
            <View style={styles.nameToggle}>
              <Text style={styles.nameToggleLabel}>Show name</Text>
              <Switch value={showName} onValueChange={setShowName} />
            </View>
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(i) => i.checkInId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={(
            <View style={styles.emptyTableState}>
              <Text style={styles.emptyTableText}>No check-ins found for the current filters.</Text>
            </View>
          )}
        />
      </View>

      {/* Row action sheet: Rider Card / Cancel Entry (today ride only) */}
      {canCancelEntries ? (
        <Modal visible={!!actionSheetEntry} transparent animationType="fade" onRequestClose={() => setActionSheetEntry(null)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setActionSheetEntry(null)}>
            <TouchableOpacity style={styles.actionSheetCard} activeOpacity={1} onPress={() => { /* keep open */ }}>
              <Text style={styles.actionSheetTitle}>{actionSheetEntry?.riderId}</Text>
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => {
                  setRiderCardRiderId(actionSheetEntry?.riderId ?? null);
                  setActionSheetEntry(null);
                }}
              >
                <Text style={styles.actionSheetButtonText}>Rider Card</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionSheetButton,
                  actionSheetEntry && isCancelledCheckIn(actionSheetEntry) ? styles.actionSheetButtonDisabled : undefined,
                ]}
                disabled={!actionSheetEntry || isCancelledCheckIn(actionSheetEntry)}
                onPress={() => {
                  setConfirmCancelEntry(actionSheetEntry);
                  setActionSheetEntry(null);
                }}
              >
                <Text
                  style={[
                    styles.actionSheetButtonText,
                    styles.actionSheetDangerText,
                    actionSheetEntry && isCancelledCheckIn(actionSheetEntry) ? styles.actionSheetButtonTextDisabled : undefined,
                  ]}
                >
                  Cancel Entry
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionSheetCancel} onPress={() => setActionSheetEntry(null)}>
                <Text style={styles.actionSheetCancelText}>Dismiss</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      ) : null}

      {/* Confirm cancel dialog */}
      <Modal visible={!!confirmCancelEntry} transparent animationType="fade" onRequestClose={() => !isCancelling && setConfirmCancelEntry(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Cancel Check-in</Text>
            <Text style={styles.confirmText}>
              Cancel this check-in entry for {confirmCancelEntry?.riderId}?
            </Text>
            {isCancelling ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={styles.confirmSpinner} />
            ) : (
              <View style={styles.confirmButtonRow}>
                <TouchableOpacity style={styles.confirmButtonNo} onPress={() => setConfirmCancelEntry(null)}>
                  <Text style={styles.confirmButtonNoText}>No</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButtonYes}
                  onPress={() => confirmCancelEntry && handleConfirmCancel(confirmCancelEntry)}
                >
                  <Text style={styles.confirmButtonYesText}>Yes</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Result banner */}
      <Modal visible={!!resultMessage} transparent animationType="fade" onRequestClose={() => setResultMessage(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <Text style={resultMessage?.kind === 'error' ? styles.resultErrorText : styles.resultSuccessText}>
              {resultMessage?.text}
            </Text>
            <TouchableOpacity style={styles.confirmButtonYes} onPress={() => setResultMessage(null)}>
              <Text style={styles.confirmButtonYesText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <RiderCardModal
        visible={!!riderCardRiderId}
        tourId={tour?.tourId}
        ride={currentRide}
        riderId={riderCardRiderId}
        onClose={() => setRiderCardRiderId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentArea: {
    flex: 1,
  },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  emptyText: { color: COLORS.textSecondary, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  controlsGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  legendText: { fontSize: 11, color: COLORS.textSecondary, fontFamily: monospaceFont },
  nameToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameToggleLabel: { color: COLORS.textSecondary, marginRight: 8 },
  listContent: { paddingHorizontal: 12, paddingBottom: 12 },
  logRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  logRowEven: { backgroundColor: '#F8FAFC' },
  logRowOdd: { backgroundColor: '#F3F8FF' },
  logText: {
    fontSize: 11,
    color: COLORS.textPrimary,
    fontFamily: monospaceFont,
  },
  logAnomalyText: {
    color: COLORS.danger,
  },
  logCancelledText: {
    color: COLORS.danger,
    textDecorationLine: 'line-through',
  },
  headerText: { fontSize: 11, fontWeight: '700', color: COLORS.textPrimary },
  emptyTableState: {
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  emptyTableText: { color: COLORS.textSecondary, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionSheetCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: 280,
  },
  actionSheetTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 10,
  },
  actionSheetButton: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    alignItems: 'center',
  },
  actionSheetButtonDisabled: {
    opacity: 0.4,
  },
  actionSheetButtonText: {
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  actionSheetButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
  actionSheetDangerText: {
    color: COLORS.danger,
  },
  actionSheetCancel: {
    marginTop: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionSheetCancelText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  confirmCard: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 20,
    width: 300,
    alignItems: 'center',
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  confirmText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  confirmSpinner: {
    marginTop: 4,
  },
  confirmButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmButtonNo: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmButtonNoText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  confirmButtonYes: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    marginTop: 4,
  },
  confirmButtonYesText: {
    color: COLORS.white,
    fontWeight: '700',
  },
  resultSuccessText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
  },
  resultErrorText: {
    fontSize: 14,
    color: COLORS.danger,
    textAlign: 'center',
    marginBottom: 16,
  },
});
