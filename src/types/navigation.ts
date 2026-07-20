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
// Phase 1 adds CheckIn + admin routes (admin routes registered conditionally
// on isAdministrator). ChangePassword is added in Phase 2.
// ============================================================================

export type AppStackParamList = {
  Dashboard: undefined;
  CheckIn: { ride: Ride; managedPitStopStageNumber?: number };
  RideStatusManagement: undefined;
  UserOnboarding: undefined;
  UserEnableDisable: undefined;
  UserDelete: undefined;
  UserModify: undefined;
};
