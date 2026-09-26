/**
 * Module/section registry for the Home hub and the web sidebar (SideNav).
 *
 * Visibility predicates must match the route registration gates in
 * AppNavigator.tsx. An entry without `getTarget` stays hidden (used for
 * routes that are not registered yet).
 *
 * See docs/SolutionDesign.md § Navigation Structure and
 * docs/Event-Engine-Design.md § Navigation.
 */

import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { CommonActions } from '@react-navigation/native';
import type { MaterialIcons } from '@expo/vector-icons';
import { useAuth, AuthUser } from '../context/AuthContext';
import { Permission, UserRole } from '../types/models';
import { AppStackParamList } from '../types/navigation';
import { hasPermission } from '../utils/permissions';

export type ModuleIconName = ComponentProps<typeof MaterialIcons>['name'];

export type ModuleTarget = {
  [K in keyof AppStackParamList]: { route: K; params: AppStackParamList[K] };
}[keyof AppStackParamList];

export interface ModuleEntry {
  id: string;
  title: string;
  icon: ModuleIconName;
  /** Sub-group label inside a section (e.g. "User management"). */
  group?: string;
  isVisible: (user: AuthUser) => boolean;
  getTarget?: (user: AuthUser) => ModuleTarget;
}

export interface ModuleSection {
  id: string;
  title: string;
  entries: ModuleEntry[];
}

export interface VisibleModuleEntry {
  id: string;
  title: string;
  icon: ModuleIconName;
  group?: string;
  target: ModuleTarget;
}

export interface VisibleModuleSection {
  id: string;
  title: string;
  entries: VisibleModuleEntry[];
}

const isAdministrator = (user: AuthUser) => user.userRole === UserRole.ADMINISTRATOR;
const can = (permission: Permission) => (user: AuthUser) => hasPermission(user.userRole, permission);

const USER_MANAGEMENT_GROUP = 'User management';

export const MODULE_SECTIONS: ModuleSection[] = [
  {
    id: 'ride',
    title: 'Ride Day',
    entries: [
      {
        id: 'ride-day',
        title: 'Ride Day',
        icon: 'directions-bike',
        isVisible: (user) =>
          hasPermission(user.userRole, Permission.VIEW_DASHBOARD)
          || hasPermission(user.userRole, Permission.CHECKIN_RIDER),
        getTarget: () => ({ route: 'MainTabs', params: undefined }),
      },
    ],
  },
  {
    id: 'events',
    title: 'Events',
    entries: [
      {
        // Route EventsHome registered in event-engine Phase 3.
        id: 'events-home',
        title: 'Events',
        icon: 'event',
        isVisible: (user) =>
          hasPermission(user.userRole, Permission.EVENT_SCAN)
          || hasPermission(user.userRole, Permission.VIEW_DASHBOARD)
          || hasPermission(user.userRole, Permission.MANAGE_EVENT_OCCURRENCES),
        getTarget: () => ({ route: 'EventsHome', params: undefined }),
      },
    ],
  },
  {
    id: 'hotels',
    title: 'Hotels & Baggage',
    entries: [
      {
        // Route HotelManagement registered in event-engine Phase 6.
        id: 'hotel-management',
        title: 'Hotels & Baggage',
        icon: 'hotel',
        isVisible: can(Permission.MANAGE_HOTEL_ALLOCATIONS),
        getTarget: () => ({ route: 'HotelManagement', params: undefined }),
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    entries: [
      {
        id: 'tour-management',
        title: 'Define/Update Tour',
        icon: 'edit-road',
        isVisible: (user) =>
          user.userRole === UserRole.ADMINISTRATOR || user.userRole === UserRole.SUPER_USER,
        getTarget: (user) => ({ route: 'TourManagement', params: { readOnly: !isAdministrator(user) } }),
      },
      {
        id: 'ride-status-management',
        title: 'Ride status management',
        icon: 'route',
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'RideStatusManagement', params: undefined }),
      },
      {
        id: 'artifacts',
        title: 'Artifacts',
        icon: 'perm-media',
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'Artifacts', params: undefined }),
      },
      {
        id: 'user-onboarding',
        title: 'New user onboarding',
        icon: 'person-add',
        group: USER_MANAGEMENT_GROUP,
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'UserOnboarding', params: undefined }),
      },
      {
        id: 'user-enable-disable',
        title: 'Enable / Disable user',
        icon: 'toggle-on',
        group: USER_MANAGEMENT_GROUP,
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'UserEnableDisable', params: undefined }),
      },
      {
        id: 'user-delete',
        title: 'Delete user',
        icon: 'delete-outline',
        group: USER_MANAGEMENT_GROUP,
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'UserDelete', params: undefined }),
      },
      {
        id: 'user-modify',
        title: 'Modify user',
        icon: 'edit',
        group: USER_MANAGEMENT_GROUP,
        isVisible: isAdministrator,
        getTarget: () => ({ route: 'UserModify', params: undefined }),
      },
      {
        // Route EventDefinitionList registered in event-engine Phase 3.
        id: 'event-definitions',
        title: 'Event definitions',
        icon: 'event-note',
        isVisible: can(Permission.MANAGE_EVENTS),
        getTarget: () => ({ route: 'EventDefinitionList', params: undefined }),
      },
      {
        id: 'tour-assignments',
        title: 'Tour assignments',
        icon: 'assignment-ind',
        isVisible: can(Permission.MANAGE_TOUR_USERS),
        getTarget: () => ({ route: 'TourUserAssignment', params: undefined }),
      },
      {
        id: 'rider-exit',
        title: 'Rider exit',
        icon: 'exit-to-app',
        isVisible: can(Permission.RIDER_EXIT),
        getTarget: () => ({ route: 'RiderExit', params: undefined }),
      },
    ],
  },
];

export interface VisibleModules {
  sections: VisibleModuleSection[];
  entries: VisibleModuleEntry[];
  /** False when the user reaches only one entry (auto-entered, no Home/sidebar). */
  hasHome: boolean;
}

export function useVisibleModules(): VisibleModules {
  const { user } = useAuth();

  return useMemo(() => {
    const sections = user ? getVisibleModuleSections(user) : [];
    const entries = sections.flatMap((section) => section.entries);
    return { sections, entries, hasHome: entries.length > 1 };
  }, [user]);
}

/**
 * Sections and entries the user can reach. Empty sections are omitted.
 */
export function getVisibleModuleSections(user: AuthUser): VisibleModuleSection[] {
  return MODULE_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    entries: section.entries.flatMap((entry): VisibleModuleEntry[] => {
      if (!entry.getTarget || !entry.isVisible(user)) return [];
      return [{
        id: entry.id,
        title: entry.title,
        icon: entry.icon,
        group: entry.group,
        target: entry.getTarget(user),
      }];
    }),
  })).filter((section) => section.entries.length > 0);
}

/** Navigates to the target, returning to it if it is already in the stack. */
export function navigateToModuleAction(target: ModuleTarget) {
  return CommonActions.navigate(target.route, target.params, { pop: true });
}

/** Replaces the whole stack with the target (single-module auto-enter). */
export function resetToModuleAction(target: ModuleTarget) {
  return CommonActions.reset({ index: 0, routes: [{ name: target.route, params: target.params }] });
}
