/**
 * Login Screen — username + password authentication.
 * No sign-up option (invite-only model).
 *
 * See docs/SolutionDesign.md § Authentication.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import StatusBanner from '../../components/events/StatusBanner';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import {
  getOfflineProfile,
  getRememberedUsername,
  getUnlockMethodLabel,
  hasDeviceScreenLock,
} from '../../services/auth/offlineCredentialService';
import { discardQueuedDataOwnedByOthers } from '../../services/database/database';
import { logger } from '../../utils/logger';

const TAG = 'LoginScreen';

const NO_SCREEN_LOCK_WARNING =
  'This device has no screen lock, so your password cannot be saved securely and offline sign-in will not be available. ' +
  'Set a PIN, pattern, password, fingerprint or Face ID in your device settings to use offline mode.';

interface LoginScreenProps {
  initialUsername?: string;
  onNewPasswordRequired: (payload: {
    username: string;
    rememberMe: boolean;
  }) => void;
  onForgotPassword: (payload: { username?: string }) => void;
  externalErrorMessage?: string | null;
}

interface OtherUserDataPrompt {
  userId: string;
  count: number;
  previousUsername: string | null;
}

export default function LoginScreen({
  initialUsername,
  onNewPasswordRequired,
  onForgotPassword,
  externalErrorMessage = null,
}: LoginScreenProps) {
  const { login, unlockWithDevice, isAuthenticating, error } = useAuth();
  const { isOffline, isManualOffline, isOfflineSupported, setManualOffline } = useOffline();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [hasScreenLock, setHasScreenLock] = useState(true);
  const [savedSignInUser, setSavedSignInUser] = useState<string | null>(null);
  const [unlockLabel, setUnlockLabel] = useState('device PIN');
  const [otherUserData, setOtherUserData] = useState<OtherUserDataPrompt | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadSavedSignIn = async () => {
      try {
        const [rememberedUsername, profile, screenLock, label] = await Promise.all([
          getRememberedUsername(),
          getOfflineProfile(),
          isOfflineSupported ? hasDeviceScreenLock() : Promise.resolve(true),
          isOfflineSupported ? getUnlockMethodLabel() : Promise.resolve('device PIN'),
        ]);
        if (cancelled) return;
        if (rememberedUsername) {
          setUsername((current) => current || rememberedUsername);
          setRememberMe(true);
        }
        setHasScreenLock(screenLock);
        setSavedSignInUser(profile?.hasSavedPassword ? profile.username : null);
        setUnlockLabel(label);
      } catch (err) {
        // Saved sign-in data is optional; never block sign-in.
        logger.warn(TAG, 'Failed to read saved sign-in', err);
      }
    };

    void loadSavedSignIn();
    return () => {
      cancelled = true;
    };
  }, [isOfflineSupported]);

  useEffect(() => {
    if (!initialUsername) {
      return;
    }
    setUsername(initialUsername);
    setPassword('');
  }, [initialUsername]);

  const handleLogin = async () => {
    setLocalError(null);

    if (!username.trim()) {
      setLocalError('Please enter your username.');
      return;
    }
    if (!password) {
      setLocalError('Please enter your password.');
      return;
    }

    try {
      const result = await login(username.trim(), password, rememberMe);

      if (result.status === 'NEW_PASSWORD_REQUIRED') {
        onNewPasswordRequired({
          username: username.trim(),
          rememberMe,
        });
      } else if (result.status === 'OTHER_USER_DATA') {
        setOtherUserData({
          userId: result.userId,
          count: result.count,
          previousUsername: result.previousUsername,
        });
      }
    } catch {
      // Error is already set in AuthContext
    }
  };

  const handleUnlock = async () => {
    setLocalError(null);
    try {
      await unlockWithDevice();
    } catch {
      // Error is already set in AuthContext
    }
  };

  const handleDiscardOtherUserData = async () => {
    if (!otherUserData) return;
    setIsDiscarding(true);
    try {
      await discardQueuedDataOwnedByOthers(otherUserData.userId);
      setOtherUserData(null);
      await handleLogin();
    } catch (err) {
      logger.error(TAG, 'Failed to discard previous user data', err);
      setLocalError('Could not remove the other user\'s data. Please try again.');
      setOtherUserData(null);
    } finally {
      setIsDiscarding(false);
    }
  };

  const displayError = localError || externalErrorMessage || error;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoContainer}>
          <Image
            source={require('../../../assets/tot-signin.jpg')}
            style={styles.signInImage}
            resizeMode="contain"
          />
          <Text style={styles.appTitle}>Tour Check-In</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        <View style={styles.formContainer}>
          {isOfflineSupported && !hasScreenLock && (
            <View style={styles.bannerSpacing}>
              <StatusBanner kind="warning" title="No screen lock" message={NO_SCREEN_LOCK_WARNING} />
            </View>
          )}

          {isManualOffline ? (
            <View style={styles.bannerSpacing}>
              <StatusBanner
                kind="info"
                title="Offline mode is on"
                message={savedSignInUser
                  ? 'You can sign in offline with your saved sign-in. Turn offline mode off to sign in online.'
                  : 'Turn offline mode off to sign in online.'}
                primaryAction={{ label: 'Turn off', onPress: () => setManualOffline(false) }}
              />
            </View>
          ) : isOffline ? (
            <View style={styles.bannerSpacing}>
              <StatusBanner
                kind="info"
                title="No connection"
                message={savedSignInUser
                  ? 'You can sign in offline with your saved sign-in.'
                  : 'Connect to the internet to sign in.'}
              />
            </View>
          ) : null}

          {displayError && (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={20} color={COLORS.danger} />
              <Text style={styles.errorText}>{displayError}</Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.inputWrapper}>
              <MaterialIcons name="person-outline" size={20} color={COLORS.gray[400]} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={(text) => setUsername(text.replace(/\s+/g, ''))}
                placeholder="Enter your email ID"
                placeholderTextColor={COLORS.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                editable={!isAuthenticating}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <MaterialIcons name="lock-outline" size={20} color={COLORS.gray[400]} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.textDisabled}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textContentType="password"
                editable={!isAuthenticating}
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <MaterialIcons
                  name={showPassword ? 'visibility' : 'visibility-off'}
                  size={20}
                  color={COLORS.gray[400]}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => {
                onForgotPassword({ username: username.trim() || undefined });
              }}
              disabled={isAuthenticating}
              style={styles.forgotPasswordLink}
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.loginButton, isAuthenticating && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isAuthenticating}
          >
            {isAuthenticating ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.loginButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {isOfflineSupported && savedSignInUser && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Sign in as ${savedSignInUser} with ${unlockLabel}`}
              style={styles.unlockButton}
              onPress={handleUnlock}
              disabled={isAuthenticating}
            >
              <MaterialIcons name="fingerprint" size={20} color={COLORS.primary} />
              <Text style={styles.unlockButtonText}>Sign in with {unlockLabel}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.rememberMeContainer}
            onPress={() => setRememberMe((prev) => !prev)}
            disabled={isAuthenticating}
          >
            <MaterialIcons
              name={rememberMe ? 'check-box' : 'check-box-outline-blank'}
              size={20}
              color={rememberMe ? COLORS.primary : COLORS.gray[500]}
            />
            <Text style={styles.rememberMeText}>Remember me</Text>
          </TouchableOpacity>
          {isOfflineSupported && (
            <Text style={styles.rememberMeHint}>
              {hasScreenLock
                ? 'Saves your sign-in securely on this device so you can sign in offline.'
                : 'Remembers your username only (no screen lock on this device).'}
            </Text>
          )}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={otherUserData !== null}
        title="Unsynced data from another user"
        message={`${otherUserData?.previousUsername ?? 'Another user'} has ${otherUserData?.count ?? 0} item(s) on this device that have not been sent to the server. Ask them to sign in and sync first. Discarding deletes this data permanently.`}
        confirmLabel="Discard and continue"
        cancelLabel="Cancel"
        confirmTone="danger"
        isSubmitting={isDiscarding}
        onConfirm={() => void handleDiscardOtherUserData()}
        onCancel={() => setOtherUserData(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  signInImage: {
    width: '100%',
    maxWidth: 280,
    height: 140,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  formContainer: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  inputGroup: {
    marginBottom: 16,
  },
  forgotPasswordLink: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputIcon: {
    paddingLeft: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  eyeButton: {
    padding: 12,
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  rememberMeContainer: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
  },
  rememberMeHint: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  bannerSpacing: {
    marginBottom: 16,
  },
  unlockButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingVertical: 12,
  },
  unlockButtonText: {
    marginLeft: 8,
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  rememberMeText: {
    marginLeft: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
});
