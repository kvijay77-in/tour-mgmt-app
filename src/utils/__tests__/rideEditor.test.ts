import { describe, expect, it } from '@jest/globals';
import { Ride, RideStatus, Stage, StageType } from '../../types/models';
import {
  addPitStop,
  createRideDraft,
  getStageLayoutIssue,
  hasExplicitRideSelfServiceValue,
  isRideDirty,
  movePitStop,
  removePitStop,
  ridePayload,
  toRideDraft,
  validateRide,
} from '../rideEditor';

const start: Stage = {
  stageId: 'S000', stageNumber: 0, type: StageType.START, name: 'Start', location: 'Depot',
  selfCheckInAllowed: true, selfNotRidingAllowed: false,
};
const pitStop: Stage = {
  stageId: 'S001', stageNumber: 1, type: StageType.PIT_STOP, name: 'Water stop', location: 'Park',
  distanceFromStart: 20, estimatedOpenTime: 60, pitStopDuration: 30,
};
const finish: Stage = {
  stageId: 'S002', stageNumber: 2, type: StageType.FINISH, name: 'Finish', location: 'Hall',
  selfCheckInAllowed: true,
};

function ride(overrides: Partial<Ride> = {}): Ride {
  return {
    rideId: 'RIDE001', date: '2026-10-01', rideNo: 1, name: 'Day 1', startLocation: 'Depot',
    finishLocation: 'Hall', totalDistance: 80, flagOffTime: '08:00', status: RideStatus.PLANNED,
    stages: [start, pitStop, finish], ...overrides,
  };
}

describe('rideEditor', () => {
  it('creates a new ride with locked Start and Finish and no pit stops', () => {
    const draft = createRideDraft('RIDE001');
    expect(draft.start.original).toBeNull();
    expect(draft.finish.original).toBeNull();
    expect(draft.start.selfCheckIn).toBe('default');
    expect(draft.finish.selfCheckIn).toBe('default');
    expect(ridePayload(draft).stages).toEqual([
      { stageId: 'S000', stageNumber: 0, type: 'START', name: 'Start', selfNotRidingAllowed: false },
      { stageId: 'S001', stageNumber: 1, type: 'FINISH', name: 'Finish' },
    ]);
  });

  it('adds, edits, moves, and removes pit stops without changing locked endpoints', () => {
    const initial = toRideDraft(ride());
    const withSecond = addPitStop(initial, { name: 'Second', location: '', distanceFromStart: '40', estimatedOpenTime: '120', pitStopDuration: '25', selfCheckIn: 'notAllowed' });
    const moved = movePitStop(withSecond, 1, 'up');
    const removed = removePitStop(moved, 1);
    expect(withSecond.pitStops.map((stage) => stage.name)).toEqual(['Water stop', 'Second']);
    expect(moved.pitStops.map((stage) => stage.name)).toEqual(['Second', 'Water stop']);
    expect(removed.pitStops.map((stage) => stage.name)).toEqual(['Second']);
    expect(removed.start).toEqual(initial.start);
    expect(removed.finish).toEqual(initial.finish);
    expect(movePitStop(initial, 0, 'up')).toBe(initial);
  });

  it('renumbers the complete stage list and retains Start and Finish fields', () => {
    const payload = ridePayload(toRideDraft(ride()));
    expect(payload.stages.map(({ stageId, stageNumber, type }) => ({ stageId, stageNumber, type }))).toEqual([
      { stageId: 'S000', stageNumber: 0, type: 'START' },
      { stageId: 'S001', stageNumber: 1, type: 'PIT_STOP' },
      { stageId: 'S002', stageNumber: 2, type: 'FINISH' },
    ]);
    expect(payload.stages[0]).toMatchObject({ name: 'Start', location: 'Depot', selfNotRidingAllowed: false });
    expect(payload.stages[2]).toMatchObject({ name: 'Finish', location: 'Hall' });
  });

  it('omits default policies and serializes explicit true and false values', () => {
    const draft = createRideDraft('RIDE001');
    const defaults = ridePayload(draft);
    expect(defaults.selfCheckInAllowed).toBeUndefined();
    expect(defaults.selfQuitRidingAllowed).toBeUndefined();
    expect(defaults.stages[0].selfCheckInAllowed).toBeUndefined();

    const explicit = {
      ...draft,
      selfCheckIn: 'allowed' as const,
      selfQuitRiding: 'notAllowed' as const,
      start: { ...draft.start, selfCheckIn: 'notAllowed' as const, selfNotRiding: true },
      finish: { ...draft.finish, selfCheckIn: 'allowed' as const },
      pitStops: [{ name: 'Water', location: '', distanceFromStart: '10', estimatedOpenTime: '5', pitStopDuration: '2', selfCheckIn: 'allowed' as const }],
    };
    const payload = ridePayload(explicit);
    expect(payload).toMatchObject({ selfCheckInAllowed: true, selfQuitRidingAllowed: false });
    expect(payload.stages.map((stage) => stage.selfCheckInAllowed)).toEqual([false, true, true]);
    expect(payload.stages[0].selfNotRidingAllowed).toBe(true);
    expect(payload.stages[1].selfNotRidingAllowed).toBeUndefined();
    expect(payload.stages[2].selfNotRidingAllowed).toBeUndefined();
  });

  it('clears an explicitly stored ride policy with null when returned to Default', () => {
    const stored = ride({ selfCheckInAllowed: true, selfQuitRidingAllowed: false });
    const draft = toRideDraft(stored);
    const reset = ridePayload({ ...draft, selfCheckIn: 'default', selfQuitRiding: 'default' });
    expect(reset.selfCheckInAllowed).toBeNull();
    expect(reset.selfQuitRidingAllowed).toBeNull();
    expect(hasExplicitRideSelfServiceValue(stored, 'selfCheckInAllowed')).toBe(true);
    expect(hasExplicitRideSelfServiceValue(ride(), 'selfQuitRidingAllowed')).toBe(false);
  });

  it.each([
    ['missing Start', [pitStop, finish]],
    ['duplicate Start', [start, start, finish]],
    ['misplaced Start', [pitStop, start, finish]],
    ['missing Finish', [start, pitStop]],
    ['duplicate Finish', [start, finish, finish]],
    ['misplaced Finish', [start, finish, pitStop]],
    ['non-pit-stop middle stage', [start, { ...pitStop, type: StageType.START }, finish]],
  ])('detects %s layout and blocks validation', (_label, stages) => {
    const malformed = ride({ stages: stages as Stage[] });
    const issue = getStageLayoutIssue(malformed);
    expect(issue).toBeTruthy();
    const draft = toRideDraft(malformed);
    expect(draft.layoutIssue).toBe(issue);
    expect(validateRide(draft)).toBe(issue);
  });

  it('accepts a valid Start, pit-stop, Finish layout and detects dirty state', () => {
    const draft = toRideDraft(ride());
    const baseline = JSON.stringify(ridePayload(draft));
    expect(getStageLayoutIssue(ride())).toBeNull();
    expect(isRideDirty(draft, baseline)).toBe(false);
    expect(isRideDirty({ ...draft, name: 'Changed' }, baseline)).toBe(true);
  });
});