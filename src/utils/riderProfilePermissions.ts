import { AppRole, Permission } from '../types/models';
import { hasPermission } from './permissions';

export function canManageRiderProfileDefinitions(role: AppRole): boolean {
  return hasPermission(role, Permission.RIDER_PROFILE_DEFINITION_MANAGE);
}

export function canEditAdminOnlyRiderProfileAttributes(role: AppRole): boolean {
  return hasPermission(role, Permission.RIDER_PROFILE_ADMIN_EDIT);
}
