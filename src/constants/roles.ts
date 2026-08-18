/**
 * Role definitions with permissions for RBAC
 */

import { UserRole, Permission, Role } from '../types/models';

/**
 * Administrator role - Full access to all features
 */
export const ADMINISTRATOR_ROLE: Role = {
  roleId: 'role_admin',
  role: UserRole.ADMINISTRATOR,
  name: 'Administrator',
  description: 'Full unrestricted access to all features and functions',
  permissions: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_HISTORICAL_DASHBOARD,
    Permission.CHECKIN_RIDER,
    Permission.CHECKIN_NOT_RIDING,
    Permission.CHECKIN_QUIT_RIDING,
    Permission.MANUAL_CHECKIN,
    Permission.ADD_MODIFY_RIDE,
    Permission.CLOSE_RIDE,
    Permission.MANAGE_USERS,
    Permission.MANAGE_ROLES,
    Permission.MANAGE_ARTIFACTS,
  ],
};

/**
 * Super User role - All access except ride management
 */
export const SUPER_USER_ROLE: Role = {
  roleId: 'role_super_user',
  role: UserRole.SUPER_USER,
  name: 'Super User',
  description: 'Access to all features except Add/Modify and Close Ride',
  permissions: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_HISTORICAL_DASHBOARD,
    Permission.CHECKIN_RIDER,
    Permission.CHECKIN_NOT_RIDING,
    Permission.CHECKIN_QUIT_RIDING,
    Permission.MANUAL_CHECKIN,
  ],
};

/**
 * Dynamic PS_x_USER role pattern.
 */
export const PIT_STOP_USER_ROLE_REGEX = /^PS_(\d+)_USER$/;

/**
 * Base permissions for dynamic PS_x_USER roles.
 * PS roles allow regular and quit-riding check-ins, but not Not Riding.
 */
export const PIT_STOP_USER_PERMISSIONS: Permission[] = [
  Permission.VIEW_DASHBOARD,
  Permission.CHECKIN_RIDER,
  Permission.CHECKIN_QUIT_RIDING,
];

/**
 * Hotel Staff role - Finish check-in only, no dashboard access
 */
export const HOTEL_STAFF_ROLE: Role = {
  roleId: 'role_hotel_staff',
  role: UserRole.HOTEL_STAFF,
  name: 'Hotel Staff',
  description: 'Finish stage check-in only, no dashboard access',
  permissions: [
    Permission.CHECKIN_RIDER,
    // Dashboard access explicitly not included
  ],
};

/**
 * Guest role - Read-only dashboard access
 */
export const GUEST_ROLE: Role = {
  roleId: 'role_guest',
  role: UserRole.GUEST,
  name: 'Guest',
  description: 'Read-only dashboard access to view ride progress',
  permissions: [
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_HISTORICAL_DASHBOARD,
  ],
};

/**
 * Map of all available roles
 */
export const ROLES_MAP: Record<UserRole, Role> = {
  [UserRole.ADMINISTRATOR]: ADMINISTRATOR_ROLE,
  [UserRole.SUPER_USER]: SUPER_USER_ROLE,
  [UserRole.HOTEL_STAFF]: HOTEL_STAFF_ROLE,
  [UserRole.GUEST]: GUEST_ROLE,
};

/**
 * Get role by UserRole enum
 */
export const getRoleByType = (roleType: UserRole): Role => {
  return ROLES_MAP[roleType];
};

/**
 * Create dynamic pit-stop role definition for a PS_x_USER group.
 */
export const createPitStopUserRole = (stageNumber: number): Role => {
  return {
    roleId: `role_ps_${stageNumber}_user`,
    role: `PS_${stageNumber}_USER`,
    name: `PS_${stageNumber}_USER`,
    description: `Pit stop regular check-in role for stage ${stageNumber}`,
    permissions: PIT_STOP_USER_PERMISSIONS,
    assignedStage: stageNumber,
  };
};
