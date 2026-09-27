/**
 * Check-in validation rules shared by the online flow (checkInApi, against
 * the backend's latest check-ins) and offline capture (against the device
 * cache). Pure functions — no I/O.
 */

import { CheckInRequest } from '../types/api';
import { CheckIn, CheckInStatus, deriveCheckInStatus, isCancelledCheckIn } from '../types/models';

export type InteractiveCheckInOutcome =
  | { kind: 'success'; checkIn: CheckIn }
  | {
      kind: 'info_conflict';
      reason: 'duplicate' | 'quit_riding' | 'not_riding';
      message: string;
    };

export type OverrideRequiredOutcome = {
  kind: 'override_required';
  reason: 'start_regular_exists' | 'start_not_riding_exists' | 'start_float_exists';
  message: string;
};

export function getRequestedActionLabel(checkIn: CheckInRequest): string {
  if (checkIn.isFloat) {
    return checkIn.floatNo ? `Float-${checkIn.floatNo}` : 'Float';
  }
  if (checkIn.isNotRiding) {
    return 'Not Riding';
  }
  if (checkIn.isQuitRiding) {
    return 'Quit Riding';
  }
  return 'Regular check-in';
}

/**
 * Resolve a check-in's stage number defensively.
 *
 * The raw ride check-ins list endpoint may expose the stage as a numeric
 * `stageNumber`, a stringified number, or only as a `stageId` such as `"S000"`.
 * Not Riding / Quit Riding records may carry no stage information at all.
 */
export function resolveStageNumber(checkIn: CheckIn): number | undefined {
  const raw = checkIn.stageNumber as unknown;

  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    return raw;
  }

  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }

  if (checkIn.stageId && /^S\d{3}$/.test(checkIn.stageId)) {
    return Number.parseInt(checkIn.stageId.slice(1), 10);
  }

  return undefined;
}

/**
 * Return the most recent active (non-cancelled) check-in matching a predicate.
 */
export function getLatestActiveCheckIn(
  checkIns: CheckIn[],
  predicate: (checkIn: CheckIn) => boolean,
): CheckIn | undefined {
  return checkIns
    .filter((checkIn) => !isCancelledCheckIn(checkIn) && predicate(checkIn))
    .reduce<CheckIn | undefined>((latest, current) => {
      if (!latest) return current;

      const latestTime = Date.parse(latest.timestamp);
      const currentTime = Date.parse(current.timestamp);
      if (Number.isNaN(latestTime) || Number.isNaN(currentTime)) {
        return latest;
      }
      return currentTime > latestTime ? current : latest;
    }, undefined);
}

/** Latest active regular (CHECKED_IN) check-in recorded at the Start stage. */
export function getActiveStartRegularCheckIn(checkIns: CheckIn[]): CheckIn | undefined {
  return getLatestActiveCheckIn(
    checkIns,
    (checkIn) =>
      deriveCheckInStatus(checkIn) === CheckInStatus.CHECKED_IN &&
      resolveStageNumber(checkIn) === 0,
  );
}

/** Latest active Not Riding check-in (Not Riding records carry no stage). */
export function getActiveNotRidingCheckIn(checkIns: CheckIn[]): CheckIn | undefined {
  return getLatestActiveCheckIn(
    checkIns,
    (checkIn) => deriveCheckInStatus(checkIn) === CheckInStatus.NOT_RIDING,
  );
}

export function getActiveFloatCheckIn(checkIns: CheckIn[]): CheckIn | undefined {
  return getLatestActiveCheckIn(
    checkIns,
    (checkIn) => deriveCheckInStatus(checkIn) === CheckInStatus.FLOAT,
  );
}

export function getStartStageOverrideOutcome(
  checkIn: CheckInRequest,
  riderCheckIns: CheckIn[],
  latestStatus: CheckInStatus,
): OverrideRequiredOutcome | null {
  const requestedIsFloat = !!checkIn.isFloat;
  const requestedIsNotRiding = !!checkIn.isNotRiding;
  const requestedIsRegularStart =
    checkIn.stageNumber === 0 &&
    !checkIn.isQuitRiding &&
    !requestedIsNotRiding &&
    !requestedIsFloat;

  if (requestedIsFloat) {
    if (
      latestStatus === CheckInStatus.CHECKED_IN &&
      getActiveStartRegularCheckIn(riderCheckIns)
    ) {
      return {
        kind: 'override_required',
        reason: 'start_regular_exists',
        message: 'A regular Start-stage check-in already exists for this rider. Override it with Float?',
      };
    }

    if (
      latestStatus === CheckInStatus.NOT_RIDING &&
      getActiveNotRidingCheckIn(riderCheckIns)
    ) {
      return {
        kind: 'override_required',
        reason: 'start_not_riding_exists',
        message: 'This rider is already marked as Not Riding at Start. Override it with Float?',
      };
    }

    return null;
  }

  if (requestedIsNotRiding) {
    if (
      latestStatus === CheckInStatus.CHECKED_IN &&
      getActiveStartRegularCheckIn(riderCheckIns)
    ) {
      return {
        kind: 'override_required',
        reason: 'start_regular_exists',
        message: 'A regular Start-stage check-in already exists for this rider. Override it with Not Riding?',
      };
    }

    if (
      latestStatus === CheckInStatus.FLOAT &&
      getActiveFloatCheckIn(riderCheckIns)
    ) {
      return {
        kind: 'override_required',
        reason: 'start_float_exists',
        message: 'This rider already has a Float check-in at Start. Override it with Not Riding?',
      };
    }

    return null;
  }

  if (
    requestedIsRegularStart &&
    latestStatus === CheckInStatus.NOT_RIDING &&
    getActiveNotRidingCheckIn(riderCheckIns)
  ) {
    return {
      kind: 'override_required',
      reason: 'start_not_riding_exists',
      message: 'This rider is already marked as Not Riding at Start. Override it with a regular check-in?',
    };
  }

  if (
    requestedIsRegularStart &&
    latestStatus === CheckInStatus.FLOAT &&
    getActiveFloatCheckIn(riderCheckIns)
  ) {
    return {
      kind: 'override_required',
      reason: 'start_float_exists',
      message: 'This rider already has a Float check-in at Start. Override it with a regular check-in?',
    };
  }

  return null;
}

