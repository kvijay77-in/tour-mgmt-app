/**
 * Main App Component
 * Entry point for the application
 */

import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { TourProvider } from './src/context/TourContext';
import DashboardScreen from './src/screens/dashboard/DashboardScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <TourProvider>
          <StatusBar style="auto" />
          <DashboardScreen />
        </TourProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
