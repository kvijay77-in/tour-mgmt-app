import { AppStackParamList } from '../types/navigation';

export type NotificationTargetScreen =
  | 'NOTIFICATIONS'
  | 'DASHBOARD'
  | 'RIDE_INFO'
  | 'EVENTS_HOME'
  | 'HOTEL_MANAGEMENT';

const ALLOWED_TARGET_SCREENS: NotificationTargetScreen[] = [
  'NOTIFICATIONS',
  'DASHBOARD',
  'RIDE_INFO',
  'EVENTS_HOME',
  'HOTEL_MANAGEMENT',
];

export function isAllowedNotificationTargetScreen(screen: string): screen is NotificationTargetScreen {
  return ALLOWED_TARGET_SCREENS.includes(screen as NotificationTargetScreen);
}

export type NotificationNavigationTarget = {
  [K in keyof AppStackParamList]: { route: K; params: AppStackParamList[K] };
}[keyof AppStackParamList];

export function getNotificationNavigationTarget(params: {
  screen?: string;
  payload?: Record<string, unknown>;
}): NotificationNavigationTarget {
  const normalizedScreen = params.screen?.trim().toUpperCase();
  if (!normalizedScreen || !isAllowedNotificationTargetScreen(normalizedScreen)) {
    return { route: 'Notifications', params: undefined };
  }

  switch (normalizedScreen) {
    case 'NOTIFICATIONS':
      return { route: 'Notifications', params: undefined };
    case 'DASHBOARD':
      return { route: 'MainTabs', params: undefined };
    case 'EVENTS_HOME':
      return { route: 'EventsHome', params: undefined };
    case 'HOTEL_MANAGEMENT':
      return { route: 'HotelManagement', params: undefined };
    case 'RIDE_INFO': {
      const ride = params.payload?.ride;
      if (ride && typeof ride === 'object') {
        return { route: 'RideInfo', params: { ride: ride as AppStackParamList['RideInfo']['ride'] } };
      }
      return { route: 'Notifications', params: undefined };
    }
    default:
      return { route: 'Notifications', params: undefined };
  }
}
