/**
 * API types for backend communication
 */

import { Rider, Ride, CheckIn, User, Role, CheckInStatus } from './models';

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface CheckInRequest {
  riderId: string;
  rideId: string;
  stageId: string;
  status: CheckInStatus;
  method: 'QR_SCAN' | 'MANUAL' | 'FALLBACK';
  notes?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface CreateRideRequest {
  date: string;
  name: string;
  startLocation: string;
  finishLocation: string;
  totalDistance: number;
  stages: Array<{
    stageNumber: number;
    type: 'START' | 'PIT_STOP' | 'FINISH';
    name: string;
    distanceFromStart?: number;
    estimatedTimeFromStart?: number;
  }>;
  notes?: string;
}

export interface UpdateRideRequest extends Partial<CreateRideRequest> {
  rideId: string;
}

export interface CloseRideRequest {
  rideId: string;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

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
  startDate?: string;
  endDate?: string;
  status?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED';
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

export interface GetDashboardDataQuery {
  rideId: string;
  stageId?: string; // For filtered view
  status?: CheckInStatus;
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
  data: any;
  error: string;
  timestamp: string;
  retryCount: number;
}

export interface PendingCheckIn extends CheckInRequest {
  localId: string;
  createdAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'FAILED';
}
