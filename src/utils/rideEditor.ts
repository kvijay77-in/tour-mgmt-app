import { CreateRideRequest } from '../types/api';
import { Ride, RideStatus, Stage, StageType } from '../types/models';
import { triStateFromBoolean, triStateToBoolean, TriState } from './rideSelfService';

export interface StageDraft {
  stageId?: string;
  name: string;
  location: string;
  distanceFromStart: string;
  estimatedOpenTime: string;
  pitStopDuration: string;
  selfCheckIn: TriState;
}

export interface LockedStageDraft {
  selfCheckIn: TriState;
  selfNotRiding: boolean;
  original: Stage | null;
}

export interface RideDraft {
  rideId: string;
  date: string;
  name: string;
  startLocation: string;
  finishLocation: string;
  description?: string;
  status: RideStatus;
  startedAt?: string;
  completedAt?: string;
  floats?: Ride['floats'];
  rideNo: number;
  totalDistance: number;
  openTime: string;
  closeTime: string;
  flagOffTime: string;
  selfCheckIn: TriState;
  selfQuitRiding: TriState;
  start: LockedStageDraft;
  finish: LockedStageDraft;
  pitStops: StageDraft[];
  layoutIssue: string | null;
  original: Ride | null;
}

export type PitStopDirection = 'up' | 'down';

export function createRideDraft(rideId: string): RideDraft {
  return {
    rideId,
    date: '',
    name: '',
    startLocation: '',
    finishLocation: '',
    description: '',
    status: RideStatus.PLANNED,
    rideNo: 0,
    totalDistance: 0,
    openTime: '',
    closeTime: '',
    flagOffTime: '',
    selfCheckIn: 'default',
    selfQuitRiding: 'default',
    start: { selfCheckIn: 'default', selfNotRiding: false, original: null },
    finish: { selfCheckIn: 'default', selfNotRiding: false, original: null },
    pitStops: [],
    layoutIssue: null,
    original: null,
  };
}

export function toRideDraft(ride: Ride): RideDraft {
  const start = ride.stages.find((stage) => stage.type === StageType.START) ?? null;
  const finish = ride.stages.find((stage) => stage.type === StageType.FINISH) ?? null;
  return {
    ...createRideDraft(ride.rideId),
    ...ride,
    rideNo: ride.rideNo ?? 0,
    totalDistance: ride.totalDistance ?? 0,
    openTime: ride.openTime ?? '',
    closeTime: ride.closeTime ?? '',
    flagOffTime: ride.flagOffTime ?? '',
    selfCheckIn: triStateFromBoolean(ride.selfCheckInAllowed),
    selfQuitRiding: triStateFromBoolean(ride.selfQuitRidingAllowed),
    start: {
      selfCheckIn: triStateFromBoolean(start?.selfCheckInAllowed),
      selfNotRiding: start?.selfNotRidingAllowed ?? false,
      original: start,
    },
    finish: {
      selfCheckIn: triStateFromBoolean(finish?.selfCheckInAllowed),
      selfNotRiding: false,
      original: finish,
    },
    pitStops: ride.stages.filter((stage) => stage.type === StageType.PIT_STOP).map(stageToDraft),
    layoutIssue: getStageLayoutIssue(ride),
    original: ride,
  };
}

export function getStageLayoutIssue(ride: Pick<Ride, 'stages'>): string | null {
  const { stages } = ride;
  const starts = stages.filter((stage) => stage.type === StageType.START);
  const finishes = stages.filter((stage) => stage.type === StageType.FINISH);
  if (starts.length !== 1) return 'This ride must have exactly one Start stage.';
  if (finishes.length !== 1) return 'This ride must have exactly one Finish stage.';
  if (stages[0]?.type !== StageType.START) return 'The Start stage must be first.';
  if (stages[stages.length - 1]?.type !== StageType.FINISH) return 'The Finish stage must be last.';
  if (stages.slice(1, -1).some((stage) => stage.type !== StageType.PIT_STOP)) {
    return 'Only pit stops may appear between Start and Finish.';
  }
  return null;
}

export function addPitStop(draft: RideDraft, stage: StageDraft = emptyStageDraft()): RideDraft {
  return { ...draft, pitStops: [...draft.pitStops, stage] };
}

export function removePitStop(draft: RideDraft, index: number): RideDraft {
  return { ...draft, pitStops: draft.pitStops.filter((_stage, stageIndex) => stageIndex !== index) };
}

export function movePitStop(draft: RideDraft, index: number, direction: PitStopDirection): RideDraft {
  const targetIndex = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || index >= draft.pitStops.length || targetIndex < 0 || targetIndex >= draft.pitStops.length) {
    return draft;
  }
  const pitStops = [...draft.pitStops];
  [pitStops[index], pitStops[targetIndex]] = [pitStops[targetIndex], pitStops[index]];
  return { ...draft, pitStops };
}

