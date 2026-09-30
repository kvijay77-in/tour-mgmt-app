# Dashboard Call-Trigger Baseline (Phase 1)

_Last updated: 2026-09-29_

> Historical / working note – kept for reference.

Date: 2026-07-23
Scope: Dashboard-only trigger and API cardinality baseline before refactor phases.

Note: This baseline intentionally captures pre-refactor call paths (including legacy function names) for before/after comparison evidence.

## Measurement Rule
Count functional API intents per user/app trigger path.
Exclude retry attempts from apiClient automatic retry behavior.

Retry exclusion source:
- src/services/api/apiClient.ts
- maxRetries default: 3
- retryable classes: network/abort, HTTP 429, HTTP 5xx

## Trigger-to-Call Baseline

1. App load to Dashboard
- Trigger location: src/screens/dashboard/DashboardScreen.tsx (mount effect)
- Current calls:
  - listRides(tourId)
  - getActiveRide(tourId)
  - getDashboardData(tourId, activeRideId)
- Baseline cardinality: 3 functional calls

2. Dashboard focus return (Check-In/Admin return path)
- Trigger location: src/screens/dashboard/DashboardScreen.tsx (useFocusEffect)
- Current calls:
  - listRides(tourId)
  - getActiveRide(tourId)
  - getDashboardData(tourId, activeRideId)
- Baseline cardinality: 3 functional calls
- Note: RideInfo return path is explicitly skipped.

3. Check-In success then return to Dashboard
- Trigger location: src/navigation/AppNavigator.tsx (CheckInRoute)
- Current behavior:
  - onCheckInComplete callback is a no-op in route wrapper.
  - Dashboard refresh occurs via focus effect path.
- Baseline cardinality: 3 functional calls on return path

4. Ride selection from menu (including historical switch)
- Trigger location: src/screens/dashboard/DashboardScreen.tsx (handleSelectRideFromMenu)
- Current calls:
  - getDashboardData(tourId, selectedRideId)
- Baseline cardinality: 1 functional call

5. Historical mode "go to today" action
- Trigger location: src/screens/dashboard/DashboardScreen.tsx (today FAB)
- Current calls:
  - listRides(tourId)
  - getActiveRide(tourId)
  - getDashboardData(tourId, activeRideId) only if active ride exists
- Baseline cardinality: 2 or 3 functional calls

6. Pit Stop management action (OPEN/CLOSE)
- Trigger location: src/screens/dashboard/DashboardScreen.tsx (pit-stop action handlers)
- Current calls:
  - openPitStopStage(tourId, rideId, stageNumber) or
  - closePitStopStage(tourId, rideId, stageNumber)
- Baseline cardinality: 1 functional call per action
- Note: no forced full dashboard refetch after action; local ride state updates in place.
- Offline: open/close is disabled (online-only action).

7. Offline mode additions (mobile)
- Queued check-ins synced: `checkInSync.ts` publishes `dashboardEvents` reason `checkins_synced` after a batch that sent at least one check-in; the Dashboard refreshes progress once (1 functional call).
- Offline readiness refresh: `SyncStatusContext` refreshes the ride datasets (ride list, riders, the ride's progress) every `readinessRefreshMinutes` only while online, in the foreground and today's ride is OPEN/STARTED; skipped when the cached data is still fresh.
- Verify with server (Sync status, user action only): one `GET /dashboard/progress` per ride that has sent check-ins in the sent log.
- Offline: the Dashboard reads cached data from SQLite; no API calls are made.

## Phase 1 Acceptance Criteria (Call Cardinality)

1. For each trigger path, there is exactly one functional API intent per required resource.
2. Duplicate logs are only accepted when attributable to apiClient retries.
3. No concurrent duplicate in-flight request for the same endpoint+params under a single trigger.
4. Check-In return path must be distinguished from RideInfo return path in measurements.
5. Historical switch and menu ride selection remain one ride-specific data call.
6. Pit-stop action stays one action call and does not force unrelated dashboard fetches.

## Audit Log Labeling Convention
During verification, classify each observed network request as one of:
- trigger:intent
- retry:intent:attemptN
- debug:non-network

Only trigger:intent entries are counted toward call cardinality.
