import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { configureAmplify } from '../amplify';
import { setApiBaseUrl } from '../../services/api/apiClient';
import {
  initBackendRouting,
  restoreReviewerSession,
  routeBackendForLogin,
  setReviewerSessionActive,
} from '../reviewAccess';

jest.mock('../amplify', () => ({ configureAmplify: jest.fn() }));
jest.mock('../../services/api/apiClient', () => ({ setApiBaseUrl: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getStoredFlag = jest.mocked(SecureStore.getItemAsync);
const setStoredFlag = jest.mocked(SecureStore.setItemAsync);
const deleteStoredFlag = jest.mocked(SecureStore.deleteItemAsync);

describe('review backend routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_REVIEW_USERNAME = 'reviewer@example.com';
    process.env.EXPO_PUBLIC_REVIEW_AWS_REGION = 'ap-south-1';
    process.env.EXPO_PUBLIC_REVIEW_AWS_USER_POOL_ID = 'ap-south-1_review';
    process.env.EXPO_PUBLIC_REVIEW_AWS_USER_POOL_WEB_CLIENT_ID = 'review-client';
    process.env.EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL = 'https://review.example.com';
    getStoredFlag.mockResolvedValue(null);
    setStoredFlag.mockResolvedValue(undefined);
    deleteStoredFlag.mockResolvedValue(undefined);
    initBackendRouting({
      orgCode: 'PRIMARY',
      orgName: 'Primary',
      awsRegion: 'ap-south-1',
      userPoolId: 'ap-south-1_primary',
      userPoolClientId: 'primary-client',
      apiBaseUrl: 'https://primary.example.com',
    });
  });

  it('routes a reviewer login to the review backend', () => {
    expect(routeBackendForLogin(' REVIEWER@example.com ')).toBe(true);
    expect(configureAmplify).toHaveBeenCalledWith(expect.objectContaining({
      userPoolId: 'ap-south-1_review',
      userPoolClientId: 'review-client',
    }));
    expect(setApiBaseUrl).toHaveBeenCalledWith('https://review.example.com');
  });

  it('restores the review backend before session checks when the flag is set', async () => {
    getStoredFlag.mockResolvedValue('true');

    await expect(restoreReviewerSession()).resolves.toBe(true);

    expect(configureAmplify).toHaveBeenCalledWith(expect.objectContaining({
      userPoolId: 'ap-south-1_review',
    }));
    expect(setApiBaseUrl).toHaveBeenCalledWith('https://review.example.com');
  });

  it('leaves primary routing unchanged when no reviewer flag is saved', async () => {
    await expect(restoreReviewerSession()).resolves.toBe(false);
    expect(configureAmplify).not.toHaveBeenCalled();
  });

  it('persists the reviewer flag and removes it when cleared', async () => {
    await setReviewerSessionActive(true);
    await setReviewerSessionActive(false);

    expect(setStoredFlag).toHaveBeenCalledWith('review.active', 'true');
    expect(deleteStoredFlag).toHaveBeenCalledWith('review.active');
  });
});
