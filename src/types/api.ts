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
  EventRegistration,
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
  /** Capture time (ISO 8601) for check-ins recorded offline and synced later */
  timestamp?: string;
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
    selfCheckInAllowed?: boolean;
    selfNotRidingAllowed?: boolean;
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
  selfCheckInAllowed?: boolean | null;
  selfQuitRidingAllowed?: boolean | null;
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
  selfQuitRidingAllowed?: boolean;
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

export interface UpdateRiderProfileRequest {
  definitionsVersion: number;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
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
  registrationEnabled?: boolean;
  selfServiceAllowed?: boolean;
  notificationConfig?: {
    completionNotifyEnabled?: boolean;
    completionRuleId?: string;
    reminderEnabled?: boolean;
    reminderRuleId?: string;
  };
  activities: EventActivityInput[];
}

/** PUT /v1/tours/{tourId}/events/{eventId} */
export type UpdateEventRequest = Partial<Omit<CreateEventRequest, 'eventId'>>;

/** POST /v1/tours/{tourId}/events/{eventId}/occurrences */
export interface CreateOccurrenceRequest {
  date: string;
  seq: number;
  selfServiceAllowed?: boolean | null;
  linkedOccurrenceRef?: string;
}

/** PUT /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId} */
export interface UpdateOccurrenceRequest {
  selfServiceAllowed?: boolean | null;
  linkedOccurrenceRef?: string | null;
}

export interface CancelOccurrenceRequest {
  cancelReason?: string;
}

/** PUT .../activity-overrides — single-activity upsert; null clears one field */
export interface UpsertActivityOverrideRequest {
  activityId: string;
  enabled?: boolean | null;
  selfServiceAllowed?: boolean | null;
  skipped?: boolean | null;
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

export interface EventDashboardRider {
  riderId: string;
  profileId?: string;
  /** TourRiderStatus, e.g. REGISTERED / EXITED */
  status?: string;
  name?: string;
  email?: string;
  phone?: string;
  emergencyContact?: { name?: string; phone?: string; relation?: string | null } | null;
  photoS3Key?: string | null;
  registered?: boolean;
  activities: Array<{ activityId: string; status: DashboardActivityStatus }>;
}

export interface EventDashboardActivitySummary {
  activityId: string;
  completed: number;
  optedOut: number;
  flagged: number;
  pending: number;
}

export interface EventDashboardSummary {
  totalRiders: number;
  registrationEnabled?: boolean;
  registeredCount?: number;
  completedCount: number;
  outstandingMandatoryCount: number;
  optedOutCount: number;
  flaggedCount: number;
  activities: EventDashboardActivitySummary[];
}

export interface OccurrenceDashboardResponse {
  event: EventDefinition;
  occurrence: EventOccurrence;
  riders: EventDashboardRider[];
  records: EventActivityRecord[];
  cancelled: EventActivityRecord[];
  summary: EventDashboardSummary;
}

export interface OccurrenceProgressResponse {
  eventId: string;
  occurrenceId: string;
  records: EventActivityRecord[];
  cancelled: EventActivityRecord[];
  summary: EventDashboardSummary;
  dataVersion?: string | number;
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
    method?: EventRecordMethod;
  }>;
}

export interface ListRegistrationsResponse {
  occurrenceId: string;
  registrationEnabled: boolean;
  count: number;
  items: EventRegistration[];
}

export interface UnregisterResponse {
  occurrenceId: string;
  riderId: string;
  registered: false;
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

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export type NotificationPriority = 'URGENT' | 'NORMAL';

export type NotificationCategory = 'ANNOUNCEMENT' | 'ALERT' | 'PERSONAL' | 'SYSTEM';

export interface NotificationTarget {
  screen: string;
  paramKeys?: string[];
}

export interface NotificationItem {
  notificationId: string;
  ruleId: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  target?: NotificationTarget;
  tourId?: string;
  createdAt: string;
  isRead: boolean;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export interface NotificationUnreadCountResponse {
  unreadCount: number;
}

export interface RegisterNotificationDeviceRequest {
  token: string;
  platform: 'ios' | 'android';
}

export interface MarkNotificationsReadRequest {
  readAt?: string;
}

export interface CreateNotificationRequest {
  ruleId: string;
  tourId?: string;
  context: Record<string, unknown>;
  audiences?: string[];
}

export interface CreateNotificationResponse {
  notificationId: string;
}

export interface NotificationQuietHours {
  from: string;
  to: string;
  tz: string;
}

export interface NotificationRule {
  ruleId: string;
  enabled: boolean;
  category: NotificationCategory;
  audiences: string[];
  titleTemplate: string;
  messageTemplate: string;
  bodyTemplate?: string;
  push: boolean;
  priority: NotificationPriority;
  androidChannel: 'urgent' | 'general';
  target?: NotificationTarget;
  ttlHours: number;
  quietHours?: NotificationQuietHours;
  allowOverride: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export type UpsertNotificationRuleRequest = Omit<NotificationRule, 'updatedAt' | 'updatedBy'>;

export type NotificationReminderType = 'RIDE_CHECKIN_NOT_STARTED' | 'EVENT_CHECKIN_NOT_STARTED';

export interface CreateNotificationReminderRequest {
  reminderType: NotificationReminderType;
  tourId: string;
  rideId?: string;
  eventId?: string;
  occurrenceId?: string;
  ruleId?: string;
}

export interface CreateNotificationReminderResponse {
  notificationId: string;
  targetCount: number;
  riderIds?: string[];
}
