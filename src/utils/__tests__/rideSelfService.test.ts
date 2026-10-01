import { describe, expect, it } from '@jest/globals';
import { Ride, Stage, StageType } from '../../types/models';
import {
  getSelfQuitRidingSource,
  getStageSelfCheckInSource,
  resolveSelfNotRiding,
  resolveSelfQuitRiding,
  resolveStageSelfCheckIn,
  triStateFromBoolean,
  triStateToBoolean,
} from '../rideSelfService';

describe('rideSelfService', () => {
  it('converts tri-state values without serializing Default', () => {
    expect(triStateFromBoolean(undefined)).toBe('default');
    expect(triStateFromBoolean(null)).toBe('default');
    expect(triStateFromBoolean(true)).toBe('allowed');
    expect(triStateFromBoolean(false)).toBe('notAllowed');
    expect(triStateToBoolean('default')).toBeUndefined();
    expect(triStateToBoolean('allowed')).toBe(true);
    expect(triStateToBoolean('notAllowed')).toBe(false);
  });

  it('resolves stage self check-in for all stage, ride and stage-type combinations', () => {
    const values = [undefined, false, true] as const;
    const stageTypes = [StageType.START, StageType.PIT_STOP, StageType.FINISH];

    for (const stageType of stageTypes) {
      for (const stageValue of values) {
        for (const rideValue of values) {
          const stage = { type: stageType, selfCheckInAllowed: stageValue };
          const ride = { selfCheckInAllowed: rideValue };
          const expectedValue = stageValue ?? rideValue ?? stageType !== StageType.PIT_STOP;
          const expectedSource = stageValue !== undefined
            ? 'stage'
            : rideValue !== undefined
              ? 'ride'
              : 'default';

          expect(resolveStageSelfCheckIn(stage, ride)).toBe(expectedValue);
          expect(getStageSelfCheckInSource(stage, ride)).toBe(expectedSource);
        }
      }
    }
  });

  it('resolves Quit Riding from ride, then tour, then false', () => {
    const values = [undefined, false, true] as const;

    for (const rideValue of values) {
      for (const tourValue of values) {
        const ride = { selfQuitRidingAllowed: rideValue };
        const tour = { selfQuitRidingAllowed: tourValue };
        const expectedValue = rideValue ?? tourValue ?? false;
        const expectedSource = rideValue !== undefined ? 'ride' : tourValue !== undefined ? 'tour' : 'default';

        expect(resolveSelfQuitRiding(ride, tour)).toBe(expectedValue);
        expect(getSelfQuitRidingSource(ride, tour)).toBe(expectedSource);
      }
    }
  });

  it('resolves Not Riding only from a Start stage and defaults false', () => {
    const startStage = (selfNotRidingAllowed?: boolean): Stage => ({
      stageId: 'S000',
      stageNumber: 0,
      type: StageType.START,
      name: 'Start',
      selfNotRidingAllowed,
    });
    const rideWithStart = (stage: Stage): Pick<Ride, 'stages'> => ({ stages: [stage] });

    expect(resolveSelfNotRiding(rideWithStart(startStage(true)))).toBe(true);
    expect(resolveSelfNotRiding(rideWithStart(startStage(false)))).toBe(false);
    expect(resolveSelfNotRiding(rideWithStart(startStage()))).toBe(false);
    expect(resolveSelfNotRiding({ stages: [] })).toBe(false);
    expect(resolveSelfNotRiding({ stages: [{ ...startStage(true), type: StageType.PIT_STOP }] })).toBe(false);
  });
});