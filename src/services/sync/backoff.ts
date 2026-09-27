/**
 * Retry backoff policy for the outbound sync queue (pure, no I/O).
 *
 * Exponential backoff with jitter so that a persistent failure does not
 * retry in a tight loop (battery, data, backend load) and many devices
 * reconnecting at once do not retry in lock-step.
 */

/** Delay before the first retry. */
export const BASE_RETRY_DELAY_MS = 10_000;

/**
 * Delay before the next attempt after `attempts` failed attempts (>= 1).
 * Grows as base × 2^(attempts−1), capped at `maxBackoffMinutes`, then
 * randomised to 50–100 % of that value.
 *
 * @param attempts Failed attempts so far, including the one just made
 * @param maxBackoffMinutes Upper bound for the delay
 * @param random Random source in [0, 1) (injectable for tests)
 */
export function computeRetryDelayMs(
  attempts: number,
  maxBackoffMinutes: number,
  random: () => number = Math.random,
): number {
  const capMs = Math.max(1, maxBackoffMinutes) * 60_000;
  const exponent = Math.min(Math.max(0, attempts - 1), 20);
  const rawMs = Math.min(capMs, BASE_RETRY_DELAY_MS * 2 ** exponent);
  const jitter = 0.5 + 0.5 * Math.min(Math.max(random(), 0), 1);
  return Math.round(rawMs * jitter);
}

/**
 * Whether an operation should be moved to FAILED (needs attention) after
 * `attempts` failed attempts instead of being retried automatically.
 */
export function hasExhaustedAttempts(attempts: number, maxSyncAttempts: number): boolean {
  return attempts >= Math.max(1, maxSyncAttempts);
}
