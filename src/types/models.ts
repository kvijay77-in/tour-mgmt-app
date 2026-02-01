/**
 * Data Models for Cycling Tour Management App
 * Based on Requirements.md specifications
 */

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Stage types in a ride
 */
export enum StageType {
  START = 'START',
  PIT_STOP = 'PIT_STOP',
  FINISH = 'FINISH',
}

/**
 * Check-in status types
 * 
 * Note: NOT_CHECKED_IN is a UI-only status representing the absence of a check-in record.
 * It is never stored in the database. Only CHECKED_IN, NOT_RIDING, and QUIT_RIDING 
 * are actual database values.
 */
export enum CheckInStatus {
  NOT_CHECKED_IN = 'NOT_CHECKED_IN', // UI-only: derived from absence of CheckIn record
  CHECKED_IN = 'CHECKED_IN',
  NOT_RIDING = 'NOT_RIDING',
  QUIT_RIDING = 'QUIT_RIDING',
}

/**
 * User roles for RBAC
 */
export enum UserRole {
  ADMINISTRATOR = 'ADMINISTRATOR',
  SUPER_USER = 'SUPER_USER',
  PIT_STOP_CREW = 'PIT_STOP_CREW',
  HOTEL_STAFF = 'HOTEL_STAFF',
  GUEST = 'GUEST',
}

// ============================================================================
// RIDER
// ============================================================================

/**
 * Rider profile information
 * Note: This data is read-only from the app's perspective
 */
export interface Rider {
  /** Unique rider identifier */
  riderId: string;
  
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
  
  /** QR code data (embedded rider info) */
  qrCodeData: string;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

// ============================================================================
// RIDE
// ============================================================================

/**
 * Stage information within a ride
 */
export interface Stage {
  /** Stage ID */
  stageId: string;
  
  /** Stage number (1-based) */
  stageNumber: number;
  
  /** Stage type */
  type: StageType;
  
  /** Stage name/location */
  name: string;
  
  /** Distance from start (in km) */
  distanceFromStart?: number;
  
  /** Estimated time from start (in minutes) */
  estimatedTimeFromStart?: number;
}

/**
 * Daily ride configuration
 */
export interface Ride {
  /** Unique ride identifier */
  rideId: string;
  
  /** Ride date (ISO 8601 format: YYYY-MM-DD) */
  date: string;
  
  /** Ride name/title */
  name: string;
  
  /** Starting location */
  startLocation: string;
  
  /** Finish location */
  finishLocation: string;
  
  /** Total distance (in km) */
  totalDistance: number;
  
  /** List of stages (Start, Pit Stops, Finish) */
  stages: Stage[];
  
  /** Ride status */
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
  
  /** Timestamp when ride was started */
  startedAt?: string;
  
  /** Timestamp when ride was completed */
  completedAt?: string;
  
  /** Timestamp when ride was closed (locked) */
  closedAt?: string;
  
  /** Additional notes */
  notes?: string;
}

// ============================================================================
// CHECK-IN
// ============================================================================

/**
 * Check-in record for a rider at a specific stage
 */
export interface CheckIn {
  /** Unique check-in identifier */
  checkInId: string;
  
  /** Rider ID */
  riderId: string;
  
  /** Ride ID */
  rideId: string;
  
  /** Stage ID */
  stageId: string;
  
  /** Check-in status (excludes NOT_CHECKED_IN - only stored values) */
  status: Exclude<CheckInStatus, CheckInStatus.NOT_CHECKED_IN>;
  
  /** Timestamp of check-in (ISO 8601) */
  timestamp: string;
  
  /** User who performed the check-in */
  checkedInBy: string;
  
  /** Check-in method */
  method: 'QR_SCAN' | 'MANUAL' | 'FALLBACK';
  
  /** Notes/remarks */
  notes?: string;
  
  /** Location coordinates (if available) */
  location?: {
    latitude: number;
    longitude: number;
  };
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
}

/**
 * Role definition with permissions
 */
export interface Role {
  /** Role identifier */
  roleId: string;
  
  /** Role type */
  role: UserRole;
  
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
