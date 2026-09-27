import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../../api/dashboardApi', () => ({ getDashboardProgress: jest.fn() }));
jest.mock('../../database/sentCheckInStore', () => ({ getSentCheckIns: jest.fn(), deleteSentCheckIn: jest.fn() }));
jest.mock('../checkInSync', () => ({ captureCheckInLocally: jest.fn(), LOCAL_QUIT_RIDING_STAGE_NUMBER: -1 }));

import { findMissingOnServer } from '../checkInCrossCheck';
import { SentCheckIn } from '../../database/sentCheckInStore';
import { CheckIn, CheckInMethod } from '../../../types/models';

const timestamp = '2026-09-27T06:10:00.000Z';

function sent(overrides: Partial<SentCheckIn> = {}): SentCheckIn {
  return {
    localId: 'local-1',
    tourId: 'T1',
    rideId: 'RIDE1',
    riderId: 'R1',
    request: { riderId: 'R1', rideId: 'RIDE1', stageNumber: 2, method: CheckInMethod.QR_SCAN, timestamp },
    serverCheckInId: 'R1#002#x',
    ownerUserId: 'sub-1',
    sentAt: timestamp,
    ...overrides,
  };
}

function server(overrides: Partial<CheckIn> = {}): CheckIn {
  return {
    checkInId: 'other',
    riderId: 'R1',
    rideId: 'RIDE1',
    stageNumber: 2,
    stageId: 'S002',
    timestamp,
    checkedInBy: 'sub-1',
    method: CheckInMethod.QR_SCAN,
    isNotRiding: false,
    isQuitRiding: false,
    ...overrides,
  } as CheckIn;
}

describe('findMissingOnServer', () => {
  it('matches by server id', () => {
    expect(findMissingOnServer([sent()], [server({ checkInId: 'R1#002#x', timestamp: 'x' })])).toEqual([]);
  });

  it('matches by capture timestamp and stage', () => {
    expect(findMissingOnServer([sent({ serverCheckInId: 'unknown' })], [server()])).toEqual([]);
  });

  it('reports check-ins the server does not hold', () => {
    const entry = sent();
    expect(findMissingOnServer([entry], [server({ stageNumber: 3, stageId: 'S003' })])).toEqual([entry]);
    expect(findMissingOnServer([entry], [])).toEqual([entry]);
  });

  it('accepts an equivalent record for check-ins reported as duplicates', () => {
    const duplicate = sent({ serverCheckInId: null });
    expect(findMissingOnServer([duplicate], [server({ timestamp: '2026-09-27T06:05:00.000Z' })])).toEqual([]);
  });
});
