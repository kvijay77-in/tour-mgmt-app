import { Ride, Stage, StageType, Tour } from '../types/models';

export type TriState = 'default' | 'allowed' | 'notAllowed';

export type RideSelfServiceSource = 'stage' | 'ride' | 'tour' | 'default';

export function triStateFromBoolean(value?: boolean | null): TriState {
  if (value === true) return 'allowed';
  if (value === false) return 'notAllowed';
  return 'default';
}

export function triStateToBoolean(value: TriState): boolean | undefined {
  if (value === 'allowed') return true;
  if (value === 'notAllowed') return false;
  return undefined;
}

export function resolveStageSelfCheckIn(
  stage: Pick<Stage, 'type' | 'selfCheckInAllowed'>,
  ride: Pick<Ride, 'selfCheckInAllowed'>,
): boolean {
  const explicit = stage.selfCheckInAllowed ?? ride.selfCheckInAllowed;
  if (typeof explicit === 'boolean') return explicit;
  return stage.type !== StageType.PIT_STOP;
}

export function getStageSelfCheckInSource(
  stage: Pick<Stage, 'selfCheckInAllowed'>,
  ride: Pick<Ride, 'selfCheckInAllowed'>,
): RideSelfServiceSource {
  if (typeof stage.selfCheckInAllowed === 'boolean') return 'stage';
  if (typeof ride.selfCheckInAllowed === 'boolean') return 'ride';
  return 'default';
}

export function resolveSelfQuitRiding(
  ride: Pick<Ride, 'selfQuitRidingAllowed'>,
  tour: Pick<Tour, 'selfQuitRidingAllowed'>,
): boolean {
  return ride.selfQuitRidingAllowed ?? tour.selfQuitRidingAllowed ?? false;
}

export function getSelfQuitRidingSource(
  ride: Pick<Ride, 'selfQuitRidingAllowed'>,
  tour: Pick<Tour, 'selfQuitRidingAllowed'>,
): RideSelfServiceSource {
  if (typeof ride.selfQuitRidingAllowed === 'boolean') return 'ride';
  if (typeof tour.selfQuitRidingAllowed === 'boolean') return 'tour';
  return 'default';
}

export function resolveSelfNotRiding(ride: Pick<Ride, 'stages'>): boolean {
  const startStage = ride.stages.find((stage) => stage.type === StageType.START);
  return startStage?.selfNotRidingAllowed ?? false;
}