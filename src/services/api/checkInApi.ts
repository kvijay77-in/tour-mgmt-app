/**
 * Check-in API service — endpoints for rider check-in operations.
 * See docs/DataIntegrationDesign.md §2.2 and §3.2.
 */

import { apiClient, ApiError } from './apiClient';
import { CancelCheckInRequest, CheckInRequest, GetCheckInsQuery } from '../../types/api';
import { CheckIn, CheckInStatus, deriveCheckInStatus } from '../../types/models';
import {
  getActiveFloatCheckIn,
  getActiveNotRidingCheckIn,
  getActiveStartRegularCheckIn,
  getLatestRiderStatus,
  getStartStageOverrideOutcome,
  getStatusConflictOutcome,
  InteractiveCheckInOutcome,
  OverrideRequiredOutcome,
} from '../../utils/checkInValidation';

export type { InteractiveCheckInOutcome, OverrideRequiredOutcome } from '../../utils/checkInValidation';

type ValidationOutcome = InteractiveCheckInOutcome | OverrideRequiredOutcome;

export interface CheckInSendOptions {
  /** apiClient retries; the outbound sync engine passes 0 (it owns retry/backoff). */
  maxRetries?: number;
}

function isExpectedCheckInConflict(error: ApiError): boolean {
  if ([409, 422].includes(error.statusCode)) {
    return true;
  }

  if (error.statusCode !== 400) {
    return false;
  }

  const errorCode = error.errorCode?.toUpperCase() ?? '';
  const message = error.message.toLowerCase();

  return (
    errorCode.includes('DUPLICATE') ||
    errorCode.includes('NOT_RIDING') ||
    errorCode.includes('QUIT') ||
    message.includes('duplicate') ||
    message.includes('already checked') ||
    message.includes('already exists') ||
    message.includes('already in') ||
    message.includes('already recorded') ||
    message.includes('checked in at') ||
    message.includes('not riding') ||
    message.includes('quit riding') ||
    message.includes('conflict')
  );
}

function checkInsPath(tourId: string): string {
  return `/v1/tours/${tourId}/checkins`;
}

function rideCheckInsPath(tourId: string, rideId: string): string {
  return `/v1/tours/${tourId}/rides/${rideId}/checkins`;
}

function checkInCancelPath(tourId: string, rideId: string, checkInId: string): string {
  return `/v1/tours/${tourId}/rides/${rideId}/checkins/${encodeURIComponent(checkInId)}/cancel`;
}

function extractCheckInList(payload: unknown): CheckIn[] {
  if (Array.isArray(payload)) {
    return payload as CheckIn[];
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const nestedData = (payload as { data?: unknown }).data;
  if (nestedData !== undefined && nestedData !== payload) {
    const nestedCheckIns = extractCheckInList(nestedData);
    if (nestedCheckIns.length > 0) {
      return nestedCheckIns;
    }
  }

  const wrappedCheckIns = (payload as { checkIns?: unknown }).checkIns;
  if (Array.isArray(wrappedCheckIns)) {
    return wrappedCheckIns as CheckIn[];
  }

  const wrappedItems = (payload as { items?: unknown }).items;
  if (Array.isArray(wrappedItems)) {
    return wrappedItems as CheckIn[];
  }

  return [];
}

function resolveCheckInId(checkIn: CheckIn): string | null {
  if (checkIn.checkInId) {
    return checkIn.checkInId;
  }

  const resolvedStageNumber =
    checkIn.stageNumber ??
    (checkIn.stageId && /^S\d{3}$/.test(checkIn.stageId)
      ? Number.parseInt(checkIn.stageId.slice(1), 10)
      : undefined);

  const resolvedTimestamp = checkIn.timestamp ?? checkIn.createdAt;

  if (!checkIn.riderId || resolvedStageNumber === undefined || !resolvedTimestamp) {
    return null;
  }

  const paddedStageNumber = String(resolvedStageNumber).padStart(3, '0');
  return `${checkIn.riderId}#${paddedStageNumber}#${resolvedTimestamp}`;
}

/**
 * Create a new check-in.
 * Returns the created check-in record from the backend.
 */
export async function createCheckIn(
  tourId: string,
  checkIn: CheckInRequest,
  sendOptions: CheckInSendOptions = {},
): Promise<CheckIn> {
  const response = await apiClient.post<CheckIn>(
    checkInsPath(tourId),
    checkIn,
    { isExpectedError: isExpectedCheckInConflict, ...sendOptions },
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from createCheckIn');
  }
  return response.data;
}

export async function cancelCheckIn(
  tourId: string,
  rideId: string,
  checkInId: string,
  previousStatus: CheckInStatus,
): Promise<void> {
  const payload: CancelCheckInRequest = {
    status: 'CANCELLED',
    prevStatus: previousStatus,
  };

  await apiClient.post(checkInCancelPath(tourId, rideId, checkInId), payload);
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (error instanceof ApiError) {
    return error.statusCode;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { statusCode?: unknown };
    if (typeof candidate.statusCode === 'number') {
      return candidate.statusCode;
    }
  }

  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    return error.errorCode;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { errorCode?: unknown };
    if (typeof candidate.errorCode === 'string' && candidate.errorCode.trim()) {
      return candidate.errorCode;
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === 'string') {
      return candidate.message;
    }
  }

  return '';
}

