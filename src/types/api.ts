/**
 * API types for tour-data-api backend communication.
 * Aligned with tour-data-api REST endpoints.
 * See docs/DataIntegrationDesign.md for API details.
 */

import {
  ActivityOutcome,
  ActivityOverride,
  BaggageDisposition,
  CheckInStatus,
  CheckInMethod,
  EventActivity,
  EventActivityRecord,
  EventAssignment,
  EventDefinition,
  EventOccurrence,
  EventRecordMethod,
  EventType,
  RideStatus,
  RiderBaggageStatus,
  RoomAllocation,
  Tour,
  TourStatus,
  TourUserAssignment,
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

/** PUT /v1/tours/{tourId}/provision — provisionedTables lists only tables created by this call. */
export interface ReprovisionTourResponse {
  tour: Tour;
  provisionedTables: string[];
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

// ============================================================================
// EVENT ENGINE TYPES (temp/api-guide.md Events, Hotels, Users)
// ============================================================================

export type EventActivityInput = Pick<EventActivity, 'activityId' | 'name' | 'sequenceNo'> &
  Partial<Omit<EventActivity, 'activityId' | 'name' | 'sequenceNo'>>;

/** POST /v1/tours/{tourId}/events */
export interface CreateEventRequest {
  eventId: string;
  eventName: string;
  eventType: EventType;
  location: string;
  sequenceEnforced: boolean;
  defaultAllowedTypeCodes: string[];
  allowSelfService?: boolean;
  activities: EventActivityInput[];
}

/** PUT /v1/tours/{tourId}/events/{eventId} */
export type UpdateEventRequest = Partial<Omit<CreateEventRequest, 'eventId'>>;

/** POST /v1/tours/{tourId}/events/{eventId}/occurrences */
export interface CreateOccurrenceRequest {
  date: string;
  seq: number;
  selfServiceEnabled?: boolean;
  linkedOccurrenceRef?: string;
}

/** PUT /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId} */
export interface UpdateOccurrenceRequest {
  selfServiceEnabled?: boolean;
  linkedOccurrenceRef?: string | null;
}

export interface CancelOccurrenceRequest {
  cancelReason?: string;
}

/** PUT .../activity-overrides — single-activity upsert; null clears one field */
export interface UpsertActivityOverrideRequest {
  activityId: string;
  enabled?: boolean | null;
  selfServiceEnabled?: boolean | null;
  allowedTypeCodes?: string[] | null;
  note?: string | null;
}

export interface ActivityOverridesResponse {
  items: ActivityOverride[];
}

/** POST .../complete returns the occurrence plus the outstanding count */
export interface OccurrenceCompleteResponse extends EventOccurrence {
  outstandingMandatoryCount: number;
}

/** POST .../records */
export interface CreateActivityRecordRequest {
  activityId: string;
  riderId: string;
  method: EventRecordMethod;
  timestamp: string;
  /** Required unless outcome is OPTED_OUT */
  typeCode?: string;
  outcome?: ActivityOutcome.COMPLETED | ActivityOutcome.OPTED_OUT;
  variantSelected?: string;
}

export interface CancelActivityRecordRequest {
  cancelReason?: string;
}

export type DashboardActivityStatus = 'PENDING' | ActivityOutcome;

export interface OccurrenceDashboardResponse {
  occurrence: EventOccurrence;
  riders: Array<{
    riderId: string;
    activities: Array<{ activityId: string; status: DashboardActivityStatus }>;
  }>;
  cancelled: EventActivityRecord[];
}

export interface OccurrenceProgressResponse {
  totalRiders: number;
  completedCount: number;
  outstandingMandatoryCount: number;
  optedOutCount: number;
  flaggedCount: number;
}

export interface ReconciliationResponse {
  loadedCount: number;
  unloadedCount: number;
  missingRiderIds: string[];
}

export interface RiderEventProgressResponse {
  items: Array<{
    eventId: string;
    occurrenceId: string;
    activityId: string;
    status: DashboardActivityStatus;
  }>;
}

/** GET /v1/tours/{tourId}/events/bootstrap (ETag/304) */
export interface EventBootstrapResponse {
  events: EventDefinition[];
  /** PLANNED/ACTIVE occurrences dated today or later */
  activeOccurrences: EventOccurrence[];
  riderBaggageStatus: RiderBaggageStatus[];
  hotelStaysToday: RoomAllocation[];
}

export interface CreateHotelRequest {
  hotelId: string;
  name: string;
  city: string;
  address: string;
  contact?: string;
  notes?: string;
}

export type UpdateHotelRequest = Partial<Omit<CreateHotelRequest, 'hotelId'>>;

/** PUT /v1/tours/{tourId}/hotelstays/{stayDate}/{riderId} */
export interface UpsertHotelStayRequest {
  hotelId: string;
  roomNo: string;
  roomCapacity?: number;
  sharingWith?: string[];
  checkInDate?: string;
  checkOutDate?: string;
}

/** POST /v1/tours/{tourId}/hotelstays/uploads/presign */
export interface HotelUploadPresignResponse {
  uploadId: string;
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export type HotelUploadStatusValue = 'PENDING' | 'VALIDATING' | 'REJECTED' | 'APPLIED';

export interface UploadErrorItem {
  /** Line number in the source file; 0 = whole file */
  row: number;
  code: string;
  message: string;
}

export interface HotelUploadStatus {
  uploadId: string;
  status: HotelUploadStatusValue;
  rowCount?: number | null;
  errorCount?: number | null;
  /** Capped at backend maxStoredErrors; errorCount is the total */
  errors?: UploadErrorItem[];
  appliedCount?: number | null;
  processedAt?: string | null;
}

/** POST /v1/tours/{tourId}/riders/{riderId}/exit */
export interface RiderExitRequest {
  baggageDisposition: BaggageDisposition;
  note?: string;
}

export interface BaggageReleaseRequest {
  note?: string;
}

/** POST /v1/tours/{tourId}/users */
export interface CreateTourUserRequest {
  userId: string;
  role: string;
  status?: string;
  assignedStage?: number | null;
  hotelId?: string | null;
  eventAssignments?: EventAssignment[] | null;
  assignedActivityIds?: string[] | null;
}

/** PUT /v1/tours/{tourId}/users/{userId} — only supplied fields change; null removes */
export type UpdateTourUserRequest = Partial<Omit<CreateTourUserRequest, 'userId'>> & {
  username?: string;
  email?: string;
  name?: string;
};

export interface TourUsersResponse {
  users: TourUserAssignment[];
  count: number;
  tourId: string;
}
