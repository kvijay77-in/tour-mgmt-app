import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { CommonActions } from '@react-navigation/native';
import { useAuth } from './AuthContext';
import { useOffline } from './OfflineContext';
import { NotificationItem } from '../types/api';
import { logger } from '../utils/logger';
import {
  describeUnexpectedNotificationError,
  getNotifications,
  markNotificationsRead,
} from '../services/api/notificationApi';
import {
  getCachedNotifications,
  getCachedUnreadNotificationCount,
  markCachedNotificationsRead,
  replaceCachedNotifications,
} from '../services/database/notificationStore';
import { registerPushDeviceIfEligible } from '../services/push/pushService';
import { navigationRef } from '../navigation/navigationRef';
import { getNotificationNavigationTarget } from '../utils/notificationRouting';
import { handlePushNotificationReceived, resolvePushNavigationTarget } from '../utils/notificationPushHandlers';

const TAG = 'NotificationContext';
const DEFAULT_LIMIT = 100;
const IS_WEB = Platform.OS === 'web';

interface NotificationContextValue {
  items: NotificationItem[];
  unreadCount: number;
  isLoading: boolean;
  isBackendAvailable: boolean;
  refresh: () => Promise<void>;
  markAllRead: (readAt?: string) => Promise<void>;
  openTarget: (item: NotificationItem) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  items: [],
  unreadCount: 0,
  isLoading: false,
  isBackendAvailable: true,
  refresh: async () => {},
  markAllRead: async () => {},
  openTarget: () => {},
});

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackendAvailable, setIsBackendAvailable] = useState(true);

  const loadCache = useCallback(async (): Promise<void> => {
    const [cachedItems, cachedUnreadCount] = await Promise.all([
      getCachedNotifications(DEFAULT_LIMIT),
      getCachedUnreadNotificationCount(),
    ]);
    setItems(cachedItems);
    setUnreadCount(cachedUnreadCount);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user) return;
    setIsLoading(true);
    try {
      const outcome = await getNotifications({ limit: DEFAULT_LIMIT });
      if (outcome.kind === 'success') {
        setItems(outcome.data.items);
        setUnreadCount(outcome.data.unreadCount);
        setIsBackendAvailable(true);
        await replaceCachedNotifications(outcome.data.items);
        return;
      }
      if (outcome.kind === 'unavailable') {
        setIsBackendAvailable(false);
        await loadCache();
        return;
      }
      setIsBackendAvailable(true);
      logger.warn(TAG, 'Notification API returned an expected error', outcome.error);
      await loadCache();
    } catch (error) {
      setIsBackendAvailable(true);
      logger.warn(TAG, describeUnexpectedNotificationError(error));
      await loadCache();
    } finally {
      setIsLoading(false);
    }
  }, [loadCache, user]);

  const markAllRead = useCallback(async (readAt?: string): Promise<void> => {
    if (!user) return;

    let canApplyLocalRead = false;
    try {
      const outcome = await markNotificationsRead(readAt ? { readAt } : {});
      if (outcome.kind === 'error') {
        logger.warn(TAG, 'Mark-read failed', outcome.error);
        return;
      }
      if (outcome.kind === 'unavailable') {
        setIsBackendAvailable(false);
        return;
      }
      setIsBackendAvailable(true);
      canApplyLocalRead = true;
    } catch (error) {
      logger.warn(TAG, describeUnexpectedNotificationError(error));
      return;
    }

    if (!canApplyLocalRead) return;
    await markCachedNotificationsRead(readAt);
    const effectiveReadAt = readAt ?? new Date().toISOString();
    setItems((prev) => {
      const next = prev.map((item) => (
        item.createdAt <= effectiveReadAt ? { ...item, isRead: true } : item
      ));
      setUnreadCount(next.filter((item) => !item.isRead).length);
      return next;
    });
  }, [user]);

  const openTarget = useCallback((item: NotificationItem) => {
    if (!navigationRef.isReady()) return;
    const payload: Record<string, unknown> = {
      ...(item as unknown as Record<string, unknown>),
    };
    const target = getNotificationNavigationTarget({
      screen: item.target?.screen,
      payload,
    });
    navigationRef.dispatch(CommonActions.navigate(target.route, target.params));
  }, []);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      setIsBackendAvailable(true);
      return;
    }
    void loadCache();
    if (!isOffline) {
      void refresh();
    }
  }, [isOffline, loadCache, refresh, user]);

  useEffect(() => {
    if (!user) return;
    void registerPushDeviceIfEligible({
      isOffline,
      isOfflineSession: Boolean(user.isOfflineSession),
    });
  }, [isOffline, user]);

  useEffect(() => {
    if (!user) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !isOffline) {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [isOffline, refresh, user]);

  useEffect(() => {
    if (!user || IS_WEB) return;
    const received = Notifications.addNotificationReceivedListener(() => {
      handlePushNotificationReceived(() => {
        void refresh();
      });
    });
    const response = Notifications.addNotificationResponseReceivedListener((event) => {
      const target = resolvePushNavigationTarget(event.notification.request.content.data);
      if (!navigationRef.isReady()) return;
      navigationRef.dispatch(CommonActions.navigate(target.route, target.params));
    });
    return () => {
      received.remove();
      response.remove();
    };
  }, [refresh, user]);

  const value = useMemo<NotificationContextValue>(() => ({
    items,
    unreadCount,
    isLoading,
    isBackendAvailable,
    refresh,
    markAllRead,
    openTarget,
  }), [isBackendAvailable, isLoading, items, markAllRead, openTarget, refresh, unreadCount]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
