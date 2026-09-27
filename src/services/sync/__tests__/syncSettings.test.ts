import { describe, expect, it } from '@jest/globals';
import {
  clampSyncSetting,
  getDefaultSyncSettings,
  resolveOrgSyncSettings,
  resolveSyncSettings,
  sanitizeSyncOverrides,
  SYNC_SETTING_LIMITS,
} from '../syncSettings';

describe('syncSettings', () => {
  it('uses built-in defaults without AppConfig', () => {
    expect(resolveSyncSettings(null, null)).toEqual(getDefaultSyncSettings());
  });

  it('applies AppConfig values, clamped to safe limits', () => {
    const settings = resolveOrgSyncSettings({ readinessRefreshMinutes: 0, maxSyncAttempts: 12, retentionDays: 999 });
    expect(settings.readinessRefreshMinutes).toBe(SYNC_SETTING_LIMITS.readinessRefreshMinutes.min);
    expect(settings.maxSyncAttempts).toBe(12);
    expect(settings.retentionDays).toBe(SYNC_SETTING_LIMITS.retentionDays.max);
  });

  it('device overrides win over AppConfig for editable settings only', () => {
    const settings = resolveSyncSettings(
      { staleQueueAlertMinutes: 60, offlineLoginMaxDays: 3 },
      { staleQueueAlertMinutes: 10, offlineLoginMaxDays: 30 } as never,
    );
    expect(settings.staleQueueAlertMinutes).toBe(10);
    // Offline sign-in limits are organisation-controlled, not user-editable.
    expect(settings.offlineLoginMaxDays).toBe(3);
  });

  it('ignores non-numeric values', () => {
    expect(clampSyncSetting('maxBackoffMinutes', 'abc')).toBeNull();
    expect(clampSyncSetting('maxBackoffMinutes', Number.NaN)).toBeNull();
    expect(clampSyncSetting('maxBackoffMinutes', 7.6)).toBe(8);
  });

  it('sanitises persisted overrides', () => {
    expect(sanitizeSyncOverrides({ retentionDays: 0, unknown: 5, offlineLoginMaxAttempts: 9 })).toEqual({
      retentionDays: SYNC_SETTING_LIMITS.retentionDays.min,
    });
    expect(sanitizeSyncOverrides('not-an-object')).toEqual({});
  });
});
