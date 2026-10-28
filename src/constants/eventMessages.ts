/**
 * User-facing messages for event-engine and hotel API error codes (FE design
 * §9.2) and event definition client validation (FE design §4.1).
 * A null message means the server message is shown verbatim.
 */

export type EventMessageKind = 'error' | 'info' | 'warning';

interface EventErrorMessage {
  message: string | null;
  kind: EventMessageKind;
}

export const EVENT_ERROR_MESSAGES: Record<string, EventErrorMessage> = {
  VALIDATION_ERROR: { message: null, kind: 'error' },
  INVALID_STAGE_LAYOUT: {
    message: 'This ride must have one Start stage first and one Finish stage last.',
    kind: 'error',
  },
  TOUR_NOT_ACTIVE: { message: 'This tour is not active.', kind: 'error' },
  RIDER_NOT_IN_TOUR: { message: 'This rider is not registered in the tour.', kind: 'error' },
  RIDER_NOT_FOUND: { message: 'Rider not found.', kind: 'error' },
  RIDE_NOT_FOUND: { message: 'Ride not found.', kind: 'error' },
  RIDE_NOT_TODAY: { message: 'Self-service is only available for today\'s ride.', kind: 'error' },
  RIDE_NOT_ACTIVE: { message: 'This ride is not open for self-service.', kind: 'error' },
  STAGE_NOT_FOUND: { message: 'Stage not found.', kind: 'error' },
  PIT_STOP_NOT_OPEN: { message: 'This pit stop is not open.', kind: 'error' },
  SELF_CHECKIN_NOT_ALLOWED: { message: 'Self check-in is not allowed at this stage.', kind: 'error' },
  NOT_RIDING_NOT_AVAILABLE: { message: 'Self Not Riding is only available while the ride is open.', kind: 'error' },
  QUIT_RIDING_NOT_AVAILABLE: { message: 'Self Quit Riding is not available for this ride state.', kind: 'error' },
  RIDER_ALREADY_QUIT: { message: 'This rider has already marked Quit Riding for this ride.', kind: 'error' },
  QUIT_RIDING_CANCEL_NOT_ALLOWED: { message: 'Only staff can cancel a Quit Riding check-in.', kind: 'error' },
  NOT_OWN_CHECKIN: { message: 'You can only cancel your own check-ins.', kind: 'error' },
  NOT_OWN_DATA: { message: 'You can only view your own rider data.', kind: 'error' },
  NOT_OWN_RECORD: { message: 'You can only cancel your own activity records.', kind: 'error' },
  REGISTRATION_NOT_ENABLED: { message: 'Registration is not enabled for this event.', kind: 'error' },
  REGISTRATION_CLOSED: { message: 'Registration is closed — the occurrence has already started or ended.', kind: 'error' },
  REGISTRATION_NOT_FOUND: { message: 'No registration was found for this rider.', kind: 'error' },
  RIDER_NOT_REGISTERED_FOR_EVENT: {
    message: 'Rider {riderId} is not registered for this event occurrence.',
    kind: 'error',
  },
  SELF_SERVICE_NOT_ALLOWED: { message: 'Self-service is not allowed for this activity.', kind: 'error' },
  EVENT_NOT_FOUND: { message: 'Event not found.', kind: 'error' },
  EVENT_ALREADY_EXISTS: { message: 'An event with this ID already exists.', kind: 'error' },
  OCCURRENCE_NOT_FOUND: { message: 'Occurrence not found.', kind: 'error' },
  OCCURRENCE_ALREADY_EXISTS: { message: 'An occurrence already exists for this date and sequence.', kind: 'error' },
  OCCURRENCE_CLOSED: { message: 'This occurrence is closed and cannot be edited.', kind: 'error' },
  INVALID_OCCURRENCE_TRANSITION: { message: 'This occurrence cannot be transitioned from its current status.', kind: 'error' },
  NO_LINKED_OCCURRENCE: { message: 'This occurrence has no linked occurrence to reconcile against.', kind: 'info' },
  ACTIVITY_NOT_FOUND: { message: 'Activity not found or disabled for this occurrence.', kind: 'error' },
  SCAN_TYPE_NOT_ALLOWED: { message: null, kind: 'warning' },
  DUPLICATE_ACTIVITY_RECORD: { message: 'This activity has already been recorded for this rider.', kind: 'info' },
  PREREQUISITE_NOT_MET: { message: 'Complete the required prior activity before this one.', kind: 'info' },
  OCCURRENCE_NOT_ACTIVE: { message: 'This occurrence is not currently open for scanning.', kind: 'warning' },
  BAGGAGE_NOT_IN_TOUR: { message: null, kind: 'warning' },
  RIDER_NOT_ASSIGNED: { message: 'You are not assigned to this event today.', kind: 'error' },
  HOTEL_MISMATCH: { message: 'This rider is not staying at your assigned hotel tonight.', kind: 'error' },
  HOTEL_NOT_FOUND: { message: 'Hotel not found.', kind: 'error' },
  HOTEL_ALREADY_EXISTS: { message: 'A hotel with this ID already exists.', kind: 'error' },
  ROOM_CLASH: { message: null, kind: 'warning' },
  NON_RECIPROCAL_SHARING: { message: null, kind: 'warning' },
  ROOM_CAPACITY_EXCEEDED: { message: null, kind: 'warning' },
  UPLOAD_NOT_FOUND: { message: 'Upload not found.', kind: 'error' },
  BAGGAGE_DISPOSITION_REQUIRED: { message: null, kind: 'error' },
  BAGGAGE_NOT_RETAINED: { message: 'Baggage is not currently retained for this rider.', kind: 'error' },
  RECORD_NOT_FOUND: { message: 'Activity record not found.', kind: 'error' },
  RECORD_ALREADY_CANCELLED: { message: 'This activity record has already been cancelled.', kind: 'info' },
  USER_NOT_FOUND: { message: 'User not found.', kind: 'error' },
  USER_ALREADY_EXISTS: { message: 'A user with this ID already exists.', kind: 'error' },
  INVALID_EVENT_ASSIGNMENT: {
    message: 'One or more assignments reference an event or hotel that does not exist.',
    kind: 'error',
  },
};

