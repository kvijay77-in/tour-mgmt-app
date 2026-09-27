import { describe, expect, it } from '@jest/globals';
import { BASE_RETRY_DELAY_MS, computeRetryDelayMs, hasExhaustedAttempts } from '../backoff';

describe('backoff', () => {
  const noJitter = () => 1;

  it('doubles the delay per attempt', () => {
    expect(computeRetryDelayMs(1, 15, noJitter)).toBe(BASE_RETRY_DELAY_MS);
    expect(computeRetryDelayMs(2, 15, noJitter)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(computeRetryDelayMs(4, 15, noJitter)).toBe(BASE_RETRY_DELAY_MS * 8);
  });

  it('caps the delay at maxBackoffMinutes', () => {
    expect(computeRetryDelayMs(50, 15, noJitter)).toBe(15 * 60_000);
  });

  it('applies 50–100 % jitter', () => {
    expect(computeRetryDelayMs(1, 15, () => 0)).toBe(BASE_RETRY_DELAY_MS / 2);
    const delay = computeRetryDelayMs(3, 15);
    expect(delay).toBeGreaterThanOrEqual(BASE_RETRY_DELAY_MS * 2);
    expect(delay).toBeLessThanOrEqual(BASE_RETRY_DELAY_MS * 4);
  });

  it('exhausts attempts at the configured maximum', () => {
    expect(hasExhaustedAttempts(7, 8)).toBe(false);
    expect(hasExhaustedAttempts(8, 8)).toBe(true);
  });
});
