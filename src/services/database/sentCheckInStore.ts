/**
 * Sent check-in log — every check-in the device queue delivered to the server
 * (captured offline or queued behind offline data). Kept separately from
 * `check_ins` because a server refresh replaces that table with the server's
 * view; this log is what "Verify with server" compares against.
 *
 * Purged by the retention job.
 */

import { getDatabase } from './database';
import { CheckInRequest } from '../../types/api';

export interface SentCheckIn {
  localId: string;
  tourId: string;
  rideId: string;
  riderId: string;
  request: CheckInRequest;
  serverCheckInId: string | null;
  ownerUserId: string | null;
  sentAt: string;
}

interface SentCheckInRow {
  localId: string;
  tourId: string;
  rideId: string;
  riderId: string;
  requestJson: string;
  serverCheckInId: string | null;
  ownerUserId: string | null;
  sentAt: string;
}

export async function recordSentCheckIn(entry: Omit<SentCheckIn, 'sentAt'> & { sentAt?: string }): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sent_check_ins
      (localId, tourId, rideId, riderId, requestJson, serverCheckInId, ownerUserId, sentAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.localId,
      entry.tourId,
      entry.rideId,
      entry.riderId,
      JSON.stringify(entry.request),
      entry.serverCheckInId,
      entry.ownerUserId,
      entry.sentAt ?? new Date().toISOString(),
    ],
  );
}

/** Sent check-ins of a tour, newest first (optionally for one ride). */
export async function getSentCheckIns(tourId: string, rideId?: string): Promise<SentCheckIn[]> {
  const db = await getDatabase();
  const rows = rideId
    ? await db.getAllAsync<SentCheckInRow>(
      'SELECT * FROM sent_check_ins WHERE tourId = ? AND rideId = ? ORDER BY sentAt DESC',
      [tourId, rideId],
    )
    : await db.getAllAsync<SentCheckInRow>(
      'SELECT * FROM sent_check_ins WHERE tourId = ? ORDER BY sentAt DESC',
      [tourId],
    );
  return rows.flatMap((row) => {
    try {
      const request = JSON.parse(row.requestJson) as CheckInRequest;
      const { requestJson: _requestJson, ...rest } = row;
      return [{ ...rest, request }];
    } catch {
      return [];
    }
  });
}

export async function deleteSentCheckIn(localId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM sent_check_ins WHERE localId = ?', [localId]);
}
