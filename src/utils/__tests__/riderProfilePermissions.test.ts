import { describe, expect, it } from '@jest/globals';
import { UserRole } from '../../types/models';
import {
  canEditAdminOnlyRiderProfileAttributes,
  canManageRiderProfileDefinitions,
} from '../riderProfilePermissions';

describe('rider profile RBAC gates', () => {
  it('allows only administrators for rider profile definition management', () => {
    expect(canManageRiderProfileDefinitions(UserRole.ADMINISTRATOR)).toBe(true);
    expect(canManageRiderProfileDefinitions(UserRole.SUPER_USER)).toBe(false);
    expect(canManageRiderProfileDefinitions(UserRole.GUEST)).toBe(false);
  });

  it('allows only administrators for admin-only rider profile editing', () => {
    expect(canEditAdminOnlyRiderProfileAttributes(UserRole.ADMINISTRATOR)).toBe(true);
    expect(canEditAdminOnlyRiderProfileAttributes(UserRole.SUPER_USER)).toBe(false);
    expect(canEditAdminOnlyRiderProfileAttributes(UserRole.HOTEL_STAFF)).toBe(false);
  });
});
