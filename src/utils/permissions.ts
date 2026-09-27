/**
 * RBAC permission utilities.
 *
 * Checks whether a user role grants a specific permission using
 * the ROLES_MAP defined in constants/roles.ts.
 *
 * See docs/Requirements.md § Role Based App Access.
 */

import { Platform } from 'react-native';
import { AppRole, UserRole, Permission } from '../types/models';
import { PIT_STOP_USER_PERMISSIONS, PIT_STOP_USER_ROLE_REGEX, ROLES_MAP } from '../constants/roles';

interface ResolvePrimaryRoleOptions {
  preferredPitStopStageNumber?: number | null;
}

/**
 * Returns true when the role matches PS_x_USER format.
 */
export function isPitStopUserRole(role: string): role is `PS_${number}_USER` {
  return PIT_STOP_USER_ROLE_REGEX.test(role);
}

/**
 * Parse stage number from PS_x_USER role.
 */
export function getStageNumberFromPitStopRole(role: string): number | null {
  const match = PIT_STOP_USER_ROLE_REGEX.exec(role);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Get unique, sorted pit-stop stage numbers from a role list.
 */
export function getPitStopStageNumbersFromRoles(roles: readonly string[]): number[] {
  const numbers = roles
    .map((r) => getStageNumberFromPitStopRole(r))
    .filter((n): n is number => n !== null);

  return [...new Set(numbers)].sort((a, b) => a - b);
}

/**
 * Resolve the effective/primary role using required precedence.
 * Order: ADMINISTRATOR > SUPER_USER > PS_x_USER > HOTEL_STAFF > GUEST
 */
export function resolvePrimaryRole(
  roles: readonly string[],
  options?: ResolvePrimaryRoleOptions,
): AppRole | null {
  if (roles.includes(UserRole.ADMINISTRATOR)) return UserRole.ADMINISTRATOR;
  if (roles.includes(UserRole.SUPER_USER)) return UserRole.SUPER_USER;

  const pitStopRoles = roles.filter((r): r is AppRole => isPitStopUserRole(r));
  if (pitStopRoles.length > 0) {
    const preferredPitStopStageNumber = options?.preferredPitStopStageNumber;

    if (typeof preferredPitStopStageNumber === 'number') {
      const preferredPitStopRole = pitStopRoles.find(
        (role) => getStageNumberFromPitStopRole(role) === preferredPitStopStageNumber,
      );

      if (preferredPitStopRole) {
        return preferredPitStopRole;
      }
    }

    // When multiple pit-stop roles are assigned and no valid context is found,
    // keep selection deterministic by using the first role from token group order.
    return pitStopRoles[0];
  }

  if (roles.includes(UserRole.HOTEL_STAFF)) return UserRole.HOTEL_STAFF;
  if (roles.includes(UserRole.GUEST)) return UserRole.GUEST;

  return null;
}

/**
 * Validate whether a Cognito group string maps to a supported app role.
 */
export function isSupportedRoleGroup(group: string): group is AppRole {
  if (isPitStopUserRole(group)) {
    return true;
  }
  return (Object.values(UserRole) as string[]).includes(group);
}

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: AppRole, permission: Permission): boolean {
  if (isPitStopUserRole(role)) {
    return PIT_STOP_USER_PERMISSIONS.includes(permission);
  }

  const roleDef = ROLES_MAP[role as UserRole];
  return roleDef?.permissions.includes(permission) ?? false;
}

/**
 * Check if a role has ALL of the specified permissions.
 */
export function hasAllPermissions(role: AppRole, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Check if a role has ANY of the specified permissions.
 */
export function hasAnyPermission(role: AppRole, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Advanced (offline sync) settings: mobile only, every role except GUEST.
 */
export function canUseAdvancedSettings(role: AppRole | string | null | undefined, platformOS: string = Platform.OS): boolean {
  return platformOS !== 'web' && Boolean(role) && role !== UserRole.GUEST;
}
