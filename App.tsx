/**
 * Main App Component
 * Entry point for the application
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import DashboardScreen from './src/screens/dashboard/DashboardScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <DashboardScreen />
    </SafeAreaProvider>
  );
}
