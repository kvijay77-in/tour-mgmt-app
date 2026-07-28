import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StageFilterBar from '../../components/dashboard/StageFilterBar';
import { useRideSession } from '../../context/RideSessionContext';
import { getCheckInsByRide } from '../../services/database/checkInStore';
import { subscribeDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { getRiderById } from '../../services/database/riderStore';
import { CheckIn, CheckInMethod, isCancelledCheckIn } from '../../types/models';
import { COLORS } from '../../constants/colors';

export default function CheckInLogScreen() {
  const insets = useSafeAreaInsets();
  const {
    currentRide,
    checkIns: contextCheckIns,
    selectedStageNumber,
    selectedSpecial,
    setSelectedStage,
    setSelectedSpecial,
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
        }).catch(() => {});
      }
    });

    return () => unsub();
  }, [currentRide]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!currentRide) return counts;
    for (const s of currentRide.stages) counts[s.stageId] = 0;
    let nr = 0;
    let qr = 0;
    for (const ci of localCheckIns) {
      if (ci.isNotRiding) nr += 1;
      else if (ci.isQuitRiding) qr += 1;
      else if (ci.stageId && counts[ci.stageId] !== undefined) counts[ci.stageId] += 1;
    }
    counts['NR'] = nr;
    counts['QR'] = qr;
    return counts;
  }, [localCheckIns, currentRide]);

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

  const renderItem = useCallback(({ item }: { item: CheckIn }) => {
    const riderName = riderNames[item.riderId] ?? '';
    let stageLabel = '—';
    if (item.isNotRiding) stageLabel = 'Not Riding';
    else if (item.isQuitRiding) stageLabel = 'Quit';
    else if (currentRide) {
      const s = currentRide.stages.find((x) => x.stageNumber === item.stageNumber);
      stageLabel = s?.name ?? `PS${item.stageNumber}`;
    }

    const time = new Date(item.createdAt ?? item.timestamp).toLocaleString();
    const checkedBy = item.checkedInByName ?? 'Not Available';

    return (
      <View style={styles.row}>
        <View style={styles.leftCol}>
          {item.method === CheckInMethod.MANUAL || item.isManualEntry ? (
            <Text style={styles.manualMarker}>*</Text>
          ) : (
            <Text style={styles.manualMarker} />
          )}
          <Text style={styles.riderId}>{item.riderId}</Text>
          {showName && <Text style={styles.riderName}>{riderName}</Text>}
        </View>

        <View style={styles.rightCol}>
          <Text style={styles.stage}>{stageLabel}</Text>
          <Text style={styles.time}>{time}</Text>
          <Text style={styles.checkedBy}>{checkedBy}</Text>
        </View>
      </View>
    );
  }, [currentRide, riderNames, showName]);

  if (!currentRide) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Select a ride from the Dashboard to view the Check-In log.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}> 
      <StageFilterBar
        stages={currentRide.stages}
        stageCounts={stageCounts}
        totalStages={currentRide.stages.length}
        selectedStageNumber={selectedStageNumber}
        selectedSpecial={selectedSpecial}
        isSorted={false}
        onToggleSort={() => {}}
        onSelectStage={(n) => setSelectedStage(n)}
        onSelectSpecial={(s) => setSelectedSpecial(s)}
      />

      <View style={styles.controlsRow}>
        <View style={{ flex: 1 }} />
        <View style={styles.nameToggle}>
          <Text style={styles.nameToggleLabel}>Show name</Text>
          <Switch value={showName} onValueChange={setShowName} />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.checkInId}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12 }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  emptyText: { color: COLORS.textSecondary, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  nameToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameToggleLabel: { color: COLORS.textSecondary, marginRight: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  leftCol: { flex: 1 },
  rightCol: { width: 180, alignItems: 'flex-end' },
  manualMarker: { width: 18, color: COLORS.danger, fontWeight: '700' },
  riderId: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  riderName: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  stage: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  time: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  checkedBy: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  sep: { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
});
