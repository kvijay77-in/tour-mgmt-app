/**
 * Events API — event definitions, occurrences, activity overrides and
 * occurrence progress. Expected 400/403/404/409 responses are returned as
 * outcomes (FE design §9.1); network, 5xx and malformed responses throw.
 * See temp/api-guide.md § Events and docs/Event-Engine-Design.md.
 */

import { apiClient, ApiError, isNetworkError } from './apiClient';
import { ApiResponse } from '../../types/api';
import type {
  ActivityOverridesResponse,
  CancelActivityRecordRequest,
  CancelOccurrenceRequest,
  CreateActivityRecordRequest,
  CreateEventRequest,
  CreateOccurrenceRequest,
  EventBootstrapResponse,
  OccurrenceCompleteResponse,
  OccurrenceDashboardResponse,
  OccurrenceProgressResponse,
  ReconciliationResponse,
  RiderEventProgressResponse,
  UpdateEventRequest,
  UpdateOccurrenceRequest,
  UpsertActivityOverrideRequest,
} from '../../types/api';
import {
  ActivityOverride,
  EventActivityRecord,
  EventDefinition,
  EventOccurrence,
  OccurrenceStatus,
} from '../../types/models';
import {
  EVENT_GENERIC_MESSAGES,
  EventMessageKind,
  getEventErrorMessage,
} from '../../constants/eventMessages';

const EXPECTED_STATUSES = new Set([400, 403, 404, 409]);

export interface EventApiError {
  status: number;
  code: string;
  message: string;
  kind: EventMessageKind;
}

export type EventApiOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; error: EventApiError };

export interface ListOccurrencesQuery {
  date?: string;
  status?: OccurrenceStatus;
}

type RequestOptions = { isExpectedError: (error: ApiError) => boolean };

export interface SendOptions {
  /** apiClient retries; event sync passes 0 because its loop is the retry. */
  maxRetries?: number;
}

function isExpectedEventError(error: ApiError): boolean {
  return EXPECTED_STATUSES.has(error.statusCode);
}

function toEventApiError(error: ApiError): EventApiError {
  const code = error.errorCode?.toUpperCase() ?? '';
  const serverMessage = error.message.startsWith('HTTP ') ? undefined : error.message;
  const { message, kind } = getEventErrorMessage(code, serverMessage, error.statusCode);
  return { status: error.statusCode, code, message, kind };
}

/** Shared with hotelsApi.ts: expected 400/403/404/409 become outcomes, everything else throws. */
export async function run<T, R = T>(
  send: (options: RequestOptions) => Promise<ApiResponse<T>>,
  map: (data: T) => R = (data) => data as unknown as R,
): Promise<EventApiOutcome<R>> {
  try {
    const response = await send({ isExpectedError: isExpectedEventError });
    if (response?.data === undefined || response.data === null) {
      throw new Error('Unexpected empty response from events API');
    }
    return { kind: 'success', data: map(response.data) };
  } catch (error) {
    if (error instanceof ApiError && isExpectedEventError(error)) {
      return { kind: 'error', error: toEventApiError(error) };
    }
    throw error;
  }
}

export interface ConditionalResult<T> {
  /** null when the server answered 304 Not Modified */
  data: T | null;
  etag?: string;
}

/** GET with If-None-Match when an ETag is known; 304 yields data null. */
function runConditional<T>(path: string, etag?: string): Promise<EventApiOutcome<ConditionalResult<T>>> {
  let responseEtag: string | undefined;
  return run<ConditionalResult<T>>(async (options) => {
    const response = await apiClient.get<T>(path, {
      ...options,
      headers: etag ? { 'If-None-Match': etag } : undefined,
      // Web only sees ETag if the API exposes it via CORS; otherwise every call is a full GET.
      onResponseHeaders: (headers) => {
        responseEtag = headers.get('ETag') ?? undefined;
      },
    });
    const data = response.data ?? null;
    return { ...response, data: { data, etag: responseEtag ?? (data ? undefined : etag) } };
  });
}