export const EVENT_GENERIC_MESSAGES = {
  NETWORK: 'Unable to reach the server. Check your connection and try again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  UNEXPECTED: 'An unexpected error occurred. Please try again.',
  REQUEST_FAILED: 'Request failed. Please try again.',
} as const;

export function formatEventErrorMessage(
  code: string,
  values: Record<string, string | number>,
): string | undefined {
  const template = EVENT_ERROR_MESSAGES[code.toUpperCase()]?.message;
  if (!template) return undefined;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}

export const EVENT_VALIDATION_MESSAGES = {
  EVENT_ID_FORMAT: 'Event ID must be EVT- followed by 2–20 uppercase letters or digits (e.g. EVT-BAGLOAD).',
  EVENT_NAME_REQUIRED: 'Event name is required.',
  LOCATION_REQUIRED: 'Location is required.',
  ACTIVITY_NAME_REQUIRED: 'Activity name is required.',
  ACTIVITIES_REQUIRED: 'At least one activity is required.',
  PREREQUISITE_ORDER: 'Prerequisite activities must come before this activity in sequence.',
  VARIANT_OPTIONS_MIN: 'Variant options require at least two values.',
  ALLOWED_TYPES_REQUIRED: 'Select allowed ID types for this activity or set the event default types.',
  DATE_FORMAT: 'Enter a valid date as YYYY-MM-DD.',
  SEQ_POSITIVE: 'Sequence must be a positive whole number.',
  DATE_RANGE_ORDER: 'The end date must be on or after the start date.',
  OVERRIDE_TYPES_REQUIRED: 'Select at least one ID type, or choose Inherit.',
} as const;

