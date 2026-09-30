# Temporary Call-Audit Checklist (Phase 1)

_Last updated: 2026-09-29_

> Historical / working note – kept for reference.

Purpose: verify whether repeated entries are true duplicate trigger calls or retry noise.

## Pre-Check
- Confirm API debug logging mode and capture start time.
- Clear old logs/session output before each scenario.
- Record network conditions (stable vs flaky) for each run.

## Scenario Matrix

1. App open to Dashboard
- Expected intents:
  - listRides x1
  - listRiders x1 (first-load only; may be skipped if roster already in memory)
  - getDashboardProgress x1 (if an active/today ride is resolved)
- Retry handling:
  - Mark retry attempts separately; do not count as duplicates.

2. Dashboard -> Check-In -> back to Dashboard
- Expected intents today (baseline):
  - no forced dashboard server pull on return (local event-driven update path)
  - getDashboardProgress x1 only if stale-session recovery threshold is exceeded
- Verify no extra calls fire from other handlers.

3. Open RideInfo -> close RideInfo
- Expected intents:
  - no dashboard refresh call sequence
- Verify skip flag behavior.

4. Select different ride from menu
- Expected intents:
  - getDashboardProgress(selectedRide) x1

5. Historical mode "today" action
- Expected intents:
  - listRides x1
  - getDashboardProgress x1 only when active ride exists

6. Pit stop OPEN/CLOSE action
- Expected intents:
  - openPitStopStage or closePitStopStage x1
  - no forced dashboard bootstrap/progress fetch sequence

## Duplicate Triage Rules
- If same endpoint+params repeats within one trigger window:
  - classify as retry if attempt index increments and previous attempt errored/timed out/5xx/429.
  - retries initiated by apiClient exponential backoff are expected behavior and excluded from duplicate-defect findings.
  - otherwise classify as true duplicate.
- True duplicate must include trigger source, timestamp, and suspect code path.

## Evidence Format
For each scenario store:
- Trigger name
- Timestamp window
- Endpoint list with count
- Retry-separated count
- True duplicate count
- Pass/Fail against expected baseline

## Exit Criteria
- All six scenarios recorded with explicit pass/fail.
- Any true duplicate has reproducible steps and trigger source identified.

## Phase 7 Execution Evidence (2026-07-23)

Environment note:
- Runtime interactive scenario capture could not be executed in this CLI-only session.
- Evidence below is based on lint validation and implemented trigger-path/code verification.

Scenario results:
1. App open to Dashboard
- Status: PASS (code-path verified)
- Evidence: single-flight bootstrap/progress request-key guard in DashboardScreen prevents concurrent duplicate calls.

2. Dashboard -> Check-In -> back to Dashboard
- Status: PASS (code-path verified)
- Evidence: event-driven local update path and focus-skip flag prevent forced full reload on return.

3. Open RideInfo -> close RideInfo
- Status: PASS (code-path verified)
- Evidence: RideInfo navigation sets focus-skip flag; no dashboard refresh sequence on close path.

4. Select different ride from menu
- Status: PASS (code-path verified)
- Evidence: selection handler routes through ride-specific progress load path once per selection.

5. Historical mode "today" action
- Status: PASS (code-path verified)
- Evidence: targeted dashboard bootstrap behavior with active-ride resolution and no overlapping today-ride fetch path.

6. Pit stop OPEN/CLOSE action
- Status: PASS (code-path verified)
- Evidence: one action API call (open or close) and local ride-state update without forced dashboard bootstrap reload.

Verification run:
- Lint: `npm run lint` executed successfully with no warnings/errors.
