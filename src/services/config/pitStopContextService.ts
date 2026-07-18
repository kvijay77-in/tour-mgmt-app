/**
 * Pit-stop context persistence service.
 *
 * Stores the stage number selected by a pit-stop user so the app can reuse
 * it across restarts.
 */

import * as SecureStore from 'expo-secure-store';

const STORE_KEY = 'pit_stop_context';

interface PitStopContextRecord {
  stageNumber: number;
}

export async function loadPitStopContextStageNumber(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PitStopContextRecord>;
    if (typeof parsed.stageNumber !== 'number' || Number.isNaN(parsed.stageNumber)) {
      await SecureStore.deleteItemAsync(STORE_KEY);
      return null;
    }

    return parsed.stageNumber;
  } catch {
    return null;
  }
}

export async function savePitStopContextStageNumber(stageNumber: number): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ stageNumber }));
}

export async function clearPitStopContextStageNumber(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
}
