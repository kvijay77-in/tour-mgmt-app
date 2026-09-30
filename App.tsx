/**
 * Main App Component
 * Entry point for the application.
 *
 * Startup sequence:
 * 1. Check expo-secure-store for a stored OrgConfig.
 * 2. If found → configure Amplify + apiClient, show auth gate.
 * 3. If not found → show OrgSetupScreen (deep link / QR scanner).
 *
 * See docs/SolutionDesign.md § App Distribution — Runtime Configuration.
 */

import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import Constants from 'expo-constants';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import TestBanner from './src/components/common/TestBanner';
import { AuthProvider } from './src/context/AuthContext';
import { OfflineProvider } from './src/context/OfflineContext';
import { configureAmplify } from './src/config/amplify';
import { initBackendRouting, restoreReviewerSession } from './src/config/reviewAccess';
import { COLORS } from './src/constants/colors';
import { OrgConfig } from './src/types/config';
import { loadOrgConfig } from './src/services/config/orgConfigService';
import { setApiBaseUrl } from './src/services/api/apiClient';
import { logger } from './src/utils/logger';
import OrgSetupScreen from './src/screens/auth/OrgSetupScreen';
import RootNavigator from './src/navigation/RootNavigator';
import { navigationRef } from './src/navigation/navigationRef';

const TAG = 'App';

// ---------------------------------------------------------------------------
// Apply runtime org config (Amplify + apiClient)
// ---------------------------------------------------------------------------

function applyOrgConfig(config: OrgConfig): void {
  configureAmplify(config);
  setApiBaseUrl(config.apiBaseUrl);
  initBackendRouting(config);
}

function logStartupConfiguration(apiBaseUrl: string): void {
  let apiHost = 'not-configured';
  try {
    if (apiBaseUrl) apiHost = new URL(apiBaseUrl).host;
  } catch {
    apiHost = 'invalid';
  }
  const variant = Constants.expoConfig?.extra?.appVariant ?? 'production';
  logger.info(TAG, `Startup configuration: variant=${variant}, apiHost=${apiHost}`);
}

// ---------------------------------------------------------------------------
// Root component — handles OrgConfig bootstrap
// ---------------------------------------------------------------------------

type AppState =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'ready' };

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const storedConfig = await loadOrgConfig();

        if (cancelled) return;

        if (storedConfig) {
          applyOrgConfig(storedConfig);
          const restoredReviewer = await restoreReviewerSession();
          logStartupConfiguration(
            restoredReviewer
              ? process.env.EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL ?? ''
              : storedConfig.apiBaseUrl,
          );
          setState({ phase: 'ready' });
        } else {
          // Check if env-var fallback is available (dev mode)
          const envBaseUrl = process.env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL || '';
          const envPoolId = process.env.EXPO_PUBLIC_AWS_USER_POOL_ID || '';

          if (envBaseUrl && envPoolId) {
            logger.info(TAG, 'No stored org config — using env-var fallback (dev mode)');
            configureAmplify();
            initBackendRouting();
            const restoredReviewer = await restoreReviewerSession();
            logStartupConfiguration(
              restoredReviewer
                ? process.env.EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL ?? ''
                : envBaseUrl,
            );
            setState({ phase: 'ready' });
          } else {
            logStartupConfiguration(envBaseUrl);
            logger.info(TAG, 'No org config found — showing setup screen');
            logStartupConfiguration(process.env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL ?? '');
            setState({ phase: 'setup' });
          }
        }
      } catch (err) {
        logger.error(TAG, 'Bootstrap error', err);
        if (!cancelled) {
          setState({ phase: 'setup' });
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfigured = async (config: OrgConfig) => {
    applyOrgConfig(config);
    const restoredReviewer = await restoreReviewerSession();
    logStartupConfiguration(
      restoredReviewer
        ? process.env.EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL ?? ''
        : config.apiBaseUrl,
    );
    setState({ phase: 'ready' });
  };

  const content = state.phase === 'loading'
    ? (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    )
    : state.phase === 'setup'
      ? <OrgSetupScreen onConfigured={handleConfigured} />
      : (
        <OfflineProvider>
          <AuthProvider>
            <NavigationContainer ref={navigationRef}>
              <RootNavigator />
            </NavigationContainer>
          </AuthProvider>
        </OfflineProvider>
      );

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <View style={styles.appFrame}>
            <TestBanner />
            {content}
          </View>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  appFrame: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
