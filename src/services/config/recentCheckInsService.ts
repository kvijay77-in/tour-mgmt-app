/**
 * Recent check-ins persistence service.
 *
 * Stores a small list of recent check-ins per user in expo-secure-store.
 */
import * as SecureStore from 'expo-secure-store';

const STORE_KEY_PREFIX = 'recent_checkins';

export interface RecentCheckInRecord {
  riderId: string;
  riderName?: string;
  ts: number;
  stage: string;
}

function keyFor(userId: string) {
  return `${STORE_KEY_PREFIX}:${userId}`;
}

export async function loadRecentCheckIns(userId: string): Promise<RecentCheckInRecord[]> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await SecureStore.deleteItemAsync(keyFor(userId));
      return [];
    }

    const items: RecentCheckInRecord[] = parsed
      .map((p: any) => ({
        riderId: typeof p.riderId === 'string' ? p.riderId : '',
        riderName: typeof p.riderName === 'string' ? p.riderName : '',
        ts: typeof p.ts === 'number' && Number.isFinite(p.ts) ? p.ts : Date.now(),
        stage: typeof p.stage === 'string' ? p.stage : '',
      }))
      .filter((it: RecentCheckInRecord) => !!it.riderId && !!it.ts);

    return items;
  } catch {
    return [];
  }
}

export async function saveRecentCheckIns(userId: string, items: RecentCheckInRecord[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(userId), JSON.stringify(items));
  } catch {
    // best-effort persistence; ignore failures
  }
}

export async function clearRecentCheckIns(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyFor(userId));
  } catch {
    // ignore
  }
}
