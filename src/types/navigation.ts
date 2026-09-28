/**
 * Navigation types for React Navigation
 *
 * See docs/SolutionDesign.md § Navigation Structure and
 * /memories/repo/spa-to-multiscreen-migration-plan.md for the phased rollout.
 */

import { Ride } from './models';

// ============================================================================
// AUTH STACK — rendered by src/navigation/AuthNavigator.tsx
// ============================================================================

export type AuthStackParamList = {
  Login: { prefillUsername?: string; externalError?: string } | undefined;
  ForgotPassword: { username?: string } | undefined;
  NewPassword: { username: string; rememberMe: boolean };
};

// ============================================================================
// APP STACK (authenticated) — rendered by src/navigation/AppNavigator.tsx
//
// Phase 1 added CheckIn + admin routes (admin routes registered conditionally
// on isAdministrator). Phase 2 adds ChangePassword.
// ============================================================================

export type AppStackParamList = {
  Home: undefined;
  MainTabs: undefined;
  RideInfo: { ride: Ride; source?: 'dashboard' | 'menu' };
  ChangePassword: undefined;
  /** Unsent / failed data captured on this device (offline sync) */
  SyncStatus: undefined;
  /** Per-device offline sync settings (mobile, non-GUEST) */
  AdvancedSettings: undefined;
  Artifacts: undefined;
  RideStatusManagement: undefined;
  UserOnboarding: undefined;
  UserEnableDisable: undefined;
  UserDelete: undefined;
  UserModify: undefined;
  TourManagement: { readOnly: boolean };
  // Event engine Phase 3
  EventsHome: undefined;
  EventDefinitionList: undefined;
  EventDefinitionEditor: { eventId?: string; mode?: 'view' | 'edit' } | undefined;
  OccurrenceManagement: { eventId: string };
  // Event engine Phase 4
  EventScan: { eventId: string; occurrenceId: string };
  // Event engine Phase 5
  OccurrenceDashboard: { eventId: string; occurrenceId: string };
  BaggageReconciliation: { eventId: string; occurrenceId: string };
  /** eventId/occurrenceId focus the view (dashboard drill-down) */
  RiderProgress: { riderId: string; eventId?: string; occurrenceId?: string };
  // Event engine Phase 6
  HotelManagement: undefined;
  HotelAllocationUpload: undefined;
  HotelAllocationAdjust: { riderId: string; stayDate: string };
  // Event engine Phase 7
  RiderExit: undefined;
  TourUserAssignment: { userId?: string } | undefined;
  RiderProfileDefinitions: undefined;
  Notifications: undefined;
  NotificationAnnounce: undefined;
  NotificationRules: undefined;
};

// Phase 2: Main tab navigator (Dashboard, CheckIn, Log)
export type MainTabParamList = {
  Dashboard: undefined;
  CheckIn: undefined;
  Log: undefined;
};
