# Dashboard Feature

[← Back to README](../README.md)

Dashboard screen specification covering the grid display, stage views, sorting, zoom levels, color coding, and UI layout.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
  - [Rider Grid Display](#1-rider-grid-display)
  - [Stage Count Summary](#2-stage-count-summary)
  - [Stage View](#3-stage-view)
  - [Sorting](#4-sorting)
  - [Color Coding](#5-color-coding)
  - [Floating Action Button](#6-floating-action-button-fab)
  - [UI Layout](#7-ui-layout)
  - [Check-In Log Tab](#8-check-in-log-tab)
- [Event Dashboards](#event-dashboards)
- [Technical Notes](#technical-notes)

---

## Overview
The Dashboard is the home screen displaying real-time rider tracking during daily rides. It shows all riders in a grid format with color-coded status indicators based on their last check-in stage.

## Key Features

### 1. Rider Grid Display
- Grid layout with 6 columns showing Rider IDs
- Color-coded icons representing check-in status
- Default sort: Lexicographical order by Rider ID
- Dashboard status refresh uses lightweight backend progress payload (`checkIns` + `summary`) for the selected ride

### 2. Stage Count Summary
Located in the header, displays cumulative counts:
- **Stage Counts (Start, PS1, PS2, Finish)**: Includes all riders who reached that stage OR beyond
- **QR Count**: Total riders who quit (counted in stages they reached before quitting)
- **NR Count**: Riders marked as Not Riding (excluded from stage counts)

**Count Logic**: Each stage count is cumulative - includes riders at that stage plus all subsequent stages and QR riders who reached that stage.

### 3. Stage View
- Toggle buttons in footer for each stage
- Active stage view changes display perspective:
  - **Checked-in riders**: Show stage color if they reached that stage
  - **Not checked-in riders**: Show white with gray border
  - **QR riders who reached stage**: Show stage color
  - **QR riders who didn't reach**: Show red (QR color)
  - **NR riders**: Always show gray
- Click active stage button again to return to default view

### 4. Sorting
- Toggle button in footer (left side) with custom sort icon
- **Unsorted Mode**: Riders sorted by Rider ID (lexicographical)
- **Sorted Mode**:
  - **Default View**: Not checked in → QR → Start → PS1 → PS2 → Finish → NR
  - **Stage View**: Not checked in → QR → Checked in → NR
  - All groups sub-sorted by Rider ID

### 5. Color Coding

**Default View:**
- Start: Dark Orange (#D97706)
- PS1: Dark Brown (#7C2D12)
- PS2: Dark Blue (#1E40AF)
- Finish: Dark Green (#15803D)
- QR: Dark Red (#B91C1C)
- NR: Gray (#9CA3AF)
- Not Checked In: White with gray border
- `EXITED` tour riders: keep their normal tile background semantics but overlay a prominent `X` mark inside the tile (no text badge, no stage-color-based EXITED color)

**Stage View:**
- Riders who reached stage: Stage color
- Riders who didn't reach: White with gray border
- QR who didn't reach: Red
- NR: Gray

### 6. Float Badge
- Float riders show a compact shipping badge on the dashboard card when the float is still in progress.
- The badge appears in the bottom-left corner of the card so it does not obscure the rider ID text.
- In stage views, the badge is visible for all stages up to the float target stage, while the default view only shows it until the rider completes the regular check-in at the target stage.
- The badge suppresses the skipped-stage warning for stages before the float target so those stages do not appear as if the rider skipped them.

### 7. Floating Action Button (FAB)
- QR Code scanner button (teal color)
- Positioned bottom-right by default
- **Draggable**: User can move it anywhere on screen
- Always accessible during scrolling
- Tap to open QR scanner (when not dragging)

### 7. UI Layout

**Header:**
- Ride name only (date removed from header)
- Ride name is clickable and opens shared ride details
- Stage count chips with counts
- Hamburger menu with account actions
- Administrator-only menu entry for Ride status management (opens dedicated full-screen flow)
- All Rides submenu keeps planned rides blocked from dashboard launch, while a dedicated info action opens shared ride details for any ride (including planned)

**Body:**
- Scrollable rider grid
- Touch rider icon (Zoom level 1/2) to open rider card
- Rider card data is fetched on demand per rider via rider-details API (no bulk preloading)
- Rider card shows loading and retry/error states when details fetch is in progress or fails
- Rider card includes configuration-driven profile attributes grouped by section and ordered by definition
- Sensitive profile attributes are masked by default using backend `sensitiveKeys`, with in-session reveal
- File/Image profile attributes expose a View action through the rider-profile download endpoint
- Administrators can launch an online-only "Edit admin fields" flow for enabled `adminOnly` rider profile attributes

**Ride Details (shared route from header and All Rides info action):**
- Compact layout optimized to fit within visible screen area
- Shows selected ride summary with only Distance and Flag Off (scheduled) after status
- Shows route in a compact stacked layout: From and To on separate rows with start/finish flag visuals
- Uses a single merged timeline in this order: Open Time, Started, PIT_STOP stage entries, Completed
- Timeline uses per-stage progress arrows with standardized label/time alignment
- For PIT_STOP entries, highlights stage label (PSx) and shows pit-stop Open and Close timestamps
- Dismiss by tapping close icon or outside the pop-up

**Footer:**
- Sort toggle button (left)
- Stage view toggle buttons (horizontal scroll)
- Height: 60px, accommodates unlimited stages

### 8. Check-In Log Tab

The Check-In Log tab (`src/screens/checkin/CheckInLogScreen.tsx`) shows a chronological, filterable list of check-in entries for the current ride.

**Row interaction:**
- Tapping a row opens an action sheet with two options: **Rider Card** and **Cancel Entry**.
- **Rider Card** opens the same read-only rider popup used on the Dashboard tab (shared `RiderCardModal` component) — no cancel-related info is shown.
- **Cancel Entry** is disabled for rows that are already cancelled. Otherwise it opens a Yes/No confirmation dialog.

**Cancel Entry flow:**
1. Confirming calls the existing cancel-check-in API (`POST /v1/tours/{tourId}/rides/{rideId}/checkins/{checkInId}/cancel`, see [Data Integration Design](DataIntegrationDesign.md#325-dashboard-api-split-implemented-in-phase-3)) — the same endpoint used by the Start-stage override flow.
2. On success, the entry is updated to `CANCELLED` (with `prevStatus`, `cancelledAt`, `cancelledBy`) in place — **no new check-in entry is created**.
3. A success/failure confirmation popup is shown.
4. The change is published locally so the Dashboard rider grid updates immediately without a full reload (mirrors the existing check-in live-update pattern).

**Display:**
- Cancelled entries remain visible in the log with a **red strikeout** over the row text, instead of being hidden.

## Event Dashboards

Event occurrences have their own dashboard, separate from the ride dashboard above. It is opened from the Events module (EventsHome "Dashboard" on today's started occurrences, OccurrenceManagement "Dashboard" action) and needs `VIEW_DASHBOARD` (Administrator, Super User, PS_x_USER, Guest; not Hotel Staff).

- **Occurrence dashboard**: tiles for total riders, completed, outstanding mandatory (tap for the rider list → rider progress), opted out and flagged; a reconciliation tile when the occurrence has a linked occurrence; cancelled records (activity, rider, time, by whom, reason). Counts refresh every 15 s while the screen is focused and the occurrence is `ACTIVE`.
- **Baggage reconciliation**: loaded vs unloaded counts and riders whose bag was loaded but not unloaded.
- **Rider progress**: activity stepper per occurrence for one rider; also opened from the ride **Rider Card** ("View event progress").
- Offline, the last saved result is shown with a "stale data" banner.

Detail: [Event Engine Design → Screens](Event-Engine-Design.md#screens).

## Technical Notes
- Uses split API orchestration for Dashboard load:
  - Ride list drives today-ride resolution and selector options (no overlapping today-ride lookup call on initial load)
  - Rider roster from rider API
  - Grid status from lightweight Dashboard progress API (`/dashboard/progress`)
- Refresh trigger strategy (Phase 4):
  - Returning from Check-In updates Dashboard locally and does not force a full dashboard reload
  - Server pull is targeted to explicit triggers: manual refresh action, explicit ride switch, or stale-session recovery
  - In-flight request guards prevent concurrent duplicate dashboard bootstrap/progress requests for the same resource
- Rider profile/timeline data for popup is held in-memory only for the current modal session
- Offline rider-profile cache is intentionally disabled by default; feature-flag placeholder exists for future enhancement
- Sensitive profile attribute values are never stored in offline SQLite caches
- Implements React Native Animated API for FAB drag
- Responsive grid adjusts to screen width
- State management: React hooks (useState, useRef)
- Check-in offline queue/sync remains SQLite-backed; Dashboard Phase 3 display path uses API split-load strategy described in [Data Integration Design](DataIntegrationDesign.md)
- The rider card popup is implemented once as a shared component (`src/components/dashboard/RiderCardModal.tsx`) and reused by both the Dashboard tab (rider icon tap) and the Check-In Log tab (row action sheet's "Rider Card" option); shared rider-status derivation logic lives in `src/utils/riderStatus.ts`
- Cancel Entry (Check-In Log tab) publishes a dedicated local event (`DashboardCancelEvent` in `src/services/dashboard/dashboardEvents.ts`) so the Dashboard grid reflects a cancellation immediately, mirroring the existing check-in live-update event
- Cancelled entries are a server-only concept today; offline display/cancellation of entries while offline is out of scope and deferred to a future enhancement

### Backend Change Request: `checkedInByName`

- Problem: dashboard check-in entries currently expose only `checkedInBy` (Cognito username). Non-admin clients cannot resolve this to a display name.
- Preferred fix: include optional `checkedInByName` in each CheckIn object returned by `GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress`.
- Client fallback: display `"Not Available"` when `checkedInByName` is absent.

See [docs/dashboard-backend-api-change-request.md](dashboard-backend-api-change-request.md) for details and alternatives.

---

## Related Documentation

- [Requirements → Dashboard](Requirements.md#dashboard) — Functional requirements for Dashboard
- [Data Integration Design → Dashboard API Split (Implemented in Phase 3)](DataIntegrationDesign.md#325-dashboard-api-split-implemented-in-phase-3)
- [Data Integration Design → Dashboard Trigger Strategy and Duplicate-Call Controls (Implemented in Phase 4)](DataIntegrationDesign.md#326-dashboard-trigger-strategy-and-duplicate-call-controls-implemented-in-phase-4)
- [Solution Design → State Management](SolutionDesign.md#state-management) — Context and state architecture
- [Event Engine Design](Event-Engine-Design.md) — Event occurrence dashboards, reconciliation and rider progress

---

[← Back to README](../README.md)
