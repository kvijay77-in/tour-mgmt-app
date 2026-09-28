import { ApiError, apiClient, isNetworkError } from './apiClient';
import {
  CreateNotificationRequest,
  CreateNotificationResponse,
  MarkNotificationsReadRequest,
  NotificationUnreadCountResponse,
  NotificationsResponse,
  RegisterNotificationDeviceRequest,
} from '../../types/api';

const EXPECTED_STATUSES = new Set([400, 403, 404, 409, 501]);

export interface NotificationApiError {
  status: number;
  code: string;
  message: string;
}

export type NotificationApiOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; error: NotificationApiError }
  | { kind: 'unavailable'; status: 404 | 501; message: string };

function toApiError(error: ApiError): NotificationApiError {
  return {
    status: error.statusCode,
    code: error.errorCode?.toUpperCase() ?? '',
    message: error.message.startsWith('HTTP ')
      ? 'Notification request failed.'
      : error.message,
  };
}

function isExpected(error: ApiError): boolean {
  return EXPECTED_STATUSES.has(error.statusCode);
}

async function run<T>(
  request: () => Promise<T>,
): Promise<NotificationApiOutcome<T>> {
  try {
    return { kind: 'success', data: await request() };
  } catch (error) {
    if (error instanceof ApiError && isExpected(error)) {
      if (error.statusCode === 404 || error.statusCode === 501) {
        return { kind: 'unavailable', status: error.statusCode, message: 'Notifications are not available yet.' };
      }
      return { kind: 'error', error: toApiError(error) };
    }
    throw error;
  }
}

export function isNotificationUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 501);
}

export function describeUnexpectedNotificationError(error: unknown): string {
  if (isNetworkError(error)) return 'Unable to reach the server. Please check your internet connection.';
  if (error instanceof ApiError) return 'Notification request failed. Please try again.';
  return 'Unexpected notification error. Please try again.';
}

export function registerNotificationDevice(
  body: RegisterNotificationDeviceRequest,
): Promise<NotificationApiOutcome<null>> {
  return run(async () => {
    await apiClient.post('/v1/notifications/devices', body, {
      isExpectedError: isExpected,
    });
    return null;
  });
}

export function deleteNotificationDevice(
  token: string,
): Promise<NotificationApiOutcome<null>> {
  return run(async () => {
    await apiClient.delete(`/v1/notifications/devices/${encodeURIComponent(token)}`, {
      isExpectedError: isExpected,
    });
    return null;
  });
}

export function getNotifications(params?: {
  since?: string;
  limit?: number;
}): Promise<NotificationApiOutcome<NotificationsResponse>> {
  return run(async () => {
    const response = await apiClient.get<NotificationsResponse>('/v1/notifications', {
      isExpectedError: isExpected,
      params: {
        ...(params?.since ? { since: params.since } : {}),
        ...(typeof params?.limit === 'number' ? { limit: String(params.limit) } : {}),
      },
    });
    return response.data ?? { items: [], unreadCount: 0 };
  });
}

export function getUnreadNotificationCount(): Promise<NotificationApiOutcome<number>> {
  return run(async () => {
    const response = await apiClient.get<NotificationUnreadCountResponse>('/v1/notifications/unread-count', {
      isExpectedError: isExpected,
    });
    return response.data?.unreadCount ?? 0;
  });
}

export function markNotificationsRead(
  body: MarkNotificationsReadRequest = {},
): Promise<NotificationApiOutcome<null>> {
  return run(async () => {
    await apiClient.put('/v1/notifications/read', body, {
      isExpectedError: isExpected,
    });
    return null;
  });
}

export function createNotification(
  body: CreateNotificationRequest,
): Promise<NotificationApiOutcome<CreateNotificationResponse>> {
  return run(async () => {
    const response = await apiClient.post<CreateNotificationResponse>('/v1/notifications', body, {
      isExpectedError: isExpected,
    });
    if (!response.data) {
      throw new Error('Notification create response is empty.');
    }
    return response.data;
  });
}
