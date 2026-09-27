/**
 * Ride data store — SQLite operations for ride caching.
 */

import type * as SQLite from 'expo-sqlite';
import { getDatabase, withWriteTransaction } from './database';
import { Ride, Stage } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'RideStore';

const RIDE_UPSERT_SQL = `INSERT OR REPLACE INTO rides
  (rideId, date, rideNo, name, startLocation, finishLocation, totalDistance,
   flagOffTime, status, stagesJson, description, startedAt, completedAt, closedAt,
   tourId, payloadJson, lastSyncedAt)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function toRideParams(ride: Ride, tourId: string | null, now: string): SQLite.SQLiteBindValue[] {
  return [
    ride.rideId,
    ride.date,
    ride.rideNo ?? null,
    ride.name,
    ride.startLocation,
    ride.finishLocation,
    ride.totalDistance,
    ride.flagOffTime ?? null,
    ride.status,
    JSON.stringify(ride.stages),
    ride.description ?? null,
    ride.startedAt ?? null,
    ride.completedAt ?? null,
    ride.closedAt ?? null,
    tourId,
    JSON.stringify(ride),
    now,
  ];
}

/**
 * Upsert a ride into the local cache (from API response).
 * The full ride is kept in payloadJson so floats, pit-stop status and
 * open/close times survive offline.
 */
export async function upsertRide(ride: Ride, tourId?: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(RIDE_UPSERT_SQL, toRideParams(ride, tourId ?? null, new Date().toISOString()));
}

/**
 * Replace the cached ride list for a tour in one transaction.
 */
export async function replaceRidesForTour(tourId: string, rides: Ride[]): Promise<void> {
  const now = new Date().toISOString();
  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM rides');
    const statement = await db.prepareAsync(RIDE_UPSERT_SQL);
    try {
      for (const ride of rides) {
        await statement.executeAsync(toRideParams(ride, tourId, now));
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
}

/**
 * Get the cached rides for a tour, most recent first.
 */
export async function getRidesByTour(tourId: string): Promise<Ride[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM rides WHERE tourId = ? ORDER BY date DESC, rideNo',
    [tourId],
  );
  return rows.map(mapRowToRide);
}

/**
 * Get a ride by ID from the local cache.
 */
export async function getRideById(rideId: string): Promise<Ride | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM rides WHERE rideId = ?',
    [rideId],
  );
  return row ? mapRowToRide(row) : null;
}

/**
 * Get rides by date.
 */
export async function getRidesByDate(date: string): Promise<Ride[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM rides WHERE date = ? ORDER BY rideNo',
    [date],
  );
  return rows.map(mapRowToRide);
}

/**
 * Get the active ride from cache.
 */
export async function getActiveRide(): Promise<Ride | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM rides WHERE status = 'STARTED' ORDER BY date DESC LIMIT 1",
  );
  return row ? mapRowToRide(row) : null;
}

/**
 * Get all cached rides.
 */
export async function getAllRides(): Promise<Ride[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM rides ORDER BY date DESC, rideNo',
  );
  return rows.map(mapRowToRide);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapRowToRide(row: Record<string, unknown>): Ride {
  if (typeof row.payloadJson === 'string' && row.payloadJson.length > 0) {
    try {
      return JSON.parse(row.payloadJson) as Ride;
    } catch (e) {
      logger.warn(TAG, 'Failed to parse cached ride payload; using columns', e);
    }
  }

  let stages: Stage[] = [];
  try {
    stages = JSON.parse(row.stagesJson as string) as Stage[];
  } catch (e) {
    logger.warn(TAG, 'Failed to parse stages JSON', e);
    stages = [];
  }

  return {
    rideId: row.rideId as string,
    date: row.date as string,
    rideNo: row.rideNo as number | undefined,
    name: row.name as string,
    startLocation: row.startLocation as string,
    finishLocation: row.finishLocation as string,
    totalDistance: row.totalDistance as number,
    flagOffTime: row.flagOffTime as string | undefined,
    status: row.status as Ride['status'],
    stages,
    description: row.description as string | undefined,
    startedAt: row.startedAt as string | undefined,
    completedAt: row.completedAt as string | undefined,
    closedAt: row.closedAt as string | undefined,
  };
}
