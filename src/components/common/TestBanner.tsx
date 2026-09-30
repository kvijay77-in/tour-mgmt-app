import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';

export default function TestBanner() {
  const insets = useSafeAreaInsets();
  if (Constants.expoConfig?.extra?.appVariant !== 'test') return null;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel="TEST environment. This app connects to test data."
      style={[styles.banner, { paddingTop: insets.top }]}
    >
      <Text style={styles.label}>TEST</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  label: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
