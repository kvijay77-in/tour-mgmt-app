/**
 * Offline sync settings service — holds the effective settings in memory and
 * persists the user's Advanced-settings overrides on the device.
 *
 * - AppConfig OFFLINE_SYNC/DEFAULT is cached in SQLite (app_config) and applied
 *   with setOrgSyncConfig() whenever it is loaded (online or from cache).
 * - Device overrides are stored in AsyncStorage (per device, all users).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineSyncConfig } from '../../types/config';
import { CONFIG_TYPE, OFFLINE_SYNC_CONFIG_ID } from '../../constants/idCodes';
import { getAppConfigsByType } from '../database/appConfigStore';
import { logger } from '../../utils/logger';
import {
  resolveOrgSyncSettings,
  resolveSyncSettings,
  sanitizeSyncOverrides,
  SyncSettingOverrides,
  SyncSettings,
} from './syncSettings';

const TAG = 'SyncSettings';
const OVERRIDES_KEY = 'offline.syncSettingOverrides';

let _orgConfig: OfflineSyncConfig | null = null;
let _overrides: SyncSettingOverrides = {};
let _settings: SyncSettings = resolveSyncSettings(null, null);
let _overridesLoaded: Promise<void> | null = null;
const _listeners = new Set<(settings: SyncSettings) => void>();

function recompute(): void {
  _settings = resolveSyncSettings(_orgConfig, _overrides);
  for (const listener of _listeners) listener(_settings);
}

/** Load device overrides once per app start. */
export function loadSyncSettingOverrides(): Promise<void> {
  if (!_overridesLoaded) {
    _overridesLoaded = AsyncStorage.getItem(OVERRIDES_KEY)
      .then((raw) => {
        _overrides = raw ? sanitizeSyncOverrides(JSON.parse(raw)) : {};
        recompute();
      })
      .catch((error: unknown) => {
        logger.warn(TAG, 'Failed to load sync setting overrides; using defaults', error);
      });
  }
  return _overridesLoaded;
}

/**
 * Apply the cached OFFLINE_SYNC AppConfig (from the last online start) and the
 * device overrides. Used before AppConfig is refreshed, e.g. offline sign-in.
 */
export async function hydrateSyncSettingsFromCache(): Promise<void> {
  await loadSyncSettingOverrides();
  try {
    const cached = await getAppConfigsByType(CONFIG_TYPE.OFFLINE_SYNC);
    const item = cached.find((entry) => entry.configId === OFFLINE_SYNC_CONFIG_ID && entry.enabled);
    setOrgSyncConfig(item ? (item.config as OfflineSyncConfig) : null);
  } catch (error) {
    logger.warn(TAG, 'Failed to read cached OFFLINE_SYNC config', error);
  }
}

/** Apply the organisation's OFFLINE_SYNC AppConfig (null = not configured). */
export function setOrgSyncConfig(config: OfflineSyncConfig | null): void {
  _orgConfig = config;
  recompute();
}

/** Current effective settings. */
export function getSyncSettings(): SyncSettings {
  return _settings;
}

/** Organisation/default values (what "Reset" restores). */
export function getOrgSyncSettings(): SyncSettings {
  return resolveOrgSyncSettings(_orgConfig);
}

/** Current device overrides. */
export function getSyncSettingOverrides(): SyncSettingOverrides {
  return { ..._overrides };
}

/** Persist device overrides (values are clamped; omitted keys use AppConfig/default). */
export async function saveSyncSettingOverrides(overrides: SyncSettingOverrides): Promise<void> {
  _overrides = sanitizeSyncOverrides(overrides);
  recompute();
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(_overrides));
}

/** Remove all device overrides. */
export async function resetSyncSettingOverrides(): Promise<void> {
  _overrides = {};
  recompute();
  await AsyncStorage.removeItem(OVERRIDES_KEY);
}

/** Subscribe to effective-setting changes. Returns an unsubscribe function. */
export function subscribeSyncSettings(listener: (settings: SyncSettings) => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
