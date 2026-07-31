import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Switch, Platform } from 'react-native';
import { useRideSession } from '../../context/RideSessionContext';
import { getCheckInsByRide } from '../../services/database/checkInStore';
import { subscribeDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { getRiderById } from '../../services/database/riderStore';
import { CheckIn, CheckInMethod, isCancelledCheckIn } from '../../types/models';
import { COLORS } from '../../constants/colors';

const monospaceFont = Platform.select({ ios: 'Courier', android: 'monospace', default: 'Courier' }) ?? 'monospace';


export default function CheckInLogScreen() {
  const {
    currentRide,
    checkIns: contextCheckIns,
    selectedStageNumber,
    selectedSpecial,
  } = useRideSession();

  const [localCheckIns, setLocalCheckIns] = useState<CheckIn[]>([]);
  const [showName, setShowName] = useState(true);
  const [riderNames, setRiderNames] = useState<Record<string, string>>({});
  const resolvedIdsRef = useRef<Set<string>>(new Set());

  // Load initial data from context or DB
  useEffect(() => {
    let mounted = true;

    async function loadFromDb() {
      if (!currentRide) return setLocalCheckIns([]);

      if (contextCheckIns && contextCheckIns.length > 0) {
        const filtered = contextCheckIns.filter((ci) => !isCancelledCheckIn(ci));
        if (!mounted) return;
        setLocalCheckIns(filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1)));
        // resolve rider names
        const ids = Array.from(new Set(filtered.map((c) => c.riderId)));
        for (const id of ids) {
          if (resolvedIdsRef.current.has(id)) continue;
          resolvedIdsRef.current.add(id);
          try {
            const r = await getRiderById(id);
            if (!mounted) return;
            if (r) setRiderNames((s) => ({ ...s, [id]: r.name }));
          } catch {
            // ignore
          }
        }
        return;
      }

      try {
        const rows = await getCheckInsByRide(currentRide.rideId);
        if (!mounted) return;
        const filtered = rows.filter((ci) => !isCancelledCheckIn(ci));
        setLocalCheckIns(filtered.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1)));
        const ids = Array.from(new Set(filtered.map((c) => c.riderId)));
        for (const id of ids) {
          try {
            const r = await getRiderById(id);
            if (!mounted) return;
            if (r) setRiderNames((s) => ({ ...s, [id]: r.name }));
          } catch {
            // ignore
          }
        }
      } catch {
        // silently ignore DB read errors here
      }
    }

    loadFromDb();

    return () => {
      mounted = false;
    };
  }, [currentRide, contextCheckIns]);

  // Subscribe to live check-in events
  useEffect(() => {
    if (!currentRide) return undefined;
    const unsub = subscribeDashboardCheckInEvent((evt) => {
      const ci = evt.checkIn;
      if (ci.rideId !== currentRide.rideId) return;
      if (isCancelledCheckIn(ci)) return;
      setLocalCheckIns((prev) => [ci, ...prev]);
      // resolve rider name if unknown
      if (!resolvedIdsRef.current.has(ci.riderId)) {
        resolvedIdsRef.current.add(ci.riderId);
        void getRiderById(ci.riderId).then((r) => {
          if (r) setRiderNames((s) => ({ ...s, [ci.riderId]: r.name }));
        }).catch(() => { });
      }
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

  const renderItem = useCallback(({ item, index }: { item: CheckIn; index: number }) => {
    const riderName = riderNames[item.riderId] ?? '';
    let stageLabel = '—';
    if (item.isNotRiding) stageLabel = 'NR';
    else if (item.isQuitRiding) stageLabel = 'Quit';
    else if (currentRide) {
      const s = currentRide.stages.find((x) => x.stageNumber === item.stageNumber);
      stageLabel = s?.name ?? `PS${item.stageNumber}`;
    }

    const time = new Date(item.createdAt ?? item.timestamp).toLocaleTimeString();
    const checkedBy = item.checkedInByName ?? 'Not Available';
    const isManual = item.method === CheckInMethod.MANUAL || item.isManualEntry;

    const riderIdText = isManual ? `# ${item.riderId}` : `  ${item.riderId}`;
    const lineParts = [
      riderIdText,
      showName ? riderName || '—' : null,
      stageLabel,
      time,
      checkedBy,
    ].filter((value): value is string => Boolean(value));

    const lineText = lineParts.join(' | ');

    return (
      <View style={[styles.logRow, index % 2 === 0 ? styles.logRowEven : styles.logRowOdd]}>
        <Text style={styles.logText} numberOfLines={1}>
          {lineText}
        </Text>
      </View>
    );
  }, [currentRide, riderNames, showName]);

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
});
