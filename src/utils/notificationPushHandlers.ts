import { NotificationNavigationTarget, getNotificationNavigationTarget } from './notificationRouting';

export function extractPushPayload(data: unknown): Record<string, unknown> {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

export function resolvePushNavigationTarget(data: unknown): NotificationNavigationTarget {
  const payload = extractPushPayload(data);
  return getNotificationNavigationTarget({
    screen: typeof payload.screen === 'string' ? payload.screen : undefined,
    payload,
  });
}

export function handlePushNotificationReceived(refresh: () => void): void {
  refresh();
}
