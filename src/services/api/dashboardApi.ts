/**
 * Dashboard API service for dashboard progress payloads.
 * See docs/DataIntegrationDesign.md §3.2 for response structure.
 */

import { apiClient } from './apiClient';
import { DashboardProgressData } from '../../types/models';
import { USE_MOCK_DATA, getMockDashboardProgressResponse } from './mockData';

/**
 * Get lightweight dashboard progress data for a ride.
 * Returns check-ins + summary only (no ride object, no riders array).
 *
 * @param etag Previous ETag for conditional request (304 optimisation)
 * @returns Progress data, or null if 304 Not Modified
 */
export async function getDashboardProgress(
  tourId: string,
  rideId: string,
  etag?: string,
): Promise<{ data: DashboardProgressData | null; etag?: string }> {
  if (USE_MOCK_DATA) {
    return { data: getMockDashboardProgressResponse(rideId), etag: undefined };
  }

  const headers: Record<string, string> = {};
  if (etag) {
    headers['If-None-Match'] = etag;
  }

  const response = await apiClient.get<DashboardProgressData>(
    `/v1/tours/${tourId}/rides/${rideId}/dashboard/progress`,
    { headers },
  );

  return {
    data: response.data ?? null,
    // ETag extraction can be enabled after apiClient response-header support is added.
    etag: undefined,
  };
}
