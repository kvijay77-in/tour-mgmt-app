/**
 * Device clock check — offline check-ins and scans are stamped with the
 * device time, so a wrong device clock gives wrong capture times on the server.
 *
 * The server time is read from the HTTP `Date` header of normal API responses
 * (no extra calls). The last few samples are kept and the smallest difference
 * is used, so one delayed or cached response cannot raise a false warning.
 * The last estimate is persisted so the warning is still shown offline.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../../utils/logger';

const TAG = 'ClockSkew';
const STORAGE_KEY = 'offline:clockSkew';
const MAX_SAMPLES = 3;
/** Responses slower than this are too imprecise to estimate the offset. */
const MAX_ROUND_TRIP_MS = 30_000;
/** Only notify / persist when the estimate moves by more than this. */
const CHANGE_THRESHOLD_MS = 30_000;

export interface ClockSkewState {
  /** Server time minus device time (ms); positive = device clock is behind */
  skewMs: number | null;
  /** When the estimate was last updated (device time, ISO) */
  measuredAt: string | null;
}

/**
 * Estimate server − device time from a response `Date` header. Uses the
 * midpoint of the request as the device time the server stamped.
 *
 * @returns null when the header is missing/invalid or the round trip is too slow
 */
export function estimateClockSkewMs(
  dateHeader: string | null | undefined,
  requestStartedAtMs: number,
  responseReceivedAtMs: number,
): number | null {
  if (!dateHeader) return null;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return null;
  const roundTrip = responseReceivedAtMs - requestStartedAtMs;
  if (roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) return null;
  // The Date header has one-second resolution; round the result to seconds.
  return Math.round((serverMs - (requestStartedAtMs + roundTrip / 2)) / 1000) * 1000;
}

/** The smallest-magnitude sample (conservative against one bad sample). */
export function pickClockSkew(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, value) => (Math.abs(value) < Math.abs(best) ? value : best));
}

/** Whether the difference is large enough to warn the user. */
export function isClockSkewSignificant(skewMs: number | null, warnMinutes: number): boolean {
  return skewMs !== null && Math.abs(skewMs) > warnMinutes * 60_000;
}

/** Human-readable difference, e.g. "12 min behind". */
export function describeClockSkew(skewMs: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(skewMs) / 60_000));
  const amount = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
  return `${amount} ${skewMs > 0 ? 'behind' : 'ahead of'} server time`;
}

let samples: number[] = [];
let state: ClockSkewState = { skewMs: null, measuredAt: null };
const listeners = new Set<(next: ClockSkewState) => void>();

function publish(next: ClockSkewState): void {
  state = next;
  listeners.forEach((listener) => listener(state));
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error: unknown) => {
    logger.warn(TAG, 'Saving clock check failed', error);
  });
}

/** Called by apiClient for every response. Cheap: no I/O unless the estimate changes. */
export function recordServerTime(
  dateHeader: string | null | undefined,
  requestStartedAtMs: number,
  responseReceivedAtMs: number = Date.now(),
): void {
  const sample = estimateClockSkewMs(dateHeader, requestStartedAtMs, responseReceivedAtMs);
  if (sample === null) return;
  samples = [...samples, sample].slice(-MAX_SAMPLES);
  const skewMs = pickClockSkew(samples);
  if (skewMs === null) return;
  if (state.skewMs !== null && Math.abs(skewMs - state.skewMs) <= CHANGE_THRESHOLD_MS) return;
  publish({ skewMs, measuredAt: new Date(responseReceivedAtMs).toISOString() });
}

/** Restore the last estimate (app start, possibly offline). */
export async function loadClockSkew(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw || state.skewMs !== null) return;
    const parsed = JSON.parse(raw) as Partial<ClockSkewState>;
    if (typeof parsed.skewMs !== 'number' || !Number.isFinite(parsed.skewMs)) return;
    state = { skewMs: parsed.skewMs, measuredAt: typeof parsed.measuredAt === 'string' ? parsed.measuredAt : null };
    listeners.forEach((listener) => listener(state));
  } catch (error) {
    logger.warn(TAG, 'Reading clock check failed', error);
  }
}

export function getClockSkew(): ClockSkewState {
  return state;
}

export function subscribeClockSkew(listener: (next: ClockSkewState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
