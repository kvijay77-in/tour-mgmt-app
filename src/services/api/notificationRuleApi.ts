import { ApiError, apiClient, isNetworkError } from './apiClient';
import { NotificationRule, UpsertNotificationRuleRequest } from '../../types/api';

const EXPECTED_STATUSES = new Set([400, 403, 404, 409, 501]);

export interface NotificationRuleApiError {
  status: number;
  code: string;
  message: string;
}

export type NotificationRuleApiOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; error: NotificationRuleApiError }
  | { kind: 'unavailable'; status: 404 | 501; message: string };

function isExpected(error: ApiError): boolean {
  return EXPECTED_STATUSES.has(error.statusCode);
}

function toError(error: ApiError): NotificationRuleApiError {
  return {
    status: error.statusCode,
    code: error.errorCode?.toUpperCase() ?? '',
    message: error.message.startsWith('HTTP ')
      ? 'Notification rule request failed.'
      : error.message,
  };
}

async function run<T>(
  request: () => Promise<T>,
): Promise<NotificationRuleApiOutcome<T>> {
  try {
    return { kind: 'success', data: await request() };
  } catch (error) {
    if (error instanceof ApiError && isExpected(error)) {
      if (error.statusCode === 404 || error.statusCode === 501) {
        return { kind: 'unavailable', status: error.statusCode, message: 'Notification rules are not available yet.' };
      }
      return { kind: 'error', error: toError(error) };
    }
    throw error;
  }
}

function extractRules(payload: unknown): NotificationRule[] {
  if (Array.isArray(payload)) return payload as NotificationRule[];
  const record = payload as { items?: unknown } | null;
  return Array.isArray(record?.items) ? (record.items as NotificationRule[]) : [];
}

export function describeUnexpectedNotificationRuleError(error: unknown): string {
  if (isNetworkError(error)) return 'Unable to reach the server. Please check your internet connection.';
  if (error instanceof ApiError) return 'Notification rule request failed. Please try again.';
  return 'Unexpected notification rule error. Please try again.';
}

export function listNotificationRules(): Promise<NotificationRuleApiOutcome<NotificationRule[]>> {
  return run(async () => {
    const response = await apiClient.get<unknown>('/v1/admin/notification-rules', {
      isExpectedError: isExpected,
    });
    return extractRules(response.data);
  });
}

export function getNotificationRule(ruleId: string): Promise<NotificationRuleApiOutcome<NotificationRule>> {
  return run(async () => {
    const response = await apiClient.get<NotificationRule>(
      `/v1/admin/notification-rules/${encodeURIComponent(ruleId)}`,
      { isExpectedError: isExpected },
    );
    if (!response.data) {
      throw new Error('Notification rule response is empty.');
    }
    return response.data;
  });
}

export function createNotificationRule(
  body: UpsertNotificationRuleRequest,
): Promise<NotificationRuleApiOutcome<NotificationRule>> {
  return run(async () => {
    const response = await apiClient.post<NotificationRule>('/v1/admin/notification-rules', body, {
      isExpectedError: isExpected,
    });
    if (!response.data) {
      throw new Error('Notification rule create response is empty.');
    }
    return response.data;
  });
}

export function updateNotificationRule(
  ruleId: string,
  body: UpsertNotificationRuleRequest,
): Promise<NotificationRuleApiOutcome<NotificationRule>> {
  return run(async () => {
    const response = await apiClient.put<NotificationRule>(
      `/v1/admin/notification-rules/${encodeURIComponent(ruleId)}`,
      body,
      { isExpectedError: isExpected },
    );
    if (!response.data) {
      throw new Error('Notification rule update response is empty.');
    }
    return response.data;
  });
}

export function deleteNotificationRule(ruleId: string): Promise<NotificationRuleApiOutcome<null>> {
  return run(async () => {
    await apiClient.delete(`/v1/admin/notification-rules/${encodeURIComponent(ruleId)}`, {
      isExpectedError: isExpected,
    });
    return null;
  });
}
