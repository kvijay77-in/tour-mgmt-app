import { describe, expect, it } from '@jest/globals';
import type { EventDashboardSummary } from '../../types/api';
import { ActivityOutcome, EventActivityRecord, EventDefinition } from '../../types/models';
import {
  applyLocalQueued,
  buildLogEntries,
  compareRiderIds,
  countDone,
  describeProgressStatus,
  deriveRiderStatuses,
  findRecord,
  getActivityTotals,
  getDashboardActivities,
  getOverallTotals,
  isDoneStatus,
  LocalRecordLike,
  ProgressRow,
  RiderStatusMap,
  sortCancelled,
  sortRidersDefault,
  sortRidersForActivity,
} from '../eventProgress';

const activity = (activityId: string, sequenceNo: number, extra: Record<string, unknown> = {}) => ({
  activityId,
  name: `Name ${activityId}`,
  sequenceNo,
  enabled: true,
  mandatory: false,
  allowedTypeCodes: [],
  allowOptOut: false,
  prerequisiteActivityIds: [],
  restrictToAssignedUsers: false,
  variantOptions: [],
  notes: '',
  ...extra,
});

const event = {
  activities: [activity('A2', 2, { allowOptOut: true, mandatory: true }), activity('A1', 1), activity('A3', 3, { enabled: false })],
} as unknown as EventDefinition;

const record = (riderId: string, activityId: string, timestamp: string, extra: Partial<EventActivityRecord> = {}) => ({
  recordId: `${riderId}#${activityId}#${timestamp}`,
  eventId: 'E',
  occurrenceId: 'O',
  activityId,
  activityName: `Name ${activityId}`,
  riderId,
  timestamp,
  method: 'QR_SCAN',
  outcome: ActivityOutcome.COMPLETED,
  isFlagged: false,
  ...extra,
}) as EventActivityRecord;

const summary: EventDashboardSummary = {
  totalRiders: 4,
  registrationEnabled: true,
  registeredCount: 3,
  completedCount: 2,
  outstandingMandatoryCount: 5,
  optedOutCount: 1,
  flaggedCount: 1,
  activities: [
    { activityId: 'A2', completed: 2, optedOut: 1, flagged: 0, pending: 1 },
    { activityId: 'A1', completed: 1, optedOut: 0, flagged: 1, pending: 2 },
  ],
};

describe('getDashboardActivities', () => {
  it('maps summary activities to event activities sorted by sequence', () => {
    const result = getDashboardActivities(event, null, summary);
    expect(result.map((a) => a.activityId)).toEqual(['A1', 'A2']);
    expect(result[1]).toMatchObject({ name: 'Name A2', mandatory: true, allowOptOut: true });
  });

  it('falls back to effective-enabled activities without a summary', () => {
    expect(getDashboardActivities(event, null).map((a) => a.activityId)).toEqual(['A1', 'A2']);
    const skipped = { activityOverrides: [{ activityId: 'A1', skipped: true }] };
    expect(getDashboardActivities(event, skipped).map((a) => a.activityId)).toEqual(['A2']);
  });

  it('keeps unknown summary activities with the id as name', () => {
    const result = getDashboardActivities(event, null, { activities: [{ activityId: 'X', completed: 0, optedOut: 0, flagged: 0, pending: 0 }] });
    expect(result[0].name).toBe('X');
  });
});

describe('deriveRiderStatuses', () => {
  const riders = [{ riderId: 'R1' }, { riderId: 'R2' }];

  it('marks every activity PENDING when there are no records', () => {
    expect(deriveRiderStatuses(riders, [], ['A1', 'A2']).get('R1')).toEqual({ A1: 'PENDING', A2: 'PENDING' });
  });

  it('applies outcome, flagged and opted-out, ignoring unknown riders and activities', () => {
    const records = [
      record('R1', 'A1', '2026-01-01T10:00:00Z'),
      record('R1', 'A2', '2026-01-01T10:01:00Z', { outcome: ActivityOutcome.OPTED_OUT }),
      record('R2', 'A1', '2026-01-01T10:02:00Z', { isFlagged: true, outcome: ActivityOutcome.COMPLETED }),
      record('R9', 'A1', '2026-01-01T10:03:00Z'),
      record('R1', 'A9', '2026-01-01T10:03:00Z'),
    ];
    const result = deriveRiderStatuses(riders, records, ['A1', 'A2']);
    expect(result.get('R1')).toEqual({ A1: 'COMPLETED', A2: 'OPTED_OUT' });
    expect(result.get('R2')).toEqual({ A1: 'FLAGGED', A2: 'PENDING' });
    expect(result.has('R9')).toBe(false);
  });

  it('uses the latest record per rider and activity', () => {
    const records = [
      record('R1', 'A1', '2026-01-01T10:00:00Z', { outcome: ActivityOutcome.OPTED_OUT }),
      record('R1', 'A1', '2026-01-01T11:00:00Z'),
    ];
    expect(deriveRiderStatuses(riders, records, ['A1']).get('R1')).toEqual({ A1: 'COMPLETED' });
    expect(findRecord(records, 'R1', 'A1')?.timestamp).toBe('2026-01-01T11:00:00Z');
    expect(findRecord(records, 'R2', 'A1')).toBeUndefined();
  });
});

