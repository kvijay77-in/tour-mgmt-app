/**
 * Data Models for Cycling Tour Management App
 * Based on Requirements.md specifications and tour-data-api backend data model.
 * See docs/DataIntegrationDesign.md for alignment details.
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Tour status values
 * Flow: PLANNING → PROVISIONING → ACTIVE → COMPLETED → ARCHIVED
 */
export enum TourStatus {
  PLANNING = 'PLANNING',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Stage types in a ride
 */
export enum StageType {
  START = 'START',
  PIT_STOP = 'PIT_STOP',
  FINISH = 'FINISH',
}

/**
 * Ride status values
 * Aligned with backend: PLANNED, OPEN, STARTED, COMPLETED, CLOSED
 */
export enum RideStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  OPEN = 'OPEN',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  CLOSED = 'CLOSED',
}

/**
 * Check-in status types
 * 
 * Note: NOT_CHECKED_IN is a UI-only status representing the absence of a check-in record.
 * It is never stored in the database. Only CHECKED_IN, NOT_RIDING, and QUIT_RIDING 
 * are actual database values.
 * 
 * Backend derives status from boolean flags:
 * - isNotRiding=true → NOT_RIDING
 * - isQuitRiding=true → QUIT_RIDING
 * - Both false → CHECKED_IN
 */
export enum CheckInStatus {
  NOT_CHECKED_IN = 'NOT_CHECKED_IN', // UI-only: derived from absence of CheckIn record
  CHECKED_IN = 'CHECKED_IN',
  FLOAT = 'FLOAT',
  NOT_RIDING = 'NOT_RIDING',
  QUIT_RIDING = 'QUIT_RIDING',
}

/**
 * Check-in method values
 */
export enum CheckInMethod {
  QR_SCAN = 'QR_SCAN',
  MANUAL = 'MANUAL',
  FALLBACK = 'FALLBACK',
}

/**
 * Tour rider registration status
 */
export enum TourRiderStatus {
  REGISTERED = 'REGISTERED',
  ACTIVE = 'ACTIVE',
  EXITED = 'EXITED',
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * User roles for RBAC
 */
export enum UserRole {
  ADMINISTRATOR = 'ADMINISTRATOR',
  SUPER_USER = 'SUPER_USER',
  HOTEL_STAFF = 'HOTEL_STAFF',
  GUEST = 'GUEST',
}

/**
 * Dynamic pit-stop role format from Cognito groups.
 * Examples: PS_1_USER, PS_2_USER, PS_10_USER
 */
export type PitStopUserRole = `PS_${number}_USER`;

/**
 * Any role that can be assigned via Cognito groups.
 */
export type AppRole = UserRole | PitStopUserRole;

// ============================================================================
// TOUR
// ============================================================================

/**
 * Tour definition (from shared TourMaster table)
 */
export interface Tour {
  /** Free-form unique identifier (e.g., TOT-2026) */
  tourId: string;

  /** Tour name */
  name: string;

  /** Tour start date (ISO 8601 date) */
  startDate: string;

  /** Tour end date (ISO 8601 date) */
  endDate: string;

  /** Number of ride definitions expected for this tour */
  rideCount: number;

  /** Tour status */
  status: TourStatus;

  /** Tour description */
  description?: string;

  /** Timestamp when tour tables were provisioned */
  provisionedAt?: string;

  /** Timestamp when tour was archived */
  archivedAt?: string;

  /** Created timestamp */
  createdAt: string;

  /** Updated timestamp */
  updatedAt: string;
}

// ============================================================================
// RIDER
// ============================================================================

/**
 * Rider profile information (from shared RiderProfile table)
 * Note: This data is read-only from the app's perspective
 */
export interface RiderProfile {
  /** Unique profile identifier (UUID) */
  profileId: string;

  /** Rider's full name */
  name: string;

  /** Contact email */
  email?: string;

  /** Contact phone */
  phone?: string;

  /** Emergency contact name */
  emergencyContactName?: string;

  /** Emergency contact phone */
  emergencyContactPhone?: string;

  /** S3 object key for rider photo */
  photoS3Key?: string;

