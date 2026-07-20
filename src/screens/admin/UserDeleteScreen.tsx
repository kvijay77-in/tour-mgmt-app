import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  CognitoManagedUser,
  deleteCognitoUser,
  listCognitoUsersWithRoles,
} from '../../services/auth/cognitoUserManagementService';
import { logger } from '../../utils/logger';

const TAG = 'UserDeleteScreen';

interface UserDeleteScreenProps {
  onClose: () => void;
}

export default function UserDeleteScreen({ onClose }: UserDeleteScreenProps) {
  const [users, setUsers] = useState<CognitoManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingFor, setIsSubmittingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await listCognitoUsersWithRoles();
      setUsers(data);
    } catch (err) {
      logger.error(TAG, 'loadUsers failed', err);
      setError(err instanceof Error ? err.message : 'Failed to load users from Cognito.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const executeDeleteUser = useCallback(async (user: CognitoManagedUser) => {
    setIsSubmittingFor(user.cognitoUserId);
    setError(null);

    try {
      await deleteCognitoUser(user.cognitoUserId);
      await loadUsers();
      Alert.alert('User deleted', 'The selected user has been permanently deleted from Cognito.');
    } catch (err) {
      logger.error(TAG, 'executeDeleteUser failed', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setIsSubmittingFor(null);
    }
  }, [loadUsers]);

  const handleDeleteUser = useCallback((user: CognitoManagedUser) => {
    const displayName = user.name?.trim() || user.email;

    Alert.alert(
      'Delete User',
      `Delete ${displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Proceed',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Confirm Permanent Delete',
              'Delete is permanent and cannot be undone. Do you want to permanently delete this user profile?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Permanently',
                  style: 'destructive',
                  onPress: () => {
                    void executeDeleteUser(user);
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [executeDeleteUser]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>Delete User</Text>
          <Text style={styles.subtitle}>Choose a user and confirm permanent deletion from Cognito.</Text>
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

          {users.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No users found in Cognito.</Text>
            </View>
          ) : (
            users.map((user) => {
              const isSubmitting = isSubmittingFor === user.cognitoUserId;

              return (
                <View key={user.cognitoUserId} style={styles.userCard}>
                  <View style={styles.userHeader}>
                    <View style={styles.userMainInfoWrap}>
                      <Text style={styles.userName}>{user.name || '-'}</Text>
                      <Text style={styles.userEmail}>{user.email}</Text>
                    </View>
                    <View style={[styles.statusBadge, user.enabled ? styles.statusEnabled : styles.statusDisabled]}>
                      <Text style={[styles.statusBadgeText, user.enabled ? styles.statusEnabledText : styles.statusDisabledText]}>
                        {user.enabled ? 'Enabled' : 'Disabled'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.rolesLabel}>Roles</Text>
                  <Text style={styles.rolesText}>{user.roles.length > 0 ? user.roles.join(', ') : '-'}</Text>

                  <TouchableOpacity
                    style={[styles.deleteButton, isSubmitting && styles.actionButtonDisabled]}
                    disabled={isSubmitting}
                    onPress={() => handleDeleteUser(user)}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color={COLORS.white} />
                    ) : (
                      <Text style={styles.deleteButtonText}>Delete User</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => {
            void loadUsers();
          }}
          disabled={isLoading || isSubmittingFor !== null}
        >
          <Text style={styles.refreshButtonText}>Refresh User List</Text>
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
    gap: 12,
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
  userCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  userMainInfoWrap: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  userEmail: {
    marginTop: 2,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusEnabled: {
    backgroundColor: '#DCFCE7',
  },
  statusDisabled: {
    backgroundColor: '#F3F4F6',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusEnabledText: {
    color: '#166534',
  },
  statusDisabledText: {
    color: COLORS.textSecondary,
  },
  rolesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
  rolesText: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  deleteButton: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: COLORS.danger,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: COLORS.white,
    fontWeight: '700',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    padding: 14,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  refreshButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
});