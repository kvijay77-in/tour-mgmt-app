import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { deleteNotificationDevice, registerNotificationDevice } from '../api/notificationApi';
import { logger } from '../../utils/logger';

const TAG = 'PushService';
const PUSH_TOKEN_STORAGE_KEY = 'notifications.pushToken';

const IS_WEB = Platform.OS === 'web';

function getEasProjectId(): string | null {
  const expoConfigProjectId = Constants.expoConfig?.extra?.eas?.projectId;
  const easConfigProjectId = Constants.easConfig?.projectId;
  if (typeof expoConfigProjectId === 'string' && expoConfigProjectId) return expoConfigProjectId;
  if (typeof easConfigProjectId === 'string' && easConfigProjectId) return easConfigProjectId;
  return null;
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('urgent', {
    name: 'Urgent',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync('general', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

async function getExpoPushToken(): Promise<string | null> {
  const permission = await Notifications.getPermissionsAsync();
  let finalStatus = permission.status;
  if (finalStatus !== 'granted') {
    const request = await Notifications.requestPermissionsAsync();
    finalStatus = request.status;
  }
  if (finalStatus !== 'granted') {
    logger.info(TAG, 'Notification permission not granted; skipping push token registration');
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    logger.warn(TAG, 'EAS projectId is missing in app.json extra.eas.projectId');
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

export async function registerPushDeviceIfEligible(params: {
  isOffline: boolean;
  isOfflineSession: boolean;
}): Promise<void> {
  if (IS_WEB || params.isOffline || params.isOfflineSession) return;

  try {
    await ensureAndroidChannels();
    const token = await getExpoPushToken();
    if (!token) return;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const outcome = await registerNotificationDevice({ token, platform });
    if (outcome.kind === 'success') {
      await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
      return;
    }
    if (outcome.kind === 'unavailable') {
      logger.info(TAG, 'Notification device registration skipped; backend not available');
      return;
    }
    logger.warn(TAG, 'Notification device registration failed', outcome.error);
  } catch (error) {
    logger.warn(TAG, 'Notification device registration failed unexpectedly', error);
  }
}

export async function unregisterPushDeviceOnLogout(): Promise<void> {
  if (IS_WEB) return;

  const token = await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  if (!token) return;

  try {
    const outcome = await deleteNotificationDevice(token);
    if (outcome.kind === 'error') {
      logger.warn(TAG, 'Push token delete failed', outcome.error);
      return;
    }
  } catch (error) {
    logger.warn(TAG, 'Push token delete failed unexpectedly', error);
  } finally {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  }
}