/** Event scanning copy (FE design §4.3). {placeholders} are filled by the screen. */
export const EVENT_SCAN_MESSAGES = {
  BAGGAGE_WITH_RIDER_OFFLINE:
    'Baggage for {rider} was released to the rider{releasedAt} and is no longer carried by the tour.',
  ESCALATE_HINT: 'Contact a tour administrator if this baggage should still be handled.',
  OCCURRENCE_NOT_ACTIVE_HINT: 'Scanning opens when an administrator starts this occurrence. Refresh to check again.',
  NOT_ASSIGNED_TODAY: 'You are not assigned to any events today.',
  NO_ACTIVITIES_ASSIGNED: 'You are not assigned to any activity of this occurrence.',
  NO_ACTIVITIES_ENABLED: 'No activities are enabled for this occurrence.',
  NOT_AVAILABLE_OFFLINE: 'This occurrence is not in the offline cache. Connect to the internet and try again.',
  SELECT_ACTIVITY: 'Select an activity to start scanning.',
  RECORDED: 'Recorded: {rider} · {activity}',
  RECORDED_FLAGGED: 'Recorded late and flagged for review: {rider} · {activity}',
  QUEUED: 'Saved on this device: {rider} · {activity}. It will be sent when the connection returns.',
  RIDER_NOT_IN_TOUR: 'Rider {riderId} is not registered in this tour.',
  MANUAL_TYPE_REQUIRED: 'Select the ID type.',
  VARIANT_REQUIRED: 'Choose an option before confirming.',
  SCAN_CANCELLED: 'Scan cancelled.',
  CANCEL_QUEUED: 'Cancellation saved on this device and will be sent when online.',
  UNSENT_REMOVED: 'Unsent scan removed.',
  ALREADY_SENT: 'This scan was just sent to the server. Cancel it again to cancel it there.',
  SAVE_FAILED: 'The scan could not be saved on this device. Please try again.',
  WEB_SESSION_ONLY:
    'On web this list is kept only for the current browser session and is cleared when the page is reloaded. Recorded scans are saved on the server.',
} as const;

/** Event dashboard, reconciliation and rider progress copy. {placeholders} are filled by the screen. */
export const EVENT_DASHBOARD_MESSAGES = {
  STALE: 'Showing data saved on this device at {time}. It may be out of date.',
  NOT_SAVED_OFFLINE: 'This data has not been saved on this device yet. Connect to the internet and try again.',
  NO_RECORDS: 'No activity has been recorded for this occurrence yet.',
  NO_VARIANCE: 'No variance — all bags accounted for.',
  OCCURRENCE_GONE: 'This occurrence no longer exists. It may have been removed elsewhere.',
  RIDER_PROGRESS_OFFLINE: 'Offline — showing saved dashboard data and scans on this device only.',
  RIDER_NO_PROGRESS: 'No event activity has been recorded for this rider yet.',
} as const;

export const REGISTRATION_MESSAGES = {
  OFFLINE: 'Registration management requires an internet connection.',
  NOT_ENABLED: 'Registration is not enabled for this event.',
  READ_ONLY: 'Registration changes are available only while the occurrence is planned.',
  NO_TOUR: 'No active tour is selected.',
  NO_REGISTRATIONS: 'No riders are registered for this occurrence.',
  NO_RIDERS: 'No eligible tour riders are available to register.',
  REGISTERED: '{rider} registered for this occurrence.',
  UNREGISTERED: '{rider} unregistered from this occurrence.',
} as const;

/** Hotel master data and manual allocation copy (FE design §4.7, §4.9). {placeholders} are filled by the screen. */
export const HOTEL_MESSAGES = {
  HOTEL_ID_FORMAT: 'Hotel ID must be HTL- followed by 3 letters, a dash and 2 digits (e.g. HTL-MDU-01).',
  HOTEL_NAME_REQUIRED: 'Hotel name is required.',
  CITY_REQUIRED: 'City is required.',
  ADDRESS_REQUIRED: 'Address is required.',
  HOTEL_REQUIRED: 'Select a hotel.',
  ROOM_NO_REQUIRED: 'Room number is required.',
  ROOM_NO_FORMAT: 'Room number can have up to 10 letters, digits, "/" or "-".',
  ROOM_CLASH: 'Room {roomNo} at {hotelName} is already allocated to {otherRiderName} on {stayDate}.',
  ROOM_CAPACITY: 'Room {roomNo} cannot hold more than {roomCapacity} riders on this date.',
  CLASH_CHECK_UNAVAILABLE: 'Room occupancy could not be checked. The server verifies it when you save.',
  RIDER_NOT_IN_TOUR: 'Rider {riderId} is not registered in this tour.',
  OFFLINE: 'Hotel management requires a connection. Actions are disabled while offline.',
  NO_HOTELS: 'No hotels yet. Add the first hotel for this tour.',
  NO_STAYS: 'No rooms are allocated at this hotel on this date.',
  SAVED: 'Allocation saved for {rider} on {stayDate}.',
} as const;

