import React, { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { DashboardActivity } from '../../utils/eventProgress';

export interface ActivityFilterDropdownProps {
  activities: readonly DashboardActivity[];
  selectedActivityId: string | null;
  onSelect: (activityId: string | null) => void;
}

type Option = { id: string | null; label: string };

/** Dropdown (modal list) of "All activities" plus each activity. The zoom-out button is rendered by the caller. */
export default function ActivityFilterDropdown({ activities, selectedActivityId, onSelect }: ActivityFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = activities.find((activity) => activity.activityId === selectedActivityId);
  const options: Option[] = [
    { id: null, label: 'All activities' },
    ...activities.map((activity) => ({ id: activity.activityId, label: activity.name })),
  ];

  return (
    <>
      <TouchableOpacity
        accessibilityLabel={`Activity filter: ${selected?.name ?? 'All activities'}`}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.button}
      >
        <Text numberOfLines={1} style={styles.buttonText}>{selected?.name ?? 'All activities'}</Text>
        <MaterialIcons name="arrow-drop-down" size={24} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)} style={styles.overlay}>
          <View style={styles.sheet}>
            <FlatList
              data={options}
              keyExtractor={(item) => item.id ?? 'ALL'}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedActivityId;
                return (
                  <TouchableOpacity
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onSelect(item.id);
                      setOpen(false);
                    }}
                    style={styles.option}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionSelected]}>{item.label}</Text>
                    {isSelected ? <MaterialIcons name="check" size={20} color={COLORS.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingLeft: 12,
    paddingRight: 4,
  },
  buttonText: { color: COLORS.textPrimary, flex: 1, fontSize: 14 },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: 24 },
  sheet: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    maxHeight: '70%',
    maxWidth: 420,
    overflow: 'hidden',
    width: '100%',
  },
  option: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  optionText: { color: COLORS.textPrimary, fontSize: 15 },
  optionSelected: { color: COLORS.primary, fontWeight: '700' },
});
