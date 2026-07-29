import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Switch, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StageFilterBar from '../../components/dashboard/StageFilterBar';
import { useRideSession } from '../../context/RideSessionContext';
import { getCheckInsByRide } from '../../services/database/checkInStore';
import { subscribeDashboardCheckInEvent } from '../../services/dashboard/dashboardEvents';
import { getRiderById } from '../../services/database/riderStore';
import { CheckIn, CheckInMethod, isCancelledCheckIn } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { COLORS } from '../../constants/colors';

export default function CheckInLogScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const insets = useSafeAreaInsets();
  const {
    currentRide,
    isHistorical,
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
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <View style={styles.headerRow}>
            <Text style={styles.rideTitle}>No active ride</Text>
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Select a ride from the Dashboard to view the Check-In log.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.rideTitleButton}
            onPress={() => navigation.navigate('RideInfo', { ride: currentRide, source: 'dashboard' })}
            accessibilityRole="button"
            accessibilityLabel="Open ride details"
            accessibilityHint="Shows details for the selected ride"
          >
            <Text style={styles.rideTitle}>{currentRide.name}</Text>
            <MaterialIcons name="info-outline" size={18} color={COLORS.white} />
          </TouchableOpacity>

          {isHistorical && (
            <View style={styles.historicalBadge}>
              <Text style={styles.historicalBadgeText}>Historical</Text>
            </View>
          )}
        </View>

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
      </View>

      <View style={styles.contentArea}>
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
          contentContainerStyle={{ padding: 12, paddingBottom: Math.max(insets.bottom, 12) }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  rideTitleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  rideTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  historicalBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  historicalBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.white,
  },
  contentArea: {
    flex: 1,
  },
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
