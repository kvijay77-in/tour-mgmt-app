# Dashboard API Optimization Proposal

[← Back to README](../README.md)

## Purpose
This document requests backend API optimization for Dashboard workflows only. The goal is to reduce payload size, improve refresh latency, and remove unnecessary coupling between Dashboard refresh and full ride/rider datasets.

This proposal is intended as a backend handoff artifact. Frontend implementation will start only after backend contract readiness is confirmed.

## Approval Status
Backend API contract is approved for Dashboard optimization scope.

- Approved date: 2026-07-23
- Contract source of truth: /home/kvija/tour-mgmt-app/temp/api-guide.md
- Frontend execution scope unlocked: Phase 1 and Phase 2 complete, Phase 3+ ready to start

## Scope
In scope:
- Dashboard progress refresh data contract
- Rider popup details contract (single rider, selected ride)
- Conditional request support for frequent refresh checks

Out of scope:
- Non-dashboard modules
- Backend data model redesign beyond Dashboard endpoints
- Persistent offline rider-profile cache (future enhancement only)

## Current Problem Summary
Observed inefficiencies in current Dashboard flow:
- Heavy composite payload is used for frequent refresh operations.
- Ride and riders datasets are returned even when only progress/state is required.
- Overlapping endpoint usage increases network and processing overhead.
- Focus return paths (for example, after Check-In) can trigger avoidable reload behavior.

## Proposed Backend Changes

Contract alignment note:
- The endpoints in this proposal are now confirmed in the API guide contract.
- ETag + If-None-Match + 304 behavior is confirmed for both dashboard progress and rider details endpoints.

### 1) Add lightweight Dashboard progress endpoint
Endpoint:
- GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress

Intent:
- Return only the data required to refresh Dashboard grid status and stage-count summary.
- Exclude ride object and riders array.

Proposed response shape:
- rideId
- checkIns[]
- summary
- dataVersion (for diagnostics/cache tracing)

> **Update:** A `cancelled[]` array (same shape as `checkIns[]`, entries with `status="CANCELLED"` plus `prevStatus`/`cancelledAt`/`cancelledBy`) was added alongside `checkIns[]` to support the Check-In Log tab's Cancel Entry feature. See [Data Integration Design → Dashboard API Split](DataIntegrationDesign.md#325-dashboard-api-split-implemented-in-phase-3) for the current contract.

Example:
{
  "success": true,
  "data": {
    "rideId": "RIDE005",
    "checkIns": [
      {
        "checkInId": "R57#001#2026-07-23T09:31:22Z",
        "riderId": "R57",
        "rideId": "RIDE005",
        "stageNumber": 1,
        "stageId": "S001",
        "isNotRiding": false,
        "isQuitRiding": false,
        "method": "QR_SCAN",
        "timestamp": "2026-07-23T09:31:22Z",
        "checkedInBy": "user-123"
      }
    ],
    "summary": {
      "totalRiders": 100,
      "checkedIn": 65,
      "notRiding": 4,
      "quitRiding": 3,
      "notCheckedIn": 28
    },
    "dataVersion": "2026-07-23T09:31:30Z"
  },
  "timestamp": "2026-07-23T09:31:30Z"
}

### 2) Add rider popup details endpoint with timeline
Endpoint:
- GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details

Intent:
- Fetch fresh rider profile and selected-ride timeline only when popup is opened.
- Keep payload limited to popup rendering needs.

Proposed response shape:
- rider (popup-required profile fields)
- checkInTimeline[] (selected ride + rider)
- latestStatus (optional but preferred)

Example:
{
  "success": true,
  "data": {
    "rider": {
      "riderId": "R57",
      "profileId": "abc-123",
      "name": "Jane Doe",
      "phone": "+1-555-1000",
      "photoS3Key": "photos/R57.jpg"
    },
    "checkInTimeline": [
      {
        "checkInId": "R57#000#2026-07-23T08:00:00Z",
        "stageNumber": 0,
        "stageId": "S000",
        "isNotRiding": false,
        "isQuitRiding": false,
        "timestamp": "2026-07-23T08:00:00Z"
      },
      {
        "checkInId": "R57#001#2026-07-23T09:31:22Z",
        "stageNumber": 1,
        "stageId": "S001",
        "isNotRiding": false,
        "isQuitRiding": false,
        "timestamp": "2026-07-23T09:31:22Z"
      }
    ],
    "latestStatus": "CHECKED_IN"
  },
  "timestamp": "2026-07-23T09:31:30Z"
}

