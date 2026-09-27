/**
 * Tour user API — tour-scoped User-{tourId} records (caller's own record,
 * list/create/update for MANAGE_TOUR_USERS). See temp/api-guide.md § Users.
 */

import { apiClient, ApiError } from './apiClient';
import { EventApiOutcome, run } from './eventsApi';
import { CreateTourUserRequest, UpdateTourUserRequest } from '../../types/api';
import { TourUserAssignment } from '../../types/models';

function tourUsersPath(tourId: string): string {
  return `/v1/tours/${encodeURIComponent(tourId)}/users`;
}

function extractUsers(payload: unknown): TourUserAssignment[] {
  if (Array.isArray(payload)) return payload as TourUserAssignment[];
  const record = payload as { users?: unknown; items?: unknown } | null;
  if (Array.isArray(record?.users)) return record.users as TourUserAssignment[];
  if (Array.isArray(record?.items)) return record.items as TourUserAssignment[];
  return [];
}

/** GET /v1/tours/{tourId}/users (?role). */
export function listTourUsers(tourId: string, role?: string): Promise<EventApiOutcome<TourUserAssignment[]>> {
  return run<unknown, TourUserAssignment[]>(
    (options) => apiClient.get(tourUsersPath(tourId), { ...options, params: role ? { role } : undefined }),
    extractUsers,
  );
}

export function createTourUser(
  tourId: string,
  body: CreateTourUserRequest,
): Promise<EventApiOutcome<TourUserAssignment>> {
  return run<TourUserAssignment>((options) => apiClient.post(tourUsersPath(tourId), body, options));
}

/** Only supplied fields change; a field sent as null is removed. */
export function updateTourUser(
  tourId: string,
  userId: string,
  body: UpdateTourUserRequest,
): Promise<EventApiOutcome<TourUserAssignment>> {
  return run<TourUserAssignment>((options) =>
    apiClient.put(`${tourUsersPath(tourId)}/${encodeURIComponent(userId)}`, body, options),
  );
}

/**
 * GET /v1/tours/{tourId}/users/me. Returns null for 404 USER_NOT_FOUND
 * (no tour record = no assignment). Other failures throw.
 */
export async function getMyTourUser(tourId: string): Promise<TourUserAssignment | null> {
  try {
    const response = await apiClient.get<TourUserAssignment>(
      `/v1/tours/${encodeURIComponent(tourId)}/users/me`,
      { isExpectedError: (error) => error.statusCode === 404 },
    );
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}
