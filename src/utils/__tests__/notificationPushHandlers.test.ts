import { describe, expect, it, jest } from '@jest/globals';
import {
  extractPushPayload,
  handlePushNotificationReceived,
  resolvePushNavigationTarget,
} from '../notificationPushHandlers';

describe('notificationPushHandlers', () => {
  it('extracts push payload object safely', () => {
    expect(extractPushPayload({ screen: 'DASHBOARD' })).toEqual({ screen: 'DASHBOARD' });
    expect(extractPushPayload('bad')).toEqual({});
  });

  it('resolves navigation target from push payload', () => {
    expect(resolvePushNavigationTarget({ screen: 'EVENTS_HOME' })).toEqual({
      route: 'EventsHome',
      params: undefined,
    });
    expect(resolvePushNavigationTarget({ screen: 'UNKNOWN' })).toEqual({
      route: 'Notifications',
      params: undefined,
    });
  });

  it('runs refresh handler when notification is received', () => {
    const refresh = jest.fn();
    handlePushNotificationReceived(refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
