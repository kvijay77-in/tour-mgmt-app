/**
 * Tour API service — endpoints for tour management.
 * See docs/DataIntegrationDesign.md §2.2 and §2.4.
 */

import { apiClient, ApiError } from './apiClient';
import { Tour } from '../../types/models';
import {
  CreateTourRequest,
  ProvisionTourRequest,
  UpdateTourRequest,
} from '../../types/api';
import { USE_MOCK_DATA, MOCK_TOUR } from './mockData';

const TOURS_PATH = '/v1/tours';

function extractTours(payload: unknown): Tour[] {
  if (Array.isArray(payload)) return payload as Tour[];

  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.tours)) return record.tours as Tour[];
  if (Array.isArray(record.items)) return record.items as Tour[];
  if (Array.isArray(record.data)) return record.data as Tour[];

  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>;
    if (Array.isArray(data.tours)) return data.tours as Tour[];
    if (Array.isArray(data.items)) return data.items as Tour[];
  }

  return [];
}

/**
 * Get the currently active tour.
 * Uses mock data when EXPO_PUBLIC_USE_MOCK_DATA is true.
 */
export async function getActiveTour(): Promise<Tour | null> {
  if (USE_MOCK_DATA) {
    return MOCK_TOUR;
  }
  try {
    const response = await apiClient.get<Tour>(`${TOURS_PATH}/active`);
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      // NO_ACTIVE_TOUR — normal when no tour is currently active
      return null;
    }
    throw error;
  }
}

/**
 * Get a tour by ID.
 */
export async function getTourById(tourId: string): Promise<Tour | null> {
  try {
    const response = await apiClient.get<Tour>(`${TOURS_PATH}/${tourId}`);
    return response.data ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * List all tours, optionally filtered by status.
 */
export async function listTours(
  status?: string,
): Promise<Tour[]> {
  const params: Record<string, string> = {};
  if (status) params.status = status;

  const response = await apiClient.get<unknown>(`${TOURS_PATH}`, { params });
  return extractTours(response.data);
}

/** Create a tour definition. */
export async function createTour(request: CreateTourRequest): Promise<Tour> {
  const response = await apiClient.post<Tour>(TOURS_PATH, request);
  if (!response.data) {
    throw new Error('Unexpected empty response from createTour');
  }
  return response.data;
}

/** Update a tour definition or provision an existing tour. */
export async function updateTour(
  tourId: string,
  updates: UpdateTourRequest,
): Promise<Tour> {
  const response = await apiClient.put<Tour>(`${TOURS_PATH}/${tourId}`, updates);
  if (!response.data) {
    throw new Error('Unexpected empty response from updateTour');
  }
  return response.data;
}

/** Create and provision a tour in one operation. */
export async function provisionTour(request: ProvisionTourRequest): Promise<Tour> {
  const response = await apiClient.post<Tour>(TOURS_PATH, request);
  if (!response.data) {
    throw new Error('Unexpected empty response from provisionTour');
  }
  return response.data;
}
