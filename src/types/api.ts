/**
 * API types for tour-data-api backend communication.
 * Aligned with tour-data-api REST endpoints.
 * See docs/DataIntegrationDesign.md for API details.
 */

import {
  CheckInStatus,
  CheckInMethod,
  RideStatus,
  TourStatus,
} from './models';

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * Create check-in request body (POST /v1/tours/{tourId}/checkins)
 */
export interface CheckInRequest {
  riderId: string;
  rideId: string;
  stageNumber?: number;
  method: CheckInMethod;
  isNotRiding?: boolean;
  isQuitRiding?: boolean;
  isFloat?: boolean;
  floatNo?: number;
  notes?: string;
}

/**
 * Cancel a prior check-in when a rider overrides a Start-stage decision.
 */
export interface CancelCheckInRequest {
  status: 'CANCELLED';
  prevStatus: CheckInStatus;
}

/**
 * Create ride request body (POST /v1/tours/{tourId}/rides)
 */
export interface CreateRideRequest {
  rideId: string;
  date: string;
  rideNo: number;
  name: string;
  startLocation: string;
  finishLocation: string;
  totalDistance: number;
  flagOffTime: string;
  stages: Array<{
    stageId: string;
    stageNumber: number;
    type: 'START' | 'PIT_STOP' | 'FINISH';
    name: string;
    location?: string;
    distanceFromStart?: number;
    estimatedOpenTime?: number;
    pitStopDuration?: number;
  }>;
  floats?: Array<{
    floatNo: number;
    floatToStage: number;
  }>;
  openTime?: string;
  closeTime?: string;
  description?: string;
}

/**
 * Update ride request body (PUT /v1/tours/{tourId}/rides/{rideId})
 */
export interface UpdateRideRequest extends Partial<CreateRideRequest> {
  rideId: string;
}

/**
 * Close ride request (POST /v1/tours/{tourId}/rides/{rideId}/close)
 */
export interface CloseRideRequest {
  rideId: string;
}

/**
 * Create tour request body (POST /v1/tours)
 */
export interface CreateTourRequest {
  tourId: string;
  name: string;
  startDate: string;
  endDate: string;
  rideCount: number;
  description?: string;
}

/** Update tour definition (PUT /v1/tours/{tourId}). */
export interface UpdateTourRequest extends Partial<CreateTourRequest> {
  tourId: string;
  provisioning?: boolean;
  provisionOnly?: boolean;
}

/** Create and provision a tour (POST /v1/tours). */
export interface ProvisionTourRequest extends CreateTourRequest {
  provisioning: true;
  provisionOnly?: false;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Standard API response envelope from tour-data-api
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

/**
 * Paginated response (for list operations)
 */
export interface PaginatedResponse<T> {
  items: T[];
  nextToken?: string;
  total?: number;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

export interface GetRidersQuery {
  limit?: number;
  nextToken?: string;
}

export interface GetRidesQuery {
  date?: string;
  status?: RideStatus;
  limit?: number;
  nextToken?: string;
}

export interface GetCheckInsQuery {
  rideId: string;
  riderId?: string;
  stageId?: string;
  status?: CheckInStatus;
  limit?: number;
  nextToken?: string;
}

export interface GetToursQuery {
  status?: TourStatus;
}

// ============================================================================
// SYNC TYPES (for offline support)
// ============================================================================

export interface SyncStatus {
  lastSyncTimestamp?: string;
  pendingChanges: number;
  isSyncing: boolean;
  syncErrors: SyncError[];
}

export interface SyncError {
  id: string;
  operation: 'CHECK_IN' | 'CREATE_RIDE' | 'UPDATE_RIDE';
  data: unknown;
  error: string;
  timestamp: string;
  retryCount: number;
}

export interface PendingCheckIn extends CheckInRequest {
  localId: string;
  createdAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'FAILED';
}

// ============================================================================
// ARTIFACT TYPES
// ============================================================================

/**
 * Artifact manifest item returned from list operations.
 */
export interface ArtifactManifestItem {
  artifactId: string;
  s3Key: string;
  version: number;
  contentType: string;
  sizeBytes?: number;
  uploadedAt?: string;
  title?: string;
  downloadUrl?: string;
}

/**
 * Request body for presigning a file upload.
 */
export interface PresignUploadRequest {
  tourId: string;
  rideId?: string;
  artifactId: string;
  contentType: string;
  fileName?: string;
}

/**
 * Response from presign endpoint includes the upload URL and persisted metadata.
 */
export interface PresignUploadResponse {
  uploadUrl: string;
  artifact: ArtifactManifestItem;
}

/**
 * Query parameters for fetching artifact manifests.
 */
export interface ArtifactQuery {
  artifactId?: string;
  expiresIn?: number; // 60..3600, default 900
}
