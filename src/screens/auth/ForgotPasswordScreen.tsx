/**
 * Forgot Password Screen — supports two reset flows:
 * 1) Request a reset code by email
 * 2) Use an already received reset code (including admin-triggered resets)
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { confirmResetPassword, resetPassword } from 'aws-amplify/auth';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

type ForgotPasswordMode = 'requestCode' | 'haveCode';

interface ForgotPasswordScreenProps {
  initialUsername?: string;
  onBackToLogin: () => void;
  onPasswordResetComplete: (payload: { username: string }) => void;
}

export default function ForgotPasswordScreen({
  initialUsername,
  onBackToLogin,
  onPasswordResetComplete,
}: ForgotPasswordScreenProps) {
  const [mode, setMode] = useState<ForgotPasswordMode>('requestCode');
  const [username, setUsername] = useState(initialUsername ?? '');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const email = useMemo(() => username.trim(), [username]);

  const handleSendCode = async () => {
    setLocalError(null);
    setInfoMessage(null);

    if (!email) {
      setLocalError('Please enter your email ID.');
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await resetPassword({ username: email });
      const destination = result.nextStep.codeDeliveryDetails?.destination;
      setInfoMessage(
        destination
          ? `A verification code has been sent to ${destination}.`
          : 'If the email exists, a password reset verification code has been sent.',
      );
      setMode('haveCode');
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Unable to start password reset. Please try again.';
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    setLocalError(null);
    setInfoMessage(null);

    if (!email) {
      setLocalError('Please enter your email ID.');
      return;
    }
    if (!resetCode.trim()) {
      setLocalError('Please enter the reset code.');
      return;
    }
    if (!newPassword) {
      setLocalError('Please enter a new password.');
      return;
    }
    if (newPassword.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    try {
      setIsSubmitting(true);
      await confirmResetPassword({
        username: email,
        confirmationCode: resetCode.trim(),
        newPassword,
      });
      onPasswordResetComplete({ username: email });
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : 'Unable to reset password. Please try again.';
      setLocalError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerContainer}>
          <MaterialIcons name="mark-email-read" size={56} color={COLORS.primary} />
          <Text style={styles.title}>Forgot Password</Text>
          <Text style={styles.subtitle}>
            Request a reset code or continue with a code you already received by email.
          </Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.modeSwitch}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === 'requestCode' && styles.modeButtonActive,
              ]}
              onPress={() => {
                setMode('requestCode');
                setLocalError(null);
                setInfoMessage(null);
              }}
              disabled={isSubmitting}
            >
              <Text
                style={[
                  styles.modeButtonText,
                  mode === 'requestCode' && styles.modeButtonTextActive,
                ]}
              >
                Enter email ID to receive code
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === 'haveCode' && styles.modeButtonActive,
              ]}
              onPress={() => {
                setMode('haveCode');
                setLocalError(null);
                setInfoMessage(null);
              }}
              disabled={isSubmitting}
            >
              <Text
                style={[
                  styles.modeButtonText,
                  mode === 'haveCode' && styles.modeButtonTextActive,
                ]}
              >
                Got Password Reset Code
              </Text>
            </TouchableOpacity>
          </View>

          {!!localError && (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={20} color={COLORS.danger} />
              <Text style={styles.errorText}>{localError}</Text>
            </View>
          )}

          {!!infoMessage && (
            <View style={styles.infoBanner}>
              <MaterialIcons name="info-outline" size={20} color={COLORS.info} />
              <Text style={styles.infoText}>{infoMessage}</Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email ID</Text>
            <View style={styles.inputWrapper}>
              <MaterialIcons
                name="person-outline"
                size={20}
                color={COLORS.gray[400]}
                style={styles.inputIcon}
              />
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
                editable={!isSubmitting}
              />
            </View>
          </View>

          {mode === 'requestCode' ? (
            <TouchableOpacity
              style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
              onPress={handleSendCode}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryButtonText}>Send Reset Code</Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Reset Code</Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons
                    name="confirmation-number"
                    size={20}
                    color={COLORS.gray[400]}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={resetCode}
                    onChangeText={setResetCode}
                    placeholder="Enter reset code"
                    placeholderTextColor={COLORS.textDisabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons
                    name="lock-outline"
                    size={20}
                    color={COLORS.gray[400]}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor={COLORS.textDisabled}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textContentType="newPassword"
                    editable={!isSubmitting}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((prev) => !prev)}
                    style={styles.eyeButton}
                    disabled={isSubmitting}
                  >
                    <MaterialIcons
                      name={showPassword ? 'visibility' : 'visibility-off'}
                      size={20}
                      color={COLORS.gray[400]}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <View style={styles.inputWrapper}>
                  <MaterialIcons
                    name="lock-outline"
                    size={20}
                    color={COLORS.gray[400]}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Re-enter new password"
                    placeholderTextColor={COLORS.textDisabled}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textContentType="newPassword"
                    editable={!isSubmitting}
                    onSubmitEditing={handleResetPassword}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
                onPress={handleResetPassword}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Reset Password</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryAction}
                onPress={handleSendCode}
                disabled={isSubmitting}
              >
                <Text style={styles.secondaryActionText}>Resend reset code</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={styles.backButton}
            onPress={onBackToLogin}
            disabled={isSubmitting}
          >
            <Text style={styles.backButtonText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  headerContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 10,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  formContainer: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  modeSwitch: {
    marginBottom: 16,
  },
  modeButton: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  modeButtonActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EEF6FF',
  },
  modeButtonText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  modeButtonTextActive: {
    color: COLORS.primary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  infoText: {
    color: COLORS.info,
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  inputGroup: {
    marginBottom: 14,
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
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryAction: {
    alignSelf: 'center',
    marginTop: 12,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  backButton: {
    alignSelf: 'center',
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  backButtonText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
});