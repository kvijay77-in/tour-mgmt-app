/**
 * Offline credential service (SEC-03) — secure "Remember me" and offline
 * sign-in support for mobile.
 *
 * - The password is kept only in expo-secure-store (Android Keystore / iOS
 *   Keychain). On iOS it is bound to the device passcode and never leaves the
 *   device (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY). It is never shown or
 *   pre-filled; it is read only to re-authenticate with Cognito silently
 *   once back online, or after a biometric / device-PIN unlock.
 * - A salted SHA-256 digest verifies a typed password while offline.
 * - A non-secret "offline profile" (user, roles, last online sign-in time,
 *   failed attempts) drives the offline sign-in policy.
 * - Saving requires a device screen lock; the login screen warns otherwise.
 * - On web only the username is remembered (no offline mode on web).
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { logger } from '../../utils/logger';
import { OfflineProfile, safeEqual } from './offlineAuthPolicy';

const TAG = 'OfflineCredential';

/** Legacy plaintext {username, password} JSON key (migrated/removed). */
const LEGACY_CREDENTIALS_KEY = 'auth.rememberedCredentials';
const PASSWORD_KEY = 'auth.offline.password';
const VERIFIER_KEY = 'auth.offline.verifier';
const PROFILE_KEY = 'auth.offline.profile';
const REMEMBERED_USERNAME_KEY = 'auth.rememberedUsername';
/** Last user who signed in on this device (drives user-switch checks). */
const LAST_USER_KEY = 'auth.lastUser';

const IS_MOBILE = Platform.OS !== 'web';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
};

interface PasswordVerifier {
  salt: string;
  digest: string;
}

export interface LastUser {
  userId: string;
  username: string;
}

// ---------------------------------------------------------------------------
// Device capability
// ---------------------------------------------------------------------------

/** True when the device has a screen lock (PIN/pattern/password/biometric). */
export async function hasDeviceScreenLock(): Promise<boolean> {
  if (!IS_MOBILE) return false;
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch (error) {
    logger.warn(TAG, 'Unable to read device security level', error);
    return false;
  }
}

