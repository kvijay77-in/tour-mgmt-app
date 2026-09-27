/**
 * Offline sign-in policy — pure rules (no I/O) deciding whether a saved
 * sign-in may be used without reaching Cognito. See SEC-03 in
 * docs/Project-Audit-Findings.md and docs/SolutionDesign.md § Offline sign-in.
 */

export interface OfflineProfile {
  username: string;
  userId: string;
  /** Recognised app roles at the last online sign-in */
  userRoles: string[];
  /** Last successful online (Cognito) authentication (ISO 8601) */
  lastOnlineAuthAt: string;
  /** Wrong offline passwords since the last online sign-in */
  failedAttempts: number;
  /** True when the password is saved for offline sign-in ("Remember me") */
  hasSavedPassword: boolean;
}

export type OfflineSignInDenial =
  | 'NO_SAVED_SIGN_IN'
  | 'OTHER_USER'
  | 'EXPIRED'
  | 'LOCKED'
  | 'NO_SCREEN_LOCK';

export interface OfflineSignInLimits {
  offlineLoginMaxDays: number;
  offlineLoginMaxAttempts: number;
}

export const OFFLINE_SIGN_IN_MESSAGES: Record<OfflineSignInDenial, string> = {
  NO_SAVED_SIGN_IN: 'Offline sign-in needs "Remember me" from an earlier online sign-in on this device. Connect to the internet to sign in.',
  OTHER_USER: 'Only the last user who signed in online on this device can sign in offline. Connect to the internet to sign in.',
  EXPIRED: 'Offline sign-in has expired. Connect to the internet to sign in.',
  LOCKED: 'Too many wrong passwords. Connect to the internet to sign in.',
  NO_SCREEN_LOCK: 'Offline sign-in needs a screen lock (PIN, pattern, password, fingerprint or Face ID) on this device.',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalise a username for comparison (Cognito usernames are case-insensitive emails here). */
export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Decide whether an offline sign-in may proceed. `username` is optional for
 * the "unlock" path (biometric/PIN) where the saved user is implied.
 * `requirePassword` is true for sign-in after sign-out, false for resuming
 * an existing Amplify session after an app restart without connectivity.
 */
export function evaluateOfflineSignIn(params: {
  profile: OfflineProfile | null;
  username?: string;
  now: Date;
  limits: OfflineSignInLimits;
  hasScreenLock: boolean;
  requirePassword: boolean;
}): OfflineSignInDenial | null {
  const { profile, username, now, limits, hasScreenLock, requirePassword } = params;
  if (!hasScreenLock) return 'NO_SCREEN_LOCK';
  if (!profile) return 'NO_SAVED_SIGN_IN';
  if (requirePassword && !profile.hasSavedPassword) return 'NO_SAVED_SIGN_IN';
  if (username !== undefined && normaliseUsername(username) !== normaliseUsername(profile.username)) {
    return 'OTHER_USER';
  }
  const lastOnline = Date.parse(profile.lastOnlineAuthAt);
  if (!Number.isFinite(lastOnline) || now.getTime() - lastOnline > limits.offlineLoginMaxDays * DAY_MS) {
    return 'EXPIRED';
  }
  if (lastOnline - now.getTime() > DAY_MS) {
    // Device clock moved back more than a day — cannot trust the validity window.
    return 'EXPIRED';
  }
  if (profile.failedAttempts >= limits.offlineLoginMaxAttempts) return 'LOCKED';
  return null;
}

/** Constant-time string comparison for hex digests. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
