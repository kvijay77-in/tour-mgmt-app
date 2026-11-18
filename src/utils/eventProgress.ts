/**
 * Pure helpers for the event dashboard: activity list, per-rider status
 * derivation, QUEUED overlay, sorting, totals and activity-log merging.
 * See docs/design/events.md.
 */

import type { EventDashboardSummary } from '../types/api';
import {
  ActivityOutcome,
  EventActivityRecord,
  EventDefinition,
  EventOccurrence,
  EventRecordMethod,
} from '../types/models';
import { findActivityOverride, getEffectiveActivityEnabled } from './eventActivity';

/** Server status plus QUEUED (saved on this device, not yet synced). */
export type ProgressStatus = 'PENDING' | ActivityOutcome | 'QUEUED';

export type RiderStatusMap = Map<string, Record<string, ProgressStatus>>;

export interface DashboardActivity {
  activityId: string;
  name: string;
  sequenceNo: number;
  mandatory: boolean;
  allowOptOut: boolean;
}

export interface ProgressRow {
  riderId: string;
  statuses: Record<string, ProgressStatus>;
}

/** Subset of the device record store used by the dashboard. */
export interface LocalRecordLike {
  localId: string;
  recordId: string | null;
  riderId: string;
  activityId: string;
  activityName: string;
  outcome: ActivityOutcome;
  isFlagged: boolean;
  isCancelled: boolean;
  method: EventRecordMethod;
  timestamp: string;
  variantSelected: string | null;
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
}

export interface ActivityTotals {
  total: number;
  completed: number;
  pending: number;
  /** null when the activity does not allow opt-out */
  optedOut: number | null;
  /** null when nothing is flagged */
  flagged: number | null;
}

export interface OverallTotals {
  totalRiders: number;
  fullyDone: number;
  withPending: number;
  outstandingMandatory: number;
  /** null unless registration is enabled */
  registered: number | null;
  /** null when nothing is flagged */
  flagged: number | null;
}

export interface LogEntry {
  key: string;
  recordId: string | null;
  riderId: string;
  activityId: string;
  activityName: string;
  timestamp: string;
  method: EventRecordMethod;
  outcome: ActivityOutcome;
  isFlagged: boolean;
  variantSelected: string | null;
  scannedBy: string | null;
  source: 'SERVER' | 'DEVICE';
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED' | null;
}

/** Local HH:mm for a timestamp; empty when unparsable. */
export function formatLocalTime(timestamp?: string | null): string {
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

const STATUS_TEXT: Record<ProgressStatus, string> = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  OPTED_OUT: 'Opted out',
  FLAGGED: 'Flagged',
  QUEUED: 'Queued',
};

/** e.g. "Completed 06:02", "Pending". */
export function describeProgressStatus(status: ProgressStatus, timestamp?: string | null): string {
  const time = status === 'PENDING' || status === 'QUEUED' ? '' : formatLocalTime(timestamp);
  return time ? `${STATUS_TEXT[status]} ${time}` : STATUS_TEXT[status];
}

export function isDoneStatus(status: ProgressStatus | undefined): boolean {
  return status === ActivityOutcome.COMPLETED
    || status === ActivityOutcome.OPTED_OUT
    || status === ActivityOutcome.FLAGGED;
}

export function countDone(statuses: Readonly<Record<string, ProgressStatus>>, activityIds: readonly string[]): number {
  return activityIds.filter((id) => isDoneStatus(statuses[id])).length;
}

