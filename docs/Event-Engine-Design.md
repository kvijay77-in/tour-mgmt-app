# Event Engine — Design (tour-mgmt-app)

[← Back to Documentation Index](docs-index.md) · [Event Engine Requirements](Event-Engine-Requirements.md)

Frontend design for the events engine in `tour-mgmt-app`, adapted from the cross-team frontend design to this app's architecture and to decisions agreed with the product owner. The backend API Guide is the authoritative contract for endpoints, fields and error codes.

## Table of Contents

- [Delivery Phases](#delivery-phases)
- [Key Decisions](#key-decisions)
- [Deviations from the Original Frontend Design](#deviations-from-the-original-frontend-design)
- [Permissions](#permissions)
- [Navigation](#navigation)
- [Screens](#screens)
- [State and Offline](#state-and-offline)
- [Types](#types)
- [Scan Resolution](#scan-resolution)
- [Effective Activity Rules](#effective-activity-rules)
- [Local Storage (SQLite)](#local-storage-sqlite)
- [App Configuration](#app-configuration)
- [API Conventions](#api-conventions)

## Delivery Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: permissions, types, scan resolution, helpers, SQLite schema/stores, config | Done |
| 2 | Navigation revamp: Home hub + web sidebar | Done |
| 3 | Event definitions & occurrences admin | Done |
| 4 | Event scanning + offline for event operations | Done |
| 5 | Event dashboards & rider progress | Done |
| 6 | Hotels & allocations (incl. CSV upload) | Done |
| 7 | Rider exit, tour assignments, re-provision | Done |

## Key Decisions

- **Self-service** is informational only (badge/note). Scanning is always QR and scan logic never changes.
- **Permissions** stay Cognito-group based: groups map to app feature permissions in `src/constants/roles.ts`, mirroring the backend group matrix. No new groups.
- **Assignment filtering**: Administrator/Super User are not filtered client-side (the server may reject with `RIDER_NOT_ASSIGNED`/`HOTEL_MISMATCH`). PS_x_USER/Hotel Staff are filtered by their own record from `GET /v1/tours/{tourId}/users/me`.
- **`assignedActivityIds` is flat**: an ID applies to every assigned event that has that activity ID.
- **dietaryPreference** is read lazily from the rider profile for variant activities and cached in SQLite.
- **baggageStatus** comes from the events bootstrap (`riderBaggageStatus`).
- **Offline** is wired for event operations only; check-in offline wiring remains a known gap (see [SolutionDesign.md](SolutionDesign.md#offline-architecture)).
- **Hotel CSV upload**: new presign per attempt, `Content-Type: text/csv`, polling every 3 s for up to 3 minutes, all-or-nothing outcome only, resumable polling via a per-tour stored `uploadId`.

## Deviations from the Original Frontend Design

| Original design | This app | Reason |
|---|---|---|
| New "Events" tab in `MainTabs` | Group-aware Home hub + web sidebar with an Events module | Navigation revamp; ride module stays unchanged |
| `ScanConfirmationCard` extracted from `CheckInScreen`; `StatusMessage` reused | New `ScanConfirmationCard` and `StatusBanner` under `src/components/events/` | No `CheckInScreen` refactor |
| New `Permission` enum members named after backend permissions | App permissions `MANAGE_EVENTS`, `MANAGE_EVENT_OCCURRENCES`, `EVENT_SCAN`, `MANAGE_HOTEL_ALLOCATIONS`, `MANAGE_TOUR_USERS`, `RIDER_EXIT` mapped from groups | Existing group → feature mapping pattern |
| snake_case SQLite tables in separate store files | camelCase columns, schema centralised in `database.ts` | Existing SQLite convention |
| `resolveScannedRiderId(qrText, allowedTypes = ['RIDER'])` | `resolveScannedRiderId(qrText, allowedTypeCodes?)` taking ID_CODE_TYPE codes | Omitted list keeps exact check-in behaviour; codes come from event config |
| Drag-and-drop reorder on web | Move up/down buttons on all form factors | No drag-and-drop dependency |
| Exit/release actions in `RiderCardModal` | Dedicated `RiderExitScreen` | Keeps the ride card read-only |
| Offline built on existing sync | Event-only sync orchestrator; check-in path untouched | Existing sync is not wired today |
| Free role picker in tour assignment | Role derived from Cognito groups, read-only | Group hierarchy decides role |
| Assignment filtering for all scanners | Admin/SU unfiltered | Product owner decision |
| Upload progress bar | Indeterminate "Uploading…" indicator | Existing uploader has no progress callback; CSV files are small |
| No client file-size limits | Size pre-check from `HOTEL_UPLOAD`/`PROCESSING` `maxFileSizeBytes` when available | Single source with the backend processor; skipped when unavailable |
| Cancel only from `ACTIVE` | Cancel offered for `PLANNED` and `ACTIVE` occurrences | API Guide example cancels a planned (rest-day) occurrence |
| Quick toggle sends the new value | Quick toggle sends `null` when the new value equals the inherited value | Avoids pinning redundant overrides; the entry disappears when nothing is overridden |
| Toast confirmations | In-screen info `StatusBanner` that clears after 4 s | No toast library |
| Event ops share the check-in outbound timer | Separate `eventSyncService` loop (~3 s) for event op types only | Check-in sync is not wired; check-in path untouched |
| Every hard reject goes to "Sync issues" | Only background-sync rejects are kept (FAILED, "Sync issues"); a reject while sending interactively is shown at once and the local record is removed | The scanner already saw the message; no stale failed rows |
| Manual entry of a rider ID only | Manual entry also picks the ID type when the activity allows more than one (`typeCode` is required unless opted out) | Contract needs `typeCode` |
| `BAGGAGE_NOT_IN_TOUR` pre-check | Client block only while offline (baggage type + cached `WITH_RIDER`); online the server decides | Server message is authoritative online |
| Variant default from bootstrap | Default from rider profile `dietaryPreference`, fetched per scan online and cached in SQLite | Bootstrap does not carry it (D-C) |
| `RiderProgress { riderId }` | `RiderProgress { riderId, eventId?, occurrenceId? }` | Dashboard drill-downs focus the occurrence (shown first, even with no records; offline read from its snapshot) |
| Tapping a completed stepper node shows `scannedBy`/`timestamp` | Not offered | Rider progress API returns status only |
| "Contact" affordance on reconciliation missing riders | Rows open rider progress | Name directory has no contact data; ride Rider Card shows the phone |
| Reconciliation drill-down only when variance is non-zero | Tile always opens the reconciliation screen | Also shows `NO_LINKED_OCCURRENCE`/errors in place |
| Outstanding tile filters the rider list | Toggles an in-screen "outstanding mandatory" rider list | No separate list screen |
| `ReadOnlyProfileHeader` shows the rider photo | Initials avatar (component accepts an optional `photoUrl`) | The profile picture endpoint is not a management-app endpoint |
| Manual adjustment opened from `RiderCardModal` | Opened from the room-wise view or "Allocate a rider" (rider ID) in HotelManagement | Plan scope; keeps the ride card read-only |
| Room-clash pre-check against the cached `hotelStayStore` | Pre-check against `GET /hotels/{hotelId}/hotelstays?date` for the night; warnings do not block saving (only the `sharingWith` cap does) | Cache holds only today; the server makes the final check |
| Presign again when `expiresIn` has passed | Presign immediately before every `PUT` | A URL is never kept between attempts, so it cannot expire unused |
| "Tour Assignments" entry on `TourManagement` | Administration entry in the Home hub / SideNav (and "Assign to this tour →" after onboarding) | Navigation revamp; TourManagement stays tour/ride definition only |
| `eventAssignments` as repeatable event-picker rows with a multi-date picker | One checkbox row per tour event; "Specific dates" picks from the tour's date range as chips | No duplicate event rows possible; no date-picker dependency |
| `assignedActivityIds` sent as selected | Saved de-duplicated and limited to activities of the assigned events | Unreachable IDs have no effect (D-P) |
| Release action on the rider detail screen with a tooltip when not `RETAINED` | Release action on `RiderExitScreen`, disabled with a hint when not `RETAINED` | Dedicated exit screen (D-G); no tooltip component |
| Onboarding success message | In-screen success confirmation (replaces the success alert) carrying "Assign to this tour →" | The action must also work on web, where alerts cannot hold buttons |

## Permissions

| App permission | Backend permission | Groups |
|---|---|---|
| `MANAGE_EVENTS` | `EVENT_MANAGE` | ADMINISTRATOR |
| `MANAGE_EVENT_OCCURRENCES` | `EVENT_OCCURRENCE_MANAGE` | ADMINISTRATOR, SUPER_USER |
| `EVENT_SCAN` | `EVENT_SCAN` | ADMINISTRATOR, SUPER_USER, PS_x_USER, HOTEL_STAFF |
| `MANAGE_HOTEL_ALLOCATIONS` | `HOTEL_ALLOC_MANAGE` | ADMINISTRATOR, SUPER_USER |
| `MANAGE_TOUR_USERS` | `USER_MANAGE` | ADMINISTRATOR |
| `RIDER_EXIT` | `RIDER_EXIT` | ADMINISTRATOR, SUPER_USER |
| `VIEW_DASHBOARD` (existing) | `DASHBOARD` | ADMINISTRATOR, SUPER_USER, PS_x_USER, GUEST |

Backend `READ` is held by every authenticated role, so it needs no app permission.

## Navigation

Detail in [SolutionDesign.md § Navigation Structure](SolutionDesign.md#navigation-structure).

- `src/navigation/modules.ts` is the single module/section registry used by `HomeScreen` (initial route) and `SideNav` (web ≥ 768 px). Each entry has a visibility predicate (permission or role, matching the route registration gates) and a typed target route.
- Entries without a target stay hidden. Events and Event definitions became active in Phase 3, Hotels & Baggage in Phase 6, Tour assignments and Rider exit in Phase 7.

| Section | Entry | Visible to | Route (phase) |
|---|---|---|---|
| Ride Day | Ride Day | `VIEW_DASHBOARD` or `CHECKIN_RIDER` | `MainTabs` |
| Events | Events | `EVENT_SCAN`, `VIEW_DASHBOARD` or `MANAGE_EVENT_OCCURRENCES` | `EventsHome` (3) |
| Hotels & Baggage | Hotels & Baggage | `MANAGE_HOTEL_ALLOCATIONS` | `HotelManagement` (6) |
| Administration | Define/Update Tour | Administrator, Super User (read-only) | `TourManagement` |
| Administration | Ride status management, Artifacts, User management (4 items) | Administrator | existing admin routes |
| Administration | Event definitions | `MANAGE_EVENTS` | `EventDefinitionList` (3) |
| Administration | Tour assignments | `MANAGE_TOUR_USERS` | `TourUserAssignment` (7) |
| Administration | Rider exit | `RIDER_EXIT` | `RiderExit` (7) |

- A user with exactly one visible entry is reset straight to it; Home button and sidebar are hidden for that user.
- `AppMenu` keeps ride-module items only. Change password and Logout move to the Home account menu and SideNav, but remain in `AppMenu` for single-module users so they are never unreachable.
- SideNav sits outside the stack and uses the container ref in `src/navigation/navigationRef.ts`.
- Phase 3 registered `EventsHome`, `EventDefinitionList`, `EventDefinitionEditor { eventId? }` and `OccurrenceManagement { eventId }` (gated by the Events visibility rule, `MANAGE_EVENTS`, `MANAGE_EVENTS` and `MANAGE_EVENT_OCCURRENCES`). Every current role now reaches Ride Day and Events, so all roles land on the Home hub.
- Phase 4 registered `EventScan { eventId, occurrenceId }` (gated by `EVENT_SCAN`), opened from EventsHome's Scan list and from the Scan action on ACTIVE occurrences in OccurrenceManagement.
- Phase 5 registered `OccurrenceDashboard { eventId, occurrenceId }` and `BaggageReconciliation { eventId, occurrenceId }` (gated by `VIEW_DASHBOARD`) and `RiderProgress { riderId, eventId?, occurrenceId? }` (all authenticated roles, backend `READ`). Entries: "Dashboard" on non-`PLANNED` occurrences in EventsHome (event list; icon on Scan rows for PS_x_USER) and OccurrenceManagement; RiderProgress from dashboard/reconciliation drill-downs and "View event progress" in `RiderCardModal` (via `navigationRef`).
- Phase 6 registered `HotelManagement`, `HotelAllocationUpload` (full-screen modal, `onClose`) and `HotelAllocationAdjust { riderId, stayDate }`, all gated by `MANAGE_HOTEL_ALLOCATIONS`, and enabled the Hotels & Baggage module entry.
- Phase 7 registered `RiderExit` (gated by `RIDER_EXIT`) and `TourUserAssignment { userId? }` (gated by `MANAGE_TOUR_USERS`) and enabled both Administration entries. `UserOnboarding` success offers "Assign to this tour →", which replaces the onboarding modal with `TourUserAssignment { userId }` (the new user's Cognito `sub` from the create response).

## Screens

All event admin screens are online-only (offline banner, actions disabled). EventsHome and EventScan work offline from the SQLite cache and show `OfflineBanner` (status, manual Offline mode toggle, queued and sync-issue counts). Expected API errors are shown in-screen via `StatusBanner`; a `404` for the event shows a full-screen "no longer exists" message with a back button.

### EventsHomeScreen (Events module)

- **Scan · active now** (`EVENT_SCAN`): today's `ACTIVE` occurrences. Administrator/Super User see all; PS_x_USER/Hotel Staff see only occurrences with at least one effective-enabled activity passing `isActivityAvailableToUser`, else "You are not assigned to any events today". Tapping opens EventScan.
- Event list (name, type, location, activity count) with today's occurrences per event (`GET .../occurrences?date=<today>`, device-local date). Not shown to PS_x_USER/Hotel Staff (their view is the Scan list).
- "Manage definitions" for `MANAGE_EVENTS`; "Occurrences" per event for `MANAGE_EVENT_OCCURRENCES` (both hidden offline). "Dashboard" per non-`PLANNED` occurrence for `VIEW_DASHBOARD` (also offline, from the snapshot); PS_x_USER get a dashboard icon on their Scan rows.
- Online: API. Offline: events and today's occurrences from the bootstrap cache.
- Reloads on focus; refresh button and pull-to-refresh (online also refreshes the bootstrap).

### EventDefinitionListScreen / EventDefinitionEditorScreen (`MANAGE_EVENTS`, web-first)

- List: cards with name, type, ID, location, activity count; "New Event"; empty state with CTA.
- Editor ≥ 768 px: event fields in a left rail, activity rows (table) on the right. < 768 px: event fields then expandable activity cards (collapsed: sequence, name, Enabled/Mandatory badges).
- Activity fields: name, enabled, mandatory, allow opt-out, assigned users only (default on), allowed ID types (empty = inherit event default, shown as "Inherits: …"), prerequisites (earlier activities only), variant options (comma-separated), notes. New activities get the next `ACT-###`; Move up/down recomputes `sequenceNo` 1..n. Only unsaved activities can be removed; saved ones are disabled instead.
- Client validation: `EVT-[A-Z0-9]{2,20}` event ID (create only), event name, location, at least one activity, activity name, prerequisites earlier in sequence, ≥ 2 variant values when any, and each activity resolves to at least one allowed ID type (own or event default). Server `400` messages are shown verbatim in the banner; `EVENT_ALREADY_EXISTS` is shown on the Event ID field.
- Create posts the full definition; edit sends only changed fields (`activities` as a whole list when any activity changed). Success returns to the list.

### OccurrenceManagementScreen (`MANAGE_EVENT_OCCURRENCES`)

- Read-only definition header (type, location, sequence rule, `ActivityChipList`).
- Occurrence rows: date, seq, status, self-service badge, linked occurrence, cancel reason. Actions: Start (`PLANNED`), Complete (`ACTIVE`), Cancel (`PLANNED`/`ACTIVE`, optional reason), Edit (open occurrences), Activities (expand).
- Complete: fetches `dashboard/progress` first and asks "N rider-activity item(s) outstanding. Complete anyway?" (count unavailable is stated); the result message uses `outstandingMandatoryCount` from `/complete`.
- New occurrence: date, seq, self-service (default from `allowSelfService`), linked occurrence picker listing other events' occurrences on the same date. `OCCURRENCE_ALREADY_EXISTS` is shown on the form. REPEATING events also offer "Generate for date range" (max 60 days): sequential POSTs with a per-date result list.
- Edit: `selfServiceEnabled` and `linkedOccurrenceRef` (None clears it with `null`); only changed fields are sent.
- Activity panel per occurrence: effective enabled/self-service with override badges and note; quick toggles for Enabled and Self-service (single-field upsert; `null` when matching the inherited value) and "Adjust…" opening `ActivityOverrideEditor` (Inherit/On/Off for enabled and self-service, Inherit or narrow ID types within the activity's base set, note). Setting all three to Inherit removes the override. Local state is replaced with the returned `items[]`. Closed occurrences disable all edits.
- `404`/`OCCURRENCE_CLOSED`/`INVALID_OCCURRENCE_TRANSITION` show the message and reload the occurrence list.
- ACTIVE occurrences show a "Scan" action for `EVENT_SCAN` holders.

### EventScanScreen (`EVENT_SCAN`)

- Loads the event and occurrence from the API when online (and upserts them into SQLite), else from the cache; `404` → full-screen message + back; not cached offline → "not in the offline cache". A bootstrap rewrite reloads them from the cache. Not `ACTIVE` → `OCCURRENCE_NOT_ACTIVE` warning, scanner hidden.
- Activity chips: effective-enabled activities in `sequenceNo` order, filtered by `isActivityAvailableToUser` (Admin/SU unfiltered, D-O). A single activity is auto-selected.
- Scanner: camera only while focused and idle, `processingRef` + scan-pause cooldown (`qr_scan_pause_seconds`, same setting as check-in). Manual rider-ID entry for `MANUAL_CHECKIN` roles, with an ID type choice when the activity allows several; an ID missing from the rider name directory is rejected inline.
- Resolution: `resolveScannedRiderId(raw, getEffectiveAllowedTypeCodes(...))`; `TYPE_NOT_ALLOWED_FOR_EVENT` → warning.
- Pre-checks: offline only, a `BAGGAGE` type for a rider whose cached `baggageStatus` is `WITH_RIDER` is blocked (rider + release date, "Escalate" shows a contact-admin hint); local duplicate (this device's non-cancelled, non-failed record) → `DUPLICATE_ACTIVITY_RECORD` info.
- `ScanConfirmationCard`: rider, activity, ID type, self-service badge and override note, variant radio (default = rider `dietaryPreference` when it matches an option; Confirm disabled until chosen), "Opt out" when `allowOptOut` (no `typeCode`, `outcome: OPTED_OUT`). Auto-submit toggle, disabled for variant activities.
- Submit: write local record + queue; online → sent at once (older queued event ops first); offline or transient failure → "saved on this device". Outcomes: synced (flagged noted), `DUPLICATE_ACTIVITY_RECORD`/`PREREQUISITE_NOT_MET` info, `RIDER_NOT_ASSIGNED`/`HOTEL_MISMATCH` error without retry, `SCAN_TYPE_NOT_ALLOWED` via `formatTypeNotAllowedMessage()`, `BAGGAGE_NOT_IN_TOUR` server message verbatim. Success/failure/scan-tick sounds as in check-in.
- Recent scans on this device (last 10, newest first) with Queued/Synced/Flagged/Cancelled badges. Cancel: unsynced → removed locally with its queued create; synced → optional reason, queued cancel (sent at once when online). "Sync issues" lists background-sync rejects with the message and a Dismiss action.

### OccurrenceDashboardScreen (`VIEW_DASHBOARD`, mobile-first)

- Header: event name, `date #seq`, status badge, location. Online: `GET .../dashboard` + event definition, then `.../dashboard/progress` and (when `linkedOccurrenceRef` is set) `.../reconciliation`.
- Tiles (2 per row < 768 px, 3 per row ≥ 768 px): total riders, completed, outstanding mandatory, opted out, flagged (from progress; counted from the dashboard payload if progress is unavailable). The outstanding tile toggles a rider list (riders with a `PENDING` mandatory activity, with the activity names) → RiderProgress.
- Reconciliation tile (linked occurrences only): "{loaded} loaded vs {unloaded} unloaded", missing count, or the error message → BaggageReconciliation.
- Cancelled records: activity name, rider, `cancelledAt`, `cancelledBy` (app-user name directory), `cancelReason`.
- Empty state when nothing has been recorded. `404` → full-screen "no longer exists" + back; other expected errors → banner.
- Polling: `dashboard/progress` every 15 s while focused, online, not stale and `ACTIVE`; when counts change the dashboard (and reconciliation) are re-fetched.
- Offline, or when the request fails unexpectedly: last snapshot + warning banner "Showing data saved on this device at {time}"; no snapshot → info message.

### BaggageReconciliationScreen (`VIEW_DASHBOARD`)

- `GET .../reconciliation`: Loaded / Unloaded columns and "Loaded but not unloaded" rider list (name + ID → RiderProgress); empty → "No variance — all bags accounted for."
- `400 NO_LINKED_OCCURRENCE` → info banner; `404` → full-screen message + back. Offline/unexpected failure → snapshot with stale banner.

### RiderProgressScreen (all roles)

- One card per occurrence with an `ActivityStepper` over effective-enabled activities in `sequenceNo` order. Node status: server status (`COMPLETED`, `OPTED_OUT`, `FLAGGED`), else "Saved on this device" (this device's unsynced record), else "Waiting for earlier activity" (a prerequisite, or an earlier activity when `sequenceEnforced`, has no record — display hint only), else Pending.
- Occurrences shown: those with records, `ACTIVE` occurrences, and the focused `occurrenceId` (listed first); then date descending. `eventId` narrows the API call and the list.
- Online: `GET /riders/{riderId}/events/progress` + `listEvents` + `listOccurrences` per relevant event (for overrides/status). Offline: cached events/occurrences, the focused occurrence's dashboard snapshot row and this device's synced/unsynced records, with an info banner. Reloads on focus and when the bootstrap cache or the unsynced count changes.

### HotelManagementScreen (`MANAGE_HOTEL_ALLOCATIONS`, responsive)

Online-only: offline shows a warning banner and disables actions (no manual Offline toggle; that is for Events screens).

- Hotel list (name, city, ID, address, contact, notes), sorted by name; ≥ 768 px hotels and rooms side by side, stacked below.
- "New hotel" / edit form: `hotelId` (create only, `HTL-AAA-99`), `name`, `city`, `address` required; `contact`, `notes` optional. Edit sends only changed fields. `HOTEL_ALREADY_EXISTS` is shown on the Hotel ID field; `HOTEL_NOT_FOUND` on the form and the list reloads.
- Rooms for the selected hotel and night (default today, device-local): `GET /hotels/{hotelId}/hotelstays?date`, grouped by `roomNo` in server order, with occupancy `n/capacity`, sharing list and Manual/Upload source badge. A rider row opens `HotelAllocationAdjust`. "Allocate a rider" takes a rider ID (checked against the rider name directory) for riders not yet in a room.
- "Upload allocations" opens `HotelAllocationUpload`. Reloads on focus.

### HotelAllocationUploadScreen (`MANAGE_HOTEL_ALLOCATIONS`, modal)

- Online-only: offline shows "Connect to the internet to upload hotel allocations" and disables the picker.
- On open: `listAppConfigs(['HOTEL_UPLOAD'])` → enabled `PROCESSING` item → `maxFileSizeBytes` (positive finite number, else no size pre-check, D-S); the picker is enabled once this finishes. Online, a stored last `uploadId` for the tour resumes polling (D-R).
- Collapsible "File format" help with the FE §14.4 content only (sample, directives before the header, required columns, room-mate rule, merge rule wording, row numbers = file line numbers, UTF-8).
- Picker (`pickArtifactFile`; web `.csv`, native `text/*` + CSV MIME types): the name must end in `.csv`, the file must not be empty, and the size must not exceed `maxFileSizeBytes` when known.
- Upload: new presign every attempt (first upload, "Try again" after an S3 failure, "Upload again"), then `uploadToPresignedUrl` with `contentType` forced to `text/csv` and an indeterminate "Uploading…" indicator (D-Q). The `uploadId` is stored only after the S3 `PUT` succeeds.
- Polling: every 3 s (resume polls at once) for up to 3 minutes, single attempt per poll; `PENDING`/`VALIDATING` → "Validating…"; thrown (network/5xx) poll errors continue; cap → "Still validating — check back later" + "Upload again" (uploadId kept). Other expected poll errors are shown with "Upload again".
- `APPLIED`: "{appliedCount} allocations applied for {rowCount} rows." + Done; `room_allocations` cleared and today's stays re-fetched.
- `REJECTED` (not all Processing): "This file was not applied — fix the {errorCount} issue(s) below …" + "More issues may be reported after these are fixed." unless every error is Cross-row, `RowErrorTable`, "Choose another file".
- `REJECTED` where every error is Processing-group: "Processing failed" banner with the server message(s) verbatim, no table, "Upload again".
- `404 UPLOAD_NOT_FOUND`: full-screen message + "Back to hotels".
- Stored uploadId is removed on `APPLIED`, `REJECTED` and `404`.

### HotelAllocationAdjustScreen (`MANAGE_HOTEL_ALLOCATIONS`)

- `ReadOnlyProfileHeader` (name from the rider name directory, rider ID). The current allocation for the night comes from `GET /riders/{riderId}/hotelstays`; `UPLOAD`-sourced stays are edited like any other.
- Form: hotel (chips), `roomNo` (1–10 letters, digits, `/`, `-`), `roomCapacity` 2|3 (default 2), `sharingWith` rider search + chips capped at capacity − 1, optional `checkInDate`/`checkOutDate` (YYYY-MM-DD).
- Pre-check: when a hotel is chosen, `GET /hotels/{hotelId}/hotelstays?date=<stayDate>`. Other riders in the same room who are not in `sharingWith` → clash warning "Room {roomNo} at {hotelName} is already allocated to {otherRiderName} on {stayDate}."; occupancy above capacity → "Room {roomNo} cannot hold more than {roomCapacity} riders on this date.". If the check fails a note says the server verifies on save.
- Save: `PUT /hotelstays/{stayDate}/{riderId}` (always sends `sharingWith`, dates only when entered). `ROOM_CLASH`, `NON_RECIPROCAL_SHARING`, `ROOM_CAPACITY_EXCEEDED` → warning banner with the server message; `HOTEL_NOT_FOUND` → hotel field. Success upserts the stay into `room_allocations` and returns to the previous screen.

### RiderExitScreen (`RIDER_EXIT`)

Online-only: offline shows a warning banner and disables actions.

- Rider search over the rider name directory plus `GET /v1/tours/{tourId}/riders` (which also supplies tour status and exit/baggage fields). A selected ID missing from the tour list is flagged as not registered.
- Status panel: tour status, baggage status (tour rider item, else the bootstrap `rider_baggage_status` cache), status before exit, exited at, baggage note, released at.
- Exit (not `EXITED`): mandatory radio "Baggage retained by organisers" (`RETAINED`) / "Rider is taking baggage now" (`WITH_RIDER`), optional note; Confirm disabled until chosen. `400 BAGGAGE_DISPOSITION_REQUIRED` → server message under the radio.
- Cancel exit (`EXITED`): `ConfirmDialog`; the server restores `status` and sets `baggageStatus=ACTIVE`.
- Release retained baggage: enabled only when baggage is `RETAINED` (hint otherwise); `ConfirmDialog` with optional note.
- Every success replaces the rider's state with the returned `TourRider` item and upserts `rider_baggage_status` (so the offline `WITH_RIDER` scan block follows at once). `RIDER_ALREADY_EXITED`, `INVALID_EXIT_CANCEL_INVOCATION` and `BAGGAGE_NOT_RETAINED` show the message and reload the rider list; other messages come from the server verbatim unless mapped in `EVENT_ERROR_MESSAGES`.

### TourUserAssignmentScreen (`MANAGE_TOUR_USERS`)

Online-only. Loads managed users (`GET /v1/admin/usermgmt/users`), `GET /v1/tours/{tourId}/users`, events and hotels.

- User picker (name/email search, "Assigned" badge when a tour record exists); `userId` route param preselects. Read-only identity header (name, email, username, groups) and tour record status.
- Role = `resolvePrimaryRole(groups)`, read-only; none → "assign a group in Modify user first" and the form is hidden.
- `assignedStage` (PS_x_USER only): chips of the user's own PS group numbers (fixed when only one). `hotelId` (Hotel Staff only): hotel chips or None.
- Event assignments: one checkbox row per event (plus rows for assigned IDs no longer defined, so they can be removed); "All dates" or "Specific dates" chosen from the tour date range (at least one date).
- Activities (when an event is assigned): chips grouped by assigned event toggling one flat ID list; a warning names the events when a selected ID exists in more than one of them (D-P). Empty = no restriction.
- Save: no record → `POST` (`userId`, `role`, and only set optional fields); record → `PUT` with changed fields only, `null` removing a field (e.g. `hotelId`/`assignedStage` when the role no longer uses it). Save is disabled when nothing changed.
- `INVALID_EVENT_ASSIGNMENT` → inline under Event assignments (and the hotel field when a hotel is set); `USER_NOT_FOUND` → full-screen message + "Back to user list"; `USER_ALREADY_EXISTS` → reload the tour user list, switch to update and ask to review.

### Re-provision tables (TourManagementScreen)

Administrator only, shown once `provisionedAt` is set: `ConfirmDialog` → `tourApi.reprovisionTour()` (`PUT /v1/tours/{tourId}/provision`); the returned tour is applied and `provisionedTables` is listed (or "no missing tables"). See [create-manage-tour.md](create-manage-tour.md).

## State and Offline

Detail in [DataIntegrationDesign.md § Event Engine Offline](DataIntegrationDesign.md#47-event-engine-offline).

- `OfflineProvider` is mounted in `RootNavigator` (authenticated tree); effective offline = manual toggle or NetInfo. The manual toggle is offered on Events screens only.
- `EventSessionContext` (mounted in `AppNavigator` above the stack): selected event/occurrence/activity, this device's recent records for the selected occurrence, failed records, unsynced count, cached own assignment, `cacheVersion`, `refreshBootstrap()`. It starts/stops the event sync loop with tour + connectivity.
- Bootstrap (`src/services/events/eventBootstrapService.ts`): `GET .../events/bootstrap` with `If-None-Match` (304 keeps the cache) plus `GET /v1/tours/{tourId}/users/me` (404 → no assignment). Triggers: tour ready and online (retried on reconnect until it succeeds), foreground after > 5 min in background, pull-to-refresh on EventsHome, after an outbound event batch that synced something.
- Event sync (`src/services/sync/eventSyncService.ts`): one serial queue for the ~3 s loop and interactive sends; only `CREATE_EVENT_ACTIVITY_RECORD`/`CANCEL_EVENT_ACTIVITY_RECORD`. Check-in offline wiring remains a known gap.
- Assumption (non-blocking, not yet confirmed by backend): `assignedActivityIds` narrowing does not apply to activities with `restrictToAssignedUsers=false` (backend §9.3 point 3).

## Types

- `src/types/models.ts`: `EventDefinition`, `EventActivity`, `EventOccurrence` (`OccurrenceStatus`), `ActivityOverride`, `EventActivityRecord` (`ActivityOutcome`, `EventRecordMethod`), `Hotel`, `RoomAllocation`, `RiderBaggageStatus` (`BaggageStatus`), `EventAssignment`, `TourUserAssignment`. `Rider` gains `baggageStatus`, `baggageReleasedAt`, `dietaryPreference`; `TourRider` gains exit and baggage audit fields.
- `src/types/api.ts`: request/response types for events, occurrences, overrides, records, dashboards, bootstrap, hotels, stays, uploads, rider exit and tour users.
- `src/types/config.ts`: `HotelUploadProcessingConfig`.

## Scan Resolution

`resolveScannedRiderId(rawQrText, allowedTypeCodes?)` in `src/services/idcode/idCodeService.ts`:

- Without `allowedTypeCodes`: unchanged — only `RIDER` type is accepted, `ERR_INVALID_ID_TYPE` otherwise. All check-in call sites pass nothing.
- With `allowedTypeCodes`: the scanned type code must be an enabled `ID_CODE_TYPE` entry and in the list, otherwise reason `TYPE_NOT_ALLOWED_FOR_EVENT` with `ERR_TYPE_NOT_ALLOWED_FOR_EVENT` naming the scanned type and allowed type names (`formatTypeNotAllowedMessage()`, also used for server `SCAN_TYPE_NOT_ALLOWED`).
- Success returns `typeCode` and `bagLabel` (ID_CODE_TYPE `name`) in addition to `riderId` and `parsed`.
- Legacy dev format (`EXPO_PUBLIC_QR_DEV_FORMAT=true`) always yields type `1` and skips type filtering, so non-rider codes cannot be tested in that mode.

## Effective Activity Rules

Pure helpers in `src/utils/eventActivity.ts`:

| Helper | Rule |
|---|---|
| `getEffectiveActivityEnabled` | Override `enabled` if set, else activity `enabled` |
| `getEffectiveAllowedTypeCodes` | Activity codes if non-empty, else event default; override codes narrow (intersection) |
| `getEffectiveSelfService` | Override `selfServiceEnabled` if set, else occurrence `selfServiceEnabled` (display only) |
| `nextActivityId` / `recomputeSequence` | Next `ACT-###`; `sequenceNo` = 1..n in list order |
| `isActivityAvailableToUser` | Admin/SU → yes; `restrictToAssignedUsers=false` → yes; else assignment for the event and date (`"ALL"` or listed) and, if `assignedActivityIds` is non-empty, the activity is listed |

## Local Storage (SQLite)

New tables (schema in `src/services/database/database.ts`, detail in [DataIntegrationDesign.md §4.2](DataIntegrationDesign.md#42-sqlite-schema)):

| Table | Store | Purpose |
|---|---|---|
| `events` | `eventStore.ts` | Event definitions (activities as JSON) |
| `event_occurrences` | `eventStore.ts` | Upcoming occurrences with overrides |
| `rider_baggage_status` | `eventStore.ts` | Offline `BAGGAGE_NOT_IN_TOUR` block |
| `event_dashboard_snapshots` | `eventStore.ts` via `eventDashboardService.ts` | Last event definition, dashboard, progress and reconciliation per occurrence (with `tourId`; other tours' rows are ignored) for offline/stale display |
| `my_tour_assignment` | `eventStore.ts` | Caller's `User-{tourId}` record (null = none) |
| `event_activity_records` | `eventRecordStore.ts` | Write-local-first scans with sync state |
| `room_allocations` | `hotelStayStore.ts` | Nightly stays (today from bootstrap; cleared + today re-fetched after an `APPLIED` upload; manual saves upserted) |

- `riders.dietaryPreference` is added via the add-column-if-missing pattern; rider upserts no longer overwrite it.
- `pending_operations` gains `CREATE_EVENT_ACTIVITY_RECORD` and `CANCEL_EVENT_ACTIVITY_RECORD`. The existing check-in outbound sync only reads `CHECK_IN` operations.

## App Configuration

- `GET /v1/config` accepts any `configType` and returns `404` when no enabled rows exist; `listAppConfigs()` maps that 404 to an empty list.
- `CONFIG_TYPE.HOTEL_UPLOAD` / `HOTEL_UPLOAD_PROCESSING_CONFIG_ID = 'PROCESSING'` provide the CSV upload `maxFileSizeBytes`. If missing or invalid the pre-check is skipped and the server's `FILE_TOO_LARGE` applies.
- The last hotel upload per tour is kept in AsyncStorage under `hotelUpload:lastUploadId:{tourId}` (see [DataIntegrationDesign.md](DataIntegrationDesign.md)).

## API Conventions

- Expected `400/403/404/409` responses are returned as discriminated-union outcomes (as in `checkInApi.ts`) and rendered in-screen; `try/catch` is only for network, `5xx` or malformed responses.
- `occurrenceId` (`EVT-...#YYYY-MM-DD#seq`) and `recordId` (`<riderId>#<activityId>#<timestamp>`) contain `#`/`:` and are always URL-encoded in paths.
- `src/services/api/eventsApi.ts` returns `EventApiOutcome<T>` = `{ kind: 'success', data }` | `{ kind: 'error', error: { status, code, message, kind } }` for `400/403/404/409`; messages come from `src/constants/eventMessages.ts` (FE §9.2, server message verbatim where marked). Other failures throw; screens use `describeUnexpectedEventError()`.
- Activity override PUT follows backend §8.9a merge semantics: a field sent as `null` clears only that field; when `enabled`, `selfServiceEnabled` and `allowedTypeCodes` all end up `null` the entry is removed.
- Conditional GETs (`runConditional` in `eventsApi.ts`) send `If-None-Match` only when an ETag was received and return `data: null` on `304`: bootstrap, occurrence dashboard and dashboard progress. `eventDashboardService.ts` keeps the last ETag + payload in memory per occurrence and reuses the payload on `304`. `getOccurrenceProgress()` without an ETag (used before Complete) always returns data.
- `apiClient` handles `304 Not Modified` (success without data) and exposes response headers via `onResponseHeaders` (used for the bootstrap `ETag`). On web the ETag is readable only if the API exposes it through CORS; otherwise every bootstrap is a full GET.
- Event record create/cancel from the sync service use `maxRetries: 0`; the sync loop is the retry.
- `src/services/api/hotelsApi.ts` reuses the `eventsApi` outcome runner (`run`, `extractItems`) and returns `EventApiOutcome<T>`; hotel messages are in `HOTEL_MESSAGES`/`HOTEL_UPLOAD_MESSAGES` (`eventMessages.ts`). `UPLOAD_ERROR_GROUPS` maps upload status codes to File / Row / Cross-row / Processing (api-guide table); `getUploadErrorGroup()` treats unknown codes as Row. Upload status polls use `maxRetries: 0`.
- Rider exit (`riderApi.exitRider`/`cancelRiderExit`/`releaseRiderBaggage`) and tour users (`tourUserApi.listTourUsers`/`createTourUser`/`updateTourUser`) also return `EventApiOutcome<T>`; copy in `RIDER_EXIT_MESSAGES`/`TOUR_USER_MESSAGES`. `tourApi.reprovisionTour()` follows the existing throwing `tourApi` style. `createCognitoUser()` now returns the new `cognitoUserId`.
