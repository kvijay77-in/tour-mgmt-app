/**
 * Shared rider-status derivation used by the Dashboard grid and the Rider Card
 * popup (Dashboard tab and Check-In Log tab) so both build RiderStatus[] the
 * same way from a ride, roster, and check-in list.
 */

import { logger } from './logger';
import { CheckIn, CheckInStatus, isCancelledCheckIn, Ride, Rider, RiderStatus, Stage } from '../types/models';

export interface RiderFloatBadge {
  floatNo: number;
  floatToStage: number;
}

function normalizeStageNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function resolveStageForCheckIn(ride: Ride | null, checkIn: CheckIn): Stage | undefined {
  if (!ride) {
    return undefined;
  }

  if (checkIn.stageId) {
    const stageById = ride.stages.find((stage) => stage.stageId === checkIn.stageId);
    if (stageById) {
      return stageById;
    }
  }

  const normalizedStageNumber = normalizeStageNumber(checkIn.stageNumber);
  if (normalizedStageNumber === null) {
    return undefined;
  }

  const exactMatch = ride.stages.find((stage) => stage.stageNumber === normalizedStageNumber);
  if (exactMatch) {
    return exactMatch;
  }

  if (normalizedStageNumber > 0) {
    return ride.stages.find((stage) => stage.stageNumber === normalizedStageNumber - 1);
  }

  return undefined;
}

/**
 * Build RiderStatus[] from a ride, roster, and check-in list.
 */
export function buildRiderStatuses(ride: Ride, riders: Rider[], checkIns: CheckIn[]): RiderStatus[] {
  if (!Array.isArray(riders)) {
    logger.error('Dashboard', 'buildRiderStatuses received a non-array rider roster');
    return [];
  }

  return riders.map((rider) => {
    const riderCheckIns = checkIns
      .filter((ci) => {
        const matchesRider = ci.riderId === rider.riderId;
        const matchesRide = typeof ci.rideId !== 'string' || ci.rideId === ride.rideId;

        return matchesRider && matchesRide && !isCancelledCheckIn(ci);
      })
      .sort((a, b) => a.stageNumber - b.stageNumber);

    // Determine overall status
    let overallStatus = CheckInStatus.NOT_CHECKED_IN;
    const nrCheckIn = riderCheckIns.find((ci) => ci.isNotRiding);
    const qrCheckIn = riderCheckIns.find((ci) => ci.isQuitRiding);
    const nonFloatCheckIns = riderCheckIns.filter((ci) => !ci.isFloat);

    if (nrCheckIn) {
      overallStatus = CheckInStatus.NOT_RIDING;
    } else if (qrCheckIn) {
      overallStatus = CheckInStatus.QUIT_RIDING;
    } else if (nonFloatCheckIns.length > 0) {
      overallStatus = CheckInStatus.CHECKED_IN;
    }

    // Last non-special check-in determines the last stage reached
    const regularCheckIns = riderCheckIns.filter(
      (ci) => !ci.isNotRiding && !ci.isQuitRiding && !ci.isFloat,
    );
    const lastRegularCheckIn = regularCheckIns.length > 0
      ? regularCheckIns[regularCheckIns.length - 1]
      : undefined;

    const lastStage = lastRegularCheckIn ? resolveStageForCheckIn(ride, lastRegularCheckIn) : undefined;

    const lastCheckIn = riderCheckIns.length > 0
      ? riderCheckIns[riderCheckIns.length - 1]
      : undefined;

    return {
      rider,
      ride,
      lastCheckIn,
      overallStatus,
      lastStage,
      checkInHistory: riderCheckIns,
    };
  });
}

export function getRiderFloatDefinition(
  ride: Ride,
  riderStatus: RiderStatus,
): RiderFloatBadge | null {
  const floatCheckIn = riderStatus.checkInHistory.find(
    (ci) => ci.isFloat && !isCancelledCheckIn(ci),
  );

  if (!floatCheckIn || !ride.floats?.length) {
    return null;
  }

  const floatNo = floatCheckIn.floatNo ?? ride.floats[0].floatNo;
  const definition = ride.floats.find((item) => item.floatNo === floatNo);

  return definition
    ? { floatNo: definition.floatNo, floatToStage: definition.floatToStage }
    : null;
}

export function shouldShowFloatBadge(
  riderStatus: RiderStatus,
  floatDef: RiderFloatBadge,
  viewedStageNumber: number | null,
): boolean {
  if (viewedStageNumber !== null) {
    return viewedStageNumber <= floatDef.floatToStage;
  }

  const hasCompletedFloatTarget =
    !!riderStatus.lastStage && riderStatus.lastStage.stageNumber >= floatDef.floatToStage;

  return !hasCompletedFloatTarget;
}