describe('applyLocalQueued', () => {
  const base = deriveRiderStatuses([{ riderId: 'R1' }], [record('R1', 'A2', '2026-01-01T10:00:00Z')], ['A1', 'A2']);

  it('overrides PENDING with QUEUED only for unsynced, non-cancelled records', () => {
    const result = applyLocalQueued(base, [
      { riderId: 'R1', activityId: 'A1', syncStatus: 'PENDING', isCancelled: false },
      { riderId: 'R1', activityId: 'A2', syncStatus: 'PENDING', isCancelled: false },
    ]);
    expect(result.get('R1')).toEqual({ A1: 'QUEUED', A2: 'COMPLETED' });
    expect(base.get('R1')?.A1).toBe('PENDING');
  });

  it('ignores failed, synced and cancelled records and returns the same map when none apply', () => {
    const result = applyLocalQueued(base, [
      { riderId: 'R1', activityId: 'A1', syncStatus: 'FAILED', isCancelled: false },
      { riderId: 'R1', activityId: 'A1', syncStatus: 'PENDING', isCancelled: true },
    ]);
    expect(result).toBe(base);
  });
});

describe('status helpers and sorting', () => {
  const DONE = ActivityOutcome.COMPLETED;
  const rows: ProgressRow[] = [
    { riderId: 'R10', statuses: { A1: DONE, A2: DONE } },
    { riderId: 'R2', statuses: { A1: 'PENDING', A2: 'PENDING' } },
    { riderId: 'R3', statuses: { A1: DONE, A2: 'PENDING' } },
    { riderId: 'R1', statuses: { A1: 'QUEUED', A2: 'PENDING' } },
  ];

  it('treats completed, opted out and flagged as done; queued and pending as not done', () => {
    expect(['COMPLETED', 'OPTED_OUT', 'FLAGGED'].every((s) => isDoneStatus(s as never))).toBe(true);
    expect(isDoneStatus('QUEUED')).toBe(false);
    expect(isDoneStatus(undefined)).toBe(false);
    expect(countDone(rows[2].statuses, ['A1', 'A2'])).toBe(1);
  });

  it('compares rider IDs numerically', () => {
    expect(compareRiderIds('R2', 'R10')).toBeLessThan(0);
  });

  it('sorts by rider ID by default', () => {
    expect(sortRidersDefault(rows, ['A1', 'A2'], false).map((r) => r.riderId)).toEqual(['R1', 'R2', 'R3', 'R10']);
  });

  it('sorts fewest done first then rider ID when sorted', () => {
    expect(sortRidersDefault(rows, ['A1', 'A2'], true).map((r) => r.riderId)).toEqual(['R1', 'R2', 'R3', 'R10']);
    const mixed: ProgressRow[] = [rows[0], rows[2], rows[1]];
    expect(sortRidersDefault(mixed, ['A1', 'A2'], true).map((r) => r.riderId)).toEqual(['R2', 'R3', 'R10']);
  });

  it('sorts not done first for a single activity', () => {
    expect(sortRidersForActivity(rows, 'A1', true).map((r) => r.riderId)).toEqual(['R1', 'R2', 'R3', 'R10']);
    expect(sortRidersForActivity(rows, 'A2', true).map((r) => r.riderId)).toEqual(['R1', 'R2', 'R3', 'R10']);
    expect(sortRidersForActivity(rows, 'A2', false).map((r) => r.riderId)).toEqual(['R1', 'R2', 'R3', 'R10']);
  });

  it('does not mutate its input', () => {
    const copy = [...rows];
    sortRidersDefault(rows, ['A1'], true);
    expect(rows).toEqual(copy);
  });
});