function getInteractiveConflictOutcome(error: unknown): InteractiveCheckInOutcome | null {
  const statusCode = getErrorStatusCode(error);
  const isConflictLikeStatus = statusCode === 400 || statusCode === 409 || statusCode === 422;

  const code = (getErrorCode(error) || '').toUpperCase();
  const message = (getErrorMessage(error) || '').toLowerCase();
  const fallbackMessage = getErrorMessage(error) || 'The check-in request was blocked by the current rider state.';

  const hasConflictLikeMessage =
    message.includes('duplicate') ||
    message.includes('already checked') ||
    message.includes('already exists') ||
    message.includes('already in') ||
    message.includes('already recorded') ||
    message.includes('checked in at') ||
    message.includes('not riding') ||
    message.includes('quit riding');

  const isDuplicateLike =
    code.includes('DUPLICATE') ||
    message.includes('duplicate') ||
    message.includes('already checked') ||
    message.includes('already exists') ||
    message.includes('already in') ||
    message.includes('already recorded') ||
    message.includes('checked in at');

  if (!isConflictLikeStatus && !hasConflictLikeMessage) {
    return null;
  }

  const isNotRidingConflict =
    code === 'RIDER_NOT_RIDING' ||
    code.includes('NOT_RIDING') ||
    message.includes('already not riding') ||
    (message.includes('not riding') && message.includes('already')) ||
    message.includes('marked as not riding');

  const isQuitRidingConflict =
    code.includes('QUIT') ||
    message.includes('quit riding') ||
    message.includes('already quit') ||
    message.includes('marked as quit');

  if (isDuplicateLike) {
    return {
      kind: 'info_conflict',
      reason: 'duplicate',
      message: fallbackMessage,
    };
  }

  if (isQuitRidingConflict) {
    return {
      kind: 'info_conflict',
      reason: 'quit_riding',
      message: fallbackMessage,
    };
  }

  if (isNotRidingConflict) {
    return {
      kind: 'info_conflict',
      reason: 'not_riding',
      message: fallbackMessage,
    };
  }

  if (message.includes('already') || message.includes('conflict') || message.includes('not allowed')) {
    return {
      kind: 'info_conflict',
      reason: 'duplicate',
      message: fallbackMessage,
    };
  }

  return {
    kind: 'info_conflict',
    reason: 'duplicate',
    message: fallbackMessage,
  };
}