export function ridePayload(draft: RideDraft): CreateRideRequest {
  const start = draft.start.original;
  const finish = draft.finish.original;
  const clearRideSelfCheckIn = draft.selfCheckIn === 'default'
    && hasExplicitRideSelfServiceValue(draft.original, 'selfCheckInAllowed');
  const clearRideQuitRiding = draft.selfQuitRiding === 'default'
    && hasExplicitRideSelfServiceValue(draft.original, 'selfQuitRidingAllowed');
  const pitStops = draft.pitStops.map((stage, index) => ({
    stageId: `S${String(index + 1).padStart(3, '0')}`,
    stageNumber: index + 1,
    type: 'PIT_STOP' as const,
    name: stage.name,
    ...(stage.location ? { location: stage.location } : {}),
    ...(stage.distanceFromStart !== '' ? { distanceFromStart: Number(stage.distanceFromStart) } : {}),
    ...(stage.estimatedOpenTime !== '' ? { estimatedOpenTime: Number(stage.estimatedOpenTime) } : {}),
    ...(stage.pitStopDuration !== '' ? { pitStopDuration: Number(stage.pitStopDuration) } : {}),
    ...policyField(stage.selfCheckIn),
  }));

  return {
    rideId: draft.rideId,
    date: draft.date,
    rideNo: draft.rideNo,
    name: draft.name,
    startLocation: draft.startLocation,
    finishLocation: draft.finishLocation,
    totalDistance: draft.totalDistance,
    flagOffTime: draft.flagOffTime,
    openTime: draft.openTime || undefined,
    closeTime: draft.closeTime || undefined,
    description: draft.description || undefined,
    stages: [
      {
        stageId: 'S000',
        stageNumber: 0,
        type: 'START',
        name: start?.name ?? 'Start',
        ...(start?.location ? { location: start.location } : {}),
        ...(start?.distanceFromStart !== undefined ? { distanceFromStart: start.distanceFromStart } : {}),
        ...policyField(draft.start.selfCheckIn),
        selfNotRidingAllowed: draft.start.selfNotRiding,
      },
      ...pitStops,
      {
        stageId: `S${String(pitStops.length + 1).padStart(3, '0')}`,
        stageNumber: pitStops.length + 1,
        type: 'FINISH',
        name: finish?.name ?? 'Finish',
        ...(finish?.location ? { location: finish.location } : {}),
        ...(finish?.distanceFromStart !== undefined ? { distanceFromStart: finish.distanceFromStart } : {}),
        ...policyField(draft.finish.selfCheckIn),
      },
    ],
    ...(draft.floats ? { floats: draft.floats } : {}),
    ...ridePolicyField(draft.selfCheckIn, clearRideSelfCheckIn),
    ...ridePolicyField(draft.selfQuitRiding, clearRideQuitRiding, 'selfQuitRidingAllowed'),
  };
}

export function validateRide(draft: RideDraft): string | null {
  if (draft.layoutIssue) return draft.layoutIssue;
  if (!draft.name.trim() || !draft.date || !draft.startLocation.trim() || !draft.finishLocation.trim()) {
    return 'Ride name, date, start location, and finish location are required.';
  }
  if (!isIsoDate(draft.date)) return 'Ride date must use YYYY-MM-DD format.';
  if (!Number.isInteger(draft.rideNo) || draft.rideNo < 1) return 'Ride number must be a positive integer.';
  if (!Number.isFinite(draft.totalDistance) || draft.totalDistance <= 0) return 'Ride distance must be greater than zero.';
  if (!isTime(draft.flagOffTime) || (draft.openTime && !isTime(draft.openTime)) || (draft.closeTime && !isTime(draft.closeTime))) {
    return 'Ride times must use HH:MM format.';
  }
  for (const stage of draft.pitStops) {
    if (!stage.name.trim()) return 'Every pit stop must have a name.';
    if (!positiveNumber(stage.distanceFromStart) || !nonNegativeInteger(stage.estimatedOpenTime) || !positiveNumber(stage.pitStopDuration)) {
      return 'Pit stop distance must be positive, open offset must be a non-negative integer, and duration must be positive.';
    }
  }
  return null;
}

export function isRideDirty(draft: RideDraft, baseline: string | undefined): boolean {
  return baseline === undefined || JSON.stringify(ridePayload(draft)) !== baseline;
}

export function hasExplicitRideSelfServiceValue(
  ride: Ride | null,
  field: 'selfCheckInAllowed' | 'selfQuitRidingAllowed',
): boolean {
  return typeof ride?.[field] === 'boolean';
}

function stageToDraft(stage: Stage): StageDraft {
  return {
    stageId: stage.stageId,
    name: stage.name,
    location: stage.location ?? '',
    distanceFromStart: stage.distanceFromStart === undefined ? '' : String(stage.distanceFromStart),
    estimatedOpenTime: stage.estimatedOpenTime === undefined ? '' : String(stage.estimatedOpenTime),
    pitStopDuration: stage.pitStopDuration === undefined ? '' : String(stage.pitStopDuration),
    selfCheckIn: triStateFromBoolean(stage.selfCheckInAllowed),
  };
}

function emptyStageDraft(): StageDraft {
  return { name: '', location: '', distanceFromStart: '', estimatedOpenTime: '', pitStopDuration: '', selfCheckIn: 'default' };
}

function policyField(value: TriState): { selfCheckInAllowed?: boolean } {
  const allowed = triStateToBoolean(value);
  return allowed === undefined ? {} : { selfCheckInAllowed: allowed };
}

function ridePolicyField(
  value: TriState,
  clearExplicitValue: boolean,
  field: 'selfCheckInAllowed' | 'selfQuitRidingAllowed' = 'selfCheckInAllowed',
): { selfCheckInAllowed?: boolean | null; selfQuitRidingAllowed?: boolean | null } {
  const allowed = triStateToBoolean(value);
  if (allowed !== undefined) return { [field]: allowed };
  return clearExplicitValue ? { [field]: null } : {};
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function positiveNumber(value: string): boolean {
  return value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

function nonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 0;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}