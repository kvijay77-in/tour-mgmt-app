/**
 * Main App Component
 * Entry point for the application
 */

import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import DashboardScreen from './src/screens/dashboard/DashboardScreen';
import { configureAmplify } from './src/config/amplify';
import { initDatabase } from './src/services/database/databaseService';
import { COLORS } from './src/constants/colors';

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      // Configure Amplify (no-op when env vars are not set)
      configureAmplify();

      // Initialise the local SQLite database
      await initDatabase();

      setIsReady(true);
    };

    bootstrap();
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <DashboardScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
