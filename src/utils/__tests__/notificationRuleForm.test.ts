import { describe, expect, it } from '@jest/globals';
import {
  isNotificationAndroidChannel,
  isNotificationCategory,
  isNotificationPriority,
} from '../notificationRuleForm';

describe('notificationRuleForm helpers', () => {
  it('validates allowed categories', () => {
    expect(isNotificationCategory('ANNOUNCEMENT')).toBe(true);
    expect(isNotificationCategory('SYSTEM')).toBe(true);
    expect(isNotificationCategory('CUSTOM')).toBe(false);
  });

  it('validates allowed priorities', () => {
    expect(isNotificationPriority('URGENT')).toBe(true);
    expect(isNotificationPriority('NORMAL')).toBe(true);
    expect(isNotificationPriority('LOW')).toBe(false);
  });

  it('validates allowed android channels', () => {
    expect(isNotificationAndroidChannel('urgent')).toBe(true);
    expect(isNotificationAndroidChannel('general')).toBe(true);
    expect(isNotificationAndroidChannel('silent')).toBe(false);
  });
});
