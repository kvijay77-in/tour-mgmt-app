import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stage } from '../../types/models';
import { COLORS, getStageColor } from '../../constants/colors';
import { SortIcon } from '../../components/common/SortIcon';

type SelectedSpecial = 'NR' | 'QR' | null;

interface Props {
  stages: Stage[];
  stageCounts: Record<string, number>;
  totalStages: number;
  selectedStageNumber: number | null;
  selectedSpecial: SelectedSpecial;
  isSorted: boolean;
  onToggleSort: () => void;
  onSelectStage: (n: number | null) => void;
  onSelectSpecial: (s: SelectedSpecial) => void;
}

const getStageLabel = (stageNumber: number, totalStages: number) => {
  if (stageNumber === 0) return 'Start';
  if (stageNumber === totalStages - 1) return 'Finish';
  return `PS${stageNumber}`;
};

export default function StageFilterBar({
  stages,
  stageCounts,
  totalStages,
  selectedStageNumber,
  selectedSpecial,
  isSorted,
  onToggleSort,
  onSelectStage,
  onSelectSpecial,
}: Props) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <TouchableOpacity
          style={[styles.sortButton, isSorted && styles.sortButtonActive]}
          onPress={onToggleSort}
        >
          <SortIcon size={18} color={isSorted ? COLORS.primary : COLORS.gray[500]} />
        </TouchableOpacity>

        {stages.map((stage) => {
          const isActive = selectedStageNumber === stage.stageNumber;
          const bg = getStageColor(stage.stageNumber, totalStages);
          return (
            <TouchableOpacity
              key={stage.stageId}
              style={[styles.stageBtn, { backgroundColor: bg }, isActive && styles.activeStageBtn]}
              onPress={() => onSelectStage(isActive ? null : stage.stageNumber)}
            >
              <Text style={styles.stageLabel}>{getStageLabel(stage.stageNumber, totalStages)}</Text>
              <Text style={styles.stageCount}>{stageCounts[stage.stageId] ?? 0}</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.stageBtn, styles.nrBtn, selectedSpecial === 'NR' && styles.activeStageBtn]}
          onPress={() => onSelectSpecial(selectedSpecial === 'NR' ? null : 'NR')}
        >
          <Text style={styles.stageLabel}>NR</Text>
          <Text style={styles.stageCount}>{stageCounts['NR'] ?? 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.stageBtn, styles.qrBtn, selectedSpecial === 'QR' && styles.activeStageBtn]}
          onPress={() => onSelectSpecial(selectedSpecial === 'QR' ? null : 'QR')}
        >
          <Text style={styles.stageLabel}>QR</Text>
          <Text style={styles.stageCount}>{stageCounts['QR'] ?? 0}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingBottom: 6,
    backgroundColor: COLORS.primary,
  },
  content: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  sortButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    marginRight: 6,
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  sortButtonActive: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.accent,
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  stageBtn: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeStageBtn: {
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  stageLabel: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: '700',
  },
  stageCount: {
    fontSize: 13,
    color: COLORS.white,
    fontWeight: '800',
    marginTop: 2,
  },
  nrBtn: {
    backgroundColor: COLORS.gray[400],
  },
  qrBtn: {
    backgroundColor: COLORS.danger,
  },
});
