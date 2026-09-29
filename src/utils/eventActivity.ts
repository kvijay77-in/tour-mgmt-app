/**
 * Pure event-engine helpers: effective activity settings after occurrence
 * overrides, activity ID/sequence utilities, and client-side scan assignment
 * filtering. See docs/Event-Engine-Design.md.
 */

import {
  ActivityOverride,
  AppRole,
  EventActivity,
  EventDefinition,
  EventOccurrence,
  TourUserAssignment,
  UserRole,
} from '../types/models';
import type { DashboardActivityStatus } from '../types/api';
import { toLocalDateString } from './dates';

const ACTIVITY_ID_PREFIX = 'ACT-';
const ACTIVITY_ID_DIGITS = 3;

export function findActivityOverride(
  occurrence: Pick<EventOccurrence, 'activityOverrides'> | null | undefined,
  activityId: string,
): ActivityOverride | undefined {
  return occurrence?.activityOverrides?.find((item) => item.activityId === activityId);
}

export function getEffectiveActivityEnabled(
  activity: Pick<EventActivity, 'enabled'>,
  override?: ActivityOverride | null,
): boolean {
  if (override?.skipped === true) {
    return false;
  }
  if (typeof override?.enabled === 'boolean') {
    return override.enabled;
  }
  return activity.enabled;
}

/**
 * Activity codes if non-empty, else the event default; an override with its
 * own codes narrows that set (intersection), never widens it.
 */
export function getEffectiveAllowedTypeCodes(
  event: Pick<EventDefinition, 'defaultAllowedTypeCodes'>,
  activity: Pick<EventActivity, 'allowedTypeCodes'>,
  override?: ActivityOverride | null,
): string[] {
  const base = activity.allowedTypeCodes?.length
    ? activity.allowedTypeCodes
    : event.defaultAllowedTypeCodes ?? [];

  if (!override?.allowedTypeCodes) {
    return [...base];
  }

  const narrowed = new Set(override.allowedTypeCodes.map((code) => code.toUpperCase()));
  return base.filter((code) => narrowed.has(code.toUpperCase()));
}

/** Display only — self-service never changes scan logic. */
export function getEffectiveSelfService(
  occurrence: Pick<EventOccurrence, 'selfServiceEnabled'> | null | undefined,
  override?: ActivityOverride | null,
): boolean {
  if (typeof override?.selfServiceEnabled === 'boolean') {
    return override.selfServiceEnabled;
  }
  return Boolean(occurrence?.selfServiceEnabled);
}

export function nextActivityId(activities: ReadonlyArray<Pick<EventActivity, 'activityId'>>): string {
  const maxNumber = activities.reduce((max, activity) => {
    if (!activity.activityId.startsWith(ACTIVITY_ID_PREFIX)) return max;
    const parsed = Number.parseInt(activity.activityId.slice(ACTIVITY_ID_PREFIX.length), 10);
    return Number.isNaN(parsed) ? max : Math.max(max, parsed);
  }, 0);

  return `${ACTIVITY_ID_PREFIX}${String(maxNumber + 1).padStart(ACTIVITY_ID_DIGITS, '0')}`;
}

/** Reassigns sequenceNo 1..n in current array order. */
export function recomputeSequence<T extends Pick<EventActivity, 'sequenceNo'>>(activities: readonly T[]): T[] {
  return activities.map((activity, index) => ({ ...activity, sequenceNo: index + 1 }));
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Device-local calendar date (YYYY-MM-DD); occurrences are dated in tour-local time. */
export { toLocalDateString };

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

/** Inclusive list of YYYY-MM-DD dates; both inputs must be valid and from <= to. */
export function listDatesInRange(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cursor = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function isAssignedToOccurrence(
  assignment: TourUserAssignment,
  eventId: string,
  date: string,
): boolean {
  return (assignment.eventAssignments ?? []).some((entry) => {
    if (entry.eventId !== eventId) return false;
    return entry.dates === 'ALL' || entry.dates.includes(date);
  });
}

/**
 * Client-side mirror of backend §9.3 used to filter scan choices (D-O).
 * Admin/SU are not filtered; the server may still reject them.
 */
export function isActivityAvailableToUser(
  role: AppRole | null,
  assignment: TourUserAssignment | null,
  event: Pick<EventDefinition, 'eventId'>,
  occurrence: Pick<EventOccurrence, 'date'>,
  activity: Pick<EventActivity, 'activityId' | 'restrictToAssignedUsers'>,
): boolean {
  if (role === UserRole.ADMINISTRATOR || role === UserRole.SUPER_USER) {
    return true;
  }
  if (activity.restrictToAssignedUsers === false) {
    return true;
  }
  if (!assignment || !isAssignedToOccurrence(assignment, event.eventId, occurrence.date)) {
    return false;
  }

  const assignedActivityIds = assignment.assignedActivityIds ?? [];
  return assignedActivityIds.length === 0 || assignedActivityIds.includes(activity.activityId);
}

export type ActivityStepStatus = DashboardActivityStatus | 'BLOCKED' | 'QUEUED';

export interface ActivityStep {
  activityId: string;
  name: string;
  mandatory: boolean;
  status: ActivityStepStatus;
}

/**
 * Stepper nodes for one rider in one occurrence: effective-enabled activities in
 * sequenceNo order. BLOCKED (prerequisite/sequence not yet met) is a display hint;
 * the server decides with PREREQUISITE_NOT_MET.
 */
export function buildActivitySteps(
  event: Pick<EventDefinition, 'activities' | 'sequenceEnforced'>,
  occurrence: Pick<EventOccurrence, 'activityOverrides'> | null | undefined,
  statusByActivity: Readonly<Record<string, DashboardActivityStatus | undefined>>,
  queuedActivityIds: ReadonlySet<string>,
): ActivityStep[] {
  const activities = event.activities
    .filter((activity) => getEffectiveActivityEnabled(activity, findActivityOverride(occurrence, activity.activityId)))
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
  const enabledIds = new Set(activities.map((activity) => activity.activityId));
  const done = new Set<string>();

  return activities.map((activity, index) => {
    const recorded = statusByActivity[activity.activityId];
    let status: ActivityStepStatus;
    if (recorded && recorded !== 'PENDING') {
      status = recorded;
    } else if (queuedActivityIds.has(activity.activityId)) {
      status = 'QUEUED';
    } else {
      const waitsOnPrerequisite = (activity.prerequisiteActivityIds ?? [])
        .some((id) => enabledIds.has(id) && !done.has(id));
      const waitsOnSequence = event.sequenceEnforced
        && activities.slice(0, index).some((earlier) => !done.has(earlier.activityId));
      status = waitsOnPrerequisite || waitsOnSequence ? 'BLOCKED' : 'PENDING';
    }
    if (status !== 'PENDING' && status !== 'BLOCKED') done.add(activity.activityId);
    return { activityId: activity.activityId, name: activity.name, mandatory: activity.mandatory, status };
  });
}
