import { describe, expect, it } from '@jest/globals';
import {
  getEffectiveActivityEnabled,
  getEffectiveSelfServiceAllowed,
  getEffectiveSelfServiceAllowedWithSource,
} from '../eventActivity';

describe('eventActivity', () => {
  it('treats skipped overrides as disabled', () => {
    expect(getEffectiveActivityEnabled({ enabled: true }, { activityId: 'ACT-001', skipped: true })).toBe(false);
  });

  it('keeps explicit enabled override when not skipped', () => {
    expect(getEffectiveActivityEnabled({ enabled: false }, { activityId: 'ACT-001', enabled: true })).toBe(true);
  });

  it('resolves self-service from override through event and defaults false', () => {
    const values = [undefined, false, true] as const;
    const nullableValues = [undefined, null, false, true] as const;

    for (const eventValue of values) {
      for (const activityValue of values) {
        for (const occurrenceValue of nullableValues) {
          for (const overrideValue of nullableValues) {
            const event = { selfServiceAllowed: eventValue };
            const activity = { selfServiceAllowed: activityValue };
            const occurrence = { selfServiceAllowed: occurrenceValue };
            const override = { activityId: 'ACT-001', selfServiceAllowed: overrideValue };
            const expectedValue = overrideValue ?? occurrenceValue ?? activityValue ?? eventValue ?? false;
            const expectedSource = overrideValue !== undefined && overrideValue !== null
              ? 'override'
              : occurrenceValue !== undefined && occurrenceValue !== null
                ? 'occurrence'
                : activityValue !== undefined
                  ? 'activity'
                  : eventValue !== undefined
                    ? 'event'
                    : 'default';

            expect(getEffectiveSelfServiceAllowed(event, activity, occurrence, override)).toBe(expectedValue);
            expect(getEffectiveSelfServiceAllowedWithSource(event, activity, occurrence, override)).toEqual({
              allowed: expectedValue,
              source: expectedSource,
            });
          }
        }
      }
    }
  });
});
