/**
 * Check-in API service — endpoints for rider check-in operations.
 * See docs/DataIntegrationDesign.md §2.2 and §3.2.
 */

import { apiClient, ApiError } from './apiClient';
import { CheckInRequest, GetCheckInsQuery } from '../../types/api';
import { CheckIn, CheckInStatus, deriveCheckInStatus } from '../../types/models';

export type InteractiveCheckInOutcome =
  | { kind: 'success'; checkIn: CheckIn }
  | {
      kind: 'info_conflict';
      reason: 'duplicate' | 'quit_riding' | 'not_riding';
      message: string;
    };

function checkInsPath(tourId: string): string {
  return `/v1/tours/${tourId}/checkins`;
}

/**
 * Create a new check-in.
 * Returns the created check-in record from the backend.
 */
export async function createCheckIn(
  tourId: string,
  checkIn: CheckInRequest,
): Promise<CheckIn> {
  const response = await apiClient.post<CheckIn>(
    checkInsPath(tourId),
    checkIn,
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from createCheckIn');
  }
  return response.data;
}

function getInteractiveConflictOutcome(error: unknown): InteractiveCheckInOutcome | null {
  if (!(error instanceof ApiError) || error.statusCode !== 409) {
    return null;
  }

  const code = (error.errorCode || '').toUpperCase();
  const message = (error.message || '').toLowerCase();

  const isNotRidingConflict =
    code === 'RIDER_NOT_RIDING' ||
    code.includes('NOT_RIDING') ||
    message.includes('already not riding') ||
    (message.includes('not riding') && message.includes('already'));

  const isQuitRidingConflict =
    code.includes('QUIT') ||
    message.includes('quit riding') ||
    message.includes('already quit');

  if (code === 'DUPLICATE_CHECKIN' || code.includes('DUPLICATE') || message.includes('duplicate') || message.includes('already checked')) {
    return {
      kind: 'info_conflict',
      reason: 'duplicate',
      message: error.message,
    };
  }

  if (isQuitRidingConflict) {
    return {
      kind: 'info_conflict',
      reason: 'quit_riding',
      message: error.message,
    };
  }

  if (isNotRidingConflict) {
    return {
      kind: 'info_conflict',
      reason: 'not_riding',
      message: error.message,
    };
  }

  return null;
}

function getRequestedActionLabel(checkIn: CheckInRequest): string {
  if (checkIn.isNotRiding) {
    return 'Not Riding';
  }
  if (checkIn.isQuitRiding) {
    return 'Quit Riding';
  }
  return 'Regular check-in';
}

function getLatestRiderStatus(checkIns: CheckIn[]): CheckInStatus {
  if (checkIns.length === 0) {
    return CheckInStatus.NOT_CHECKED_IN;
  }

  const latestCheckIn = checkIns.reduce((latest, current) => {
    const latestTime = Date.parse(latest.timestamp);
    const currentTime = Date.parse(current.timestamp);
    if (Number.isNaN(latestTime) || Number.isNaN(currentTime)) {
      return latest;
    }
    return currentTime > latestTime ? current : latest;
  });

  return deriveCheckInStatus(latestCheckIn);
}

function getStatusConflictOutcome(
  checkIn: CheckInRequest,
  latestStatus: CheckInStatus,
): InteractiveCheckInOutcome | null {
  const actionLabel = getRequestedActionLabel(checkIn);

  if (latestStatus === CheckInStatus.NOT_RIDING) {
    return {
      kind: 'info_conflict',
      reason: 'not_riding',
      message: `Rider is already marked as Not Riding in the latest backend status. ${actionLabel} is not allowed.`,
    };
  }

  if (latestStatus === CheckInStatus.QUIT_RIDING) {
    return {
      kind: 'info_conflict',
      reason: 'quit_riding',
      message: `Rider is already marked as Quit Riding in the latest backend status. ${actionLabel} is not allowed.`,
    };
  }

  return null;
}

async function listRiderCheckInsForValidation(
  tourId: string,
  rideId: string,
  riderId: string,
): Promise<CheckIn[]> {
  try {
    return await listCheckIns(tourId, {
      rideId,
      riderId,
    });
  } catch (error) {
    // Some backend deployments return 404 when no check-ins exist for rider/ride yet.
    if (error instanceof ApiError && error.statusCode === 404) {
      return [];
    }
    throw error;
  }
}

/**
 * Create a check-in for the interactive screen flow.
 *
 * Expected rider-state conflicts such as duplicate scans or a rider who has
 * already quit riding are returned as informational outcomes so the UI can
 * present them without treating them as errors.
 */
export async function createInteractiveCheckIn(
  tourId: string,
  checkIn: CheckInRequest,
): Promise<InteractiveCheckInOutcome> {
  try {
    // Interactive online mode must validate against backend-latest rider status
    // before final create/write to avoid stale local-state decisions.
    const riderCheckIns = await listRiderCheckInsForValidation(
      tourId,
      checkIn.rideId,
      checkIn.riderId,
    );
    const latestStatus = getLatestRiderStatus(riderCheckIns);
    const statusConflict = getStatusConflictOutcome(checkIn, latestStatus);
    if (statusConflict) {
      return statusConflict;
    }

    const createdCheckIn = await createCheckIn(tourId, checkIn);
    return {
      kind: 'success',
      checkIn: createdCheckIn,
    };
  } catch (error) {
    const outcome = getInteractiveConflictOutcome(error);
    if (outcome) {
      return outcome;
    }
    throw error;
  }
}

/**
 * List check-ins for a ride, optionally filtered by rider, stage, or status.
 */
export async function listCheckIns(
  tourId: string,
  query: GetCheckInsQuery,
): Promise<CheckIn[]> {
  const params: Record<string, string> = {
    rideId: query.rideId,
  };
  if (query.riderId) params.riderId = query.riderId;
  if (query.stageId) params.stageId = query.stageId;
  if (query.status) params.status = query.status;
  if (query.limit) params.limit = String(query.limit);
  if (query.nextToken) params.nextToken = query.nextToken;

  const response = await apiClient.get<CheckIn[]>(checkInsPath(tourId), {
    params,
  });
  return response.data ?? [];
}

/**
 * Get a single check-in by ID.
 */
export async function getCheckInById(
  tourId: string,
  checkInId: string,
): Promise<CheckIn | null> {
  try {
    const response = await apiClient.get<CheckIn>(
      `${checkInsPath(tourId)}/${encodeURIComponent(checkInId)}`,
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}
