import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../../constants/colors';

interface RiderProfileDefinitionsScreenProps {
  onClose: () => void;
}

export default function RiderProfileDefinitionsScreen({ onClose }: RiderProfileDefinitionsScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rider profile definitions</Text>
      <Text style={styles.subtitle}>
        Manage rider profile sections, attributes and value lists.
      </Text>
      {Platform.OS !== 'web' && (
        <Text style={styles.mobileNote}>
          Tip: for best experience use web. Mobile fallback supports read-only access.
        </Text>
      )}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close rider profile definitions"
      >
        <Text style={styles.closeButtonText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  mobileNote: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  closeButtonText: {
    color: COLORS.white,
    fontWeight: '600',
  },
});
