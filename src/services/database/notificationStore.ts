import { NotificationItem } from '../../types/api';
import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY, withWriteTransaction } from './database';

const memoryItems = new Map<string, NotificationItem>();
registerSessionMemoryReset(() => memoryItems.clear());

function sortByCreatedAtDesc(items: NotificationItem[]): NotificationItem[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mapRowToNotification(row: Record<string, unknown>): NotificationItem {
  let target: NotificationItem['target'];
  if (typeof row.targetJson === 'string' && row.targetJson) {
    try {
      target = JSON.parse(row.targetJson) as NotificationItem['target'];
    } catch {
      target = undefined;
    }
  }

  return {
    notificationId: row.notificationId as string,
    ruleId: row.ruleId as string,
    title: row.title as string,
    body: row.body as string,
    priority: row.priority as NotificationItem['priority'],
    target,
    tourId: typeof row.tourId === 'string' ? row.tourId : undefined,
    createdAt: row.createdAt as string,
    isRead: Number(row.isRead) === 1,
  };
}

export async function replaceCachedNotifications(items: NotificationItem[]): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memoryItems.clear();
    for (const item of items) {
      memoryItems.set(item.notificationId, item);
    }
    return;
  }

  await withWriteTransaction(async (db) => {
    await db.runAsync('DELETE FROM notifications_inbox');
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO notifications_inbox
          (notificationId, ruleId, title, body, priority, targetJson, tourId, createdAt, isRead)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.notificationId,
          item.ruleId,
          item.title,
          item.body,
          item.priority,
          item.target ? JSON.stringify(item.target) : null,
          item.tourId ?? null,
          item.createdAt,
          item.isRead ? 1 : 0,
        ],
      );
    }
  });
}

export async function getCachedNotifications(limit = 50): Promise<NotificationItem[]> {
  if (USE_SESSION_MEMORY) {
    return sortByCreatedAtDesc([...memoryItems.values()]).slice(0, Math.max(1, limit));
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT notificationId, ruleId, title, body, priority, targetJson, tourId, createdAt, isRead
       FROM notifications_inbox
      ORDER BY createdAt DESC
      LIMIT ?`,
    [Math.max(1, limit)],
  );
  return rows.map(mapRowToNotification);
}

export async function getCachedUnreadNotificationCount(): Promise<number> {
  if (USE_SESSION_MEMORY) {
    return [...memoryItems.values()].filter((item) => !item.isRead).length;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM notifications_inbox WHERE isRead = 0',
  );
  return row?.c ?? 0;
}

export async function markCachedNotificationsRead(readAt?: string): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memoryItems.forEach((item, key) => {
      if (!readAt || item.createdAt <= readAt) {
        memoryItems.set(key, { ...item, isRead: true });
      }
    });
    return;
  }

  await withWriteTransaction(async (db) => {
    if (readAt) {
      await db.runAsync('UPDATE notifications_inbox SET isRead = 1 WHERE createdAt <= ?', [readAt]);
      return;
    }
    await db.runAsync('UPDATE notifications_inbox SET isRead = 1');
  });
}
