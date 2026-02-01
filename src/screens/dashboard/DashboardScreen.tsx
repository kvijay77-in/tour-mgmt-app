/**
 * Dashboard Screen - Main screen showing rider status
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getMockDashboardData, getMockCurrentRide } from '../../services/api/mockData';
import { RiderStatus, CheckInStatus } from '../../types/models';
import { COLORS, CHECK_IN_STATUS_COLORS, getStageColor, STAGE_VIEW_COLORS } from '../../constants/colors';

const { width } = Dimensions.get('window');
const GRID_COLUMNS = 6;
const RIDER_ICON_SIZE = (width - 32) / GRID_COLUMNS - 6;

export default function DashboardScreen() {
  const ride = getMockCurrentRide();
  const allRiderStatuses = getMockDashboardData();
  const [stageViewId, setStageViewId] = useState<string | undefined>(undefined);

  // Toggle stage view - clicking again deactivates
  const toggleStageView = (stageId: string) => {
    setStageViewId(stageViewId === stageId ? undefined : stageId);
  };

  // Stage view doesn't filter - it just changes color display
  const filteredRiders = allRiderStatuses;

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
    // Special statuses always use their colors
    if (riderStatus.overallStatus === CheckInStatus.NOT_RIDING) {
      return COLORS.gray[400]; // Grey for Not Riding
    }
    if (riderStatus.overallStatus === CheckInStatus.QUIT_RIDING) {
      return CHECK_IN_STATUS_COLORS[CheckInStatus.QUIT_RIDING];
    }

    // Stage view active - show selected stage color if rider has reached it, white otherwise
    if (stageViewId) {
      const selectedStage = ride.stages.find(s => s.stageId === stageViewId);
      
      // If rider hasn't checked in anywhere yet, show white
      if (!riderStatus.lastStage) {
        return STAGE_VIEW_COLORS.notCheckedInAtStage;
      }
      
      // Check if rider has reached or passed the selected stage
      // (since checking in at a later stage implies checking in at all previous stages)
      if (selectedStage && riderStatus.lastStage.stageNumber >= selectedStage.stageNumber) {
        // Rider has reached this stage - show the selected stage's color
        return getStageColor(selectedStage.stageNumber, ride.stages.length);
      }
      
      // Rider hasn't reached this stage yet - show white
      return STAGE_VIEW_COLORS.notCheckedInAtStage;
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

      {/* Compact Footer with Stage View Toggle and QR Scan */}
      <View style={styles.footer}>
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
        
        <TouchableOpacity style={styles.qrButton}>
          <MaterialIcons name="qr-code-scanner" size={28} color={COLORS.white} />
        </TouchableOpacity>
      </View>
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
  qrButton: {
    backgroundColor: '#14B8A6',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
