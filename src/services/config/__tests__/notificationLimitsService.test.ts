import { describe, expect, it, jest } from '@jest/globals';
import { DEFAULT_NOTIFICATION_LIMITS, getNotificationLimits } from '../notificationLimitsService';

jest.mock('../../api/configApi', () => ({
  listAppConfigs: jest.fn(),
}));

const { listAppConfigs } = jest.requireMock('../../api/configApi') as {
  listAppConfigs: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
};

describe('notificationLimitsService', () => {
  it('returns configured limits when available', async () => {
    listAppConfigs.mockResolvedValueOnce([
      {
        configType: 'NOTIFICATION',
        configId: 'LIMITS',
        enabled: true,
        config: { maxTitleLength: 90, maxMessageLength: 300, archiveAfterReadHours: 24 },
      },
    ]);

    await expect(getNotificationLimits()).resolves.toEqual({
      maxTitleLength: 90,
      maxMessageLength: 300,
      archiveAfterReadHours: 24,
    });
  });

  it('falls back to defaults when config is missing', async () => {
    listAppConfigs.mockResolvedValueOnce([]);
    await expect(getNotificationLimits()).resolves.toEqual(DEFAULT_NOTIFICATION_LIMITS);
  });
});