describe('totals', () => {
  it('returns per-activity totals with optional opt-out and flagged', () => {
    expect(getActivityTotals(summary, { activityId: 'A2', allowOptOut: true })).toEqual({
      total: 4, completed: 2, pending: 1, optedOut: 1, flagged: null,
    });
    expect(getActivityTotals(summary, { activityId: 'A1', allowOptOut: false })).toEqual({
      total: 4, completed: 1, pending: 2, optedOut: null, flagged: 1,
    });
  });

  it('derives pending when the activity is missing from the summary', () => {
    expect(getActivityTotals(summary, { activityId: 'ZZ', allowOptOut: false })).toMatchObject({ completed: 0, pending: 4 });
  });

  it('computes overall totals client-side from rider statuses', () => {
    const statuses: RiderStatusMap = new Map([
      ['R1', { A1: ActivityOutcome.COMPLETED, A2: ActivityOutcome.OPTED_OUT }],
      ['R2', { A1: ActivityOutcome.COMPLETED, A2: 'PENDING' as const }],
    ]);
    expect(getOverallTotals(summary, statuses, ['A1', 'A2'])).toEqual({
      totalRiders: 4, fullyDone: 1, withPending: 1, outstandingMandatory: 5, registered: 3, flagged: 1,
    });
  });

  it('hides registered and flagged when not applicable and never counts fully done without activities', () => {
    const plain = { ...summary, registrationEnabled: false, flaggedCount: 0 };
    const totals = getOverallTotals(plain, new Map([['R1', {}]]), []);
    expect(totals).toMatchObject({ fullyDone: 0, withPending: 1, registered: null, flagged: null });
  });
});

describe('buildLogEntries', () => {
  const local = (localId: string, extra: Partial<LocalRecordLike> = {}): LocalRecordLike => ({
    localId,
    recordId: null,
    riderId: 'R1',
    activityId: 'A1',
    activityName: 'Name A1',
    outcome: ActivityOutcome.COMPLETED,
    isFlagged: false,
    isCancelled: false,
    method: 'MANUAL',
    timestamp: '2026-01-01T12:00:00Z',
    variantSelected: null,
    syncStatus: 'PENDING',
    ...extra,
  });

  it('merges device and server records, dedupes by recordId, newest first', () => {
    const server = [record('R1', 'A1', '2026-01-01T10:00:00Z'), record('R2', 'A2', '2026-01-01T11:00:00Z')];
    const entries = buildLogEntries(server, [
      local('L1'),
      local('L2', { recordId: server[0].recordId, syncStatus: 'SYNCED' }),
      local('L3', { isCancelled: true }),
    ], null);
    expect(entries.map((e) => e.key)).toEqual(['local:L1', server[1].recordId, server[0].recordId]);
    expect(entries[0]).toMatchObject({ source: 'DEVICE', syncStatus: 'PENDING' });
  });

  it('filters by activity and handles empty inputs', () => {
    const server = [record('R1', 'A1', '2026-01-01T10:00:00Z'), record('R2', 'A2', '2026-01-01T11:00:00Z')];
    expect(buildLogEntries(server, [], 'A2').map((e) => e.activityId)).toEqual(['A2']);
    expect(buildLogEntries([], [], null)).toEqual([]);
  });

  it('sorts cancelled records newest cancellation first', () => {
    const a = record('R1', 'A1', '2026-01-01T10:00:00Z', { cancelledAt: '2026-01-02T00:00:00Z' });
    const b = record('R2', 'A1', '2026-01-01T09:00:00Z', { cancelledAt: '2026-01-03T00:00:00Z' });
    expect(sortCancelled([a, b])).toEqual([b, a]);
  });
});

describe('describeProgressStatus', () => {
  it('omits time for pending and queued', () => {
    expect(describeProgressStatus('PENDING', '2026-01-01T10:00:00Z')).toBe('Pending');
    expect(describeProgressStatus('QUEUED')).toBe('Queued');
  });

  it('appends local time for done statuses and tolerates missing or invalid timestamps', () => {
    expect(describeProgressStatus(ActivityOutcome.COMPLETED, '2026-01-01T10:00:00Z')).toMatch(/^Completed \d{2}:\d{2}$/);
    expect(describeProgressStatus(ActivityOutcome.OPTED_OUT)).toBe('Opted out');
    expect(describeProgressStatus(ActivityOutcome.FLAGGED, 'bad')).toBe('Flagged');
  });
});