  /** Created timestamp */
  createdAt?: string;

  /** Updated timestamp */
  updatedAt?: string;
}

/**
 * Tour-specific rider registration (from TourRider-{tourId} table)
 */
export interface TourRider {
  /** Tour-specific rider ID (e.g., R1, R57) */
  riderId: string;

  /** Reference to RiderProfile */
  profileId: string;

  /** Registration status */
  status: TourRiderStatus;

  /** QR code data (currently just riderId) */
  qrCodeData?: string;

  /** Registration timestamp */
  registeredAt?: string;

  prevStatus?: TourRiderStatus;
  exitedAt?: string;
  exitedBy?: string;
  baggageStatus?: BaggageStatus;
  baggageExitNote?: string;
  baggageExitedAt?: string;
  baggageExitedBy?: string;
  baggageReleasedAt?: string;
  baggageReleasedBy?: string;

  /** Created timestamp */
  createdAt?: string;

  /** Updated timestamp */
  updatedAt?: string;
}

/**
 * Combined rider info returned by dashboard API
 * Merges TourRider and RiderProfile data
 */
export interface Rider {
  /** Tour-specific rider ID (e.g., R1, R57) */
  riderId: string;

  /** Reference to RiderProfile */
  profileId?: string;

  /** Rider's full name */
  name: string;

  /** Contact email */
  email?: string;

  /** Contact phone */
  phone?: string;

  /** Emergency contact name */
  emergencyContactName?: string;

  /** Emergency contact phone */
  emergencyContactPhone?: string;

  /** S3 object key for rider photo */
  photoS3Key?: string;

  /** QR code data (embedded rider info) */
  qrCodeData?: string;

  /** Tour rider registration status */
  status?: string;

  /** Baggage custody state (event engine) */
  baggageStatus?: BaggageStatus;

  /** When retained baggage was released to the rider */
  baggageReleasedAt?: string | null;

  /** Rider profile dietary preference, drives variant defaults */
  dietaryPreference?: DietaryPreference | null;
}

// ============================================================================
// RIDE
// ============================================================================

/**
 * Stage information within a ride
 */
export interface Stage {
  /** Stage ID aligned with zero-based sequence (e.g., S000, S001) */
  stageId: string;
  
  /** Stage number (zero-based: Start is 0) */
  stageNumber: number;
  
  /** Stage type */
  type: StageType;
  
  /** Stage name/label */
  name: string;

  /** Location name */
  location?: string;
  
  /** Distance from start (in km) */
  distanceFromStart?: number;

  /** Planned pit stop opening offset (in minutes) */
  estimatedOpenTime?: number;

  /** Planned pit stop window duration (in minutes) */
  pitStopDuration?: number;

  /** Runtime pit stop status (OPEN/CLOSED) */
  pitStopStatus?: 'OPEN' | 'CLOSED' | null;

  /** Runtime timestamp when pit stop is opened */
  openedAt?: string;

  /** Runtime timestamp when pit stop is closed */
  closedAt?: string;
  
}

export interface FloatDefinition {
  floatNo: number;
  floatToStage: number;
}

/**
 * Daily ride configuration (from Ride-{tourId} table)
 */
export interface Ride {
  /** Unique ride identifier (e.g., RIDE001) */
  rideId: string;
  
  /** Ride date (ISO 8601 format: YYYY-MM-DD) */
  date: string;

  /** Ride sequence number for the day */
  rideNo?: number;
  
  /** Ride name/title (e.g., Day1, Day2) */
  name: string;
  
  /** Starting location */
  startLocation: string;
  
  /** Finish location */
  finishLocation: string;

  /** Optional description */
  description?: string;
  
  /** Total distance (in km) */
  totalDistance: number;

  /** Planned flag-off time */
  flagOffTime?: string;

  /** Planned ride opening time (HH:MM) */
  openTime?: string;

  /** Planned ride closing time (HH:MM) */
  closeTime?: string;
  
  /** List of stages (Start, Pit Stops, Finish) */
  stages: Stage[];

  /** Optional float definitions for riders who join after Start */
  floats?: FloatDefinition[];
  