Notes:
- Exclude cancelled timeline entries by default unless explicit query behavior is added.
- If ride or rider is not found, return 404 using standard API error schema.

### 3) Add conditional request support (ETag)
Required for both new endpoints:
- Response header: ETag
- Request header: If-None-Match
- 304 Not Modified when data has not changed

This is required to reduce repeated payload transfer during frequent Dashboard refresh checks.

### 4) Keep current endpoints intact during rollout
No immediate removal is requested for existing endpoints.

Frontend switch policy:
- Frontend will move to optimized Dashboard flow only after new contracts are available and validated.
- No temporary dual-path fallback is planned in the frontend implementation branch.

### 5) Optional fallback if new endpoints are delayed
If dedicated endpoints cannot be delivered in the near term, provide compact mode on existing endpoint:
- GET /v1/tours/{tourId}/rides/{rideId}/dashboard?include=checkIns,summary

Preferred direction remains dedicated endpoints for lower coupling and clearer contracts.

Current status:
- This fallback is not required for current implementation planning because dedicated endpoints are approved.

## Performance Targets
- Dashboard progress payload: typical size below 20 KB
- Rider details payload: typical size below 5 KB
- P95 response time: below 300 ms (same region)

## Functional Expectations
- Preserve functional equivalence for Dashboard status and stage-count computation.
- Rider popup response must include sufficient fields for popup rendering:
  - riderId
  - name
  - contact
  - photo reference
  - stage timeline for selected ride
- Data must reflect latest backend state at request time.

## Error Contract Expectations
Use existing API error schema consistently:
- 400 validation errors
- 401 authentication errors
- 403 authorization errors
- 404 missing ride or rider
- 409 conflicts when applicable
- 5xx server errors

Stable error code values are required for reliable client handling.

## Security and Privacy Requirements
- Keep existing JWT authentication and tour scoping.
- Return only fields required by Dashboard and rider popup use cases.
- Do not expand rider-list response scope in rider details endpoint.
- Frontend requirement: rider profile data used for popup should remain in memory by default (no persistent device storage).

## Rollout and Validation Plan
1. Backend shares final schema and representative error samples.
2. Backend deploys to dev/stage.
3. Frontend validates contract behavior, payload size, and response latency.
4. Frontend implements optimized Dashboard flow in a separate implementation phase.
5. Backend and frontend jointly verify reduced call volume and render-latency improvements.

## Acceptance Criteria
- New endpoint(s) available in dev/stage with documented schema.
- ETag and 304 behavior validated.
- Dashboard refresh flow no longer depends on heavy ride+rider payloads.
- Rider popup fetches single-rider details on demand.
- Measurable reduction in payload transfer and Dashboard refresh latency.

## Assumptions
1. Existing endpoint GET /v1/tours/{tourId}/rides/{rideId}/dashboard remains available during rollout.
2. Current check-in and summary semantics remain authoritative and unchanged.
3. Rider popup data freshness is prioritized over local persistence.
4. Backend can expose deterministic ETag behavior for both progress and rider-details responses.

## Backend Resolution Summary
1. Rider timeline endpoint is approved as a dedicated endpoint:
  - GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details
  - Response includes popup-focused rider fields and selected-ride checkInTimeline.
2. Rider details payload is confirmed to include popup-required rider identity/contact fields and timeline entries, with cancelled entries excluded.
3. ETag behavior is confirmed for both approved optimization endpoints:
  - GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress
  - GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details
4. Compact-mode fallback on legacy dashboard endpoint is not required for current frontend execution.
5. Authorization matrix coverage is confirmed for Dashboard scope roles in api-guide.

## Owner and Scope Declaration
Requested by: Frontend app team  
Feature scope: Dashboard only

---

## Related Documentation
- [Requirements](Requirements.md)
- [Solution Design](SolutionDesign.md)
- [Data Integration Design](DataIntegrationDesign.md)
- [Dashboard Feature](Dashboard-Feature.md)

[← Back to README](../README.md)