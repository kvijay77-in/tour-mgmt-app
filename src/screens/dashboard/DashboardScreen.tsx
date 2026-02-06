/**
 * Dashboard Screen - Main screen showing rider status
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getMockDashboardData, getMockCurrentRide } from '../../services/api/mockData';
import { RiderStatus, CheckInStatus } from '../../types/models';
import { COLORS, CHECK_IN_STATUS_COLORS, getStageColor, STAGE_VIEW_COLORS } from '../../constants/colors';
import { SortIcon } from '../../components/common/SortIcon';

const { width } = Dimensions.get('window');
const GRID_COLUMNS = 6;
const RIDER_ICON_SIZE = (width - 32) / GRID_COLUMNS - 6;

export default function DashboardScreen() {
  const ride = getMockCurrentRide();
  const allRiderStatuses = getMockDashboardData();
  const [stageViewId, setStageViewId] = useState<string | undefined>(undefined);
  const [isSorted, setIsSorted] = useState<boolean>(false);

  // FAB draggable position
  const pan = useRef(new Animated.ValueXY({ x: width - 76, y: width - 76 })).current;
  const [isDragging, setIsDragging] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          // @ts-ignore - accessing private _value property
          x: pan.x._value,
          // @ts-ignore - accessing private _value property
          y: pan.y._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, gesture) => {
        setIsDragging(true);
        Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        })(_, gesture);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
        setTimeout(() => setIsDragging(false), 100);
      },
    })
  ).current;

  // Toggle stage view - clicking again deactivates
  const toggleStageView = (stageId: string) => {
    setStageViewId(stageViewId === stageId ? undefined : stageId);
  };

  // Toggle sort
  const toggleSort = () => {
    setIsSorted(!isSorted);
  };

  // Sort riders based on requirements
  const sortRiders = (riders: RiderStatus[]): RiderStatus[] => {
    if (!isSorted) {
      // Unsorted mode: sort by Rider ID lexicographically
      return [...riders].sort((a, b) => 
        a.rider.riderId.localeCompare(b.rider.riderId)
      );
    }

    // Sorted mode
    return [...riders].sort((a, b) => {
      if (stageViewId) {
        // Stage View sorting
        const selectedStage = ride.stages.find(s => s.stageId === stageViewId);
        if (!selectedStage) return 0;
        
        const aIsNR = a.overallStatus === CheckInStatus.NOT_RIDING;
        const bIsNR = b.overallStatus === CheckInStatus.NOT_RIDING;
        const aIsQR = a.overallStatus === CheckInStatus.QUIT_RIDING;
        const bIsQR = b.overallStatus === CheckInStatus.QUIT_RIDING;
        const aCheckedInAtStage = a.lastStage && a.lastStage.stageNumber >= selectedStage.stageNumber;
        const bCheckedInAtStage = b.lastStage && b.lastStage.stageNumber >= selectedStage.stageNumber;
        
        // Order: not checked in → QR (all QR) → checked in → NR
        // All sub-sorted by Rider ID
        
        // NR always last
        if (aIsNR && !bIsNR) return 1;
        if (!aIsNR && bIsNR) return -1;
        if (aIsNR && bIsNR) {
          return a.rider.riderId.localeCompare(b.rider.riderId);
        }
        
        // Checked in at this stage (excluding QR) - comes after QR
        if (aCheckedInAtStage && !aIsQR && (!bCheckedInAtStage || bIsQR) && !bIsNR) return 1;
        if (bCheckedInAtStage && !bIsQR && (!aCheckedInAtStage || aIsQR) && !aIsNR) return -1;
        if (aCheckedInAtStage && !aIsQR && bCheckedInAtStage && !bIsQR) {
          return a.rider.riderId.localeCompare(b.rider.riderId);
        }
        
        // All QR riders - comes after not checked in
        if (aIsQR && !bIsQR && !bCheckedInAtStage && !bIsNR) return 1;
        if (bIsQR && !aIsQR && !aCheckedInAtStage && !aIsNR) return -1;
        if (aIsQR && bIsQR) {
          return a.rider.riderId.localeCompare(b.rider.riderId);
        }
        
        // Not checked in (and not QR, not NR) - first group
        // Same group: sub-sort by Rider ID
        return a.rider.riderId.localeCompare(b.rider.riderId);
      } else {
        // Default View sorting
        // Assign group order: not checked in → QR → stages → NR
        const getGroupOrder = (rs: RiderStatus): number => {
          if (rs.overallStatus === CheckInStatus.NOT_RIDING) return 1000; // NR last
          if (rs.overallStatus === CheckInStatus.QUIT_RIDING) return 100; // QR second (after not checked in)
          if (rs.overallStatus === CheckInStatus.NOT_CHECKED_IN) return 0; // Not checked in first
          return 200 + (rs.lastStage?.stageNumber || 0); // Regular riders by stage (after QR)
        };
        
        const aGroup = getGroupOrder(a);
        const bGroup = getGroupOrder(b);
        
        if (aGroup !== bGroup) {
          return aGroup - bGroup;
        }
        
        // Same group: sub-sort by Rider ID
        return a.rider.riderId.localeCompare(b.rider.riderId);
      }
    });
  };

  // Apply sorting
  const filteredRiders = sortRiders(allRiderStatuses);

  // Calculate per-stage counts
  // Each stage count includes riders at that stage AND all subsequent stages
  // QR riders are counted for stages they reached before quitting
  const getStageCounts = () => {
    const counts: Record<string, number> = {};
    
    ride.stages.forEach(stage => {
      // Count riders who have reached this stage or beyond
      // This includes riders currently at this stage, at later stages, or who quit after reaching this stage
      counts[stage.stageId] = allRiderStatuses.filter(rs => {
        // Exclude NR riders (they never started)
        if (rs.overallStatus === CheckInStatus.NOT_RIDING) {
          return false;
        }
        
        // Include if rider has reached or passed this stage
        // This works because checking in at a later stage means they passed all earlier stages
        if (rs.lastStage && rs.lastStage.stageNumber >= stage.stageNumber) {
          return true;
        }
        
        return false;
      }).length;
    });
    
    counts['NR'] = allRiderStatuses.filter(rs => rs.overallStatus === CheckInStatus.NOT_RIDING).length;
    counts['QR'] = allRiderStatuses.filter(rs => rs.overallStatus === CheckInStatus.QUIT_RIDING).length;
    
    return counts;
  };

  const stageCounts = getStageCounts();

  // Get color for rider based on status and stage view
  const getRiderColor = (riderStatus: RiderStatus): string => {
    // NR always uses gray color in all views
    if (riderStatus.overallStatus === CheckInStatus.NOT_RIDING) {
      return COLORS.gray[400]; // Grey for Not Riding
    }

    // Stage view active
    if (stageViewId) {
      const selectedStage = ride.stages.find(s => s.stageId === stageViewId);
      
      // If rider hasn't checked in anywhere yet, show white
      if (!riderStatus.lastStage) {
        return STAGE_VIEW_COLORS.notCheckedInAtStage;
      }
      
      // Check if rider has reached or passed the selected stage
      if (selectedStage && riderStatus.lastStage.stageNumber >= selectedStage.stageNumber) {
        // Rider has reached this stage - show the selected stage's color
        return getStageColor(selectedStage.stageNumber, ride.stages.length);
      }
      
      // Rider hasn't reached this stage yet
      // If QR rider who quit before this stage, show QR color
      // Otherwise show white (not checked in at this stage yet)
      if (riderStatus.overallStatus === CheckInStatus.QUIT_RIDING) {
        return CHECK_IN_STATUS_COLORS[CheckInStatus.QUIT_RIDING];
      }
      
      return STAGE_VIEW_COLORS.notCheckedInAtStage;
    }

    // Default/Overall view - QR riders show their special color
    if (riderStatus.overallStatus === CheckInStatus.QUIT_RIDING) {
      return CHECK_IN_STATUS_COLORS[CheckInStatus.QUIT_RIDING];
    }

    // Default view - show last stage color or white for not checked in
    if (riderStatus.overallStatus === CheckInStatus.NOT_CHECKED_IN) {
      return STAGE_VIEW_COLORS.notCheckedInAtStage; // White with border
    }
    
    if (riderStatus.lastStage) {
      return getStageColor(riderStatus.lastStage.stageNumber, ride.stages.length);
    }
    
    return STAGE_VIEW_COLORS.notCheckedInAtStage; // White with border
  };

  const getStageLabel = (stageNumber: number, totalStages: number): string => {
    if (stageNumber === 1) return 'Start';
    if (stageNumber === totalStages) return 'Finish';
    return `PS${stageNumber - 1}`;
  };

  // Style helpers for dynamic colors
  const getRiderIconStyle = (riderStatus: RiderStatus) => {
    const bgColor = getRiderColor(riderStatus);
    const isWhite = bgColor === COLORS.white;
    
    return [
      styles.riderIcon,
      {
        backgroundColor: bgColor,
        borderWidth: isWhite ? 2 : 0,
        borderColor: isWhite ? COLORS.gray[400] : 'transparent',
      }
    ];
  };

  const getStageButtonStyle = (stage: { stageId: string; stageNumber: number }) => {
    const isActive = stageViewId === stage.stageId;
    const bgColor = getStageColor(stage.stageNumber, ride.stages.length);
    
    return [
      styles.stageBtn,
      { 
        backgroundColor: bgColor,
        opacity: isActive ? 1 : 0.6,
        borderWidth: isActive ? 2 : 0,
        borderColor: COLORS.white,
      }
    ];
  };

  return (
    <View style={styles.container}>
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.rideTitle}>{ride.name}</Text>
          <Text style={styles.rideDate}>{ride.date}</Text>
        </View>
        <View style={styles.statsRow}>
          {ride.stages.map((stage) => (
            <View key={stage.stageId} style={styles.statChip}>
              <Text style={styles.statChipValue}>{stageCounts[stage.stageId] || 0}</Text>
              <Text style={styles.statChipLabel}>{getStageLabel(stage.stageNumber, ride.stages.length)}</Text>
            </View>
          ))}
          <View style={styles.statChip}>
            <Text style={styles.statChipValue}>{stageCounts['NR']}</Text>
            <Text style={styles.statChipLabel}>NR</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statChipValue}>{stageCounts['QR']}</Text>
            <Text style={styles.statChipLabel}>QR</Text>
          </View>
        </View>
      </View>

      {/* Rider Grid - Maximum space */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.gridContainer}>
        {filteredRiders.map((riderStatus) => {
          const isWhiteBg = getRiderColor(riderStatus) === COLORS.white;
          return (
            <TouchableOpacity
              key={riderStatus.rider.riderId}
              style={getRiderIconStyle(riderStatus)}
            >
              <Text style={[styles.riderIdText, isWhiteBg && { color: COLORS.textPrimary }]}>
                {riderStatus.rider.riderId}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Footer with Sort and Stage View Toggles */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.sortButton, isSorted && styles.sortButtonActive]}
          onPress={toggleSort}
        >
          <SortIcon 
            size={24} 
            color={isSorted ? COLORS.primary : COLORS.gray[500]} 
          />
        </TouchableOpacity>
        
        <ScrollView 
          horizontal 
          style={styles.stageScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stageContent}
        >
          {ride.stages.map((stage) => (
            <TouchableOpacity
              key={stage.stageId}
              style={getStageButtonStyle(stage)}
              onPress={() => toggleStageView(stage.stageId)}
            >
              <Text style={styles.stageBtnText}>
                {getStageLabel(stage.stageNumber, ride.stages.length)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Floating Action Button for QR Scanner - Draggable */}
      <Animated.View
        style={[
          styles.fab,
          {
            transform: [{ translateX: pan.x }, { translateY: pan.y }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.fabButton}
          disabled={isDragging}
          onPress={() => {
            if (!isDragging) {
              // Handle QR scan action
              // TODO: Navigate to QR scanner screen
            }
          }}
        >
          <MaterialIcons name="qr-code-scanner" size={28} color={COLORS.white} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rideTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  rideDate: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.9,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statChipValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  statChipLabel: {
    fontSize: 11,
    color: COLORS.white,
    opacity: 0.9,
  },
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
  },
  riderIcon: {
    width: RIDER_ICON_SIZE,
    height: RIDER_ICON_SIZE,
    margin: 3,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  riderIdText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  footer: {
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    height: 60,
    gap: 12,
  },
  sortButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.gray[100],
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary + '15', // 15% opacity
  },
  stageScroll: {
    flex: 1,
  },
  stageContent: {
    alignItems: 'center',
    gap: 6,
  },
  stageBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginRight: 6,
  },
  stageBtnText: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: 'bold',
  },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#14B8A6',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
});
