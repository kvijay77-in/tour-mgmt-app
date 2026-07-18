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
  CognitoManagedUser,
  listAvailableRoleGroups,
  listCognitoUsersWithRoles,
  updateCognitoUserProfile,
} from '../../services/auth/cognitoUserManagementService';
import { logger } from '../../utils/logger';

const TAG = 'UserModifyScreen';
const DEFAULT_COUNTRY_CODE = '+91';

interface UserModifyScreenProps {
  onClose: () => void;
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

export default function UserModifyScreen({ onClose }: UserModifyScreenProps) {
  const [users, setUsers] = useState<CognitoManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [name, setName] = useState('');
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.cognitoUserId === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [data, groups] = await Promise.all([
        listCognitoUsersWithRoles(),
        listAvailableRoleGroups(),
      ]);
      setUsers(data);
      setRoleOptions(groups);

      if (selectedUserId) {
        const refreshed = data.find((user) => user.cognitoUserId === selectedUserId);
        if (refreshed) {
          setEmail(refreshed.email);
          setPhoneNumber(refreshed.phoneNumber ?? DEFAULT_COUNTRY_CODE);
          setName(refreshed.name ?? '');
          setSelectedRoles(refreshed.roles);
        }
      }
    } catch (err) {
      logger.error(TAG, 'loadUsers failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load users from Cognito.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleSelectUser = useCallback((user: CognitoManagedUser) => {
    setSelectedUserId(user.cognitoUserId);
    setEmail(user.email);
    setPhoneNumber(user.phoneNumber ?? DEFAULT_COUNTRY_CODE);
    setName(user.name ?? '');
    setSelectedRoles(user.roles);
    setError(null);
  }, []);

  const toggleRoleSelection = useCallback((role: string) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        return prev.filter((item) => item !== role);
      }
      return [...prev, role];
    });
  }, []);

  const handleUpdateUser = useCallback(async () => {
    if (!selectedUser) {
      Alert.alert('Select a user', 'Please select a user to modify.');
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizePhoneInput(phoneNumber);
    if (!isValidEmail(trimmedEmail)) {
      Alert.alert('Validation failed', 'Please enter a valid email ID.');
      return;
    }

    if (!isValidPhone(normalizedPhone)) {
      Alert.alert('Validation failed', 'Phone number must be in international format, for example +919876543210.');
      return;
    }

    if (selectedRoles.length === 0) {
      Alert.alert('Validation failed', 'Please select at least one role.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await updateCognitoUserProfile(selectedUser.cognitoUserId, {
        email: trimmedEmail,
        phoneNumber: normalizedPhone,
        name: name.trim(),
        roles: [...new Set(selectedRoles)],
      });

      Alert.alert('User updated', 'The selected user profile and role assignments have been updated.');
      await loadUsers();
    } catch (err) {
      logger.error(TAG, 'handleUpdateUser failed', err);
      setError(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, loadUsers, name, phoneNumber, selectedRoles, selectedUser]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>Modify User</Text>
          <Text style={styles.subtitle}>Select a user, update profile fields, then save changes to Cognito.</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading users...</Text>
        </View>
      ) : (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {error && (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={18} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Registered Users</Text>
            {users.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No users found in Cognito.</Text>
              </View>
            ) : (
              <View style={styles.userListWrap}>
                {users.map((user) => {
                  const isSelected = selectedUserId === user.cognitoUserId;
                  return (
                    <TouchableOpacity
                      key={user.cognitoUserId}
                      style={[styles.userRow, isSelected && styles.userRowSelected]}
                      onPress={() => handleSelectUser(user)}
                      disabled={isSubmitting}
                    >
                      <View style={styles.userInfoWrap}>
                        <Text style={styles.userName}>{user.name || '-'}</Text>
                        <Text style={styles.userEmail}>{user.email}</Text>
                      </View>
                      {isSelected && <MaterialIcons name="check-circle" size={20} color={COLORS.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Edit Profile</Text>
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
                editable={!isSubmitting && !!selectedUser}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Phone No</Text>
              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                placeholder="+919876543210"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.input}
                editable={!isSubmitting && !!selectedUser}
              />
              <Text style={styles.helperText}>Defaults to +91. Keep empty or +91 only to clear phone.</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                textContentType="name"
                placeholder="Full name"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.input}
                editable={!isSubmitting && !!selectedUser}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Roles *</Text>
              {roleOptions.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No role groups available.</Text>
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
                        disabled={!selectedUser || isSubmitting}
                      >
                        <Text style={[styles.roleText, isSelected && styles.roleTextSelected]}>{role}</Text>
                        {isSelected && <MaterialIcons name="check-circle" size={20} color={COLORS.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            void loadUsers();
          }}
          disabled={isLoading || isSubmitting}
        >
          <Text style={styles.secondaryButtonText}>Refresh List</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (
              isSubmitting ||
              !selectedUser ||
              !isValidEmail(email) ||
              !isValidPhone(normalizePhoneInput(phoneNumber)) ||
              selectedRoles.length === 0
            ) && styles.buttonDisabled,
          ]}
          onPress={() => {
            void handleUpdateUser();
          }}
          disabled={
            isSubmitting ||
            !selectedUser ||
            !isValidEmail(email) ||
            !isValidPhone(normalizePhoneInput(phoneNumber)) ||
            selectedRoles.length === 0
          }
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Save Changes</Text>
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
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  stateText: {
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 14,
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
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
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
  userListWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: COLORS.white,
    overflow: 'hidden',
  },
  userRow: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  userRowSelected: {
    backgroundColor: COLORS.gray[50],
  },
  userInfoWrap: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  userEmail: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textSecondary,
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
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
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
