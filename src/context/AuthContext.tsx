/**
 * Auth Context — manages Cognito authentication state.
 *
 * Provides login, sign-out, and session state to the entire app.
 * Wires the JWT access token into apiClient for authenticated API calls.
 *
 * See docs/SolutionDesign.md § Authentication.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signIn,
  signOut,
  fetchAuthSession,
  confirmSignIn,
  getCurrentUser,
  updatePassword,
} from 'aws-amplify/auth';
import { setAuthTokenProvider, setAuthInvalidatedCallback } from '../services/api/apiClient';
import { routeBackendForLogin } from '../config/reviewAccess';
import { AppRole } from '../types/models';
import { isSupportedRoleGroup, resolvePrimaryRole } from '../utils/permissions';
import { loadPitStopContextStageNumber } from '../services/config/pitStopContextService';
import { logger } from '../utils/logger';

const TAG = 'AuthContext';

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
}

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
   * Sign in with username and password.
   * Returns 'DONE' on success, 'NEW_PASSWORD_REQUIRED' if the user must change their temp password.
   */
  login: (username: string, password: string) => Promise<'DONE' | 'NEW_PASSWORD_REQUIRED'>;
  /** Complete the new-password challenge (first login with temp password) */
  completeNewPassword: (newPassword: string) => Promise<'SIGNED_IN' | 'NO_ROLE'>;
  /** Sign out and clear session */
  logout: () => Promise<void>;
  /** Change password for an authenticated user */
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticating: false,
  error: null,
  login: async () => 'DONE',
  completeNewPassword: async () => 'SIGNED_IN',
  logout: async () => {},
  changePassword: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
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

  // Wire the JWT token provider into apiClient so all API calls include auth
  useEffect(() => {
    setAuthTokenProvider(async () => {
      try {
        const session = await fetchAuthSession();
        return session.tokens?.accessToken?.toString() ?? null;
      } catch {
        return null;
      }
    });
    // Register callback for unrecoverable 401 — forces re-login
    setAuthInvalidatedCallback(() => {
      signOut().catch(() => {});
      setUser(null);
      setError('Your session has expired. Please sign in again.');
    });
  }, []);

  // Check for existing session on mount — validate against Cognito, not just local cache.
  // This catches cases where the user was signed out server-side (e.g. from Cognito console).
  useEffect(() => {
    (async () => {
      try {
        const currentUser = await getCurrentUser();
        logger.info(TAG, `Session found for ${currentUser.username}`);
        // Verify the session is still valid with Cognito by forcing a token refresh
        const session = await fetchAuthSession({ forceRefresh: true });
        if (!session.tokens?.accessToken) {
          // Token refresh failed — session is invalid
          logger.warn(TAG, 'Session invalid — no access token after forceRefresh');
          await signOut().catch(() => {});
          setUser(null);
        } else {
          const userRoles = await resolveUserRoles(session);
          const primaryRole = await resolveEffectiveRole(userRoles);
          if (!primaryRole) {
            await handleNoRole();
          } else {
            setUser({
              username: currentUser.username,
              userId: currentUser.userId,
              userRole: primaryRole,
              userRoles,
            });
          }
        }
      } catch {
        // No valid session — clear any stale local state and require login
        logger.info(TAG, 'No existing session — login required');
        await signOut().catch(() => {});
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole]);

  const login = useCallback(async (username: string, password: string): Promise<'DONE' | 'NEW_PASSWORD_REQUIRED'> => {
    setIsAuthenticating(true);
    setError(null);
    try {
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
        // A lingering session on the previously-configured pool can block sign-in
        // after a backend switch. Clear it and retry once.
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
        return 'NEW_PASSWORD_REQUIRED';
      }

      if (result.isSignedIn) {
        const currentUser = await getCurrentUser();
        const userRoles = await resolveUserRoles();
        const primaryRole = await resolveEffectiveRole(userRoles);
        if (!primaryRole) {
          await handleNoRole();
          return 'DONE';
        }
        setUser({
          username: currentUser.username,
          userId: currentUser.userId,
          userRole: primaryRole,
          userRoles,
        });
        return 'DONE';
      }

      // Unexpected step — treat as error
      setError(`Unexpected authentication step: ${result.nextStep.signInStep}`);
      return 'DONE';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole]);

  const completeNewPassword = useCallback(async (newPassword: string): Promise<'SIGNED_IN' | 'NO_ROLE'> => {
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
        setUser({
          username: currentUser.username,
          userId: currentUser.userId,
          userRole: primaryRole,
          userRoles,
        });
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
  }, [resolveUserRoles, resolveEffectiveRole, handleNoRole]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await signOut();
    } catch {
      // Sign out locally even if the API call fails
    } finally {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password.';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticating,
    error,
    login,
    completeNewPassword,
    logout,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
