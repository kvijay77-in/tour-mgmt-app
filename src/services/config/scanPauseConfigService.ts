import * as SecureStore from 'expo-secure-store';

const STORE_KEY = 'qr_scan_pause_seconds';

export const DEFAULT_SCAN_PAUSE_SECONDS = 3;
export const MIN_SCAN_PAUSE_SECONDS = 3;

interface ScanPauseConfigRecord {
  seconds: number;
}

export function normalizeScanPauseSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCAN_PAUSE_SECONDS;
  }

  const wholeSeconds = Math.floor(value);
  return wholeSeconds < MIN_SCAN_PAUSE_SECONDS ? MIN_SCAN_PAUSE_SECONDS : wholeSeconds;
}

export async function loadScanPauseSeconds(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) {
      return DEFAULT_SCAN_PAUSE_SECONDS;
    }

    const parsed = JSON.parse(raw) as Partial<ScanPauseConfigRecord>;
    if (typeof parsed.seconds !== 'number' || Number.isNaN(parsed.seconds)) {
      await SecureStore.deleteItemAsync(STORE_KEY);
      return DEFAULT_SCAN_PAUSE_SECONDS;
    }

    return normalizeScanPauseSeconds(parsed.seconds);
  } catch {
    return DEFAULT_SCAN_PAUSE_SECONDS;
  }
}

export async function saveScanPauseSeconds(value: number): Promise<void> {
  const normalized = normalizeScanPauseSeconds(value);
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ seconds: normalized }));
}
