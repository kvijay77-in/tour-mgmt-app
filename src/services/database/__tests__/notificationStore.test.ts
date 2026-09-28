import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../database', () => ({
  USE_SESSION_MEMORY: true,
  registerSessionMemoryReset: () => {},
  getDatabase: async () => {
    throw new Error('not used in session-memory tests');
  },
  withWriteTransaction: async () => {
    throw new Error('not used in session-memory tests');
  },
}));

import {
  getCachedNotifications,
  getCachedUnreadNotificationCount,
  markCachedNotificationsRead,
  replaceCachedNotifications,
} from '../notificationStore';
import { NotificationItem } from '../../../types/api';

const ITEMS: NotificationItem[] = [
  {
    notificationId: 'n-1',
    ruleId: 'R1',
    title: 'One',
    body: 'Body one',
    priority: 'NORMAL',
    createdAt: '2026-01-01T10:00:00.000Z',
    isRead: false,
  },
  {
    notificationId: 'n-2',
    ruleId: 'R2',
    title: 'Two',
    body: 'Body two',
    priority: 'URGENT',
    createdAt: '2026-01-02T10:00:00.000Z',
    isRead: false,
  },
];

describe('notificationStore', () => {
  it('marks only items up to readAt cutoff', async () => {
    await replaceCachedNotifications(ITEMS);
    await markCachedNotificationsRead('2026-01-01T23:59:59.999Z');

    const unreadCount = await getCachedUnreadNotificationCount();
    expect(unreadCount).toBe(1);

    const items = await getCachedNotifications(10);
    const one = items.find((item) => item.notificationId === 'n-1');
    const two = items.find((item) => item.notificationId === 'n-2');
    expect(one?.isRead).toBe(true);
    expect(two?.isRead).toBe(false);
  });

  it('marks all items when readAt is omitted', async () => {
    await replaceCachedNotifications(ITEMS);
    await markCachedNotificationsRead();
    expect(await getCachedUnreadNotificationCount()).toBe(0);
  });
});
