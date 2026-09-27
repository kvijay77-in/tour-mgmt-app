/**
 * Hotels API — hotel master data, nightly room allocations (stays) and the
 * allocation CSV upload (presign + status). Expected 400/403/404/409 responses
 * are returned as outcomes (FE design §9.1); network, 5xx and malformed
 * responses throw. See temp/api-guide.md § Hotels and docs/Event-Engine-Design.md.
 */

import { apiClient } from './apiClient';
import { EventApiOutcome, extractItems, run } from './eventsApi';
import type {
  CreateHotelRequest,
  HotelUploadPresignResponse,
  HotelUploadStatus,
  UpdateHotelRequest,
  UpsertHotelStayRequest,
} from '../../types/api';
import { Hotel, RoomAllocation } from '../../types/models';

const enc = encodeURIComponent;

function tourPath(tourId: string): string {
  return `/v1/tours/${enc(tourId)}`;
}

// ---------------------------------------------------------------------------
// Upload status error groups (backend §8.25a); used only to pick banner copy.
// ---------------------------------------------------------------------------

export type UploadErrorGroup = 'FILE' | 'ROW' | 'CROSS_ROW' | 'PROCESSING';

export const UPLOAD_ERROR_GROUPS: Record<string, UploadErrorGroup> = {
  FILE_TOO_LARGE: 'FILE',
  INVALID_ENCODING: 'FILE',
  INVALID_HEADER: 'FILE',
  EMPTY_FILE: 'FILE',
  TOO_MANY_ROWS: 'FILE',
  MISSING_STAY_DATES: 'FILE',
  INVALID_STAY_DATES: 'FILE',
  TOO_MANY_STAY_DATES: 'FILE',
  MALFORMED_ROW: 'ROW',
  MISSING_RIDER_ID: 'ROW',
  INVALID_RIDER_ID: 'ROW',
  UNKNOWN_RIDER_ID: 'ROW',
  RIDER_NOT_ELIGIBLE: 'ROW',
  MISSING_HOTEL_ID: 'ROW',
  INVALID_HOTEL_ID: 'ROW',
  UNKNOWN_HOTEL_ID: 'ROW',
  MISSING_ROOM_NO: 'ROW',
  INVALID_ROOM_NO: 'ROW',
  INVALID_ROOM_CAPACITY: 'ROW',
  INVALID_SHARING_WITH: 'ROW',
  DUPLICATE_RIDER_FOR_DATE: 'CROSS_ROW',
  NON_RECIPROCAL_SHARING: 'CROSS_ROW',
  ROOM_CLASH: 'CROSS_ROW',
  ROOM_CAPACITY_EXCEEDED: 'CROSS_ROW',
  CONCURRENT_MODIFICATION: 'PROCESSING',
  PROCESSING_TIMEOUT: 'PROCESSING',
  PROCESSING_ERROR: 'PROCESSING',
};

/** Unknown codes fall back to the Row group so a new backend code never breaks the screen. */
export function getUploadErrorGroup(code: string | undefined | null): UploadErrorGroup {
  return (code && UPLOAD_ERROR_GROUPS[code.toUpperCase()]) || 'ROW';
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export function listHotels(tourId: string): Promise<EventApiOutcome<Hotel[]>> {
  return run<unknown, Hotel[]>(
    (options) => apiClient.get(`${tourPath(tourId)}/hotels`, options),
    extractItems,
  );
}

export function createHotel(tourId: string, body: CreateHotelRequest): Promise<EventApiOutcome<Hotel>> {
  return run<Hotel>((options) => apiClient.post(`${tourPath(tourId)}/hotels`, body, options));
}

export function updateHotel(
  tourId: string,
  hotelId: string,
  body: UpdateHotelRequest,
): Promise<EventApiOutcome<Hotel>> {
  return run<Hotel>((options) => apiClient.put(`${tourPath(tourId)}/hotels/${enc(hotelId)}`, body, options));
}

// ---------------------------------------------------------------------------
// Hotel stays (RoomAllocation)
// ---------------------------------------------------------------------------

export function listStaysByDate(tourId: string, date: string): Promise<EventApiOutcome<RoomAllocation[]>> {
  return run<unknown, RoomAllocation[]>(
    (options) => apiClient.get(`${tourPath(tourId)}/hotelstays`, { ...options, params: { date } }),
    extractItems,
  );
}

export function listStaysByRider(tourId: string, riderId: string): Promise<EventApiOutcome<RoomAllocation[]>> {
  return run<unknown, RoomAllocation[]>(
    (options) => apiClient.get(`${tourPath(tourId)}/riders/${enc(riderId)}/hotelstays`, options),
    extractItems,
  );
}

/** Server-sorted by roomNo, riderId; every night when date is omitted. */
export function listStaysByHotel(
  tourId: string,
  hotelId: string,
  date?: string,
): Promise<EventApiOutcome<RoomAllocation[]>> {
  return run<unknown, RoomAllocation[]>(
    (options) => apiClient.get(`${tourPath(tourId)}/hotels/${enc(hotelId)}/hotelstays`, {
      ...options,
      params: date ? { date } : undefined,
    }),
    extractItems,
  );
}

/** Manual single-night upsert; the server stores source=MANUAL. */
export function upsertHotelStay(
  tourId: string,
  stayDate: string,
  riderId: string,
  body: UpsertHotelStayRequest,
): Promise<EventApiOutcome<RoomAllocation>> {
  return run<RoomAllocation>((options) =>
    apiClient.put(`${tourPath(tourId)}/hotelstays/${enc(stayDate)}/${enc(riderId)}`, body, options),
  );
}

// ---------------------------------------------------------------------------
// Allocation CSV upload
// ---------------------------------------------------------------------------

/** Call once per upload attempt; a presigned URL is never reused. */
export function presignHotelUpload(tourId: string): Promise<EventApiOutcome<HotelUploadPresignResponse>> {
  return run<HotelUploadPresignResponse>((options) =>
    apiClient.post(`${tourPath(tourId)}/hotelstays/uploads/presign`, undefined, options),
  );
}

/** Single attempt (no client retries); the polling loop is the retry. */
export function getHotelUploadStatus(
  tourId: string,
  uploadId: string,
): Promise<EventApiOutcome<HotelUploadStatus>> {
  return run<HotelUploadStatus>((options) =>
    apiClient.get(`${tourPath(tourId)}/hotelstays/uploads/${enc(uploadId)}`, { ...options, maxRetries: 0 }),
  );
}