  /** Ride status */
  status: RideStatus;

  /** Timestamp when ride was opened */
  openedAt?: string;
  
  /** Timestamp when ride was started */
  startedAt?: string;
  
  /** Timestamp when ride was completed */
  completedAt?: string;
  
  /** Timestamp when ride was closed (locked) */
  closedAt?: string;
  
  /** Additional notes */
  notes?: string;

  /** Created timestamp */
  createdAt?: string;

  /** Updated timestamp */
  updatedAt?: string;
}

// ============================================================================
// CHECK-IN
// ============================================================================

/**
 * Check-in record for a rider at a specific stage (from CheckIn-{tourId} table)
 * 
 * Status is derived from boolean flags, not stored directly:
 * - isNotRiding=true → NOT_RIDING
 * - isQuitRiding=true → QUIT_RIDING
 * - Both false → CHECKED_IN
 */
export interface CheckIn {
  /** Unique check-in identifier (format: <riderId>#<stageNumber (3-digit padded)>#<ISO 8601 timestamp>) */
  checkInId: string;
  
  /** Rider ID */
  riderId: string;
  
  /** Ride ID */
  rideId: string;

  /** Stage number (zero-based: Start is 0) */
  stageNumber: number;
  
  /** Stage ID reference */
  stageId: string;
  
  /** Timestamp of check-in (ISO 8601) */
  timestamp: string;
  
  /** User who performed the check-in */
  checkedInBy: string;
  
  /** Check-in method */
  method: CheckInMethod;

  /** True if rider is Not Riding for the day */
  isNotRiding: boolean;

  /** True if rider has Quit Riding */
  isQuitRiding: boolean;

  /** True if rider is floating to a later stage instead of riding from Start */
  isFloat?: boolean;

  /** Float definition number when multiple floats exist for the ride */
  floatNo?: number;

  /** True if check-in was done manually (not via QR scan) */
  isManualEntry?: boolean;
  
  /** Notes/remarks */
  notes?: string;

  /** Timestamp when this check-in was cancelled by an override flow */
  cancelledAt?: string;

  /** User who cancelled this check-in */
  cancelledBy?: string;

  /** Optional backend status field when a cancelled record is materialized explicitly */
  status?: string;

  /** Status the entry held before it was cancelled (only present on cancelled records) */
  prevStatus?: string;
  
  /** Location coordinates (if available) */
  location?: {
    latitude: number;
    longitude: number;
  };

  /** Created timestamp */
  createdAt?: string;

