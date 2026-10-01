import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../database', () => ({
  USE_SESSION_MEMORY: true,
  registerSessionMemoryReset: () => {},
  getDatabase: async () => {
    throw new Error('not used in row-mapping tests');
  },
}));

import { mapRowToEvent, mapRowToOccurrence } from '../eventStore';

describe('eventStore row mapping', () => {
  it('keeps legacy cached event details readable when policy columns are absent', () => {
    const event = mapRowToEvent({
      eventId: 'EVT-OLD',
      eventName: 'Legacy event',
      eventType: 'SINGLE',
      location: 'Town hall',
      sequenceEnforced: 1,
      defaultAllowedTypeCodesJson: '["BAG"]',
      activitiesJson: '[{"activityId":"ACT-001","name":"Load","sequenceNo":1}]',
    });

    expect(event).toMatchObject({
      eventId: 'EVT-OLD',
      eventName: 'Legacy event',
      registrationEnabled: false,
      selfServiceAllowed: false,
      activities: [{ activityId: 'ACT-001', name: 'Load' }],
    });
  });

  it('maps policy columns on current event and occurrence rows', () => {
    const event = mapRowToEvent({
      eventId: 'EVT-NEW',
      eventName: 'Current event',
      eventType: 'REPEATING',
      sequenceEnforced: 0,
      registrationEnabled: 1,
      selfServiceAllowed: 1,
      activitiesJson: '[]',
    });
    const occurrence = mapRowToOccurrence({
      occurrenceId: 'EVT-NEW#2026-10-01#1',
      eventId: 'EVT-NEW',
      date: '2026-10-01',
      seq: 1,
      status: 'PLANNED',
      selfServiceAllowed: 0,
      activityOverridesJson: '[{"activityId":"ACT-001","selfServiceAllowed":true}]',
    });

    expect(event.registrationEnabled).toBe(true);
    expect(event.selfServiceAllowed).toBe(true);
    expect(occurrence.selfServiceAllowed).toBe(false);
    expect(occurrence.activityOverrides).toEqual([{ activityId: 'ACT-001', selfServiceAllowed: true }]);
  });
});