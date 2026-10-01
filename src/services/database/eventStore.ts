/**
 * Event store — SQLite cache for event definitions, occurrences, rider
 * baggage status, dashboard snapshots, and the caller's own tour assignment.
 * Populated from the events bootstrap; read when offline. On web the same data
 * is held in memory for the browser session only (see database.web.ts).
 */

import { getDatabase, registerSessionMemoryReset, USE_SESSION_MEMORY } from './database';
import {
  ActivityOverride,
  BaggageStatus,
  EventActivity,
  EventDefinition,
  EventOccurrence,
  EventType,
  OccurrenceStatus,
  RiderBaggageStatus,
  TourUserAssignment,
} from '../../types/models';

const memory = {
  events: new Map<string, EventDefinition>(),
  occurrences: new Map<string, EventOccurrence>(),
  baggage: new Map<string, RiderBaggageStatus>(),
  snapshots: new Map<string, { payload: unknown; fetchedAt: string }>(),
  assignments: new Map<string, { assignment: TourUserAssignment | null; fetchedAt: string }>(),
};
registerSessionMemoryReset(() => Object.values(memory).forEach((map) => map.clear()));

function toMemoryEvent(event: EventDefinition): EventDefinition {
  return {
    ...event,
    location: event.location ?? '',
    defaultAllowedTypeCodes: event.defaultAllowedTypeCodes ?? [],
    activities: event.activities ?? [],
  };
}

function toMemoryOccurrence(occurrence: EventOccurrence): EventOccurrence {
  return {
    ...occurrence,
    dateSeq: `${occurrence.date}#${occurrence.seq}`,
    activityOverrides: occurrence.activityOverrides ?? [],
    linkedOccurrenceRef: occurrence.linkedOccurrenceRef ?? null,
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function inTransaction(work: () => Promise<void>): Promise<void> {
  const db = await getDatabase();
  await db.execAsync('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await work();
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

/** Replace all cached definitions (bootstrap returns the full list). */
export async function replaceEvents(events: EventDefinition[]): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.events.clear();
    events.forEach((event) => memory.events.set(event.eventId, toMemoryEvent(event)));
    return;
  }

  const db = await getDatabase();

  await inTransaction(async () => {
    await db.runAsync('DELETE FROM events');
    for (const event of events) {
      await writeEvent(event);
    }
  });
}

/** Upsert a single definition fetched online (e.g. when opening the scan screen). */
export async function upsertEvent(event: EventDefinition): Promise<void> {
  await writeEvent(event);
}

async function writeEvent(event: EventDefinition): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.events.set(event.eventId, toMemoryEvent(event));
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO events
      (eventId, eventName, eventType, location, sequenceEnforced, defaultAllowedTypeCodesJson,
       registrationEnabled, selfServiceAllowed, activitiesJson, updatedAt, lastSyncedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.eventId,
      event.eventName,
      event.eventType,
      event.location ?? null,
      event.sequenceEnforced ? 1 : 0,
      JSON.stringify(event.defaultAllowedTypeCodes ?? []),
      event.registrationEnabled ? 1 : 0,
      event.selfServiceAllowed ? 1 : 0,
      JSON.stringify(event.activities ?? []),
      event.updatedAt ?? null,
      new Date().toISOString(),
    ],
  );
}

export async function getEvents(): Promise<EventDefinition[]> {
  if (USE_SESSION_MEMORY) {
    return [...memory.events.values()].sort((a, b) => a.eventName.localeCompare(b.eventName));
  }

  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM events ORDER BY eventName',
  );
  return rows.map(mapRowToEvent);
}

export async function getEventById(eventId: string): Promise<EventDefinition | null> {
  if (USE_SESSION_MEMORY) return memory.events.get(eventId) ?? null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM events WHERE eventId = ?',
    [eventId],
  );
  return row ? mapRowToEvent(row) : null;
}

