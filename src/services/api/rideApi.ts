/**
 * Ride API service — endpoints for ride management.
 * See docs/DataIntegrationDesign.md §2.2.
 */

import { apiClient, ApiError } from './apiClient';
import {
  CreateRideRequest,
  GetRidesQuery,
} from '../../types/api';
import { Ride } from '../../types/models';
import { USE_MOCK_DATA, MOCK_RIDE } from './mockData';

function ridesPath(tourId: string): string {
  return `/v1/tours/${tourId}/rides`;
}

/**
 * List rides for a tour, optionally filtered by date or status.
 */
export async function listRides(
  tourId: string,
  query?: GetRidesQuery,
): Promise<Ride[]> {
  const params: Record<string, string> = {};
  if (query?.date) params.date = query.date;
  if (query?.status) params.status = query.status;
  if (query?.limit) params.limit = String(query.limit);
  if (query?.nextToken) params.nextToken = query.nextToken;

  const response = await apiClient.get<{ rides: Ride[] }>(ridesPath(tourId), { params });
  const payload = response.data;
  return Array.isArray(payload) ? payload : (payload?.rides ?? []);
}

/**
 * Get a single ride by ID.
 */
export async function getRideById(
  tourId: string,
  rideId: string,
): Promise<Ride | null> {
  try {
    const response = await apiClient.get<Ride>(
      `${ridesPath(tourId)}/${rideId}`,
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Get today's active ride for the tour.
 * Uses mock data when EXPO_PUBLIC_USE_MOCK_DATA is true.
 */
export async function getActiveRide(tourId: string): Promise<Ride | null> {
  if (USE_MOCK_DATA) {
    return MOCK_RIDE;
  }
  try {
    const response = await apiClient.get<Ride>(
      `${ridesPath(tourId)}/today`,
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      // NO_ACTIVE_RIDE — normal when no ride is scheduled for today
      return null;
    }
    throw error;
  }
}

/**
 * Create a new ride.
 */
export async function createRide(
  tourId: string,
  ride: CreateRideRequest,
): Promise<Ride> {
  const response = await apiClient.post<Ride>(ridesPath(tourId), ride);
  if (!response.data) {
    throw new Error('Unexpected empty response from createRide');
  }
  return response.data;
}

/**
 * Update an existing ride.
 */
export async function updateRide(
  tourId: string,
  rideId: string,
  updates: Partial<CreateRideRequest>,
): Promise<Ride> {
  const response = await apiClient.put<Ride>(
    `${ridesPath(tourId)}/${rideId}`,
    updates,
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from updateRide');
  }
  return response.data;
}

/**
 * Open today's ride.
 * Backend resolves today's ride by UTC date.
 */
export async function openTodayRide(tourId: string): Promise<Ride> {
  const response = await apiClient.post<Ride>(
    `${ridesPath(tourId)}/open`,
    {},
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from openTodayRide');
  }
  return response.data;
}

/**
 * Start today's ride.
 * Backend resolves today's ride by UTC date.
 */
export async function startTodayRide(tourId: string): Promise<Ride> {
  const response = await apiClient.post<Ride>(
    `${ridesPath(tourId)}/start`,
    {},
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from startTodayRide');
  }
  return response.data;
}

/**
 * Close a ride (lock — no further check-ins).
 */
export async function closeRide(
  tourId: string,
  rideId: string,
): Promise<Ride> {
  const response = await apiClient.post<Ride>(
    `${ridesPath(tourId)}/${rideId}/close`,
    {},
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from closeRide');
  }
  return response.data;
}

/**
 * Open a pit-stop stage for the specified ride.
 */
export async function openPitStopStage(
  tourId: string,
  rideId: string,
  stageNumber: number,
): Promise<Ride> {
  const response = await apiClient.post<Ride>(
    `${ridesPath(tourId)}/${rideId}/stages/${stageNumber}/pitstop/open`,
    {},
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from openPitStopStage');
  }
  return response.data;
}

/**
 * Close a pit-stop stage for the specified ride.
 */
export async function closePitStopStage(
  tourId: string,
  rideId: string,
  stageNumber: number,
): Promise<Ride> {
  const response = await apiClient.post<Ride>(
    `${ridesPath(tourId)}/${rideId}/stages/${stageNumber}/pitstop/close`,
    {},
  );
  if (!response.data) {
    throw new Error('Unexpected empty response from closePitStopStage');
  }
  return response.data;
}
