import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  createCognitoUser,
  listAvailableRoleGroups,
} from '../../services/auth/cognitoUserManagementService';
import { logger } from '../../utils/logger';

const TAG = 'UserOnboardingScreen';
const DEFAULT_COUNTRY_CODE = '+91';

interface UserOnboardingScreenProps {
  onClose: () => void;
  /** Offered after a successful create when the caller may manage tour assignments. */
  onAssignToTour?: (cognitoUserId: string) => void;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizePhoneInput(raw: string): string {
  const compact = raw.replace(/[\s-]/g, '').trim();

  if (!compact || compact === DEFAULT_COUNTRY_CODE) {
    return '';
  }

  if (compact.startsWith('+')) {
    return compact;
  }

  return `${DEFAULT_COUNTRY_CODE}${compact}`;
}

function isValidPhone(value: string): boolean {
  if (!value) return true;
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export default function UserOnboardingScreen({ onClose, onAssignToTour }: UserOnboardingScreenProps) {
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState(DEFAULT_COUNTRY_CODE);
  const [name, setName] = useState('');
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<{ email: string; cognitoUserId: string | null } | null>(null);

  const canSubmit = useMemo(() => {
    const normalizedPhone = normalizePhoneInput(phoneNumber);
    return isValidEmail(email) && isValidPhone(normalizedPhone) && selectedRoles.length > 0 && !isSubmitting;
  }, [email, phoneNumber, selectedRoles.length, isSubmitting]);

  const loadRoleOptions = useCallback(async () => {
    setIsLoadingRoles(true);
    setError(null);

    try {
      const groups = await listAvailableRoleGroups();
      setRoleOptions(groups);
    } catch (err) {
      logger.error(TAG, 'loadRoleOptions failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load role groups from Cognito.');
    } finally {
      setIsLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    void loadRoleOptions();
  }, [loadRoleOptions]);

  const toggleRoleSelection = useCallback((role: string) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        return prev.filter((item) => item !== role);
      }
      return [...prev, role];
    });
  }, []);

  const handleCreateUser = useCallback(async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhoneInput(phoneNumber);

    if (!isValidEmail(trimmedEmail)) {
      Alert.alert('Validation failed', 'Please enter a valid email ID.');
      return;
    }

    if (selectedRoles.length === 0) {
      Alert.alert('Validation failed', 'Please select at least one role.');
      return;
    }

    if (!isValidPhone(normalizedPhone)) {
      Alert.alert('Validation failed', 'Phone number must be in international format, for example +919876543210.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setCreatedUser(null);

    try {
      const cognitoUserId = await createCognitoUser({
        email: trimmedEmail,
        phoneNumber: normalizedPhone || undefined,
        name: name.trim() || undefined,
        roles: selectedRoles,
      });

      setCreatedUser({ email: trimmedEmail, cognitoUserId });
      setEmail('');
      setPhoneNumber(DEFAULT_COUNTRY_CODE);
      setName('');
      setSelectedRoles([]);
    } catch (err) {
      logger.error(TAG, 'handleCreateUser failed', err);
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, name, phoneNumber, selectedRoles]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>New User Onboarding</Text>
          <Text style={styles.subtitle}>Create a Cognito user and assign one or more role groups.</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.formGroup}>
          <Text style={styles.label}>Email ID *</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="user@example.com"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            editable={!isSubmitting}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Phone No (optional)</Text>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            placeholder="+919876543210"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            editable={!isSubmitting}
          />
          <Text style={styles.helperText}>Defaults to +91. Keep empty or +91 only to skip phone.</Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Name (optional)</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            textContentType="name"
            placeholder="Full name"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            editable={!isSubmitting}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Roles (Cognito groups) *</Text>
          {isLoadingRoles ? (
            <View style={styles.inlineLoadingWrap}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading groups...</Text>
            </View>
          ) : roleOptions.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No Cognito groups found.</Text>
            </View>
          ) : (
            <View style={styles.roleListWrap}>
              {roleOptions.map((role) => {
                const isSelected = selectedRoles.includes(role);
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.roleRow, isSelected && styles.roleRowSelected]}
                    onPress={() => toggleRoleSelection(role)}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.roleText, isSelected && styles.roleTextSelected]}>{role}</Text>
                    {isSelected && <MaterialIcons name="check-circle" size={20} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={18} color={COLORS.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {createdUser && (
          <View style={styles.successBanner}>
            <View style={styles.successRow}>
              <MaterialIcons name="check-circle" size={18} color={COLORS.success} />
              <Text style={styles.successText}>
                {createdUser.email} has been created in Cognito and assigned the selected roles.
              </Text>
            </View>
            {onAssignToTour && createdUser.cognitoUserId && (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => onAssignToTour(createdUser.cognitoUserId as string)}
                style={styles.assignButton}
              >
                <Text style={styles.assignButtonText}>Assign to this tour →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={loadRoleOptions}
          disabled={isSubmitting}
        >
          <Text style={styles.secondaryButtonText}>Refresh Groups</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
          onPress={() => {
            void handleCreateUser();
          }}
          disabled={!canSubmit}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Create User</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  closeButton: {
    padding: 4,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 14,
  },
  formGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  inlineLoadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    color: COLORS.textSecondary,
  },
  roleListWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
  },
  roleRow: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  roleRowSelected: {
    backgroundColor: COLORS.gray[50],
  },
  roleText: {
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  roleTextSelected: {
    fontWeight: '600',
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    padding: 12,
  },
  emptyText: {
    color: COLORS.textSecondary,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#991B1B',
    flex: 1,
  },
  successBanner: {
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    color: '#166534',
    flex: 1,
  },
  assignButton: {
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assignButtonText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
