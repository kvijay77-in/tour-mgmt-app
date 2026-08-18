/**
 * Artifact API service — endpoints for artifact management.
 * See docs/tour-artifacts-handling-design.md §4 and temp/api-guide.md.
 */

import { apiClient } from './apiClient';
import {
  ArtifactManifestItem,
  PresignUploadRequest,
  PresignUploadResponse,
  ArtifactQuery,
} from '../../types/api';
import { logger } from '../../utils/logger';

const TAG = 'ArtifactApi';

// ============================================================================
// Path helpers
// ============================================================================

function tourArtifactsPath(tourId: string): string {
  return `/v1/tours/${tourId}/artifacts`;
}

function rideArtifactsPath(tourId: string, rideId: string): string {
  return `/v1/tours/${tourId}/rides/${rideId}/artifacts`;
}

function tourArtifactPath(tourId: string, artifactId: string): string {
  return `/v1/artifacts/tour/${tourId}/${artifactId}`;
}

function rideArtifactPath(tourId: string, rideId: string, artifactId: string): string {
  return `/v1/artifacts/ride/${tourId}/${rideId}/${artifactId}`;
}

function tourPresignPath(): string {
  return '/v1/artifacts/tour/presign-upload';
}

function ridePresignPath(): string {
  return '/v1/artifacts/ride/presign-upload';
}

// ============================================================================
// List artifacts
// ============================================================================

/**
 * List artifacts for a tour.
 * @param tourId Tour ID
 * @param query Optional query parameters (artifactId, expiresIn)
 * @returns Array of artifact manifest items; empty if none
 */
export async function listTourArtifacts(
  tourId: string,
  query?: ArtifactQuery,
): Promise<ArtifactManifestItem[]> {
  try {
    const params: Record<string, string> = {};
    if (query?.artifactId) params.artifactId = query.artifactId;
    if (query?.expiresIn) params.expiresIn = String(query.expiresIn);

    const response = await apiClient.get<ArtifactManifestItem[]>(
      tourArtifactsPath(tourId),
      { params },
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    logger.error(TAG, 'listTourArtifacts failed', {
      tourId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * List artifacts for a ride.
 * @param tourId Tour ID
 * @param rideId Ride ID
 * @param query Optional query parameters (artifactId, expiresIn)
 * @returns Array of artifact manifest items; empty if none
 */
export async function listRideArtifacts(
  tourId: string,
  rideId: string,
  query?: ArtifactQuery,
): Promise<ArtifactManifestItem[]> {
  try {
    const params: Record<string, string> = {};
    if (query?.artifactId) params.artifactId = query.artifactId;
    if (query?.expiresIn) params.expiresIn = String(query.expiresIn);

    const response = await apiClient.get<ArtifactManifestItem[]>(
      rideArtifactsPath(tourId, rideId),
      { params },
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    logger.error(TAG, 'listRideArtifacts failed', {
      tourId,
      rideId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Presign uploads
// ============================================================================

/**
 * Presign a tour artifact upload.
 * Metadata is written server-side at presign time.
 * @param req Presign request with tourId, artifactId, contentType
 * @returns Upload URL and persisted artifact metadata
 */
export async function presignTourUpload(
  req: PresignUploadRequest,
): Promise<PresignUploadResponse> {
  try {
    if (!req.tourId) throw new Error('tourId is required');
    if (!req.artifactId) throw new Error('artifactId is required');
    if (!req.contentType) throw new Error('contentType is required');

    const response = await apiClient.post<PresignUploadResponse>(
      tourPresignPath(),
      req,
    );
    if (!response.data) {
      throw new Error('Unexpected empty response from presignTourUpload');
    }
    return response.data;
  } catch (error) {
    logger.error(TAG, 'presignTourUpload failed', {
      tourId: req.tourId,
      artifactId: req.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Presign a ride artifact upload.
 * Metadata is written server-side at presign time.
 * @param req Presign request with tourId, rideId, artifactId, contentType
 * @returns Upload URL and persisted artifact metadata
 */
export async function presignRideUpload(
  req: PresignUploadRequest,
): Promise<PresignUploadResponse> {
  try {
    if (!req.tourId) throw new Error('tourId is required');
    if (!req.rideId) throw new Error('rideId is required for ride artifact');
    if (!req.artifactId) throw new Error('artifactId is required');
    if (!req.contentType) throw new Error('contentType is required');

    const response = await apiClient.post<PresignUploadResponse>(
      ridePresignPath(),
      req,
    );
    if (!response.data) {
      throw new Error('Unexpected empty response from presignRideUpload');
    }
    return response.data;
  } catch (error) {
    logger.error(TAG, 'presignRideUpload failed', {
      tourId: req.tourId,
      rideId: req.rideId,
      artifactId: req.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Delete artifacts
// ============================================================================

/**
 * Delete a tour artifact.
 * @param tourId Tour ID
 * @param artifactId Artifact ID
 */
export async function deleteTourArtifact(
  tourId: string,
  artifactId: string,
): Promise<void> {
  try {
    if (!tourId) throw new Error('tourId is required');
    if (!artifactId) throw new Error('artifactId is required');

    await apiClient.delete(tourArtifactPath(tourId, artifactId));
  } catch (error) {
    logger.error(TAG, 'deleteTourArtifact failed', {
      tourId,
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete a ride artifact.
 * @param tourId Tour ID
 * @param rideId Ride ID
 * @param artifactId Artifact ID
 */
export async function deleteRideArtifact(
  tourId: string,
  rideId: string,
  artifactId: string,
): Promise<void> {
  try {
    if (!tourId) throw new Error('tourId is required');
    if (!rideId) throw new Error('rideId is required');
    if (!artifactId) throw new Error('artifactId is required');

    await apiClient.delete(rideArtifactPath(tourId, rideId, artifactId));
  } catch (error) {
    logger.error(TAG, 'deleteRideArtifact failed', {
      tourId,
      rideId,
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
