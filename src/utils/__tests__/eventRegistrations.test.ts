import { describe, expect, it } from '@jest/globals';
import { EventRegistration, OccurrenceStatus } from '../../types/models';
import {
  addRegistration,
  filterRegistrations,
  formatRegistrationSource,
  getRegistrableRiders,
  getRegistrationEditState,
  removeRegistration,
} from '../eventRegistrations';

const ITEMS: EventRegistration[] = [
  {
    riderId: 'R12',
    name: 'Ada Lovelace',
    registeredAt: '2026-10-01T09:00:00Z',
    registeredBy: 'staff-1',
    source: 'STAFF',
  },
  {
    riderId: 'R3',
    name: 'Grace Hopper',
    registeredAt: '2026-10-01T10:00:00Z',
    registeredBy: 'rider-3',
    source: 'RIDER',
  },
];

describe('eventRegistrations', () => {
  it('filters by rider ID or name without case sensitivity and sorts by ID', () => {
    expect(filterRegistrations(ITEMS, 'ada').map((item) => item.riderId)).toEqual(['R12']);
    expect(filterRegistrations(ITEMS, 'r3').map((item) => item.riderId)).toEqual(['R3']);
    expect(filterRegistrations(ITEMS, '').map((item) => item.riderId)).toEqual(['R3', 'R12']);
  });

  it('excludes already-registered riders and supports add/remove list updates', () => {
    expect(getRegistrableRiders({ R3: 'Grace Hopper', R12: 'Ada Lovelace', R8: null }, ITEMS)).toEqual([
      { riderId: 'R8', name: 'Unknown' },
    ]);
    const added = addRegistration(ITEMS, {
      riderId: 'R8',
      name: 'Katherine Johnson',
      registeredAt: '2026-10-01T11:00:00Z',
      registeredBy: 'staff-1',
      source: 'STAFF',
    });
    expect(added.map((item) => item.riderId)).toEqual(['R3', 'R8', 'R12']);
    expect(removeRegistration(added, 'R3').map((item) => item.riderId)).toEqual(['R8', 'R12']);
  });

  it('makes editing planned, enabled, online and permission-gated', () => {
    expect(getRegistrationEditState(OccurrenceStatus.PLANNED, true, true, true)).toEqual({
      editable: true,
      notice: null,
    });
    for (const status of [OccurrenceStatus.ACTIVE, OccurrenceStatus.COMPLETED, OccurrenceStatus.CANCELLED]) {
      expect(getRegistrationEditState(status, true, true, true).editable).toBe(false);
    }
    expect(getRegistrationEditState(OccurrenceStatus.PLANNED, false, true, true).editable).toBe(false);
    expect(getRegistrationEditState(OccurrenceStatus.PLANNED, true, false, true).editable).toBe(false);
    expect(getRegistrationEditState(OccurrenceStatus.PLANNED, true, true, false).editable).toBe(false);
  });

  it('formats registration source labels', () => {
    expect(formatRegistrationSource('RIDER')).toBe('Rider');
    expect(formatRegistrationSource('STAFF')).toBe('Staff');
  });
});