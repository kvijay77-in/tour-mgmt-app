import { describe, expect, it } from '@jest/globals';
import { getNotificationNavigationTarget, isAllowedNotificationTargetScreen } from '../notificationRouting';

describe('notificationRouting', () => {
  it('accepts only allowed screens', () => {
    expect(isAllowedNotificationTargetScreen('NOTIFICATIONS')).toBe(true);
    expect(isAllowedNotificationTargetScreen('DASHBOARD')).toBe(true);
    expect(isAllowedNotificationTargetScreen('UNKNOWN')).toBe(false);
  });

  it('falls back to inbox for unknown screens', () => {
    expect(getNotificationNavigationTarget({ screen: 'unknown' })).toEqual({
      route: 'Notifications',
      params: undefined,
    });
  });

  it('maps known screens to app routes', () => {
    expect(getNotificationNavigationTarget({ screen: 'DASHBOARD' })).toEqual({
      route: 'MainTabs',
      params: undefined,
    });
    expect(getNotificationNavigationTarget({ screen: 'EVENTS_HOME' })).toEqual({
      route: 'EventsHome',
      params: undefined,
    });
  });

  it('maps backend compatibility aliases', () => {
    expect(getNotificationNavigationTarget({ screen: 'RideStatus' })).toEqual({
      route: 'MainTabs',
      params: undefined,
    });
    expect(getNotificationNavigationTarget({ screen: 'EVENTS' })).toEqual({
      route: 'EventsHome',
      params: undefined,
    });
  });
});
