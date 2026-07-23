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

**Stage View:**
- Riders who reached stage: Stage color
- Riders who didn't reach: White with gray border
- QR who didn't reach: Red
- NR: Gray

### 6. Floating Action Button (FAB)
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
- Implements React Native Animated API for FAB drag
- Responsive grid adjusts to screen width
- State management: React hooks (useState, useRef)
- Check-in offline queue/sync remains SQLite-backed; Dashboard Phase 3 display path uses API split-load strategy described in [Data Integration Design](DataIntegrationDesign.md)

---

## Related Documentation

- [Requirements → Dashboard](Requirements.md#dashboard) — Functional requirements for Dashboard
- [Data Integration Design → Dashboard API Split (Implemented in Phase 3)](DataIntegrationDesign.md#325-dashboard-api-split-implemented-in-phase-3)
- [Data Integration Design → Dashboard Trigger Strategy and Duplicate-Call Controls (Implemented in Phase 4)](DataIntegrationDesign.md#326-dashboard-trigger-strategy-and-duplicate-call-controls-implemented-in-phase-4)
- [Solution Design → State Management](SolutionDesign.md#state-management) — Context and state architecture

---

[← Back to README](../README.md)
