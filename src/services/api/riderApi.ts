/**
 * Rider API service — endpoints for rider data.
 * See docs/DataIntegrationDesign.md §2.2.
 */

import { apiClient, ApiError } from './apiClient';
import { EventApiOutcome, run } from './eventsApi';
import { BaggageReleaseRequest, GetRidersQuery, RiderExitRequest } from '../../types/api';
import { DietaryPreference, Rider, RiderDetailsData, TourRider } from '../../types/models';
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

  const payloadObj = payload as Record<string, unknown>;

  const maybeItems = payloadObj['items'];
  if (Array.isArray(maybeItems)) {
    return maybeItems as Rider[];
  }

  const maybeRiders = payloadObj['riders'];
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
 * Get a rider profile's dietaryPreference (GET /v1/riders/profile/{profileId}).
 * Returns undefined when the profile does not exist.
 */
export async function getRiderProfileDietaryPreference(
  profileId: string,
): Promise<DietaryPreference | null | undefined> {
  try {
    const response = await apiClient.get<{ dietaryPreference?: DietaryPreference | null }>(
      `/v1/riders/profile/${encodeURIComponent(profileId)}`,
      { isExpectedError: (error) => error.statusCode === 404 },
    );
    return response.data?.dietaryPreference ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return undefined;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rider exit and baggage release (RIDER_EXIT). Expected 400/403/404/409
// responses are outcomes; each success returns the updated TourRider item.
// ---------------------------------------------------------------------------

function riderPath(tourId: string, riderId: string): string {
  return `/v1/tours/${encodeURIComponent(tourId)}/riders/${encodeURIComponent(riderId)}`;
}

export function exitRider(
  tourId: string,
  riderId: string,
  body: RiderExitRequest,
): Promise<EventApiOutcome<TourRider>> {
  return run<TourRider>((options) => apiClient.post(`${riderPath(tourId, riderId)}/exit`, body, options));
}

export function cancelRiderExit(tourId: string, riderId: string): Promise<EventApiOutcome<TourRider>> {
  return run<TourRider>((options) => apiClient.post(`${riderPath(tourId, riderId)}/exit/cancel`, undefined, options));
}

export function releaseRiderBaggage(
  tourId: string,
  riderId: string,
  body: BaggageReleaseRequest = {},
): Promise<EventApiOutcome<TourRider>> {
  return run<TourRider>((options) =>
    apiClient.post(`${riderPath(tourId, riderId)}/baggage/release`, body, options),
  );
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
