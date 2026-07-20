/**
 * Root Navigator — switches between the Auth stack and the authenticated
 * App stack based on AuthContext state.
 *
 * Replaces the previous AuthGate state-machine in App.tsx. Because the
 * entire Auth/App subtree is swapped (not just a screen within one stack),
 * the Auth stack always remounts fresh at Login on sign-out — matching the
 * previous "reset to login on logout" behaviour.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 0).
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../context/AuthContext';
import { TourProvider } from '../context/TourContext';
import { COLORS } from '../constants/colors';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';

export default function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!user) {
    return <AuthNavigator />;
  }

  return (
    <TourProvider>
      <StatusBar style="auto" />
      <AppNavigator />
    </TourProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
