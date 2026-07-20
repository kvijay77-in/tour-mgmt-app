/**
 * Navigation types for React Navigation
 *
 * See docs/SolutionDesign.md § Navigation Structure and
 * /memories/repo/spa-to-multiscreen-migration-plan.md for the phased rollout.
 */

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
// Phase 0 only registers Dashboard. CheckIn/ChangePassword/admin routes are
// added in later migration phases.
// ============================================================================

export type AppStackParamList = {
  Dashboard: undefined;
};