export function mapRowToEvent(row: Record<string, unknown>): EventDefinition {
  return {
    eventId: row.eventId as string,
    eventName: row.eventName as string,
    eventType: row.eventType as EventType,
    location: (row.location as string | null) ?? '',
    sequenceEnforced: (row.sequenceEnforced as number) === 1,
    defaultAllowedTypeCodes: parseJson<string[]>(row.defaultAllowedTypeCodesJson, []),
    registrationEnabled: (row.registrationEnabled as number) === 1,
    selfServiceAllowed: (row.selfServiceAllowed as number) === 1,
    activities: parseJson<EventActivity[]>(row.activitiesJson, []),
    updatedAt: (row.updatedAt as string | null) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

/** Replace all cached occurrences (bootstrap activeOccurrences is the full upcoming set). */
export async function replaceOccurrences(occurrences: EventOccurrence[]): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.occurrences.clear();
    occurrences.forEach((occurrence) =>
      memory.occurrences.set(occurrence.occurrenceId, toMemoryOccurrence(occurrence)));
    return;
  }

  const db = await getDatabase();
  await inTransaction(async () => {
    await db.runAsync('DELETE FROM event_occurrences');
    for (const occurrence of occurrences) {
      await writeOccurrence(occurrence);
    }
  });
}

/** Upsert a single occurrence after an online admin action. */
export async function upsertOccurrence(occurrence: EventOccurrence): Promise<void> {
  await writeOccurrence(occurrence);
}

async function writeOccurrence(occurrence: EventOccurrence): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.occurrences.set(occurrence.occurrenceId, toMemoryOccurrence(occurrence));
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO event_occurrences
      (occurrenceId, eventId, date, seq, status, selfServiceAllowed, activityOverridesJson,
       linkedOccurrenceRef, updatedAt, lastSyncedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      occurrence.occurrenceId,
      occurrence.eventId,
      occurrence.date,
      occurrence.seq,
      occurrence.status,
      occurrence.selfServiceAllowed == null ? null : occurrence.selfServiceAllowed ? 1 : 0,
      JSON.stringify(occurrence.activityOverrides ?? []),
      occurrence.linkedOccurrenceRef ?? null,
      occurrence.updatedAt ?? null,
      new Date().toISOString(),
    ],
  );
}

export async function getOccurrences(filter?: {
  eventId?: string;
  date?: string;
  status?: OccurrenceStatus;
}): Promise<EventOccurrence[]> {
  if (USE_SESSION_MEMORY) {
    return [...memory.occurrences.values()]
      .filter((occurrence) =>
        (!filter?.eventId || occurrence.eventId === filter.eventId) &&
        (!filter?.date || occurrence.date === filter.date) &&
        (!filter?.status || occurrence.status === filter.status))
      .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  }

  const clauses: string[] = [];
  const params: string[] = [];
  if (filter?.eventId) {
    clauses.push('eventId = ?');
    params.push(filter.eventId);
  }
  if (filter?.date) {
    clauses.push('date = ?');
    params.push(filter.date);
  }
  if (filter?.status) {
    clauses.push('status = ?');
    params.push(filter.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM event_occurrences ${where} ORDER BY date, seq`,
    params,
  );
  return rows.map(mapRowToOccurrence);
}

export async function getOccurrenceById(occurrenceId: string): Promise<EventOccurrence | null> {
  if (USE_SESSION_MEMORY) return memory.occurrences.get(occurrenceId) ?? null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM event_occurrences WHERE occurrenceId = ?',
    [occurrenceId],
  );
  return row ? mapRowToOccurrence(row) : null;
}

export function mapRowToOccurrence(row: Record<string, unknown>): EventOccurrence {
  const date = row.date as string;
  const seq = row.seq as number;
  return {
    occurrenceId: row.occurrenceId as string,
    eventId: row.eventId as string,
    dateSeq: `${date}#${seq}`,
    date,
    seq,
    status: row.status as OccurrenceStatus,
    selfServiceAllowed: row.selfServiceAllowed == null
      ? row.selfServiceAllowed as null | undefined
      : (row.selfServiceAllowed as number) === 1,
    activityOverrides: parseJson<ActivityOverride[]>(row.activityOverridesJson, []),
    linkedOccurrenceRef: (row.linkedOccurrenceRef as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Rider baggage status
// ---------------------------------------------------------------------------

export async function replaceRiderBaggageStatuses(statuses: RiderBaggageStatus[]): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.baggage.clear();
    statuses.forEach((status) => memory.baggage.set(status.riderId, status));
    return;
  }

  const db = await getDatabase();
  const now = new Date().toISOString();
  await inTransaction(async () => {
    await db.runAsync('DELETE FROM rider_baggage_status');
    for (const status of statuses) {
      await db.runAsync(
        `INSERT OR REPLACE INTO rider_baggage_status
          (riderId, baggageStatus, baggageReleasedAt, lastSyncedAt)
         VALUES (?, ?, ?, ?)`,
        [status.riderId, status.baggageStatus, status.baggageReleasedAt ?? null, now],
      );
    }
  });
}

export async function upsertRiderBaggageStatus(status: RiderBaggageStatus): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.baggage.set(status.riderId, status);
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO rider_baggage_status
      (riderId, baggageStatus, baggageReleasedAt, lastSyncedAt)
     VALUES (?, ?, ?, ?)`,
    [status.riderId, status.baggageStatus, status.baggageReleasedAt ?? null, new Date().toISOString()],
  );
}

export async function getRiderBaggageStatus(riderId: string): Promise<RiderBaggageStatus | null> {
  if (USE_SESSION_MEMORY) {
    const status = memory.baggage.get(riderId);
    return status ? { ...status, baggageReleasedAt: status.baggageReleasedAt ?? null } : null;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM rider_baggage_status WHERE riderId = ?',
    [riderId],
  );
  if (!row) return null;
  return {
    riderId: row.riderId as string,
    baggageStatus: row.baggageStatus as BaggageStatus,
    baggageReleasedAt: (row.baggageReleasedAt as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Dashboard snapshots
// ---------------------------------------------------------------------------

export async function saveDashboardSnapshot(occurrenceId: string, payload: unknown): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.snapshots.set(occurrenceId, { payload, fetchedAt: new Date().toISOString() });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO event_dashboard_snapshots (occurrenceId, payloadJson, fetchedAt)
     VALUES (?, ?, ?)`,
    [occurrenceId, JSON.stringify(payload), new Date().toISOString()],
  );
}