export function getLatestRiderStatus(checkIns: CheckIn[]): CheckInStatus {
  const activeCheckIns = checkIns.filter((checkIn) => !isCancelledCheckIn(checkIn));

  if (activeCheckIns.length === 0) {
    return CheckInStatus.NOT_CHECKED_IN;
  }

  const latestCheckIn = activeCheckIns.reduce((latest, current) => {
    const latestTime = Date.parse(latest.timestamp);
    const currentTime = Date.parse(current.timestamp);
    if (Number.isNaN(latestTime) || Number.isNaN(currentTime)) {
      return latest;
    }
    return currentTime > latestTime ? current : latest;
  });

  return deriveCheckInStatus(latestCheckIn);
}

export function getStatusConflictOutcome(
  checkIn: CheckInRequest,
  latestStatus: CheckInStatus,
): InteractiveCheckInOutcome | null {
  const actionLabel = getRequestedActionLabel(checkIn);

  if (latestStatus === CheckInStatus.NOT_RIDING) {
    return {
      kind: 'info_conflict',
      reason: 'not_riding',
      message: `Rider is already marked as Not Riding. ${actionLabel} is not allowed.`,
    };
  }

  if (latestStatus === CheckInStatus.QUIT_RIDING) {
    return {
      kind: 'info_conflict',
      reason: 'quit_riding',
      message: `Rider is already marked as Quit Riding. ${actionLabel} is not allowed.`,
    };
  }

  return null;
}

/**
 * Validate a check-in against a rider's existing check-ins for the ride
 * (offline capture). Mirrors the backend rules: Not Riding / Quit Riding
 * block further check-ins, one regular check-in per stage, and Start-stage
 * changes need an override (online only).
 *
 * @returns null when the check-in may be recorded
 */
export function evaluateCheckInAgainstHistory(
  checkIn: CheckInRequest,
  riderCheckIns: CheckIn[],
): InteractiveCheckInOutcome | OverrideRequiredOutcome | null {
  const latestStatus = getLatestRiderStatus(riderCheckIns);
  const override = getStartStageOverrideOutcome(checkIn, riderCheckIns, latestStatus);
  if (override) return override;

  const statusConflict = getStatusConflictOutcome(checkIn, latestStatus);
  if (statusConflict) return statusConflict;

  const isRegular = !checkIn.isNotRiding && !checkIn.isQuitRiding && !checkIn.isFloat;
  if (isRegular && checkIn.stageNumber !== undefined) {
    const duplicate = getLatestActiveCheckIn(
      riderCheckIns,
      (existing) =>
        deriveCheckInStatus(existing) === CheckInStatus.CHECKED_IN &&
        resolveStageNumber(existing) === checkIn.stageNumber,
    );
    if (duplicate) {
      return {
        kind: 'info_conflict',
        reason: 'duplicate',
        message: `Rider ${checkIn.riderId} is already checked in at this stage.`,
      };
    }
  }

  if (checkIn.isFloat && getActiveFloatCheckIn(riderCheckIns)) {
    return {
      kind: 'info_conflict',
      reason: 'duplicate',
      message: `Rider ${checkIn.riderId} already has a Float check-in.`,
    };
  }

  return null;
}

/**
 * Whether a server check-in is the record created from `request` (same rider,
 * capture timestamp, kind and stage). The backend stores the client timestamp
 * exactly, so this identifies a check-in sent from the device queue.
 */
export function isServerCopyOfRequest(server: CheckIn, request: CheckInRequest): boolean {
  if (server.riderId && server.riderId !== request.riderId) return false;
  if (server.timestamp !== request.timestamp) return false;
  if (Boolean(server.isQuitRiding) !== Boolean(request.isQuitRiding)) return false;
  if (Boolean(server.isNotRiding) !== Boolean(request.isNotRiding)) return false;
  return Boolean(request.isQuitRiding) || resolveStageNumber(server) === request.stageNumber;
}

/**
 * Whether the server holds an equivalent record for `request` (same rider and
 * kind — used for check-ins the server reported as duplicates, whose server
 * copy may carry another timestamp).
 */
export function hasEquivalentServerCheckIn(serverCheckIns: CheckIn[], request: CheckInRequest): boolean {
  return serverCheckIns.some((server) => {
    if (server.riderId !== request.riderId) return false;
    if (request.isQuitRiding) return Boolean(server.isQuitRiding);
    if (request.isNotRiding) return Boolean(server.isNotRiding);
    if (request.isFloat) return Boolean(server.isFloat);
    return deriveCheckInStatus(server) === CheckInStatus.CHECKED_IN
      && resolveStageNumber(server) === request.stageNumber;
  });
}
