/**
 * OfflineBanner — connectivity strip with the manual offline toggle, the
 * unsent / failed counts of data captured on this device, the stale-data
 * alert and the offline-readiness time ("data as of HH:MM").
 *
 * Tapping the strip opens Sync status. Used by the Events screens (full) and
 * the ride tabs header (compact). The toggle is hidden on web (online only).
 */

import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, STATUS_BANNER_COLORS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { AppStackParamList } from '../../types/navigation';

export interface OfflineBannerProps {
  /** compact = single line for headers */
  variant?: 'full' | 'compact';
  /** What is captured on this screen, for the offline hint */
  captureLabel?: 'Scans' | 'Check-ins';
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function OfflineBanner({ variant = 'full', captureLabel = 'Scans' }: OfflineBannerProps) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { user } = useAuth();
  const { isOffline, isManualOffline, offlineReason, setManualOffline, isOfflineSupported } = useOffline();
  const { pendingCount, failedCount, isStale, readinessSyncedAt } = useSyncStatus();
  const isCompact = variant === 'compact';
  const isOfflineSession = Boolean(user?.isOfflineSession);

  const statusText = offlineReason === 'manual'
    ? 'Offline mode'
    : offlineReason === 'no-connectivity'
      ? 'No connection'
      : isOfflineSession
        ? 'Signed in offline'
        : 'Online';

  const readyTime = formatTime(readinessSyncedAt);
  const readiness = !isOfflineSupported
    ? null
    : readyTime
      ? (isOffline ? `Data as of ${readyTime}` : `Offline ready · data as of ${readyTime}`)
      : 'Offline data not downloaded yet';

  const details = [
    pendingCount > 0 ? `${pendingCount} unsent` : null,
    failedCount > 0 ? `${failedCount} sync issue${failedCount === 1 ? '' : 's'}` : null,
    readiness,
  ].filter(Boolean).join(' · ');

  const needsAttention = failedCount > 0 || isStale;
  const showWarning = isOffline || isOfflineSession || needsAttention;
  const hint = isStale
    ? 'Some data has not been sent for a while. Tap to review.'
    : isOffline
      ? `${captureLabel} are saved on this device and sent when online.`
      : isOfflineSession
        ? 'Data is saved on this device and sent after you sign in online.'
        : null;

  return (
    <TouchableOpacity
      accessibilityHint="Opens Sync status"
      accessibilityLabel={`${statusText}. ${details}`}
      accessibilityRole="button"
      activeOpacity={0.7}
      onPress={() => navigation.navigate('SyncStatus')}
      style={[
        styles.container,
        isCompact ? styles.compact : styles.full,
        showWarning ? styles.warning : styles.online,
      ]}
    >
      <MaterialIcons
        name={isOffline || isOfflineSession ? 'cloud-off' : needsAttention ? 'sync-problem' : 'cloud-done'}
        size={18}
        color={showWarning ? STATUS_BANNER_COLORS.warning.text : COLORS.success}
      />
      <View style={styles.body}>
        <Text style={styles.status} numberOfLines={1}>
          {statusText}
          {isCompact && details ? <Text style={styles.inlineDetails}>{` · ${details}`}</Text> : null}
        </Text>
        {!isCompact && details ? <Text style={styles.details}>{details}</Text> : null}
        {hint && (!isCompact || isStale) ? <Text style={styles.details}>{hint}</Text> : null}
      </View>
      {isOfflineSupported ? (
        <>
          {!isCompact ? <Text style={styles.toggleLabel}>Offline mode</Text> : null}
          <Switch
            accessibilityLabel="Offline mode"
            onValueChange={setManualOffline}
            value={isManualOffline}
          />
        </>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  full: { marginBottom: 12, paddingVertical: 8 },
  compact: { marginHorizontal: 8, marginVertical: 4, paddingVertical: 2 },
  online: { backgroundColor: COLORS.surface, borderColor: COLORS.border },
  warning: {
    backgroundColor: STATUS_BANNER_COLORS.warning.background,
    borderColor: STATUS_BANNER_COLORS.warning.border,
  },
  body: { flex: 1, minWidth: 0 },
  status: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  inlineDetails: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '400' },
  details: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  toggleLabel: { color: COLORS.textSecondary, fontSize: 12 },
});