export function compareRiderIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Summary order mapped to event activities; falls back to effective-enabled activities. */
export function getDashboardActivities(
  event: Pick<EventDefinition, 'activities'>,
  occurrence: Pick<EventOccurrence, 'activityOverrides'> | null | undefined,
  summary?: Pick<EventDashboardSummary, 'activities'> | null,
): DashboardActivity[] {
  const byId = new Map(event.activities.map((activity) => [activity.activityId, activity]));
  const toActivity = (activityId: string): DashboardActivity => {
    const activity = byId.get(activityId);
    return {
      activityId,
      name: activity?.name ?? activityId,
      sequenceNo: activity?.sequenceNo ?? Number.MAX_SAFE_INTEGER,
      mandatory: activity?.mandatory ?? false,
      allowOptOut: activity?.allowOptOut ?? false,
    };
  };

  const ids = summary?.activities
    ? summary.activities.map((item) => item.activityId)
    : event.activities
      .filter((activity) => getEffectiveActivityEnabled(activity, findActivityOverride(occurrence, activity.activityId)))
      .map((activity) => activity.activityId);

  return ids.map(toActivity).sort((a, b) => a.sequenceNo - b.sequenceNo);
}

function isNewer(a: EventActivityRecord, b: EventActivityRecord): boolean {
  return a.timestamp.localeCompare(b.timestamp) > 0;
}

/** Latest active record for the rider × activity, by timestamp. */
export function findRecord(
  records: readonly EventActivityRecord[],
  riderId: string,
  activityId: string,
): EventActivityRecord | undefined {
  let latest: EventActivityRecord | undefined;
  for (const record of records) {
    if (record.riderId !== riderId || record.activityId !== activityId) continue;
    if (!latest || isNewer(record, latest)) latest = record;
  }
  return latest;
}

/** Flagged records show as FLAGGED, otherwise the record outcome; no record means PENDING. */
export function deriveRiderStatuses(
  riders: ReadonlyArray<{ riderId: string }>,
  records: readonly EventActivityRecord[],
  activityIds: readonly string[],
): RiderStatusMap {
  const activitySet = new Set(activityIds);
  const latest = new Map<string, EventActivityRecord>();
  for (const record of records) {
    if (!activitySet.has(record.activityId)) continue;
    const key = `${record.riderId}\u0000${record.activityId}`;
    const current = latest.get(key);
    if (!current || isNewer(record, current)) latest.set(key, record);
  }

  const result: RiderStatusMap = new Map();
  for (const { riderId } of riders) {
    const statuses: Record<string, ProgressStatus> = {};
    for (const activityId of activityIds) {
      const record = latest.get(`${riderId}\u0000${activityId}`);
      if (!record) statuses[activityId] = 'PENDING';
      else statuses[activityId] = record.isFlagged ? ActivityOutcome.FLAGGED : record.outcome;
    }
    result.set(riderId, statuses);
  }
  return result;
}

/** Unsynced local records turn a PENDING server status into QUEUED. */
export function applyLocalQueued(
  statuses: RiderStatusMap,
  localRecords: ReadonlyArray<Pick<LocalRecordLike, 'riderId' | 'activityId' | 'syncStatus' | 'isCancelled'>>,
): RiderStatusMap {
  const queued = localRecords.filter((record) => record.syncStatus === 'PENDING' && !record.isCancelled);
  if (queued.length === 0) return statuses;

  const result: RiderStatusMap = new Map(statuses);
  for (const record of queued) {
    const current = result.get(record.riderId);
    if (!current || current[record.activityId] !== 'PENDING') continue;
    result.set(record.riderId, { ...current, [record.activityId]: 'QUEUED' });
  }
  return result;
}

/** Default: Rider ID order. Sorted: fewest activities done first, then Rider ID. */
export function sortRidersDefault(
  rows: readonly ProgressRow[],
  activityIds: readonly string[],
  isSorted: boolean,
): ProgressRow[] {
  const copy = [...rows];
  if (!isSorted) return copy.sort((a, b) => compareRiderIds(a.riderId, b.riderId));
  const doneCount = new Map(copy.map((row) => [row.riderId, countDone(row.statuses, activityIds)]));
  return copy.sort((a, b) => (doneCount.get(a.riderId)! - doneCount.get(b.riderId)!) || compareRiderIds(a.riderId, b.riderId));
}

