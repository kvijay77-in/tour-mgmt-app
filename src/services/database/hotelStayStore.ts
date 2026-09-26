/**
 * Hotel stay store — SQLite cache of RoomAllocation rows per night.
 * Holds today's stays from the events bootstrap and refreshed stays after
 * a hotel allocation upload is APPLIED.
 */

import { getDatabase } from './database';
import { RoomAllocation, RoomAllocationSource } from '../../types/models';

/** Replace all cached stays for one night. */
export async function replaceStaysForDate(stayDate: string, stays: RoomAllocation[]): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.execAsync('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await db.runAsync('DELETE FROM room_allocations WHERE stayDate = ?', [stayDate]);
    for (const stay of stays) {
      if (stay.stayDate !== stayDate) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO room_allocations
          (stayDate, riderId, hotelId, roomNo, roomCapacity, sharingWithJson, source, updatedAt, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          stay.stayDate,
          stay.riderId,
          stay.hotelId,
          stay.roomNo ?? null,
          stay.roomCapacity ?? 2,
          JSON.stringify(stay.sharingWith ?? []),
          stay.source ?? null,
          stay.updatedAt ?? null,
          now,
        ],
      );
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

/** Upsert one night after a manual save so cached views match the server. */
export async function upsertStay(stay: RoomAllocation): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO room_allocations
      (stayDate, riderId, hotelId, roomNo, roomCapacity, sharingWithJson, source, updatedAt, lastSyncedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stay.stayDate,
      stay.riderId,
      stay.hotelId,
      stay.roomNo ?? null,
      stay.roomCapacity ?? 2,
      JSON.stringify(stay.sharingWith ?? []),
      stay.source ?? null,
      stay.updatedAt ?? null,
      new Date().toISOString(),
    ],
  );
}

export async function getStaysByDate(stayDate: string): Promise<RoomAllocation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE stayDate = ? ORDER BY roomNo, riderId',
    [stayDate],
  );
  return rows.map(mapRowToStay);
}

export async function getStaysByHotel(hotelId: string, stayDate: string): Promise<RoomAllocation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE hotelId = ? AND stayDate = ? ORDER BY roomNo, riderId',
    [hotelId, stayDate],
  );
  return rows.map(mapRowToStay);
}

export async function getStay(stayDate: string, riderId: string): Promise<RoomAllocation | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE stayDate = ? AND riderId = ?',
    [stayDate, riderId],
  );
  return row ? mapRowToStay(row) : null;
}

export async function clearAllStays(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM room_allocations');
}

function mapRowToStay(row: Record<string, unknown>): RoomAllocation {
  let sharingWith: string[] = [];
  try {
    sharingWith = JSON.parse((row.sharingWithJson as string) || '[]') as string[];
  } catch {
    sharingWith = [];
  }

  return {
    stayDate: row.stayDate as string,
    riderId: row.riderId as string,
    hotelId: row.hotelId as string,
    roomNo: (row.roomNo as string | null) ?? '',
    roomCapacity: (row.roomCapacity as number) ?? 2,
    sharingWith,
    source: (row.source as RoomAllocationSource | null) ?? undefined,
    updatedAt: (row.updatedAt as string | null) ?? undefined,
  };
}