async function resolveOverrideTargetCheckIn(
  tourId: string,
  checkIn: CheckInRequest,
): Promise<CheckIn> {
  const riderCheckIns = await listRiderCheckInsForValidation(
    tourId,
    checkIn.rideId,
    checkIn.riderId,
  );

  const latestStatus = getLatestRiderStatus(riderCheckIns);
  const overrideOutcome = getStartStageOverrideOutcome(checkIn, riderCheckIns, latestStatus);

  if (!overrideOutcome) {
    throw new Error('Override target check-in was not found.');
  }

  const target =
    overrideOutcome.reason === 'start_regular_exists'
      ? getActiveStartRegularCheckIn(riderCheckIns)
      : overrideOutcome.reason === 'start_not_riding_exists'
        ? getActiveNotRidingCheckIn(riderCheckIns)
        : getActiveFloatCheckIn(riderCheckIns);

  if (!target) {
    throw new Error('Existing Start-stage check-in to cancel was not found.');
  }

  return target;
}

async function listRiderCheckInsForValidation(
  tourId: string,
  rideId: string,
  riderId: string,
): Promise<CheckIn[]> {
  try {
    const response = await apiClient.get<CheckIn[] | { checkIns?: CheckIn[]; items?: CheckIn[] }>(
      rideCheckInsPath(tourId, rideId),
      { isExpectedError: (error) => error.statusCode === 404 },
    );
    return extractCheckInList(response.data).filter((checkIn) => checkIn.riderId === riderId);
  } catch (error) {
    // Some backend deployments return 404 when no check-ins exist for the ride yet.
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
): Promise<ValidationOutcome> {
  try {
    // Interactive online mode must validate against backend-latest rider status
    // before final create/write to avoid stale local-state decisions.
    const riderCheckIns = await listRiderCheckInsForValidation(
      tourId,
      checkIn.rideId,
      checkIn.riderId,
    );

    const latestStatus = getLatestRiderStatus(riderCheckIns);
    const overrideOutcome = getStartStageOverrideOutcome(checkIn, riderCheckIns, latestStatus);
    if (overrideOutcome) {
      return overrideOutcome;
    }

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

    if (getErrorStatusCode(error) && [400, 409, 422].includes(getErrorStatusCode(error)!)) {
      return {
        kind: 'info_conflict',
        reason: 'duplicate',
        message: getErrorMessage(error) || 'The check-in was blocked because the rider already has an existing check-in.',
      };
    }

    throw error;
  }
}

/**
 * Override an existing check-in by cancelling the prior record and creating the new one.
 */
export async function overrideInteractiveCheckIn(
  tourId: string,
  checkIn: CheckInRequest,
): Promise<InteractiveCheckInOutcome> {
  try {
    const existingCheckIn = await resolveOverrideTargetCheckIn(tourId, checkIn);
    const previousStatus = deriveCheckInStatus(existingCheckIn);
    const resolvedCheckInId = resolveCheckInId(existingCheckIn);

    if (!resolvedCheckInId) {
      return {
        kind: 'info_conflict',
        reason: 'duplicate',
        message: 'The existing check-in could not be resolved for override.',
      };
    }

    await cancelCheckIn(tourId, checkIn.rideId, resolvedCheckInId, previousStatus);

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

    if (getErrorStatusCode(error) && [400, 409, 422].includes(getErrorStatusCode(error)!)) {
      return {
        kind: 'info_conflict',
        reason: 'duplicate',
        message: getErrorMessage(error) || 'The override request was blocked because the rider already has an existing check-in.',
      };
    }

    if (error instanceof Error && /override target check-in|existing check-in/i.test(error.message)) {
      return {
        kind: 'info_conflict',
        reason: 'duplicate',
        message: error.message,
      };
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
  sendOptions: CheckInSendOptions = {},
): Promise<CheckIn[]> {
  const params: Record<string, string> = {
    rideId: query.rideId,
  };
  if (query.riderId) params.riderId = query.riderId;
  if (query.stageId) params.stageId = query.stageId;
  if (query.status) params.status = query.status;
  if (query.limit) params.limit = String(query.limit);
  if (query.nextToken) params.nextToken = query.nextToken;

  const response = await apiClient.get<CheckIn[] | { checkIns?: CheckIn[]; items?: CheckIn[] }>(checkInsPath(tourId), {
    params,
    ...sendOptions,
  });
  return extractCheckInList(response.data);
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
