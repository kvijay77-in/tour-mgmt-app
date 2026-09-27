import { describe, expect, it } from '@jest/globals';
import { toLocalDateString } from '../dates';

describe('toLocalDateString', () => {
  it('formats the device-local calendar date', () => {
    expect(toLocalDateString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(toLocalDateString(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });
});
