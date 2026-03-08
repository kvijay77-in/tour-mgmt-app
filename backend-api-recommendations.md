# Backend API Recommendations for Error Handling

These are recommended changes to the `tour-data-api` backend to improve error handling efficiency on the client app.

## 1. Distinct Error Codes for "Not Found" vs "No Active Entity"

Currently `GET /v1/tours/active` and `GET /v1/tours/{tourId}/rides/active` both return a **generic 404** when there is no active tour/ride. The client cannot distinguish between "no active tour today" (normal state) and "tour ID doesn't exist" (unexpected).

**Recommendation** — return specific error codes:

```json
// GET /v1/tours/active — no active tour
HTTP 404
{
  "error": { "code": "NO_ACTIVE_TOUR", "message": "No tour is currently active." }
}

// GET /v1/tours/{tourId}/rides/active — no active ride
HTTP 404
{
  "error": { "code": "NO_ACTIVE_RIDE", "message": "No active ride found for today." }
}

// GET /v1/tours/{tourId} — tour ID not found
HTTP 404
{
  "error": { "code": "TOUR_NOT_FOUND", "message": "Tour 'XYZ' does not exist." }
}
```

This lets the client show contextual messages like _"No ride scheduled for today"_ vs _"Tour not found — contact administrator"_.

## 2. Dashboard Endpoint Must Always Return Arrays

`GET /v1/tours/{tourId}/rides/{rideId}/dashboard` should always return:

| Field      | Guarantee                                              |
|------------|--------------------------------------------------------|
| `ride`     | The ride object with a `stages` array (even if empty)  |
| `riders`   | Always an array (empty `[]` if no riders registered)   |
| `checkIns` | Always an array (empty `[]` if no check-ins yet)       |
| `summary`  | Always an object with zeroed counts                    |

The client currently has to defensively cast these with `Array.isArray()` fallbacks, which is fragile and error-prone.

## 3. Standard Error Envelope

Ensure **all** error responses follow the same envelope format:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description"
  }
}
```

This should be verified for all Lambda handlers to ensure consistency. The client's `apiClient.ts` already parses this structure — inconsistent responses will produce unhelpful error messages.

## Impact on Client Code

Once these backend changes are implemented, the following client-side updates can be made:

- `tourApi.ts` and `rideApi.ts` — use `error.errorCode` (e.g. `NO_ACTIVE_TOUR`, `NO_ACTIVE_RIDE`) in catch blocks to provide more specific user-facing messages.
- `DashboardScreen.tsx` — remove defensive `Array.isArray()` casts once the backend guarantees array responses.

---

## Review Status (2026-03-08)

### Recommendation 1: Distinct Error Codes — Implemented ✅

The backend already used distinct error codes for most cases:

- `GET /v1/tours/active` — returns `NO_ACTIVE_TOUR` (in `src/functions/tours/get_active.py`).
- `GET /v1/tours/{tourId}` — returns `TOUR_NOT_FOUND` via the shared `not_found_response()` helper (in `src/functions/tours/get_tour.py`).

**Change applied:** `GET /v1/tours/{tourId}/rides/today` previously returned `RIDE_NOT_FOUND` (generic) when no ride was scheduled for the day. Updated `src/functions/rides/get_todays_ride.py` to return `NO_ACTIVE_RIDE` with message "No active ride found for today" to distinguish "no ride today" (normal) from an actual missing ride resource.

### Recommendation 2: Dashboard Always Returns Arrays — Already Satisfied ✅

No changes needed. The `GET /v1/tours/{tourId}/rides/{rideId}/dashboard` endpoint (in `src/functions/checkins/get_dashboard_data.py`) already guarantees:

- `ride` — always a dict (or 404 returned before response is built).
- `riders` — always a list (built from list comprehension over `tour_riders`).
- `checkIns` — always a list (returned from `query_tour_items`).
- `summary` — always a dict with all count keys, including zeroed values when no check-ins exist.

### Recommendation 3: Standard Error Envelope — Already Satisfied ✅

No changes needed. All handlers use the shared `error_response()` utility in `src/layers/common/response.py`, which enforces a consistent envelope:

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable description"
  },
  "timestamp": "ISO-8601"
}
```

**Note for client:** The backend envelope includes additional `"success"` and `"timestamp"` fields beyond what this document originally described. The client should account for these.
