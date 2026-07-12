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
  Modal,
  Alert,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { resetPassword } from 'aws-amplify/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';

const REMEMBERED_CREDENTIALS_KEY = 'auth.rememberedCredentials';

interface RememberedCredentials {
  username: string;
  password: string;
}

interface LoginScreenProps {
  onNewPasswordRequired: (payload: {
    username: string;
    rememberMe: boolean;
  }) => void;
}

export default function LoginScreen({ onNewPasswordRequired }: LoginScreenProps) {
  const { login, isAuthenticating, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isForgotPasswordModalVisible, setIsForgotPasswordModalVisible] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordError, setForgotPasswordError] = useState<string | null>(null);
  const [isSubmittingForgotPassword, setIsSubmittingForgotPassword] = useState(false);

  useEffect(() => {
    const loadRememberedCredentials = async () => {
      try {
        const raw = await SecureStore.getItemAsync(REMEMBERED_CREDENTIALS_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as Partial<RememberedCredentials>;
        if (typeof parsed.username === 'string' && typeof parsed.password === 'string') {
          setUsername(parsed.username);
          setPassword(parsed.password);
          setRememberMe(true);
        }
      } catch {
        // Corrupted or inaccessible saved credentials should not block sign-in.
      }
    };

    void loadRememberedCredentials();
  }, []);

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
      const result = await login(username.trim(), password);

      if (result === 'DONE') {
        if (rememberMe) {
          const credentials: RememberedCredentials = {
            username: username.trim(),
            password,
          };
          await SecureStore.setItemAsync(
            REMEMBERED_CREDENTIALS_KEY,
            JSON.stringify(credentials),
          );
        } else {
          await SecureStore.deleteItemAsync(REMEMBERED_CREDENTIALS_KEY);
        }
      }

      if (result === 'NEW_PASSWORD_REQUIRED') {
        onNewPasswordRequired({
          username: username.trim(),
          rememberMe,
        });
      }
    } catch {
      // Error is already set in AuthContext
    }
  };

  const handleForgotPasswordSubmit = async () => {
    setForgotPasswordError(null);
    const email = forgotPasswordEmail.trim();

    if (!email) {
      setForgotPasswordError('Please enter your email ID.');
      return;
    }

    try {
      setIsSubmittingForgotPassword(true);
      const result = await resetPassword({ username: email });
      const destination = result.nextStep.codeDeliveryDetails?.destination;

      setIsForgotPasswordModalVisible(false);
      setForgotPasswordEmail('');

      Alert.alert(
        'Password Reset Email Sent',
        destination
          ? `A verification code has been sent to ${destination}.`
          : 'If the email exists, a password reset verification code has been sent.',
      );
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Unable to start password reset. Please try again.';
      setForgotPasswordError(message);
    } finally {
      setIsSubmittingForgotPassword(false);
    }
  };

  const displayError = localError || error;

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
                onChangeText={setUsername}
                placeholder="Enter your username"
                placeholderTextColor={COLORS.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
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
                setForgotPasswordError(null);
                setForgotPasswordEmail('');
                setIsForgotPasswordModalVisible(true);
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
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={isForgotPasswordModalVisible}
        onRequestClose={() => setIsForgotPasswordModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Forgot Password</Text>
            <Text style={styles.modalSubtitle}>
              Enter your email ID to receive a password reset verification code.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={forgotPasswordEmail}
              onChangeText={setForgotPasswordEmail}
              placeholder="Enter your email"
              placeholderTextColor={COLORS.textDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!isSubmittingForgotPassword}
            />

            {forgotPasswordError && (
              <Text style={styles.modalErrorText}>{forgotPasswordError}</Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setIsForgotPasswordModalVisible(false)}
                disabled={isSubmittingForgotPassword}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitButton}
                onPress={handleForgotPasswordSubmit}
                disabled={isSubmittingForgotPassword}
              >
                {isSubmittingForgotPassword ? (
                  <ActivityIndicator color={COLORS.white} size="small" />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  rememberMeText: {
    marginLeft: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  modalErrorText: {
    color: COLORS.danger,
    fontSize: 13,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  modalCancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalSubmitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minWidth: 86,
    alignItems: 'center',
  },
  modalSubmitButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