/** Default: Rider ID order. Sorted: not done first, then done, then Rider ID. */
export function sortRidersForActivity(
  rows: readonly ProgressRow[],
  activityId: string,
  isSorted: boolean,
): ProgressRow[] {
  const copy = [...rows];
  if (!isSorted) return copy.sort((a, b) => compareRiderIds(a.riderId, b.riderId));
  const rank = (row: ProgressRow) => (isDoneStatus(row.statuses[activityId]) ? 1 : 0);
  return copy.sort((a, b) => (rank(a) - rank(b)) || compareRiderIds(a.riderId, b.riderId));
}

export function getActivityTotals(
  summary: EventDashboardSummary,
  activity: Pick<DashboardActivity, 'activityId' | 'allowOptOut'>,
): ActivityTotals {
  const item = summary.activities.find((entry) => entry.activityId === activity.activityId);
  const total = summary.totalRiders;
  const completed = item?.completed ?? 0;
  const optedOut = item?.optedOut ?? 0;
  const flagged = item?.flagged ?? 0;
  return {
    total,
    completed,
    pending: item?.pending ?? Math.max(total - completed - optedOut - flagged, 0),
    optedOut: activity.allowOptOut ? optedOut : null,
    flagged: flagged > 0 ? flagged : null,
  };
}

export function getOverallTotals(
  summary: EventDashboardSummary,
  statuses: RiderStatusMap,
  activityIds: readonly string[],
): OverallTotals {
  let fullyDone = 0;
  let withPending = 0;
  statuses.forEach((riderStatuses) => {
    const done = countDone(riderStatuses, activityIds);
    if (activityIds.length > 0 && done === activityIds.length) fullyDone += 1;
    else withPending += 1;
  });
  return {
    totalRiders: summary.totalRiders,
    fullyDone,
    withPending,
    outstandingMandatory: summary.outstandingMandatoryCount,
    registered: summary.registrationEnabled ? (summary.registeredCount ?? 0) : null,
    flagged: summary.flaggedCount > 0 ? summary.flaggedCount : null,
  };
}

/** Server records merged with this device's local records (server wins by recordId), newest first. */
export function buildLogEntries(
  serverRecords: readonly EventActivityRecord[],
  localRecords: readonly LocalRecordLike[],
  activityFilter: string | null,
): LogEntry[] {
  const entries: LogEntry[] = serverRecords.map((record) => ({
    key: record.recordId,
    recordId: record.recordId,
    riderId: record.riderId,
    activityId: record.activityId,
    activityName: record.activityName,
    timestamp: record.timestamp,
    method: record.method,
    outcome: record.outcome,
    isFlagged: record.isFlagged,
    variantSelected: record.variantSelected ?? null,
    scannedBy: record.scannedBy ?? null,
    source: 'SERVER',
    syncStatus: null,
  }));

  const serverIds = new Set(serverRecords.map((record) => record.recordId));
  for (const record of localRecords) {
    if (record.isCancelled) continue;
    if (record.recordId && serverIds.has(record.recordId)) continue;
    entries.push({
      key: `local:${record.localId}`,
      recordId: record.recordId,
      riderId: record.riderId,
      activityId: record.activityId,
      activityName: record.activityName,
      timestamp: record.timestamp,
      method: record.method,
      outcome: record.outcome,
      isFlagged: record.isFlagged,
      variantSelected: record.variantSelected,
      scannedBy: null,
      source: 'DEVICE',
      syncStatus: record.syncStatus,
    });
  }

  return entries
    .filter((entry) => !activityFilter || entry.activityId === activityFilter)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Newest cancellation first. */
export function sortCancelled(cancelled: readonly EventActivityRecord[]): EventActivityRecord[] {
  const when = (record: EventActivityRecord) => record.cancelledAt ?? record.timestamp;
  return [...cancelled].sort((a, b) => when(b).localeCompare(when(a)));
}
