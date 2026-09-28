/**
 * Auth Context — manages Cognito authentication state.
 *
 * Provides login, sign-out, and session state to the entire app.
 * Wires the JWT access token into apiClient for authenticated API calls.
 *
 * Offline (mobile only, SEC-03 / DES-01 / DES-07):
 * - Startup restores the session without forcing a token refresh; network
 *   errors never sign the user out. If the session can't be validated offline
 *   the saved offline profile is used (isOfflineSession).
 * - With "Remember me" and a device screen lock the password is saved
 *   securely so the user can sign in offline (typed password or
 *   biometric/device-PIN unlock) after signing out.
 * - When connectivity returns an offline session re-authenticates with
 *   Cognito silently; queued data is sent only after that succeeds.
 *
 * See docs/SolutionDesign.md § Authentication and § Offline sign-in.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import {
  signIn,
  signOut,
  fetchAuthSession,
  confirmSignIn,
  getCurrentUser,
  updatePassword,
} from 'aws-amplify/auth';
import {
  AuthTokenRequest,
  isNetworkError,
  setAuthTokenProvider,
  setAuthInvalidatedCallback,
} from '../services/api/apiClient';
import { routeBackendForLogin } from '../config/reviewAccess';
import { AppRole } from '../types/models';
import { isSupportedRoleGroup, resolvePrimaryRole } from '../utils/permissions';
import { loadPitStopContextStageNumber } from '../services/config/pitStopContextService';
import {
  authenticateDeviceOwner,
  clearOfflineSignIn,
  getLastUser,
  getOfflineProfile,
  getSavedPassword,
  hasDeviceScreenLock,
  invalidateSavedSignIn,
  migrateLegacyCredentials,
  recordOnlineSignIn,
  updateSavedPassword,
  verifyOfflinePassword,
} from '../services/auth/offlineCredentialService';
import {
  evaluateOfflineSignIn,
  OFFLINE_SIGN_IN_MESSAGES,
  OfflineProfile,
} from '../services/auth/offlineAuthPolicy';
import { getSyncSettings, hydrateSyncSettingsFromCache } from '../services/sync/syncSettingsService';
import { countOperationsOwnedByOthers } from '../services/database/pendingStore';
import { clearUserScopedCache } from '../services/database/database';
import { unregisterPushDeviceOnLogout } from '../services/push/pushService';
import { useOffline } from './OfflineContext';
import { logger } from '../utils/logger';

const TAG = 'AuthContext';
const IS_MOBILE = Platform.OS !== 'web';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  username: string;
  userId: string;
  /** Primary/effective role resolved by precedence from Cognito groups */
  userRole: AppRole;
  /** All recognised app roles from Cognito groups */
  userRoles: AppRole[];
  /**
   * True when signed in on this device without a live Cognito session
   * (offline sign-in). Data is captured locally and sent after the app
   * re-authenticates online.
   */
  isOfflineSession?: boolean;
}

export type LoginResult =
  | { status: 'DONE' }
  | { status: 'NEW_PASSWORD_REQUIRED' }
  /** Another user's unsynced data is on this device; sign-in was not completed. */
  | { status: 'OTHER_USER_DATA'; userId: string; count: number; previousUsername: string | null };

