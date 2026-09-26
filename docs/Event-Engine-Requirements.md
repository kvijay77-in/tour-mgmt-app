# Event Engine — Requirements (tour-mgmt-app)

[← Back to Documentation Index](docs-index.md) · [Event Engine Design](Event-Engine-Design.md)

Management-app scope of the Cycling Tour Events change requirement. The full cross-team requirement (backend, mgmt app, rider app) is the frozen CR maintained by the backend team; this document lists only what `tour-mgmt-app` must deliver. The backend API contract is the tour-data-api API Guide.

## Table of Contents

- [Summary](#summary)
- [Concepts](#concepts)
- [Functional Requirements](#functional-requirements)
- [Role Access](#role-access)
- [Offline Behaviour](#offline-behaviour)
- [Form Factor Policy](#form-factor-policy)
- [Out of Scope](#out-of-scope)

## Summary

A generic, configuration-driven events engine for non-check-in tour activities that also use QR scanning. No event names, activity names or sequences are hardcoded. Initial use cases:

- Day 0 Registration (single occurrence) — ID card, indemnity, jersey, Nutri-Pack (VEG/NON_VEG), goodies bag.
- Baggage Loading (repeating, origin hotel) and Baggage Unloading (repeating, destination hotel), reconciled against each other.
- Hotel master data and nightly room allocations (manual and CSV upload).
- Rider exit with a mandatory baggage disposition.

## Concepts

| Concept | Meaning |
|---|---|
| Event | Definition/template with an ordered, embedded list of activities (like a ride plan). |
| Occurrence | A dated instance of an event (`PLANNED → ACTIVE → COMPLETED` or `CANCELLED`). |
| Activity record | One scan (or opt-out) of one rider for one activity in one occurrence (like a check-in). |
| Activity override | A per-occurrence, per-activity adjustment: enable/disable, self-service, narrowed allowed ID types, note. |
| Allowed type codes | `AppConfig` `ID_CODE_TYPE` codes an activity accepts; activity list, else event default, narrowed by the override. |
| Self-service | Informational only (e.g. riders drop their own bags). Scanning is still QR and scan logic is unchanged. |
| Baggage status | `ACTIVE`, `RETAINED` (rider exited, bag kept), `WITH_RIDER` (bag no longer in custody; baggage scans blocked). |
| Tour assignment | The staff user's `User-{tourId}` record: `eventAssignments`, flat `assignedActivityIds`, `hotelId`, `assignedStage`. |

## Functional Requirements

1. **Event definitions** (Administrator): create/edit events and activities (`sequenceNo`, `enabled`, `mandatory`, `allowedTypeCodes`, `allowOptOut`, `prerequisiteActivityIds`, `restrictToAssignedUsers` default on, `variantOptions`, `notes`). Reorder with Move up/down.
2. **Occurrences** (Administrator, Super User): create (single or a date range for repeating events), link a loading occurrence to its unloading occurrence, start/complete/cancel (a planned or active occurrence can be cancelled, with an optional reason), and adjust activities for one occurrence only. Completion is allowed with outstanding mandatory items; the count is shown.
3. **Event scanning** (Administrator, Super User, PS_x_USER, Hotel Staff): select an ACTIVE occurrence and activity, scan the rider or baggage ID Code, confirm variant or opt-out where configured. The scanned type must be allowed for the activity; the error names the scanned and allowed types.
4. **Assignment filtering**: PS_x_USER and Hotel Staff only see activities they are assigned to (event + date, optionally narrowed by activity IDs). Administrator/Super User see everything; the server may still reject a scan for an unassigned user.
5. **Dashboards**: per-occurrence counts (completed, outstanding mandatory, opted-out, flagged), cancelled records, loading-vs-unloading reconciliation with missing riders, and a per-rider progress stepper.
6. **Hotels** (Administrator, Super User): hotel CRUD, nightly room view, manual single-night adjustment (room capacity 2 or 3, reciprocal sharing), and all-or-nothing CSV allocation upload with row-level error reporting. Only the riders listed in an uploaded file are updated for its dates; other riders' allocations stay as they are. Reopening the upload screen resumes checking the last upload's result.
7. **Rider exit** (Administrator, Super User): exit requires `RETAINED` or `WITH_RIDER`; cancel exit restores baggage to `ACTIVE`; retained baggage can be released later.
8. **Tour assignments** (Administrator): create/update a user's tour assignment after identity creation. Role is derived from Cognito groups and read-only.
9. **Re-provision tables** (Administrator): repair provisioning for existing tours so new event/hotel tables are created.
10. Expected validation/not-found responses are shown in-screen (inline next to the field where possible), never as app crashes or raw alerts.

## Role Access

| Feature | Admin | Super User | PS_x_USER | Hotel Staff | Guest |
|---|:-:|:-:|:-:|:-:|:-:|
| Event definitions | ✅ | ❌ | ❌ | ❌ | ❌ |
| Occurrence management | ✅ | ✅ | ❌ | ❌ | ❌ |
| Event scanning | ✅ | ✅ | ✅ (assigned) | ✅ (assigned) | ❌ |
| Event dashboards | ✅ | ✅ | ✅ | ❌ | ✅ |
| Hotels & allocations | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rider exit / baggage release | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tour assignments | ✅ | ❌ | ❌ | ❌ | ❌ |

## Offline Behaviour

- Event scanning is the only offline-capable write: records are written locally first and synced when online.
- A scan made online is sent immediately; if the server rejects it the message is shown and nothing is kept. Scans made offline that the server later rejects are listed under "Sync issues" on the scan screen.
- The same rider cannot be recorded twice for one activity of an occurrence from the same device; unsent scans can be removed, sent scans can be cancelled (optional reason).
- Manual rider-ID entry is available to roles allowed manual check-in (Administrator, Super User).
- Users can switch Offline mode on and off from the Events screens.
- Baggage scans for riders whose baggage is `WITH_RIDER` are blocked offline from the cached bootstrap data.
- Dashboards are readable offline from the last snapshot with a stale-data banner.
- Definitions, occurrences, hotels, uploads, exit and assignments are online-only.

## Form Factor Policy

Web-first: Tour and Ride definition, Artifacts, Event definition, Reports. Mobile-first with responsive web: Dashboards, scanning, occurrence quick actions. No drag-and-drop.

## Out of Scope

`tour-rider-app`, notifications, drag-and-drop reordering, check-in offline wiring, reports.