/** Label for the unlock button, e.g. "Face ID", "fingerprint" or "device PIN". */
export async function getUnlockMethodLabel(): Promise<string> {
  if (!IS_MOBILE) return 'device PIN';
  try {
    const [enrolled, types] = await Promise.all([
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    if (enrolled && types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === 'ios' ? 'Face ID' : 'face unlock';
    }
    if (enrolled && types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  } catch (error) {
    logger.warn(TAG, 'Unable to read biometric types', error);
  }
  return 'device PIN';
}

/** Ask the user to confirm with biometrics or the device PIN/pattern/password. */
export async function authenticateDeviceOwner(promptMessage: string): Promise<boolean> {
  if (!IS_MOBILE) return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (error) {
    logger.warn(TAG, 'Device authentication failed', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

async function digestPassword(salt: string, password: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

function randomSalt(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getOfflineProfile(): Promise<OfflineProfile | null> {
  if (!IS_MOBILE) return null;
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY, SECURE_OPTIONS);
    return raw ? (JSON.parse(raw) as OfflineProfile) : null;
  } catch (error) {
    logger.warn(TAG, 'Offline profile unreadable', error);
    return null;
  }
}

async function writeOfflineProfile(profile: OfflineProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile), SECURE_OPTIONS);
}

/**
 * Record a successful online sign-in: refreshes the offline profile (roles,
 * validity window, attempt counter) and saves or clears the password.
 * `rememberMe` undefined keeps the user's previous choice (session restore /
 * silent re-authentication). Without a screen lock no password is kept.
 */
export async function recordOnlineSignIn(params: {
  username: string;
  userId: string;
  userRoles: string[];
  password?: string;
  rememberMe?: boolean;
}): Promise<{ passwordSaved: boolean }> {
  const { username, userId, userRoles, password, rememberMe } = params;
  await setLastUser({ userId, username }).catch((error: unknown) =>
    logger.warn(TAG, 'Failed to record last user', error),
  );
  if (rememberMe !== undefined) {
    await setRememberedUsername(rememberMe ? username : null).catch(() => undefined);
  }
  if (!IS_MOBILE) return { passwordSaved: false };

  let passwordSaved = false;
  try {
    const previous = await getOfflineProfile();
    const samePreviousUser = previous?.userId === userId;
    const screenLock = await hasDeviceScreenLock();

    if (rememberMe === true && password && screenLock) {
      const salt = randomSalt();
      const verifier: PasswordVerifier = { salt, digest: await digestPassword(salt, password) };
      await SecureStore.setItemAsync(PASSWORD_KEY, password, SECURE_OPTIONS);
      await SecureStore.setItemAsync(VERIFIER_KEY, JSON.stringify(verifier), SECURE_OPTIONS);
      passwordSaved = true;
    } else if (rememberMe === false || !samePreviousUser || !screenLock) {
      await deleteSavedPassword();
    } else {
      // Keep the previously saved password (no new password supplied).
      passwordSaved = Boolean(previous?.hasSavedPassword);
    }

    if (screenLock) {
      await writeOfflineProfile({
        username,
        userId,
        userRoles,
        lastOnlineAuthAt: new Date().toISOString(),
        failedAttempts: 0,
        hasSavedPassword: passwordSaved,
      });
    }
  } catch (error) {
    logger.warn(TAG, 'Failed to update offline sign-in data', error);
    passwordSaved = false;
  }
  return { passwordSaved };
}

/** Verify a typed password offline; failures are counted against the lock-out. */
export async function verifyOfflinePassword(password: string): Promise<boolean> {
  const profile = await getOfflineProfile();
  if (!profile) return false;
  let ok = false;
  try {
    const raw = await SecureStore.getItemAsync(VERIFIER_KEY, SECURE_OPTIONS);
    if (raw) {
      const verifier = JSON.parse(raw) as PasswordVerifier;
      ok = safeEqual(await digestPassword(verifier.salt, password), verifier.digest);
    }
  } catch (error) {
    logger.warn(TAG, 'Password verifier unreadable', error);
  }
  await writeOfflineProfile({
    ...profile,
    failedAttempts: ok ? 0 : profile.failedAttempts + 1,
  });
  return ok;
}

/** The saved password, for silent Cognito re-authentication (never displayed). */
export async function getSavedPassword(): Promise<string | null> {
  if (!IS_MOBILE) return null;
  try {
    return await SecureStore.getItemAsync(PASSWORD_KEY, SECURE_OPTIONS);
  } catch (error) {
    logger.warn(TAG, 'Saved password unreadable', error);
    return null;
  }
}

/** Replace the saved password after a successful password change. */
export async function updateSavedPassword(newPassword: string): Promise<void> {
  const profile = await getOfflineProfile();
  if (!profile?.hasSavedPassword) return;
  const salt = randomSalt();
  const verifier: PasswordVerifier = { salt, digest: await digestPassword(salt, newPassword) };
  await SecureStore.setItemAsync(PASSWORD_KEY, newPassword, SECURE_OPTIONS);
  await SecureStore.setItemAsync(VERIFIER_KEY, JSON.stringify(verifier), SECURE_OPTIONS);
}

async function deleteSavedPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSWORD_KEY, SECURE_OPTIONS).catch(() => undefined);
  await SecureStore.deleteItemAsync(VERIFIER_KEY, SECURE_OPTIONS).catch(() => undefined);
}

/**
 * Remove the saved password and mark the profile as not usable offline
 * (e.g. Cognito rejected the saved password after a reset).
 */
export async function invalidateSavedSignIn(): Promise<void> {
  if (!IS_MOBILE) return;
  await deleteSavedPassword();
  const profile = await getOfflineProfile();
  if (profile) {
    await writeOfflineProfile({ ...profile, hasSavedPassword: false });
  }
}

/** Remove all offline sign-in data (sign-out without Remember me). */
export async function clearOfflineSignIn(): Promise<void> {
  if (!IS_MOBILE) return;
  await deleteSavedPassword();
  await SecureStore.deleteItemAsync(PROFILE_KEY, SECURE_OPTIONS).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Remembered username (login screen pre-fill) and last user
// ---------------------------------------------------------------------------

/** Username to pre-fill on the login screen (never the password). */
export async function getRememberedUsername(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(REMEMBERED_USERNAME_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

async function setRememberedUsername(username: string | null): Promise<void> {
  if (username) await AsyncStorage.setItem(REMEMBERED_USERNAME_KEY, username);
  else await AsyncStorage.removeItem(REMEMBERED_USERNAME_KEY);
}

export async function getLastUser(): Promise<LastUser | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as LastUser) : null;
  } catch {
    return null;
  }
}

async function setLastUser(user: LastUser): Promise<void> {
  await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
}

/**
 * One-time migration of the legacy plaintext credential (SEC-03): the
 * username is kept for pre-fill; the password is deleted (the user signs
 * in once online to save it securely).
 */
export async function migrateLegacyCredentials(): Promise<void> {
  if (!IS_MOBILE) return;
  try {
    const raw = await SecureStore.getItemAsync(LEGACY_CREDENTIALS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { username?: unknown };
      if (typeof parsed.username === 'string' && parsed.username) {
        await AsyncStorage.setItem(REMEMBERED_USERNAME_KEY, parsed.username);
      }
    } catch {
      // Corrupt legacy value — just remove it.
    }
    await SecureStore.deleteItemAsync(LEGACY_CREDENTIALS_KEY);
    logger.info(TAG, 'Legacy plaintext credential removed');
  } catch (error) {
    logger.warn(TAG, 'Legacy credential migration failed', error);
  }
}
