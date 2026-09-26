/**
 * Event bootstrap service — refreshes the offline event cache.
 *
 * GET /v1/tours/{tourId}/events/bootstrap (If-None-Match/304) writes events,
 * upcoming occurrences, today's hotel stays and rider baggage status to SQLite.
 * GET /v1/tours/{tourId}/users/me refreshes the caller's own assignment on every
 * run (404 = no assignment, stored as null).
 *
 * Triggers (EventSessionContext / screens): tour ready after sign-in, app
 * foreground after > 5 min, pull-to-refresh on EventsHome, after an outbound
 * event sync batch. See docs/DataIntegrationDesign.md § Event Bootstrap.
 */

import { getEventBootstrap } from '../api/eventsApi';
import { getMyTourUser } from '../api/tourUserApi';
import {
  replaceEvents,
  replaceOccurrences,
  replaceRiderBaggageStatuses,
  saveMyTourAssignment,
} from '../database/eventStore';
import { replaceStaysForDate } from '../database/hotelStayStore';
import { EventBootstrapResponse } from '../../types/api';
import { RoomAllocation } from '../../types/models';
import { toLocalDateString } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';

const TAG = 'EventBootstrap';

export interface EventBootstrapRefreshResult {
  /** True when the cache was rewritten (200); false on 304 or failure */
  updated: boolean;
  /** Set when the bootstrap or assignment request failed */
  error?: string;
}

const etagByTour = new Map<string, string>();
const inFlightByTour = new Map<string, Promise<EventBootstrapRefreshResult>>();

/** Concurrent calls for the same tour share one request. */
export function refreshEventBootstrap(tourId: string): Promise<EventBootstrapRefreshResult> {
  const existing = inFlightByTour.get(tourId);
  if (existing) return existing;

  const task = runRefresh(tourId).finally(() => {
    inFlightByTour.delete(tourId);
  });
  inFlightByTour.set(tourId, task);
  return task;
}

async function runRefresh(tourId: string): Promise<EventBootstrapRefreshResult> {
  const [bootstrap, assignment] = await Promise.allSettled([
    getEventBootstrap(tourId, etagByTour.get(tourId)),
    getMyTourUser(tourId),
  ]);

  const errors: string[] = [];

  if (assignment.status === 'fulfilled') {
    await saveMyTourAssignment(tourId, assignment.value);
  } else {
    logger.warn(TAG, 'Own tour assignment refresh failed', assignment.reason);
    errors.push('assignment');
  }

  let updated = false;
  if (bootstrap.status === 'rejected') {
    logger.warn(TAG, 'Bootstrap request failed', bootstrap.reason);
    errors.push('bootstrap');
  } else if (bootstrap.value.kind === 'error') {
    logger.warn(TAG, 'Bootstrap rejected', { code: bootstrap.value.error.code, status: bootstrap.value.error.status });
    errors.push('bootstrap');
  } else {
    const { data, etag } = bootstrap.value.data;
    if (data) {
      await writeBootstrap(data);
      updated = true;
    }
    if (etag) {
      etagByTour.set(tourId, etag);
    }
  }

  return { updated, error: errors.length > 0 ? errors.join(',') : undefined };
}

async function writeBootstrap(payload: EventBootstrapResponse): Promise<void> {
  await replaceEvents(payload.events ?? []);
  await replaceOccurrences(payload.activeOccurrences ?? []);
  await replaceRiderBaggageStatuses(payload.riderBaggageStatus ?? []);

  const staysByDate = new Map<string, RoomAllocation[]>();
  for (const stay of payload.hotelStaysToday ?? []) {
    const list = staysByDate.get(stay.stayDate) ?? [];
    list.push(stay);
    staysByDate.set(stay.stayDate, list);
  }
  if (staysByDate.size === 0) {
    staysByDate.set(toLocalDateString(), []);
  }
  for (const [stayDate, stays] of staysByDate) {
    await replaceStaysForDate(stayDate, stays);
  }

  logger.info(TAG, 'Event cache refreshed', {
    events: payload.events?.length ?? 0,
    occurrences: payload.activeOccurrences?.length ?? 0,
  });
}
