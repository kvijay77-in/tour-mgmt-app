/**
 * Hotel stay store — SQLite cache of RoomAllocation rows per night.
 * Holds today's stays from the events bootstrap and refreshed stays after
 * a hotel allocation upload is APPLIED. On web the stays are held in memory for
 * the browser session only (see database.web.ts).
 */

import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY } from './database';
import { RoomAllocation, RoomAllocationSource } from '../../types/models';

/** Web: session-only copy keyed by `stayDate|riderId`. */
const memoryStays = new Map<string, RoomAllocation>();
registerSessionMemoryReset(() => memoryStays.clear());

function setMemoryStay(stay: RoomAllocation): void {
  memoryStays.set(`${stay.stayDate}|${stay.riderId}`, {
    ...stay,
    roomNo: stay.roomNo ?? '',
    roomCapacity: stay.roomCapacity ?? 2,
    sharingWith: stay.sharingWith ?? [],
  });
}

function memoryStaysWhere(match: (stay: RoomAllocation) => boolean): RoomAllocation[] {
  return [...memoryStays.values()]
    .filter(match)
    .sort((a, b) => a.roomNo.localeCompare(b.roomNo) || a.riderId.localeCompare(b.riderId));
}

/** Replace all cached stays for one night. */
export async function replaceStaysForDate(stayDate: string, stays: RoomAllocation[]): Promise<void> {
  if (USE_SESSION_MEMORY) {
    for (const [key, stay] of memoryStays) {
      if (stay.stayDate === stayDate) memoryStays.delete(key);
    }
    stays.filter((stay) => stay.stayDate === stayDate).forEach(setMemoryStay);
    return;
  }

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
  if (USE_SESSION_MEMORY) {
    setMemoryStay(stay);
    return;
  }

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
  if (USE_SESSION_MEMORY) return memoryStaysWhere((stay) => stay.stayDate === stayDate);

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE stayDate = ? ORDER BY roomNo, riderId',
    [stayDate],
  );
  return rows.map(mapRowToStay);
}

export async function getStaysByHotel(hotelId: string, stayDate: string): Promise<RoomAllocation[]> {
  if (USE_SESSION_MEMORY) {
    return memoryStaysWhere((stay) => stay.hotelId === hotelId && stay.stayDate === stayDate);
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE hotelId = ? AND stayDate = ? ORDER BY roomNo, riderId',
    [hotelId, stayDate],
  );
  return rows.map(mapRowToStay);
}

export async function getStay(stayDate: string, riderId: string): Promise<RoomAllocation | null> {
  if (USE_SESSION_MEMORY) return memoryStays.get(`${stayDate}|${riderId}`) ?? null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM room_allocations WHERE stayDate = ? AND riderId = ?',
    [stayDate, riderId],
  );
  return row ? mapRowToStay(row) : null;
}

export async function clearAllStays(): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memoryStays.clear();
    return;
  }

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
