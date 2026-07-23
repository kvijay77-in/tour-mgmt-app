/**
 * Rider API service — endpoints for rider data.
 * See docs/DataIntegrationDesign.md §2.2.
 */

import { apiClient, ApiError } from './apiClient';
import { GetRidersQuery } from '../../types/api';
import { Rider, RiderDetailsData } from '../../types/models';
import { USE_MOCK_DATA, getMockRiderDetailsResponse } from './mockData';

function ridersPath(tourId: string): string {
  return `/v1/tours/${tourId}/riders`;
}

function normalizeRiderListResponse(
  payload: unknown,
): Rider[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const payloadAny = payload as any;

  const maybeItems = payloadAny.items;
  if (Array.isArray(maybeItems)) {
    return maybeItems as Rider[];
  }

  const maybeRiders = payloadAny.riders;
  if (Array.isArray(maybeRiders)) {
    return maybeRiders as Rider[];
  }

  return [];
}

/**
 * List riders for a tour (combined TourRider + RiderProfile data).
 */
export async function listRiders(
  tourId: string,
  query?: GetRidersQuery,
): Promise<Rider[]> {
  const params: Record<string, string> = {};
  if (query?.limit) params.limit = String(query.limit);
  if (query?.nextToken) params.nextToken = query.nextToken;

  const response = await apiClient.get<unknown>(ridersPath(tourId), { params });
  return normalizeRiderListResponse(response.data);
}

/**
 * Get a single rider by ID.
 */
export async function getRiderById(
  tourId: string,
  riderId: string,
): Promise<Rider | null> {
  try {
    const response = await apiClient.get<Rider>(
      `${ridersPath(tourId)}/${riderId}`,
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
 * Get popup-focused rider details and selected-ride timeline.
 */
export async function getRideRiderDetails(
  tourId: string,
  rideId: string,
  riderId: string,
): Promise<RiderDetailsData | null> {
  if (USE_MOCK_DATA) {
    return getMockRiderDetailsResponse(riderId, rideId);
  }

  try {
    const response = await apiClient.get<RiderDetailsData>(
      `/v1/tours/${tourId}/rides/${rideId}/riders/${riderId}/details`,
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}
