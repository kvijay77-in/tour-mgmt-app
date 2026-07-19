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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
import { TourProvider } from './src/context/TourContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { configureAmplify } from './src/config/amplify';
import { initBackendRouting } from './src/config/reviewAccess';
import { COLORS } from './src/constants/colors';
import { OrgConfig } from './src/types/config';
import { loadOrgConfig } from './src/services/config/orgConfigService';
import { setApiBaseUrl } from './src/services/api/apiClient';
import { logger } from './src/utils/logger';
import DashboardScreen from './src/screens/dashboard/DashboardScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import NewPasswordScreen from './src/screens/auth/NewPasswordScreen';
import ForgotPasswordScreen from './src/screens/auth/ForgotPasswordScreen';
import OrgSetupScreen from './src/screens/auth/OrgSetupScreen';

const TAG = 'App';

type AuthScreen =
  | { screen: 'login' }
  | {
      screen: 'forgotPassword';
      username?: string;
    }
  | {
      screen: 'newPassword';
      username: string;
      rememberMe: boolean;
    };

// ---------------------------------------------------------------------------
// Apply runtime org config (Amplify + apiClient)
// ---------------------------------------------------------------------------

function applyOrgConfig(config: OrgConfig): void {
  configureAmplify(config);
  setApiBaseUrl(config.apiBaseUrl);
  initBackendRouting(config);
}

// ---------------------------------------------------------------------------
// AuthGate — login / new-password / dashboard
// ---------------------------------------------------------------------------

function AuthGate() {
  const { user, isLoading } = useAuth();
  const [authScreen, setAuthScreen] = useState<AuthScreen>({ screen: 'login' });
  const [loginErrorMessage, setLoginErrorMessage] = useState<string | null>(null);
  const [loginPrefillUsername, setLoginPrefillUsername] = useState<string | undefined>(undefined);

  // Reset to login screen whenever the user is signed out
  React.useEffect(() => {
    if (!user && !isLoading) {
      setAuthScreen({ screen: 'login' });
    }
  }, [user, isLoading]);

  const handleGoToLogin = React.useCallback(() => {
    setAuthScreen({ screen: 'login' });
  }, []);

  const handleNoRoleAfterPasswordChange = React.useCallback(() => {
    setLoginErrorMessage('No role has been assigned to your account. Please contact your tour administrator.');
    setAuthScreen({ screen: 'login' });
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!user) {
    if (authScreen.screen === 'forgotPassword') {
      return (
        <ForgotPasswordScreen
          initialUsername={authScreen.username}
          onBackToLogin={() => {
            setAuthScreen({ screen: 'login' });
          }}
          onPasswordResetComplete={({ username }) => {
            setLoginErrorMessage(null);
            setLoginPrefillUsername(username);
            setAuthScreen({ screen: 'login' });
          }}
        />
      );
    }

    if (authScreen.screen === 'newPassword') {
      return (
        <NewPasswordScreen
          username={authScreen.username}
          rememberMe={authScreen.rememberMe}
          onCancel={handleGoToLogin}
          onPasswordChangedNoRole={handleNoRoleAfterPasswordChange}
        />
      );
    }
    return (
      <LoginScreen
        initialUsername={loginPrefillUsername}
        externalErrorMessage={loginErrorMessage}
        onForgotPassword={({ username }) =>
          setAuthScreen({
            screen: 'forgotPassword',
            username,
          })}
        onNewPasswordRequired={({ username, rememberMe }) =>
          setAuthScreen({
            screen: 'newPassword',
            username,
            rememberMe,
          })}
      />
    );
  }

  return (
    <TourProvider>
      <StatusBar style="auto" />
      <DashboardScreen />
    </TourProvider>
  );
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
          setState({ phase: 'ready' });
        } else {
          // Check if env-var fallback is available (dev mode)
          const envBaseUrl = process.env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL || '';
          const envPoolId = process.env.EXPO_PUBLIC_AWS_USER_POOL_ID || '';

          if (envBaseUrl && envPoolId) {
            logger.info(TAG, 'No stored org config — using env-var fallback (dev mode)');
            configureAmplify();
            initBackendRouting();
            setState({ phase: 'ready' });
          } else {
            logger.info(TAG, 'No org config found — showing setup screen');
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

  const handleConfigured = (config: OrgConfig) => {
    applyOrgConfig(config);
    setState({ phase: 'ready' });
  };

  if (state.phase === 'loading') {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (state.phase === 'setup') {
    return (
      <SafeAreaProvider>
        <ErrorBoundary>
          <OrgSetupScreen onConfigured={handleConfigured} />
        </ErrorBoundary>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
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