interface AuthContextValue {
  /** The authenticated user, or null if not logged in */
  user: AuthUser | null;
  /** True while checking for an existing session at startup */
  isLoading: boolean;
  /** True when a login or sign-out operation is in progress */
  isAuthenticating: boolean;
  /** Error message from the last auth operation */
  error: string | null;
  /**
   * Sign in with username and password. Online → Cognito; offline (mobile)
   * → verified against the securely saved sign-in.
   */
  login: (username: string, password: string, rememberMe: boolean) => Promise<LoginResult>;
  /** Sign in with the saved credential after biometric / device-PIN confirmation. */
  unlockWithDevice: () => Promise<LoginResult | null>;
  /** Complete the new-password challenge (first login with temp password) */
  completeNewPassword: (
    newPassword: string,
    options: { username: string; rememberMe: boolean },
  ) => Promise<'SIGNED_IN' | 'NO_ROLE'>;
  /** Sign out and clear session. Keeps the saved sign-in when "Remember me" was on. */
  logout: () => Promise<void>;
  /** Change password for an authenticated user */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  /** Clear the last auth error */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticating: false,
  error: null,
  login: async () => ({ status: 'DONE' }),
  unlockWithDevice: async () => null,
  completeNewPassword: async () => 'SIGNED_IN',
  logout: async () => {},
  changePassword: async () => {},
  clearError: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** True when an Amplify/Cognito call failed because the network is unavailable. */
function isAuthNetworkError(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (error instanceof Error) {
    if (error.name === 'NetworkError') return true;
    return /network/i.test(error.message);
  }
  return false;
}

function toAppRoles(roles: string[]): AppRole[] {
  return roles.filter((role): role is AppRole => isSupportedRoleGroup(role));
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
  * Resolve the user's app roles from Cognito User Group membership.
   *
   * Reads `cognito:groups` from the ID token payload. If the user belongs
  * Supports static roles and dynamic PS_x_USER roles.
  * Returns an empty array if no recognised role group is found.
   *
   * Accepts an optional pre-fetched session to avoid a redundant
   * fetchAuthSession() call when the caller already has one.
   */
  const resolveUserRoles = useCallback(async (
    existingSession?: Awaited<ReturnType<typeof fetchAuthSession>>,
  ): Promise<AppRole[]> => {
    try {
      const session = existingSession ?? await fetchAuthSession();
      const payload = session.tokens?.idToken?.payload;
      const groups: string[] = (payload?.['cognito:groups'] as string[] | undefined) ?? [];
      const matchedRoles = groups.filter((g): g is AppRole => isSupportedRoleGroup(g));
      if (matchedRoles.length === 0) {
        logger.warn(TAG, `No recognised app role group found (groups: ${JSON.stringify(groups)})`);
        return [];
      }
      logger.info(TAG, `Resolved role groups: ${JSON.stringify(matchedRoles)}`);
      return matchedRoles;
    } catch (err) {
      logger.warn(TAG, 'Failed to resolve user role from token', err);
      return [];
    }
  }, []);

  /**
   * Resolve effective role with deterministic precedence and optional
   * pit-stop context fallback for users assigned multiple PS_x_USER roles.
   */
  const resolveEffectiveRole = useCallback(async (userRoles: AppRole[]): Promise<AppRole | null> => {
    let preferredPitStopStageNumber: number | null = null;

    try {
      preferredPitStopStageNumber = await loadPitStopContextStageNumber();
    } catch (err) {
      logger.warn(TAG, 'Failed to load pit-stop context while resolving role', err);
    }

    const effectiveRole = resolvePrimaryRole(userRoles, {
      preferredPitStopStageNumber,
    });

    logger.info(
      TAG,
      `Resolved effective role: ${effectiveRole ?? 'NONE'} (preferredPitStopStage=${preferredPitStopStageNumber ?? 'none'})`,
    );

    return effectiveRole;
  }, []);

  /** Sign out and optionally show a "no role assigned" error. */
  const handleNoRole = useCallback(async (showErrorMessage = true) => {
    logger.warn(TAG, 'User has no role assigned — signing out');
    await signOut().catch(() => {});
    setUser(null);
    if (showErrorMessage) {
      setError('No role has been assigned to your account. Please contact your tour administrator.');
    }
  }, []);

  const { isOffline, isOfflineSupported } = useOffline();
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;

  // DES-07: one shared in-flight forced refresh for concurrent 401s.
  const refreshInFlightRef = useRef<Promise<string | null> | null>(null);

  // Wire the JWT token provider into apiClient so all API calls include auth
  useEffect(() => {
    const readToken = async (forceRefresh: boolean): Promise<string | null> => {
      try {
        const session = await fetchAuthSession(forceRefresh ? { forceRefresh: true } : undefined);
        return session.tokens?.accessToken?.toString() ?? null;
      } catch (err) {
        // Network failures are transient: reject so apiClient doesn't sign out.
        if (isAuthNetworkError(err)) throw err;
        logger.warn(TAG, 'Token unavailable', err);
        return null;
      }
    };

    setAuthTokenProvider(async (request?: AuthTokenRequest) => {
      if (!request?.forceRefresh) return readToken(false);
      if (!refreshInFlightRef.current) {
        refreshInFlightRef.current = readToken(true).finally(() => {
          refreshInFlightRef.current = null;
        });
      }
      return refreshInFlightRef.current;
    });
    // Called only when a forced refresh confirmed the session is invalid.
    setAuthInvalidatedCallback(() => {
      signOut().catch(() => {});
      setUser(null);
      setError('Your session has expired. Please sign in again.');
    });
  }, []);

  /**
   * Build an offline-session user from the saved profile when policy allows.
   * Returns the denial message otherwise.
   */
  const resolveOfflineUser = useCallback(async (params: {
    username?: string;
    requirePassword: boolean;
  }): Promise<{ user: AuthUser; profile: OfflineProfile } | { denial: string }> => {
    await hydrateSyncSettingsFromCache();
    const [profile, hasScreenLock] = await Promise.all([getOfflineProfile(), hasDeviceScreenLock()]);
    const denial = evaluateOfflineSignIn({
      profile,
      username: params.username,
      now: new Date(),
      limits: getSyncSettings(),
      hasScreenLock,
      requirePassword: params.requirePassword,
    });
    if (denial || !profile) return { denial: OFFLINE_SIGN_IN_MESSAGES[denial ?? 'NO_SAVED_SIGN_IN'] };
    const userRoles = toAppRoles(profile.userRoles);
    const primaryRole = await resolveEffectiveRole(userRoles);
    if (!primaryRole) return { denial: OFFLINE_SIGN_IN_MESSAGES.NO_SAVED_SIGN_IN };
    return {
      profile,
      user: {
        username: profile.username,
        userId: profile.userId,
        userRole: primaryRole,
        userRoles,
        isOfflineSession: true,
      },
    };
  }, [resolveEffectiveRole]);

  /**
   * Complete an online sign-in: user-switch protection, offline profile /
   * saved password update, then publish the user.
   */
  const finishOnlineSignIn = useCallback(async (params: {
    username: string;
    userId: string;
    userRoles: AppRole[];
    primaryRole: AppRole;
    password?: string;
    /** undefined = keep the previous "Remember me" choice */
    rememberMe?: boolean;
  }): Promise<LoginResult> => {
    const { username, userId, userRoles, primaryRole, password, rememberMe } = params;

    const lastUser = await getLastUser();
    if (lastUser && lastUser.userId !== userId) {
      const count = await countOperationsOwnedByOthers(userId).catch(() => 0);
      if (count > 0) {
        logger.warn(TAG, 'Sign-in blocked: another user has unsynced data on this device', { count });
        await signOut().catch(() => {});
        setUser(null);
        return { status: 'OTHER_USER_DATA', userId, count, previousUsername: lastUser.username };
      }
      await clearUserScopedCache().catch((err: unknown) => logger.warn(TAG, 'Failed to clear previous user cache', err));
      await clearOfflineSignIn();
    }

    await recordOnlineSignIn({ username, userId, userRoles, password, rememberMe });
    setUser({ username, userId, userRole: primaryRole, userRoles });
    return { status: 'DONE' };
  }, []);

  // Check for an existing session on mount (DES-01): no forced refresh and
  // no sign-out on network errors.
  useEffect(() => {
    (async () => {
      await migrateLegacyCredentials();
      let currentUser: Awaited<ReturnType<typeof getCurrentUser>>;
      try {
        currentUser = await getCurrentUser();
      } catch {
        logger.info(TAG, 'No existing session — login required');
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        logger.info(TAG, `Session found for ${currentUser.username}`);
        const session = await fetchAuthSession();
        if (!session.tokens?.accessToken) {
          // Refresh token rejected by Cognito — session is definitely invalid
          logger.warn(TAG, 'Session invalid — no access token');
          await signOut().catch(() => {});
          setUser(null);
          return;
        }
        const userRoles = await resolveUserRoles(session);
        const primaryRole = await resolveEffectiveRole(userRoles);
        if (!primaryRole) {
          await handleNoRole();
          return;
        }
        await finishOnlineSignIn({
          username: currentUser.username,
          userId: currentUser.userId,
          userRoles,
          primaryRole,
        });
      } catch (err) {
        if (IS_MOBILE && isAuthNetworkError(err)) {
          // Offline start: keep the Amplify session for later refresh and
          // resume from the saved profile when policy allows.
          const resolved = await resolveOfflineUser({ username: currentUser.username, requirePassword: false });
          if ('user' in resolved) {
            logger.info(TAG, 'Resumed session offline');
            setUser(resolved.user);
          } else {
            setUser(null);
            setError(resolved.denial);
          }
        } else {
          logger.info(TAG, 'Existing session could not be restored — login required', err);
          await signOut().catch(() => {});
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole, finishOnlineSignIn, resolveOfflineUser]);

  const loginOffline = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const resolved = await resolveOfflineUser({ username, requirePassword: true });
    if (!('user' in resolved)) {
      setError(resolved.denial);
      return { status: 'DONE' };
    }
    const ok = await verifyOfflinePassword(password);
    if (!ok) {
      const remaining = getSyncSettings().offlineLoginMaxAttempts - (resolved.profile.failedAttempts + 1);
      setError(remaining > 0
        ? `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} left for offline sign-in.`
        : OFFLINE_SIGN_IN_MESSAGES.LOCKED);
      return { status: 'DONE' };
    }
    logger.info(TAG, 'Signed in offline');
    setUser(resolved.user);
    return { status: 'DONE' };
  }, [resolveOfflineUser]);

  const loginOnline = useCallback(async (
    username: string,
    password: string,
    rememberMe: boolean,
  ): Promise<LoginResult> => {
    // Route to the correct backend before authenticating. Primary (production)
    // is the default; this only reconfigures when the reviewer account signs in
    // (or when switching back after a reviewer session in the same app run).
    routeBackendForLogin(username);

    let result;
    try {
      result = await signIn({
        username,
        password,
        options: { authFlowType: 'USER_PASSWORD_AUTH' },
      });
    } catch (signInErr) {
      // A lingering session on the previously-configured pool (or a session
      // kept for offline use) can block sign-in. Clear it and retry once.
      if (signInErr instanceof Error && signInErr.name === 'UserAlreadyAuthenticatedException') {
        await signOut().catch(() => {});
        result = await signIn({
          username,
          password,
          options: { authFlowType: 'USER_PASSWORD_AUTH' },
        });
      } else {
        throw signInErr;
      }
    }

    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
      // User must set a new password (first login with temp password)
      return { status: 'NEW_PASSWORD_REQUIRED' };
    }

    if (result.isSignedIn) {
      const currentUser = await getCurrentUser();
      const userRoles = await resolveUserRoles();
      const primaryRole = await resolveEffectiveRole(userRoles);
      if (!primaryRole) {
        await handleNoRole();
        return { status: 'DONE' };
      }
      return finishOnlineSignIn({
        username: currentUser.username,
        userId: currentUser.userId,
        userRoles,
        primaryRole,
        password,
        rememberMe,
      });
    }

    // Unexpected step — treat as error
    setError(`Unexpected authentication step: ${result.nextStep.signInStep}`);
    return { status: 'DONE' };
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole, finishOnlineSignIn]);

  const login = useCallback(async (
    username: string,
    password: string,
    rememberMe: boolean,
  ): Promise<LoginResult> => {
    setIsAuthenticating(true);
    setError(null);
    try {
      if (IS_MOBILE && isOfflineRef.current) {
        return await loginOffline(username, password);
      }
      try {
        return await loginOnline(username, password, rememberMe);
      } catch (err) {
        if (IS_MOBILE && isAuthNetworkError(err)) {
          logger.info(TAG, 'Online sign-in unreachable — trying offline sign-in');
          return await loginOffline(username, password);
        }
        throw err;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, [loginOffline, loginOnline]);

  const unlockWithDevice = useCallback(async (): Promise<LoginResult | null> => {
    setError(null);
    const resolved = await resolveOfflineUser({ requirePassword: true });
    if (!('user' in resolved)) {
      setError(resolved.denial);
      return null;
    }
    const confirmed = await authenticateDeviceOwner(`Sign in as ${resolved.profile.username}`);
    if (!confirmed) return null;

    setIsAuthenticating(true);
    try {
      if (!isOfflineRef.current) {
        const password = await getSavedPassword();
        if (password) {
          try {
            return await loginOnline(resolved.profile.username, password, true);
          } catch (err) {
            if (!isAuthNetworkError(err)) {
              await invalidateSavedSignIn();
              setError('Your saved sign-in is no longer valid. Please enter your password.');
              return null;
            }
            // Unreachable — fall through to an offline session.
          }
        }
      }
      logger.info(TAG, 'Signed in offline with device unlock');
      setUser(resolved.user);
      return { status: 'DONE' };
    } finally {
      setIsAuthenticating(false);
    }
  }, [resolveOfflineUser, loginOnline]);

  // Offline session → silent Cognito re-authentication when back online.
  const reauthInFlightRef = useRef(false);
  useEffect(() => {
    if (!user?.isOfflineSession || isOffline || !isOfflineSupported || reauthInFlightRef.current) return;
    reauthInFlightRef.current = true;
    const offlineUser = user;

    (async () => {
      try {
        let session = await fetchAuthSession({ forceRefresh: true });
        if (!session.tokens?.accessToken) {
          const password = await getSavedPassword();
          if (!password) throw new Error('No saved password for re-authentication');
          routeBackendForLogin(offlineUser.username);
          await signOut().catch(() => {});
          const result = await signIn({
            username: offlineUser.username,
            password,
            options: { authFlowType: 'USER_PASSWORD_AUTH' },
          });
          if (!result.isSignedIn) throw new Error(`Re-authentication needs ${result.nextStep.signInStep}`);
          session = await fetchAuthSession();
        }
        const currentUser = await getCurrentUser();
        if (currentUser.userId !== offlineUser.userId) throw new Error('Re-authenticated as a different user');
        const userRoles = await resolveUserRoles(session);
        const primaryRole = await resolveEffectiveRole(userRoles);
        if (!primaryRole) {
          await handleNoRole();
          return;
        }
        await recordOnlineSignIn({
          username: currentUser.username,
          userId: currentUser.userId,
          userRoles,
        });
        logger.info(TAG, 'Offline session re-authenticated online');
        setUser({ username: currentUser.username, userId: currentUser.userId, userRole: primaryRole, userRoles });
      } catch (err) {
        if (isAuthNetworkError(err)) {
          logger.info(TAG, 'Re-authentication deferred (network)', err);
          return;
        }
        logger.warn(TAG, 'Saved sign-in rejected by Cognito — online sign-in required', err);
        await invalidateSavedSignIn();
        await signOut().catch(() => {});
        setUser(null);
        setError('Please sign in again to send your offline data. It stays safely on this device until then.');
      } finally {
        reauthInFlightRef.current = false;
      }
    })();
  }, [user, isOffline, isOfflineSupported, resolveUserRoles, resolveEffectiveRole, handleNoRole]);

  const completeNewPassword = useCallback(async (
    newPassword: string,
    options: { username: string; rememberMe: boolean },
  ): Promise<'SIGNED_IN' | 'NO_ROLE'> => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const result = await confirmSignIn({ challengeResponse: newPassword });
      if (result.isSignedIn) {
        const currentUser = await getCurrentUser();
        const userRoles = await resolveUserRoles();
        const primaryRole = await resolveEffectiveRole(userRoles);
        if (!primaryRole) {
          await handleNoRole(false);
          return 'NO_ROLE';
        }
        const outcome = await finishOnlineSignIn({
          username: currentUser.username || options.username,
          userId: currentUser.userId,
          userRoles,
          primaryRole,
          password: newPassword,
          rememberMe: options.rememberMe,
        });
        if (outcome.status === 'OTHER_USER_DATA') {
          setError('Another user has unsynced data on this device. Sign in again to review it.');
        }
        return 'SIGNED_IN';
      }
      return 'SIGNED_IN';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set new password.';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole, finishOnlineSignIn]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      const profile = await getOfflineProfile();
      if (!profile?.hasSavedPassword) {
        await clearOfflineSignIn();
      }
      await unregisterPushDeviceOnLogout();
      await signOut();
    } catch {
      // Sign out locally even if the API call fails
    } finally {
      // Web: drop session data so the next sign-in loads the latest from the server.
      if (!IS_MOBILE) {
        await clearUserScopedCache().catch((err: unknown) => logger.warn(TAG, 'Failed to clear session data', err));
      }
      setUser(null);
      setError(null);
    }
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<void> => {
    setIsAuthenticating(true);
    setError(null);
    try {
      await updatePassword({
        oldPassword,
        newPassword,
      });
      await updateSavedPassword(newPassword).catch((err: unknown) =>
        logger.warn(TAG, 'Failed to update saved password', err),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password.';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isLoading,
    isAuthenticating,
    error,
    login,
    unlockWithDevice,
    completeNewPassword,
    logout,
    changePassword,
    clearError,
  }), [user, isLoading, isAuthenticating, error, login, unlockWithDevice, completeNewPassword, logout, changePassword, clearError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
