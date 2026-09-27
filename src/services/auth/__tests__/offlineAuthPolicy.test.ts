import { describe, expect, it } from '@jest/globals';
import { evaluateOfflineSignIn, OfflineProfile, safeEqual } from '../offlineAuthPolicy';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-27T08:00:00.000Z');
const limits = { offlineLoginMaxDays: 7, offlineLoginMaxAttempts: 5 };

function profile(overrides: Partial<OfflineProfile> = {}): OfflineProfile {
  return {
    username: 'Marshal@Example.com',
    userId: 'sub-1',
    userRoles: ['PS_1_USER'],
    lastOnlineAuthAt: new Date(now.getTime() - DAY_MS).toISOString(),
    failedAttempts: 0,
    hasSavedPassword: true,
    ...overrides,
  };
}

function evaluate(overrides: Partial<Parameters<typeof evaluateOfflineSignIn>[0]> = {}) {
  return evaluateOfflineSignIn({
    profile: profile(),
    username: ' marshal@example.com ',
    now,
    limits,
    hasScreenLock: true,
    requirePassword: true,
    ...overrides,
  });
}

describe('evaluateOfflineSignIn', () => {
  it('allows the saved user (case-insensitive) within the validity window', () => {
    expect(evaluate()).toBeNull();
  });

  it('requires a screen lock', () => {
    expect(evaluate({ hasScreenLock: false })).toBe('NO_SCREEN_LOCK');
  });

  it('requires a saved sign-in', () => {
    expect(evaluate({ profile: null })).toBe('NO_SAVED_SIGN_IN');
    expect(evaluate({ profile: profile({ hasSavedPassword: false }) })).toBe('NO_SAVED_SIGN_IN');
  });

  it('allows session resume without a saved password', () => {
    expect(evaluate({ profile: profile({ hasSavedPassword: false }), requirePassword: false, username: undefined }))
      .toBeNull();
  });

  it('rejects another user', () => {
    expect(evaluate({ username: 'someone@example.com' })).toBe('OTHER_USER');
  });

  it('expires after offlineLoginMaxDays and when the clock moved back', () => {
    expect(evaluate({ profile: profile({ lastOnlineAuthAt: new Date(now.getTime() - 8 * DAY_MS).toISOString() }) }))
      .toBe('EXPIRED');
    expect(evaluate({ profile: profile({ lastOnlineAuthAt: new Date(now.getTime() + 2 * DAY_MS).toISOString() }) }))
      .toBe('EXPIRED');
    expect(evaluate({ profile: profile({ lastOnlineAuthAt: 'invalid' }) })).toBe('EXPIRED');
  });

  it('locks after too many wrong passwords', () => {
    expect(evaluate({ profile: profile({ failedAttempts: 5 }) })).toBe('LOCKED');
  });
});

describe('safeEqual', () => {
  it('compares strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
