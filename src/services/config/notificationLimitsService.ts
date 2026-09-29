import { listAppConfigs } from '../api/configApi';
import { logger } from '../../utils/logger';

const TAG = 'notificationLimitsService';

export interface NotificationLimits {
  maxTitleLength: number;
  maxMessageLength: number;
  archiveAfterReadHours: number;
}

export const DEFAULT_NOTIFICATION_LIMITS: NotificationLimits = {
  maxTitleLength: 120,
  maxMessageLength: 500,
  archiveAfterReadHours: 48,
};

function toPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export async function getNotificationLimits(): Promise<NotificationLimits> {
  try {
    const configs = await listAppConfigs(['NOTIFICATION']);
    const limits = configs.find((item) => item.configId.toUpperCase() === 'LIMITS');
    const source = limits?.config as Record<string, unknown> | undefined;
    if (!source) return DEFAULT_NOTIFICATION_LIMITS;
    return {
      maxTitleLength: toPositiveNumber(source.maxTitleLength, DEFAULT_NOTIFICATION_LIMITS.maxTitleLength),
      maxMessageLength: toPositiveNumber(source.maxMessageLength, DEFAULT_NOTIFICATION_LIMITS.maxMessageLength),
      archiveAfterReadHours: toPositiveNumber(
        source.archiveAfterReadHours,
        DEFAULT_NOTIFICATION_LIMITS.archiveAfterReadHours,
      ),
    };
  } catch (error) {
    logger.warn(TAG, 'Unable to load NOTIFICATION/LIMITS config; using defaults', error);
    return DEFAULT_NOTIFICATION_LIMITS;
  }
}
