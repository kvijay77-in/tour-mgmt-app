/**
 * Server cross-check ("Verify with server" in Sync status).
 *
 * Compares the check-ins the device queue delivered (sent log) with the
 * server's records for the same rides and reports any the server does not
 * hold, so they can be sent again. Runs only when the user asks — no
 * background traffic.
 */

import { getDashboardProgress } from '../api/dashboardApi';
import { deleteSentCheckIn, getSentCheckIns, SentCheckIn } from '../database/sentCheckInStore';
import { captureCheckInLocally, LOCAL_QUIT_RIDING_STAGE_NUMBER } from './checkInSync';
import { CheckIn } from '../../types/models';
import { hasEquivalentServerCheckIn, isServerCopyOfRequest } from '../../utils/checkInValidation';
import { logger } from '../../utils/logger';

const TAG = 'CheckInCrossCheck';

export interface CrossCheckResult {
  /** Sent check-ins compared */
  checkedCount: number;
  /** Rides whose server records were read */
  rideCount: number;
  /** Sent check-ins the server does not hold */
  missing: SentCheckIn[];
  verifiedAt: string;
}

/** Sent check-ins without a matching server record (pure; exported for tests). */
export function findMissingOnServer(sent: readonly SentCheckIn[], serverCheckIns: CheckIn[]): SentCheckIn[] {
  const serverIds = new Set(serverCheckIns.map((checkIn) => checkIn.checkInId));
  return sent.filter((entry) => {
    if (entry.serverCheckInId && serverIds.has(entry.serverCheckInId)) return false;
    if (serverCheckIns.some((server) => isServerCopyOfRequest(server, entry.request))) return false;
    // Reported as a duplicate when sent: any equivalent server record counts.
    if (!entry.serverCheckInId && hasEquivalentServerCheckIn(serverCheckIns, entry.request)) return false;
    return true;
  });
}

/** Verify every sent check-in of the tour against the server (needs a connection). */
export async function verifySentCheckIns(tourId: string): Promise<CrossCheckResult> {
  const sent = await getSentCheckIns(tourId);
  const byRide = new Map<string, SentCheckIn[]>();
  sent.forEach((entry) => byRide.set(entry.rideId, [...(byRide.get(entry.rideId) ?? []), entry]));

  const missing: SentCheckIn[] = [];
  for (const [rideId, entries] of byRide) {
    const progress = (await getDashboardProgress(tourId, rideId)).data;
    const serverCheckIns = [
      ...(Array.isArray(progress?.checkIns) ? progress.checkIns : []),
      ...(Array.isArray(progress?.cancelled) ? progress.cancelled : []),
    ];
    missing.push(...findMissingOnServer(entries, serverCheckIns));
  }

  logger.info(TAG, 'Server cross-check completed', {
    checked: sent.length,
    rides: byRide.size,
    missing: missing.length,
  });
  return { checkedCount: sent.length, rideCount: byRide.size, missing, verifiedAt: new Date().toISOString() };
}

/**
 * Queue a missing check-in again with its original capture time. If the
 * server does have it after all, the queue treats the duplicate as sent.
 */
export async function resendMissingCheckIn(
  entry: SentCheckIn,
  sender: { userId: string; checkedInBy: string },
): Promise<void> {
  const { timestamp, ...request } = entry.request;
  const stageNumber = request.stageNumber;
  const stageId = stageNumber === undefined || stageNumber === LOCAL_QUIT_RIDING_STAGE_NUMBER
    ? ''
    : `S${String(stageNumber).padStart(3, '0')}`;
  const capturedAt = timestamp ? new Date(timestamp) : undefined;
  await captureCheckInLocally({
    tourId: entry.tourId,
    request,
    stageId,
    ownerUserId: sender.userId,
    checkedInBy: sender.checkedInBy,
    capturedAt: capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt : undefined,
  });
  await deleteSentCheckIn(entry.localId);
  logger.info(TAG, 'Missing check-in queued again', { localId: entry.localId, riderId: entry.riderId });
}
