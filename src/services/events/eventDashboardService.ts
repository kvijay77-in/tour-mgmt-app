/**
 * Event dashboard service — occurrence dashboard, progress and reconciliation
 * reads with ETag/304 reuse, plus the last-known snapshot per occurrence in
 * SQLite (event_dashboard_snapshots) for offline and "stale data" display.
 *
 * See docs/design/events.md.
 */

import {
  ConditionalResult,
  EventApiOutcome,
  getOccurrenceDashboard,
  getOccurrenceProgress,
  getOccurrenceReconciliation,
} from '../api/eventsApi';
import { getDashboardSnapshot, saveDashboardSnapshot } from '../database/eventStore';
import { registerSessionMemoryReset } from '../database/database';
import {
  OccurrenceDashboardResponse,
  OccurrenceProgressResponse,
  ReconciliationResponse,
} from '../../types/api';
import { logger } from '../../utils/logger';

const TAG = 'EventDashboardService';

export interface OccurrenceDashboardSnapshot {
  /** Occurrence IDs are only unique within a tour */
  tourId: string;
  /** Full dashboard payload (event, occurrence, riders, records, summary) with progress merged in */
  dashboard: OccurrenceDashboardResponse | null;
  reconciliation: ReconciliationResponse | null;
}

export interface StoredOccurrenceSnapshot {
  snapshot: OccurrenceDashboardSnapshot;
  fetchedAt: string;
}

const conditionalCache = new Map<string, { etag: string; data: unknown }>();
registerSessionMemoryReset(() => conditionalCache.clear());
let snapshotWriteChain: Promise<void> = Promise.resolve();

async function fetchConditional<T>(
  key: string,
  fetcher: (etag?: string) => Promise<EventApiOutcome<ConditionalResult<T>>>,
): Promise<EventApiOutcome<{ data: T; notModified: boolean }>> {
  const cached = conditionalCache.get(key) as { etag: string; data: T } | undefined;
  const outcome = await fetcher(cached?.etag);
  if (outcome.kind === 'error') return outcome;

  const { data, etag } = outcome.data;
  if (data === null) {
    if (!cached) throw new Error('304 Not Modified without a cached payload');
    return { kind: 'success', data: { data: cached.data, notModified: true } };
  }
  if (etag) conditionalCache.set(key, { etag, data });
  else conditionalCache.delete(key);
  return { kind: 'success', data: { data, notModified: false } };
}

export async function readOccurrenceSnapshot(
  tourId: string,
  occurrenceId: string,
): Promise<StoredOccurrenceSnapshot | null> {
  try {
    const stored = await getDashboardSnapshot<OccurrenceDashboardSnapshot>(occurrenceId);
    if (!stored || stored.payload.tourId !== tourId) return null;
    // Snapshots saved before the revamped contract have no summary: treat the dashboard as not saved.
    if (!stored.payload.dashboard?.summary) {
      return { snapshot: { ...stored.payload, dashboard: null }, fetchedAt: stored.fetchedAt };
    }
    return { snapshot: stored.payload, fetchedAt: stored.fetchedAt };
  } catch (error) {
    logger.warn(TAG, 'Reading dashboard snapshot failed', error);
    return null;
  }
}

async function saveSnapshotPart(
  tourId: string,
  occurrenceId: string,
  part: Partial<Omit<OccurrenceDashboardSnapshot, 'tourId'>>,
): Promise<void> {
  // Serialised: each write is read-merge-write of the same row.
  const task = snapshotWriteChain.then(() => writeSnapshotPart(tourId, occurrenceId, part));
  snapshotWriteChain = task;
  return task;
}

async function writeSnapshotPart(
  tourId: string,
  occurrenceId: string,
  part: Partial<Omit<OccurrenceDashboardSnapshot, 'tourId'>>,
): Promise<void> {
  try {
    const existing = await readOccurrenceSnapshot(tourId, occurrenceId);
    const base: OccurrenceDashboardSnapshot = existing?.snapshot ?? {
      tourId,
      dashboard: null,
      reconciliation: null,
    };
    await saveDashboardSnapshot(occurrenceId, { ...base, ...part, tourId });
  } catch (error) {
    logger.warn(TAG, 'Saving dashboard snapshot failed', error);
  }
}

async function mergeProgressIntoSnapshot(
  tourId: string,
  occurrenceId: string,
  progress: OccurrenceProgressResponse,
): Promise<void> {
  const task = snapshotWriteChain.then(async () => {
    try {
      const existing = await readOccurrenceSnapshot(tourId, occurrenceId);
      const dashboard = existing?.snapshot.dashboard;
      if (!dashboard) return;
      await saveDashboardSnapshot(occurrenceId, {
        ...existing.snapshot,
        dashboard: {
          ...dashboard,
          records: progress.records,
          cancelled: progress.cancelled,
          summary: progress.summary,
        },
      });
    } catch (error) {
      logger.warn(TAG, 'Merging progress into snapshot failed', error);
    }
  });
  snapshotWriteChain = task;
  return task;
}

export async function fetchOccurrenceDashboard(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<OccurrenceDashboardResponse>> {
  const outcome = await fetchConditional(
    `${tourId}|${occurrenceId}|dashboard`,
    (etag) => getOccurrenceDashboard(tourId, eventId, occurrenceId, etag),
  );
  if (outcome.kind === 'error') return outcome;
  if (!outcome.data.notModified) {
    await saveSnapshotPart(tourId, occurrenceId, { dashboard: outcome.data.data });
  }
  return { kind: 'success', data: outcome.data.data };
}

export async function fetchOccurrenceProgress(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<{ progress: OccurrenceProgressResponse; notModified: boolean }>> {
  const outcome = await fetchConditional(
    `${tourId}|${occurrenceId}|progress`,
    (etag) => getOccurrenceProgress(tourId, eventId, occurrenceId, etag),
  );
  if (outcome.kind === 'error') return outcome;
  if (!outcome.data.notModified) {
    await mergeProgressIntoSnapshot(tourId, occurrenceId, outcome.data.data);
  }
  return { kind: 'success', data: { progress: outcome.data.data, notModified: outcome.data.notModified } };
}

export async function fetchOccurrenceReconciliation(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<ReconciliationResponse>> {
  const outcome = await getOccurrenceReconciliation(tourId, eventId, occurrenceId);
  if (outcome.kind === 'success') {
    await saveSnapshotPart(tourId, occurrenceId, { reconciliation: outcome.data });
  }
  return outcome;
}
