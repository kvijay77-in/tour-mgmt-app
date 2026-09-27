import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, STATUS_BANNER_COLORS } from '../../constants/colors';
import { useOffline } from '../../context/OfflineContext';
import { useEventSession } from '../../context/EventSessionContext';

/** Connectivity strip with the manual offline toggle and queued/failed counts (Events screens only). */
export default function OfflineBanner() {
  const { isOffline, isManualOffline, offlineReason, setManualOffline } = useOffline();
  const { pendingCount, failedCount } = useEventSession();

  const statusText = offlineReason === 'manual'
    ? 'Offline mode'
    : offlineReason === 'no-connectivity'
      ? 'No connection'
      : 'Online';
  const details = [
    pendingCount > 0 ? `${pendingCount} queued` : null,
    failedCount > 0 ? `${failedCount} sync issue${failedCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.container, isOffline ? styles.offline : styles.online]}>
      <MaterialIcons
        name={isOffline ? 'cloud-off' : 'cloud-done'}
        size={18}
        color={isOffline ? STATUS_BANNER_COLORS.warning.text : COLORS.success}
      />
      <View style={styles.body}>
        <Text style={styles.status}>{statusText}</Text>
        {details ? <Text style={styles.details}>{details}</Text> : null}
        {isOffline ? <Text style={styles.details}>Scans are saved on this device and sent when online.</Text> : null}
      </View>
      <Text style={styles.toggleLabel}>Offline mode</Text>
      <Switch
        accessibilityLabel="Offline mode"
        onValueChange={setManualOffline}
        value={isManualOffline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  online: { backgroundColor: COLORS.surface, borderColor: COLORS.border },
  offline: {
    backgroundColor: STATUS_BANNER_COLORS.warning.background,
    borderColor: STATUS_BANNER_COLORS.warning.border,
  },
  body: { flex: 1, minWidth: 0 },
  status: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  details: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  toggleLabel: { color: COLORS.textSecondary, fontSize: 12 },
});