export function extractItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const items = (payload as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

/** Friendly message for failures that are not expected outcomes (network, 5xx, malformed). */
export function describeUnexpectedEventError(error: unknown): string {
  if (isNetworkError(error)) return EVENT_GENERIC_MESSAGES.NETWORK;
  if (error instanceof ApiError) {
    if (error.statusCode === 0) return EVENT_GENERIC_MESSAGES.NETWORK;
    return EVENT_GENERIC_MESSAGES.REQUEST_FAILED;
  }
  return EVENT_GENERIC_MESSAGES.UNEXPECTED;
}

const enc = encodeURIComponent;

function eventsPath(tourId: string): string {
  return `/v1/tours/${enc(tourId)}/events`;
}

function eventPath(tourId: string, eventId: string): string {
  return `${eventsPath(tourId)}/${enc(eventId)}`;
}

function occurrencesPath(tourId: string, eventId: string): string {
  return `${eventPath(tourId, eventId)}/occurrences`;
}

function occurrencePath(tourId: string, eventId: string, occurrenceId: string): string {
  return `${occurrencesPath(tourId, eventId)}/${enc(occurrenceId)}`;
}

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

export function listEvents(tourId: string): Promise<EventApiOutcome<EventDefinition[]>> {
  return run<unknown, EventDefinition[]>(
    (options) => apiClient.get(eventsPath(tourId), options),
    extractItems,
  );
}

export function getEvent(tourId: string, eventId: string): Promise<EventApiOutcome<EventDefinition>> {
  return run<EventDefinition>((options) => apiClient.get(eventPath(tourId, eventId), options));
}

export function createEvent(
  tourId: string,
  body: CreateEventRequest,
): Promise<EventApiOutcome<EventDefinition>> {
  return run<EventDefinition>((options) => apiClient.post(eventsPath(tourId), body, options));
}

export function updateEvent(
  tourId: string,
  eventId: string,
  body: UpdateEventRequest,
): Promise<EventApiOutcome<EventDefinition>> {
  return run<EventDefinition>((options) => apiClient.put(eventPath(tourId, eventId), body, options));
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

export function listOccurrences(
  tourId: string,
  eventId: string,
  query: ListOccurrencesQuery = {},
): Promise<EventApiOutcome<EventOccurrence[]>> {
  const params: Record<string, string> = {};
  if (query.date) params.date = query.date;
  if (query.status) params.status = query.status;
  return run<unknown, EventOccurrence[]>(
    (options) => apiClient.get(occurrencesPath(tourId, eventId), { ...options, params }),
    extractItems,
  );
}

export function getOccurrence(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<EventOccurrence>> {
  return run<EventOccurrence>((options) =>
    apiClient.get(occurrencePath(tourId, eventId, occurrenceId), options),
  );
}

export function createOccurrence(
  tourId: string,
  eventId: string,
  body: CreateOccurrenceRequest,
): Promise<EventApiOutcome<EventOccurrence>> {
  return run<EventOccurrence>((options) =>
    apiClient.post(occurrencesPath(tourId, eventId), body, options),
  );
}

export function updateOccurrence(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  body: UpdateOccurrenceRequest,
): Promise<EventApiOutcome<EventOccurrence>> {
  return run<EventOccurrence>((options) =>
    apiClient.put(occurrencePath(tourId, eventId, occurrenceId), body, options),
  );
}

export function startOccurrence(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<EventOccurrence>> {
  return run<EventOccurrence>((options) =>
    apiClient.post(`${occurrencePath(tourId, eventId, occurrenceId)}/start`, undefined, options),
  );
}

export function completeOccurrence(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<OccurrenceCompleteResponse>> {
  return run<OccurrenceCompleteResponse>((options) =>
    apiClient.post(`${occurrencePath(tourId, eventId, occurrenceId)}/complete`, undefined, options),
  );
}

export function cancelOccurrence(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  body: CancelOccurrenceRequest = {},
): Promise<EventApiOutcome<EventOccurrence>> {
  return run<EventOccurrence>((options) =>
    apiClient.post(`${occurrencePath(tourId, eventId, occurrenceId)}/cancel`, body, options),
  );
}

// ---------------------------------------------------------------------------
// Activity overrides
// ---------------------------------------------------------------------------

export function getActivityOverrides(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<ActivityOverride[]>> {
  return run<ActivityOverridesResponse, ActivityOverride[]>(
    (options) => apiClient.get(`${occurrencePath(tourId, eventId, occurrenceId)}/activity-overrides`, options),
    extractItems,
  );
}

/** Single-activity upsert; a null field clears it, all three null removes the entry. */
export function upsertActivityOverride(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  body: UpsertActivityOverrideRequest,
): Promise<EventApiOutcome<ActivityOverride[]>> {
  return run<ActivityOverridesResponse, ActivityOverride[]>(
    (options) => apiClient.put(`${occurrencePath(tourId, eventId, occurrenceId)}/activity-overrides`, body, options),
    extractItems,
  );
}

// ---------------------------------------------------------------------------
// Dashboards, progress and reconciliation
// ---------------------------------------------------------------------------

export function getOccurrenceDashboard(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  etag?: string,
): Promise<EventApiOutcome<ConditionalResult<OccurrenceDashboardResponse>>> {
  return runConditional<OccurrenceDashboardResponse>(
    `${occurrencePath(tourId, eventId, occurrenceId)}/dashboard`,
    etag,
  );
}

/** Without an etag the server never answers 304, so data is always set. */
export function getOccurrenceProgress(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  etag?: string,
): Promise<EventApiOutcome<ConditionalResult<OccurrenceProgressResponse>>> {
  return runConditional<OccurrenceProgressResponse>(
    `${occurrencePath(tourId, eventId, occurrenceId)}/dashboard/progress`,
    etag,
  );
}

/** 400 NO_LINKED_OCCURRENCE when the occurrence has no linkedOccurrenceRef. */
export function getOccurrenceReconciliation(
  tourId: string,
  eventId: string,
  occurrenceId: string,
): Promise<EventApiOutcome<ReconciliationResponse>> {
  return run<ReconciliationResponse>((options) =>
    apiClient.get(`${occurrencePath(tourId, eventId, occurrenceId)}/reconciliation`, options),
  );
}

export function getRiderEventProgress(
  tourId: string,
  riderId: string,
  eventId?: string,
): Promise<EventApiOutcome<RiderEventProgressResponse['items']>> {
  return run<unknown, RiderEventProgressResponse['items']>(
    (options) => apiClient.get(`/v1/tours/${enc(tourId)}/riders/${enc(riderId)}/events/progress`, {
      ...options,
      params: eventId ? { eventId } : undefined,
    }),
    extractItems,
  );
}

// ---------------------------------------------------------------------------
// Activity records (scanning)
// ---------------------------------------------------------------------------

export function createActivityRecord(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  body: CreateActivityRecordRequest,
  sendOptions: SendOptions = {},
): Promise<EventApiOutcome<EventActivityRecord>> {
  return run<EventActivityRecord>((options) =>
    apiClient.post(`${occurrencePath(tourId, eventId, occurrenceId)}/records`, body, {
      ...options,
      ...sendOptions,
    }),
  );
}

export function cancelActivityRecord(
  tourId: string,
  eventId: string,
  occurrenceId: string,
  recordId: string,
  body: CancelActivityRecordRequest = {},
  sendOptions: SendOptions = {},
): Promise<EventApiOutcome<EventActivityRecord>> {
  return run<EventActivityRecord>((options) =>
    apiClient.post(
      `${occurrencePath(tourId, eventId, occurrenceId)}/records/${enc(recordId)}/cancel`,
      body,
      { ...options, ...sendOptions },
    ),
  );
}

// ---------------------------------------------------------------------------
// Bootstrap (ETag / 304)
// ---------------------------------------------------------------------------

export type EventBootstrapResult = ConditionalResult<EventBootstrapResponse>;

export function getEventBootstrap(
  tourId: string,
  etag?: string,
): Promise<EventApiOutcome<EventBootstrapResult>> {
  return runConditional<EventBootstrapResponse>(`${eventsPath(tourId)}/bootstrap`, etag);
}