  /**
   * Device-only sync state for check-ins captured on this device and not yet
   * accepted by the backend (undefined once synced / for server records).
   */
  localSyncStatus?: 'PENDING' | 'FAILED';
}

// ============================================================================
// EVENT ENGINE (events, occurrences, activity records, hotels)
// See docs/Event-Engine-Design.md and temp/api-guide.md (Events, Hotels, Users).
// ============================================================================

export enum EventType {
  SINGLE = 'SINGLE',
  REPEATING = 'REPEATING',
}

export enum OccurrenceStatus {
  PLANNED = 'PLANNED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ActivityOutcome {
  COMPLETED = 'COMPLETED',
  OPTED_OUT = 'OPTED_OUT',
  FLAGGED = 'FLAGGED',
}

export type EventRecordMethod = 'QR_SCAN' | 'MANUAL';

export enum BaggageStatus {
  ACTIVE = 'ACTIVE',
  RETAINED = 'RETAINED',
  WITH_RIDER = 'WITH_RIDER',
}

export type BaggageDisposition = BaggageStatus.RETAINED | BaggageStatus.WITH_RIDER;

export type DietaryPreference = 'VEG' | 'NON_VEG';

export interface EventActivity {
  /** ACT-### identifier, unique within its event only */
  activityId: string;
  name: string;
  sequenceNo: number;
  enabled: boolean;
  mandatory: boolean;
  /** Empty means inherit the event's defaultAllowedTypeCodes */
  allowedTypeCodes: string[];
  allowOptOut: boolean;
  prerequisiteActivityIds: string[];
  restrictToAssignedUsers: boolean;
  variantOptions: string[];
  notes: string;
}

export interface EventDefinition {
  /** EVT-... identifier */
  eventId: string;
  eventName: string;
  eventType: EventType;
  location: string;
  sequenceEnforced: boolean;
  defaultAllowedTypeCodes: string[];
  /** Informational only; never changes scan logic */
  allowSelfService: boolean;
  activities: EventActivity[];
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** Absent/null fields inherit the activity or occurrence default. */
export interface ActivityOverride {
  activityId: string;
  enabled?: boolean | null;
  selfServiceEnabled?: boolean | null;
  /** Narrows the activity's effective allowed type codes for this occurrence only */
  allowedTypeCodes?: string[] | null;
  note?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export interface EventOccurrence {
  eventId: string;
  /** YYYY-MM-DD#seq */
  dateSeq: string;
  /** EVT-...#YYYY-MM-DD#seq — contains '#', always URL-encode in paths */
  occurrenceId: string;
  date: string;
  seq: number;
  status: OccurrenceStatus;
  activityOverrides: ActivityOverride[];
  selfServiceEnabled: boolean;
  linkedOccurrenceRef?: string | null;
  restrictToAssignedUsers?: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface EventActivityRecord {
  occurrenceId: string;
  /** <riderId>#<activityId>#<timestamp> — URL-encode in paths */
  recordId: string;
  eventId: string;
  activityId: string;
  activityName: string;
  riderId: string;
  scannedBy?: string;
  timestamp: string;
  method: EventRecordMethod;
  outcome: ActivityOutcome;
  typeCode?: string | null;
  bagLabel?: string | null;
  variantSelected?: string | null;
  hotelId?: string | null;
  syncedAt?: string;
  isFlagged: boolean;
  createdAt?: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
}

export interface Hotel {
  /** HTL-AAA-99 */
  hotelId: string;
  name: string;
  city: string;
  address: string;
  contact?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type RoomAllocationSource = 'MANUAL' | 'UPLOAD';

export interface RoomAllocation {
  stayDate: string;
  riderId: string;
  hotelId: string;
  roomNo: string;
  roomCapacity: number;
  sharingWith: string[];
  source?: RoomAllocationSource;
  uploadId?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface RiderBaggageStatus {
  riderId: string;
  baggageStatus: BaggageStatus;
  baggageReleasedAt: string | null;
}

export interface EventAssignment {
  eventId: string;
  dates: string[] | 'ALL';
}

/** User-{tourId} record. assignedActivityIds is flat and applies to every assigned event (D-P). */
export interface TourUserAssignment {
  userId: string;
  username?: string;
  email?: string;
  name?: string;
  role: string;
  status?: string;
  assignedStage?: number | null;
  hotelId?: string | null;
  eventAssignments?: EventAssignment[] | null;
  assignedActivityIds?: string[] | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

// ============================================================================
// USER & RBAC
// ============================================================================

/**
 * Feature/permission labels for RBAC
 */
export enum Permission {
  // Dashboard
  VIEW_DASHBOARD = 'VIEW_DASHBOARD',
  VIEW_HISTORICAL_DASHBOARD = 'VIEW_HISTORICAL_DASHBOARD',
  
  // Check-in
  CHECKIN_RIDER = 'CHECKIN_RIDER',
  CHECKIN_NOT_RIDING = 'CHECKIN_NOT_RIDING',
  CHECKIN_QUIT_RIDING = 'CHECKIN_QUIT_RIDING',
  MANUAL_CHECKIN = 'MANUAL_CHECKIN',
  
  // Admin features
  ADD_MODIFY_RIDE = 'ADD_MODIFY_RIDE',
  CLOSE_RIDE = 'CLOSE_RIDE',
  MANAGE_USERS = 'MANAGE_USERS',
  MANAGE_ROLES = 'MANAGE_ROLES',
  MANAGE_ARTIFACTS = 'MANAGE_ARTIFACTS',

  // Event engine (backend EVENT_MANAGE, EVENT_OCCURRENCE_MANAGE, EVENT_SCAN, HOTEL_ALLOC_MANAGE, USER_MANAGE, RIDER_EXIT)
  MANAGE_EVENTS = 'MANAGE_EVENTS',
  MANAGE_EVENT_OCCURRENCES = 'MANAGE_EVENT_OCCURRENCES',
  EVENT_SCAN = 'EVENT_SCAN',
  MANAGE_HOTEL_ALLOCATIONS = 'MANAGE_HOTEL_ALLOCATIONS',
  MANAGE_TOUR_USERS = 'MANAGE_TOUR_USERS',
  RIDER_EXIT = 'RIDER_EXIT',
}

/**
 * Role definition with permissions
 */
export interface Role {
  /** Role identifier */
  roleId: string;
  
  /** Role type */
  role: AppRole;
  
  /** Role display name */
  name: string;
  
  /** Role description */
  description: string;
  
  /** List of permissions */
  permissions: Permission[];
  
  /** For Pit Stop Crew: assigned stage number */
  assignedStage?: number;
}

/**
 * Application user
 */
export interface User {
  /** User ID (Cognito sub) */
  userId: string;
  
  /** Username */
  username: string;
  
  /** Email */
  email: string;
  
  /** Full name */
  name: string;
  
  /** Assigned role */
  role: Role;
  
  /** Account status */
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  
  /** Last login timestamp */
  lastLoginAt?: string;
  
  /** Created timestamp */
  createdAt: string;
  
  /** Updated timestamp */
  updatedAt: string;
}

// ============================================================================
// DASHBOARD
// ============================================================================

/**
 * Rider status for dashboard display
 */
export interface RiderStatus {
  /** Rider information */
  rider: Rider;
  
  /** Current ride */
  ride: Ride;
  
  /** Last check-in record */
  lastCheckIn?: CheckIn;
  
  /** Overall status for the ride */
  overallStatus: CheckInStatus;
  
  /** Last stage where rider checked in */
  lastStage?: Stage;
  
  /** Check-in history for the current ride */
  checkInHistory: CheckIn[];
}

/**
 * Dashboard filter options
 */
export interface DashboardFilter {
  /** Filter by stage */
  stageId?: string;
  
  /** Filter by status */
  status?: CheckInStatus;
}

/**
 * Dashboard sort options
 */
export enum DashboardSortOption {
  RIDER_ID = 'RIDER_ID',
  STAGE = 'STAGE',
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Derive CheckInStatus from a CheckIn record's boolean flags.
 * Backend stores isNotRiding/isQuitRiding flags; status is derived.
 * 
 * Note: Business rules prevent both isNotRiding and isQuitRiding from being true
 * simultaneously. If both are somehow set, isNotRiding takes precedence.
 */
export const deriveCheckInStatus = (checkIn: CheckIn): CheckInStatus => {
  if (checkIn.isNotRiding) return CheckInStatus.NOT_RIDING;
  if (checkIn.isQuitRiding) return CheckInStatus.QUIT_RIDING;
  if (checkIn.isFloat) return CheckInStatus.FLOAT;
  return CheckInStatus.CHECKED_IN;
};

export const isCancelledCheckIn = (checkIn: CheckIn): boolean => {
  if (checkIn.status?.toUpperCase() === 'CANCELLED') {
    return true;
  }

  return Boolean(checkIn.cancelledAt || checkIn.cancelledBy);
};

// ============================================================================
// DASHBOARD API RESPONSE
// ============================================================================

/**
 * Dashboard summary statistics returned by the API
 */
export interface DashboardSummary {
  totalRiders: number;
  checkedIn: number;
  notRiding: number;
  quitRiding: number;
  notCheckedIn: number;
}

/**
 * Lightweight dashboard progress payload returned by
 * GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress
 */
export interface DashboardProgressData {
  rideId: string;
  checkIns: CheckIn[];
  /** Cancelled check-in entries for this ride (status=CANCELLED, prevStatus set) */
  cancelled: CheckIn[];
  summary: DashboardSummary;
  dataVersion?: string;
}

/**
 * Rider popup details payload returned by
 * GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details
 */
export interface RiderDetailsData {
  rider: Rider;
  checkInTimeline: CheckIn[];
  latestStatus?: CheckInStatus;
}

