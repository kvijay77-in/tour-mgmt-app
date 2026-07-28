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
          <SortIcon size={20} color={isSorted ? COLORS.primary : COLORS.gray[500]} />
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
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.primary,
  },
  content: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  sortButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.gray[100],
    marginRight: 8,
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary + '15',
  },
  stageBtn: {
    minWidth: 56,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginRight: 8,
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
