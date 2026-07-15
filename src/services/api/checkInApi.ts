/**
 * Check-in API service — endpoints for rider check-in operations.
 * See docs/DataIntegrationDesign.md §2.2 and §3.2.
 */

import { apiClient, ApiError } from './apiClient';
import { CheckInRequest, GetCheckInsQuery } from '../../types/api';
import { CheckIn } from '../../types/models';

export type InteractiveCheckInOutcome =
  | { kind: 'success'; checkIn: CheckIn }
  | {
      kind: 'info_conflict';
      reason: 'duplicate' | 'quit_riding';
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

  if (code === 'DUPLICATE_CHECKIN' || code.includes('DUPLICATE') || message.includes('duplicate') || message.includes('already checked')) {
    return {
      kind: 'info_conflict',
      reason: 'duplicate',
      message: error.message,
    };
  }

  if (code.includes('QUIT') || message.includes('quit riding') || message.includes('already quit')) {
    return {
      kind: 'info_conflict',
      reason: 'quit_riding',
      message: error.message,
    };
  }

  return null;
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