/** Hotel allocation CSV upload copy (FE design §4.8, §14). {placeholders} are filled by the screen. */
export const HOTEL_UPLOAD_MESSAGES = {
  OFFLINE: 'Connect to the internet to upload hotel allocations.',
  NOT_CSV: 'Select a .csv file.',
  EMPTY: 'The selected file is empty.',
  TOO_LARGE: 'The file is {size}. The maximum allowed size is {max}.',
  UPLOADING: 'Uploading…',
  VALIDATING: 'Validating…',
  RESUMED: 'Checking the result of your last upload ({uploadId})…',
  S3_FAILED: 'The file could not be uploaded. Check your connection and try again.',
  APPLIED: '{appliedCount} allocations applied for {rowCount} rows.',
  REJECTED: 'This file was not applied — fix the {errorCount} issue(s) below and re-upload the corrected file. No allocations were changed.',
  MORE_ISSUES: 'More issues may be reported after these are fixed.',
  STILL_VALIDATING: 'Still validating — check back later.',
  PROCESSING_FAILED_TITLE: 'Processing failed',
  NOT_FOUND: 'This upload no longer exists. Upload the file again.',
  CAPPED_FOOTER: 'Showing {shown} of {total} issues. Fix these and re-upload to see the rest.',
} as const;

/** Rider exit and baggage release copy (FE design §4.10). {placeholders} are filled by the screen. */
export const RIDER_EXIT_MESSAGES = {
  OFFLINE: 'Rider exit requires a connection. Actions are disabled while offline.',
  DISPOSITION_REQUIRED: 'Choose whether baggage is retained or released before exiting this rider.',
  RIDER_NOT_IN_TOUR: 'Rider {riderId} is not registered in this tour.',
  EXITED: '{rider} has exited the tour.',
  EXIT_CANCELLED: 'Exit cancelled for {rider}.',
  RELEASED: 'Retained baggage released to {rider}.',
  RELEASE_UNAVAILABLE: 'Only retained baggage can be released.',
  STATUS_UNAVAILABLE: 'Rider status could not be loaded. The server checks it when you save.',
} as const;

/** Tour assignment copy (FE design §4.11). {placeholders} are filled by the screen. */
export const TOUR_USER_MESSAGES = {
  OFFLINE: 'Tour assignments require a connection. Actions are disabled while offline.',
  NO_TOUR: 'No tour is selected.',
  NO_SUPPORTED_ROLE: 'This user has no supported role group. Assign a group in Modify user first.',
  USER_GONE: 'This user no longer exists. They may have been removed elsewhere.',
  RECORD_EXISTS_RELOADED: 'This user already has an assignment for this tour. It has been reloaded — review and save again.',
  SAVED: 'Tour assignment saved for {user}.',
  NO_EVENTS: 'No events are defined for this tour yet.',
  NO_HOTELS: 'No hotels are defined for this tour yet.',
  NO_ACTIVITY_RESTRICTION: 'No activities selected — the user may scan every activity of the assigned events.',
  DATES_REQUIRED: 'Select at least one date, or choose All dates.',
  NO_TOUR_DATES: 'The tour dates are not available, so specific dates cannot be chosen. Use All dates.',
  SHARED_ACTIVITY_ID: '{activityId} exists in more than one assigned event ({events}). The selection applies to all of them.',
  USER_NOT_LISTED: 'The requested user was not found in the user list. Choose a user below.',
  NO_CHANGES: 'No changes to save.',
} as const;

/** Maps a backend error code to the app message; falls back to the server message. */
export function getEventErrorMessage(
  code: string | undefined,
  serverMessage: string | undefined,
  status?: number,
): { message: string; kind: EventMessageKind } {
  const mapped = code ? EVENT_ERROR_MESSAGES[code.toUpperCase()] : undefined;
  if (mapped?.message) {
    return { message: mapped.message, kind: mapped.kind };
  }
  const fallback = status === 403 && !serverMessage
    ? EVENT_GENERIC_MESSAGES.FORBIDDEN
    : serverMessage || EVENT_GENERIC_MESSAGES.REQUEST_FAILED;
  return { message: fallback, kind: mapped?.kind ?? 'error' };
}
