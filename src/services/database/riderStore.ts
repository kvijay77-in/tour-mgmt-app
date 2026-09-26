/**
 * Rider data store — SQLite operations for rider caching.
 * Riders are read-only from the app's perspective (synced from API).
 */

import { getDatabase } from './database';
import { DietaryPreference, Rider } from '../../types/models';

/**
 * Upsert riders into the local cache (from API response).
 */
export async function upsertRiders(riders: Rider[]): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  for (const rider of riders) {
    // Upsert (not REPLACE) so the lazily cached dietaryPreference survives rider refreshes.
    await db.runAsync(
      `INSERT INTO riders
        (riderId, profileId, name, email, phone, emergencyContactName, emergencyContactPhone, photoS3Key, qrCodeData, status, lastSyncedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(riderId) DO UPDATE SET
         profileId = excluded.profileId,
         name = excluded.name,
         email = excluded.email,
         phone = excluded.phone,
         emergencyContactName = excluded.emergencyContactName,
         emergencyContactPhone = excluded.emergencyContactPhone,
         photoS3Key = excluded.photoS3Key,
         qrCodeData = excluded.qrCodeData,
         status = excluded.status,
         lastSyncedAt = excluded.lastSyncedAt`,
      [
        rider.riderId,
        rider.profileId ?? null,
        rider.name,
        rider.email ?? null,
        rider.phone ?? null,
        rider.emergencyContactName ?? null,
        rider.emergencyContactPhone ?? null,
        rider.photoS3Key ?? null,
        rider.qrCodeData ?? null,
        rider.status ?? null,
        now,
      ],
    );
  }
}

/**
 * Get all cached riders.
 */
export async function getAllRiders(): Promise<Rider[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM riders ORDER BY riderId',
  );
  return rows.map(mapRowToRider);
}

/**
 * Get a single rider by ID.
 */
export async function getRiderById(riderId: string): Promise<Rider | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM riders WHERE riderId = ?',
    [riderId],
  );
  return row ? mapRowToRider(row) : null;
}

/**
 * Cache a rider's profile dietaryPreference (fetched lazily for variant activities).
 */
export async function setRiderDietaryPreference(
  riderId: string,
  dietaryPreference: DietaryPreference | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE riders SET dietaryPreference = ? WHERE riderId = ?',
    [dietaryPreference, riderId],
  );
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapRowToRider(row: Record<string, unknown>): Rider {
  return {
    riderId: row.riderId as string,
    profileId: row.profileId as string | undefined,
    name: row.name as string,
    email: row.email as string | undefined,
    phone: row.phone as string | undefined,
    emergencyContactName: row.emergencyContactName as string | undefined,
    emergencyContactPhone: row.emergencyContactPhone as string | undefined,
    photoS3Key: row.photoS3Key as string | undefined,
    qrCodeData: row.qrCodeData as string | undefined,
    status: row.status as string | undefined,
    dietaryPreference: (row.dietaryPreference as DietaryPreference | null) ?? null,
  };
}
