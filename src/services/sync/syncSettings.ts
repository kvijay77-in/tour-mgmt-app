/**
 * Offline sync settings — pure resolution and clamping (no I/O).
 *
 * Precedence for each value: device override (Advanced settings) →
 * AppConfig OFFLINE_SYNC/DEFAULT → built-in default. The result is always
 * clamped to a safe range so a bad value cannot drain the battery or lose data.
 */

import type { OfflineSyncConfig } from '../../types/config';

export type SyncSettingKey = keyof Required<OfflineSyncConfig>;

export type SyncSettings = Required<OfflineSyncConfig>;

/** Settings the user may override on the device (Advanced settings). */
export const USER_EDITABLE_SYNC_SETTINGS = [
  'readinessRefreshMinutes',
  'maxSyncAttempts',
  'staleQueueAlertMinutes',
  'retentionDays',
  'maxBackoffMinutes',
] as const satisfies readonly SyncSettingKey[];

export type UserEditableSyncSettingKey = (typeof USER_EDITABLE_SYNC_SETTINGS)[number];

export type SyncSettingOverrides = Partial<Record<UserEditableSyncSettingKey, number>>;

export interface SyncSettingLimit {
  min: number;
  max: number;
  defaultValue: number;
  label: string;
  unit: string;
  description: string;
}

export const SYNC_SETTING_LIMITS: Record<SyncSettingKey, SyncSettingLimit> = {
  readinessRefreshMinutes: {
    min: 1,
    max: 60,
    defaultValue: 5,
    label: 'Offline data refresh',
    unit: 'min',
    description: 'How often ride data is refreshed for offline use while online and a ride is live.',
  },
  maxSyncAttempts: {
    min: 3,
    max: 20,
    defaultValue: 8,
    label: 'Sync attempts',
    unit: 'attempts',
    description: 'Attempts before an unsent item needs your attention in Sync status.',
  },
  staleQueueAlertMinutes: {
    min: 5,
    max: 240,
    defaultValue: 30,
    label: 'Unsent data alert',
    unit: 'min',
    description: 'Warn when data captured offline has not been sent for this long.',
  },
  retentionDays: {
    min: 1,
    max: 14,
    defaultValue: 2,
    label: 'Keep synced data',
    unit: 'days',
    description: 'Days to keep synced records of past rides and events on this device.',
  },
  maxBackoffMinutes: {
    min: 1,
    max: 60,
    defaultValue: 15,
    label: 'Max retry wait',
    unit: 'min',
    description: 'Longest wait between automatic retries when the server cannot be reached.',
  },
  offlineLoginMaxDays: {
    min: 1,
    max: 30,
    defaultValue: 7,
    label: 'Offline sign-in validity',
    unit: 'days',
    description: 'Days offline sign-in is allowed after the last online sign-in.',
  },
  offlineLoginMaxAttempts: {
    min: 3,
    max: 10,
    defaultValue: 5,
    label: 'Offline sign-in attempts',
    unit: 'attempts',
    description: 'Wrong password attempts before offline sign-in is locked.',
  },
  clockSkewWarnMinutes: {
    min: 1,
    max: 60,
    defaultValue: 5,
    label: 'Clock difference warning',
    unit: 'min',
    description: 'Warn when the device clock differs from server time by more than this.',
  },
};

const ALL_KEYS = Object.keys(SYNC_SETTING_LIMITS) as SyncSettingKey[];

/** Clamp a value to the setting's range; non-numeric values yield null. */
export function clampSyncSetting(key: SyncSettingKey, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = SYNC_SETTING_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Built-in defaults. */
export function getDefaultSyncSettings(): SyncSettings {
  const result = {} as SyncSettings;
  for (const key of ALL_KEYS) result[key] = SYNC_SETTING_LIMITS[key].defaultValue;
  return result;
}

/**
 * The organisation value (AppConfig, clamped) or the default — i.e. what a
 * setting returns to when the user resets their device override.
 */
export function resolveOrgSyncSettings(appConfig?: OfflineSyncConfig | null): SyncSettings {
  const result = getDefaultSyncSettings();
  if (!appConfig) return result;
  for (const key of ALL_KEYS) {
    const value = clampSyncSetting(key, appConfig[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

/** Effective settings: override → AppConfig → default, clamped. */
export function resolveSyncSettings(
  appConfig?: OfflineSyncConfig | null,
  overrides?: SyncSettingOverrides | null,
): SyncSettings {
  const result = resolveOrgSyncSettings(appConfig);
  if (!overrides) return result;
  for (const key of USER_EDITABLE_SYNC_SETTINGS) {
    const value = clampSyncSetting(key, overrides[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}

/** Keep only valid, user-editable, clamped override values. */
export function sanitizeSyncOverrides(raw: unknown): SyncSettingOverrides {
  const result: SyncSettingOverrides = {};
  if (!raw || typeof raw !== 'object') return result;
  const source = raw as Record<string, unknown>;
  for (const key of USER_EDITABLE_SYNC_SETTINGS) {
    const value = clampSyncSetting(key, source[key]);
    if (value !== null) result[key] = value;
  }
  return result;
}
