/**
 * Runtime organisation configuration type.
 *
 * Delivered to the app via a setup deep link or QR code scanned on first launch.
 * Stored securely in expo-secure-store after HMAC-SHA256 signature verification.
 *
 * See docs/SolutionDesign.md § App Distribution — Runtime Configuration.
 */

export interface OrgConfig {
  /** Short identifier for the organizer (e.g. "TOURFRANCE-2026") */
  orgCode: string;

  /** Display name shown in the app (e.g. "Tour de France 2026") */
  orgName: string;

  /** AWS region for all services */
  awsRegion: string;

  /** Cognito User Pool ID */
  userPoolId: string;

  /** Cognito User Pool Client ID (app client) */
  userPoolClientId: string;

  /** Cognito Identity Pool ID (optional — for federated identity access) */
  identityPoolId?: string;

  /** Base URL for the tour-data-api (e.g. "https://xxx.execute-api.eu-west-1.amazonaws.com/v1") */
  apiBaseUrl: string;
}

export interface SubstringExtractor {
  startPosition: number;
  length: number;
}

export interface RegexExtractor {
  pattern: string;
  flags?: string;
  group: number;
}

export interface SubstringDefinition {
  method: 'SUBSTRING';
  idCode: SubstringExtractor;
  idCodeType: SubstringExtractor;
  personalCode: SubstringExtractor;
}

/**
 * Artifact configuration for tour and ride artifacts.
 */
export type ArtifactCategory = 'tour' | 'ride';

export interface ArtifactTypeConfig {
  category: ArtifactCategory;
}

export interface RegexDefinition {
  method: 'REGEX';
  idCode: RegexExtractor;
  idCodeType: RegexExtractor;
  personalCode: RegexExtractor;
}

export type IdCodeFormatConfig = SubstringDefinition | RegexDefinition;

export type IdCodeTypeName = 'RIDER' | 'CYCLE' | 'BAGGAGE';

export interface IdCodeTypeConfig {
  code: string;
  type: IdCodeTypeName | null;
  name: string;
  description?: string | null;
}

export interface AppConfigItem<T = unknown> {
  configType: string;
  configId: string;
  enabled: boolean;
  config: T;
  description?: string | null;
  version?: number | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** AppConfig HOTEL_UPLOAD / PROCESSING; the app only reads maxFileSizeBytes. */
export interface HotelUploadProcessingConfig {
  maxFileSizeBytes?: number;
  maxDataRows?: number;
  maxStayDates?: number;
  maxStoredErrors?: number;
  timeReserveSeconds?: number;
}

/**
 * AppConfig OFFLINE_SYNC / DEFAULT — offline readiness, outbound sync and
 * offline sign-in limits. All fields are optional; the app clamps each value
 * to a safe range and falls back to built-in defaults
 * (see services/sync/syncSettingsService.ts).
 */
export interface OfflineSyncConfig {
  /** Readiness refresh interval while online and a ride is live (minutes) */
  readinessRefreshMinutes?: number;
  /** Attempts before a queued operation is marked FAILED */
  maxSyncAttempts?: number;
  /** Alert when the oldest unsent item is older than this (minutes) */
  staleQueueAlertMinutes?: number;
  /** Days to keep synced records of past rides/occurrences on the device */
  retentionDays?: number;
  /** Upper bound of the exponential retry backoff (minutes) */
  maxBackoffMinutes?: number;
  /** Days an offline sign-in is allowed after the last online sign-in (not user-editable) */
  offlineLoginMaxDays?: number;
  /** Wrong offline password attempts before offline sign-in is locked (not user-editable) */
  offlineLoginMaxAttempts?: number;
  /** Warn when the device clock differs from server time by more than this (minutes, not user-editable) */
  clockSkewWarnMinutes?: number;
}
