/**
 * Backend routing for the Google Play review account.
 *
 * A single production build is published to the Play Store, but Google requires
 * a full-access ADMINISTRATOR account for app review. To keep production data
 * isolated from the reviewer, a hardcoded (env-configured) reviewer username is
 * routed to the Dev backend — a separate Cognito User Pool + App Client, Identity
 * Pool, and tour-data-api — while all real users continue to use the primary
 * (production) backend.
 *
 * Efficiency: the primary backend is applied once at startup and is the default.
 * Normal-user logins are a no-op here (zero reconfiguration). The switch fires
 * only on an actual transition to/from review mode, tracked by `_activeBackend`.
 *
 * See docs/SolutionDesign.md § Authentication and docs/release-guide.md.
 */

import { configureAmplify } from './amplify';
import { setApiBaseUrl } from '../services/api/apiClient';
import { OrgConfig } from '../types/config';
import { logger } from '../utils/logger';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TAG = 'BackendRouter';
const REVIEW_SESSION_KEY = 'review.active';

type BackendKind = 'primary' | 'review';

/** Primary (production) config captured at startup, used to restore after review mode. */
let _primaryConfig: OrgConfig | null = null;

/** Currently active backend. Defaults to primary (set by initBackendRouting). */
let _activeBackend: BackendKind = 'primary';

/**
 * Build the primary config from EXPO_PUBLIC_* env vars (dev-mode / ToT fallback,
 * used when the app is not configured via a runtime OrgConfig).
 */
function getEnvPrimaryConfig(): OrgConfig {
  return {
    orgCode: 'PRIMARY',
    orgName: 'Primary',
    awsRegion: process.env.EXPO_PUBLIC_AWS_REGION ?? '',
    userPoolId: process.env.EXPO_PUBLIC_AWS_USER_POOL_ID ?? '',
    userPoolClientId: process.env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID ?? '',
    identityPoolId: process.env.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID || undefined,
    apiBaseUrl: process.env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL ?? '',
  };
}

/**
 * Build the review (Dev) config from EXPO_PUBLIC_REVIEW_* env vars.
 * Returns null when the required values are not present so routing degrades
 * gracefully (the reviewer switch is simply disabled).
 */
function getReviewBackendConfig(): OrgConfig | null {
  const userPoolId = process.env.EXPO_PUBLIC_REVIEW_AWS_USER_POOL_ID ?? '';
  const userPoolClientId = process.env.EXPO_PUBLIC_REVIEW_AWS_USER_POOL_WEB_CLIENT_ID ?? '';
  const apiBaseUrl = process.env.EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL ?? '';

  if (!userPoolId || !userPoolClientId || !apiBaseUrl) {
    return null;
  }

  return {
    orgCode: 'REVIEW',
    orgName: 'App Review (Dev)',
    awsRegion: process.env.EXPO_PUBLIC_REVIEW_AWS_REGION ?? '',
    userPoolId,
    userPoolClientId,
    identityPoolId: process.env.EXPO_PUBLIC_REVIEW_AWS_IDENTITY_POOL_ID || undefined,
    apiBaseUrl,
  };
}

/**
 * Capture the primary (production) config at startup and mark it active.
 * Call once from App bootstrap after resolving the effective config.
 *
 * @param primaryConfig - The runtime OrgConfig if one was applied, otherwise the
 *   env-var fallback config is used.
 */
export function initBackendRouting(primaryConfig?: OrgConfig): void {
  _primaryConfig = primaryConfig ?? getEnvPrimaryConfig();
  _activeBackend = 'primary';
}

/**
 * Whether the given username is the configured Google Play review account.
 * Comparison is trimmed and case-insensitive. Returns false when the reviewer
 * username env var is unset (fail-safe: routing disabled).
 */
export function isReviewerUsername(username: string): boolean {
  const reviewer = (process.env.EXPO_PUBLIC_REVIEW_USERNAME ?? '').trim().toLowerCase();
  if (!reviewer) return false;
  return username.trim().toLowerCase() === reviewer;
}

function applyReviewBackend(): void {
  const cfg = getReviewBackendConfig();
  if (!cfg) {
    logger.warn(
      TAG,
      'Reviewer username matched but review backend env vars are incomplete — staying on primary',
    );
    return;
  }
  configureAmplify(cfg);
  setApiBaseUrl(cfg.apiBaseUrl);
  _activeBackend = 'review';
  logger.info(TAG, 'Switched to review (Dev) backend');
}

export function isReviewBackendActive(): boolean {
  return _activeBackend === 'review';
}

export async function setReviewerSessionActive(active: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  if (active) {
    await SecureStore.setItemAsync(REVIEW_SESSION_KEY, 'true');
  } else {
    await SecureStore.deleteItemAsync(REVIEW_SESSION_KEY);
  }
}

export async function restoreReviewerSession(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if ((await SecureStore.getItemAsync(REVIEW_SESSION_KEY)) !== 'true') return false;
    applyReviewBackend();
    return isReviewBackendActive();
  } catch (err) {
    logger.warn(TAG, 'Failed to restore reviewer backend session', err);
    return false;
  }
}

function applyPrimaryBackend(): void {
  const cfg = _primaryConfig ?? getEnvPrimaryConfig();
  configureAmplify(cfg);
  setApiBaseUrl(cfg.apiBaseUrl);
  _activeBackend = 'primary';
  logger.info(TAG, 'Restored primary backend');
}

/**
 * Route the backend for a login attempt. Primary is the default, so real users
 * incur no reconfiguration. The backend is only reconfigured on an actual
 * transition: to review mode for the reviewer, or back to primary if a normal
 * user signs in after a reviewer session in the same app run.
 *
 * @returns true if the login should use the review (Dev) backend.
 */
export function routeBackendForLogin(username: string): boolean {
  if (isReviewerUsername(username)) {
    if (_activeBackend !== 'review') {
      applyReviewBackend();
    }
    return _activeBackend === 'review';
  }

  if (_activeBackend !== 'primary') {
    applyPrimaryBackend();
  }
  return false;
}
