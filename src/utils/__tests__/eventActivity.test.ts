import { describe, expect, it } from '@jest/globals';
import { getEffectiveActivityEnabled } from '../eventActivity';

describe('eventActivity', () => {
  it('treats skipped overrides as disabled', () => {
    expect(getEffectiveActivityEnabled({ enabled: true }, { activityId: 'ACT-001', skipped: true })).toBe(false);
  });

  it('keeps explicit enabled override when not skipped', () => {
    expect(getEffectiveActivityEnabled({ enabled: false }, { activityId: 'ACT-001', enabled: true })).toBe(true);
  });
});