export async function getDashboardSnapshot<T>(
  occurrenceId: string,
): Promise<{ payload: T; fetchedAt: string } | null> {
  if (USE_SESSION_MEMORY) {
    const stored = memory.snapshots.get(occurrenceId);
    return stored ? { payload: stored.payload as T, fetchedAt: stored.fetchedAt } : null;
  }

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT payloadJson, fetchedAt FROM event_dashboard_snapshots WHERE occurrenceId = ?',
    [occurrenceId],
  );
  if (!row) return null;
  const payload = parseJson<T | null>(row.payloadJson, null);
  return payload === null ? null : { payload, fetchedAt: row.fetchedAt as string };
}

// ---------------------------------------------------------------------------
// Own tour assignment (GET /v1/tours/{tourId}/users/me)
// ---------------------------------------------------------------------------

/** Pass null when the caller has no User-{tourId} record (404 USER_NOT_FOUND). */
export async function saveMyTourAssignment(
  tourId: string,
  assignment: TourUserAssignment | null,
): Promise<void> {
  if (USE_SESSION_MEMORY) {
    memory.assignments.set(tourId, { assignment, fetchedAt: new Date().toISOString() });
    return;
  }

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO my_tour_assignment (tourId, payloadJson, fetchedAt)
     VALUES (?, ?, ?)`,
    [tourId, assignment ? JSON.stringify(assignment) : null, new Date().toISOString()],
  );
}

/** Returns undefined when never fetched, null when fetched but no record exists. */
export async function getMyTourAssignment(
  tourId: string,
): Promise<{ assignment: TourUserAssignment | null; fetchedAt: string } | undefined> {
  if (USE_SESSION_MEMORY) return memory.assignments.get(tourId);

  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT payloadJson, fetchedAt FROM my_tour_assignment WHERE tourId = ?',
    [tourId],
  );
  if (!row) return undefined;
  return {
    assignment: parseJson<TourUserAssignment | null>(row.payloadJson, null),
    fetchedAt: row.fetchedAt as string,
  };
}
