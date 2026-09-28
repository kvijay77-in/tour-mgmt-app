import { NotificationCategory } from '../types/api';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'ANNOUNCEMENT',
  'ALERT',
  'PERSONAL',
  'SYSTEM',
];

export const NOTIFICATION_PRIORITIES: Array<'URGENT' | 'NORMAL'> = [
  'URGENT',
  'NORMAL',
];

export const NOTIFICATION_ANDROID_CHANNELS: Array<'urgent' | 'general'> = [
  'urgent',
  'general',
];

export function isNotificationCategory(value: string): value is NotificationCategory {
  return NOTIFICATION_CATEGORIES.includes(value as NotificationCategory);
}

export function isNotificationPriority(value: string): value is 'URGENT' | 'NORMAL' {
  return NOTIFICATION_PRIORITIES.includes(value as 'URGENT' | 'NORMAL');
}

export function isNotificationAndroidChannel(value: string): value is 'urgent' | 'general' {
  return NOTIFICATION_ANDROID_CHANNELS.includes(value as 'urgent' | 'general');
}
