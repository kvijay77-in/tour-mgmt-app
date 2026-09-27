import { describe, expect, it } from '@jest/globals';
import { evaluateCheckInAgainstHistory, resolveStageNumber } from '../checkInValidation';
import { CheckInRequest } from '../../types/api';
import { CheckIn, CheckInMethod } from '../../types/models';

let sequence = 0;
function checkIn(overrides: Partial<CheckIn> = {}): CheckIn {
  sequence += 1;
  return {
    checkInId: `R1#000#${sequence}`,
    riderId: 'R1',
    rideId: 'RIDE1',
    stageNumber: 0,
    stageId: 'S000',
    timestamp: new Date(Date.UTC(2026, 8, 27, 6, sequence)).toISOString(),
    checkedInBy: 'sub-1',
    method: CheckInMethod.QR_SCAN,
    isNotRiding: false,
    isQuitRiding: false,
    ...overrides,
  } as CheckIn;
}

function request(overrides: Partial<CheckInRequest> = {}): CheckInRequest {
  return { riderId: 'R1', rideId: 'RIDE1', stageNumber: 1, method: CheckInMethod.QR_SCAN, ...overrides };
}

describe('evaluateCheckInAgainstHistory', () => {
  it('allows a first check-in', () => {
    expect(evaluateCheckInAgainstHistory(request(), [])).toBeNull();
  });

  it('blocks a duplicate regular check-in at the same stage', () => {
    const result = evaluateCheckInAgainstHistory(request(), [checkIn({ stageNumber: 1, stageId: 'S001' })]);
    expect(result).toMatchObject({ kind: 'info_conflict', reason: 'duplicate' });
  });

  it('ignores cancelled check-ins', () => {
    const cancelled = checkIn({ stageNumber: 1, stageId: 'S001', status: 'CANCELLED' } as Partial<CheckIn>);
    expect(evaluateCheckInAgainstHistory(request(), [cancelled])).toBeNull();
  });

  it('blocks check-ins after Quit Riding', () => {
    const result = evaluateCheckInAgainstHistory(request({ stageNumber: 2 }), [checkIn({ isQuitRiding: true })]);
    expect(result).toMatchObject({ kind: 'info_conflict', reason: 'quit_riding' });
  });

  it('requires an override to change a Start-stage decision', () => {
    const result = evaluateCheckInAgainstHistory(request({ stageNumber: 0, isNotRiding: true }), [checkIn()]);
    expect(result).toMatchObject({ kind: 'override_required', reason: 'start_regular_exists' });
  });

  it('blocks a second Float check-in', () => {
    const result = evaluateCheckInAgainstHistory(
      request({ stageNumber: 0, isFloat: true }),
      [checkIn({ isFloat: true } as Partial<CheckIn>)],
    );
    expect(result).toMatchObject({ kind: 'info_conflict', reason: 'duplicate' });
  });
});

describe('resolveStageNumber', () => {
  it('reads numeric, string and stageId forms', () => {
    expect(resolveStageNumber(checkIn({ stageNumber: 3 }))).toBe(3);
    expect(resolveStageNumber(checkIn({ stageNumber: '4' as unknown as number }))).toBe(4);
    expect(resolveStageNumber(checkIn({ stageNumber: undefined as unknown as number, stageId: 'S005' }))).toBe(5);
  });
});
