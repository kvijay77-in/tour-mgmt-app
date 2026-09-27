import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

import {
  describeClockSkew,
  estimateClockSkewMs,
  isClockSkewSignificant,
  pickClockSkew,
} from '../clockSkew';

describe('clockSkew', () => {
  const start = Date.parse('2026-09-27T10:00:00.000Z');

  it('estimates server minus device time from the Date header', () => {
    const header = new Date(start + 10 * 60_000).toUTCString();
    expect(estimateClockSkewMs(header, start, start + 400)).toBe(10 * 60_000);
  });

  it('ignores missing/invalid headers and slow round trips', () => {
    expect(estimateClockSkewMs(null, start, start + 100)).toBeNull();
    expect(estimateClockSkewMs('not a date', start, start + 100)).toBeNull();
    expect(estimateClockSkewMs(new Date(start).toUTCString(), start, start + 60_000)).toBeNull();
  });

  it('uses the smallest difference of recent samples', () => {
    expect(pickClockSkew([600_000, -2_000, 300_000])).toBe(-2_000);
    expect(pickClockSkew([])).toBeNull();
  });

  it('warns only beyond the threshold', () => {
    expect(isClockSkewSignificant(4 * 60_000, 5)).toBe(false);
    expect(isClockSkewSignificant(-6 * 60_000, 5)).toBe(true);
    expect(isClockSkewSignificant(null, 5)).toBe(false);
  });

  it('describes the difference', () => {
    expect(describeClockSkew(12 * 60_000)).toBe('12 min behind server time');
    expect(describeClockSkew(-3 * 60 * 60_000)).toBe('3 h ahead of server time');
  });
});
