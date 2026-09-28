import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY } from './database';

interface RiderPersonalCodeEntry {
  personalCode: string;
  riderId: string;
}

/** Web: session-only copy, personalCode -> rider. */
const memoryCodes = new Map<string, { riderId: string; tourId: string }>();
registerSessionMemoryReset(() => memoryCodes.clear());

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

export async function replaceRiderPersonalCodes(
  tourId: string,
  entries: RiderPersonalCodeEntry[],
): Promise<void> {
  if (USE_SESSION_MEMORY) {
    for (const [code, entry] of memoryCodes) {
      if (entry.tourId === tourId) memoryCodes.delete(code);
    }
    for (const entry of entries) {
      const personalCode = normalizeCode(entry.personalCode);
      const riderId = entry.riderId.trim();
      if (personalCode && riderId) memoryCodes.set(personalCode, { riderId, tourId });
    }
    return;
  }

  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.execAsync('BEGIN IMMEDIATE TRANSACTION;');

  try {
    await db.runAsync(
      'DELETE FROM rider_personal_codes WHERE tourId = ?',
      [tourId],
    );

    for (const entry of entries) {
      const personalCode = normalizeCode(entry.personalCode);
      const riderId = entry.riderId.trim();
      if (!personalCode || !riderId) continue;

      await db.runAsync(
        `INSERT OR REPLACE INTO rider_personal_codes
          (personalCode, riderId, tourId, lastSyncedAt)
         VALUES (?, ?, ?, ?)`,
        [personalCode, riderId, tourId, now],
      );
    }

    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

export async function getRiderIdByPersonalCode(personalCode: string): Promise<string | null> {
  const code = normalizeCode(personalCode);
  if (!code) return null;
  if (USE_SESSION_MEMORY) return memoryCodes.get(code)?.riderId ?? null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ riderId: string }>(
    'SELECT riderId FROM rider_personal_codes WHERE personalCode = ? LIMIT 1',
    [code],
  );

  return row?.riderId ?? null;
}
