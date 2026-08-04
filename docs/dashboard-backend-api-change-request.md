# Dashboard Backend API Change Request

Date: 2026-07-28

## Summary

The client needs a human-friendly display name for the `checkedInBy` field on CheckIn records shown in the Dashboard and Check-in Log. Currently the API returns a Cognito username (e.g. `jdoe`) which non-admin clients cannot resolve to a display name.

This document requests a small, backward-compatible change to provide `checkedInByName` (display name) on CheckIn payloads, or alternatively to expose a minimal read-only user mapping endpoint for the tour.

## Background

- The Dashboard `GET /v1/tours/{tourId}/dashboard/progress` already returns CheckIn entries with `checkedInBy` (Cognito username).
- Non-admin clients (check-in staff) cannot map the username to a friendly name without an additional backend endpoint accessible to their role.

## Recommendation (Preferred)

1. Add an optional `checkedInByName?: string` property to the CheckIn object returned by `GET /v1/tours/{tourId}/dashboard/progress` and to any check-in creation responses where the server can resolve the actor's display name.

Example CheckIn (before):

```json
{
  "checkInId": "c123",
  "riderId": "r456",
  "stageNumber": 3,
  "checkedInBy": "jdoe",
  "timestamp": "2026-07-28T12:34:56Z"
}
```

Example CheckIn (after):

```json
{
  "checkInId": "c123",
  "riderId": "r456",
  "stageNumber": 3,
  "checkedInBy": "jdoe",
  "checkedInByName": "Jane Doe",
  "timestamp": "2026-07-28T12:34:56Z"
}
```

Benefits:
- Simple and minimal change for clients — they can use `checkedInByName` when present and fall back to a default (`"Not Available"`) when absent.
- Backward compatible: existing clients ignore the new field.

## Alternative (if server cannot resolve names reliably)

Expose a small read-only endpoint that returns a mapping of Cognito username → displayName for users in the tour, limited to fields required by the client:

`GET /v1/tours/{tourId}/users?fields=cognitoUserName,displayName`

Response sample:

```json
[
  { "cognitoUserName": "jdoe", "displayName": "Jane Doe" },
  { "cognitoUserName": "asmith", "displayName": "Alan Smith" }
]
```

Security notes:
- Limit returned fields to `cognitoUserName` and `displayName` only. Do not return emails or other PII.
- Restrict endpoint access to the minimum role(s) required for check-in staff (not public).
- Consider rate-limiting and caching on the client to avoid frequent calls.

## Implementation Guidance

- If feasible, adding `checkedInByName` to the CheckIn payload is the most straightforward and lowest-effort change.
- If adding the field is not possible, implement the read-only `GET /v1/tours/{tourId}/users` mapping endpoint and document its availability.
- Document the change in API docs and add examples showing clients should fallback to `"Not Available"` when the field is missing.

## Backward Compatibility & Client Behavior

- Client behavior: read `checkIn.checkedInByName` when present; otherwise display `Not Available`.
- No client-side user-directory or mapping service should be implemented — prefer the server-provided field or mapping endpoint.

## Notes / Next Steps

- Add this change request to the backend team's ticketing system (include payload example and security notes).
- Update client docs to reference the new field/endpoint and expected fallback behavior.

## Float Check-In Support

### Summary

The client needs ride-level float definitions and check-in payload support for riders who are transported from Start to a later stage instead of riding the Start segment. The change must be backward compatible and must not require existing rides or check-ins to provide float data.

### Background

- Float is configured per ride and can define one or more transport options, for example Float-1 to Stage 1 and Float-2 to Stage 2.
- At Start, the client needs to submit a distinct float check-in instead of a regular Start check-in.
- Dashboard and check-in log views need the backend to echo float metadata on CheckIn records so the UI can render the correct badge and label while still treating the rider as not yet regularly checked in.

### Recommendation

1. Extend the Ride payload with an optional `floats` array:

```json
{
  "floats": [
    {
      "floatNo": 1,
      "floatToStage": 1
    }
  ]
}
```

2. Extend check-in request handling to accept these optional fields on `CheckInRequest`:

```json
{
  "isFloat": true,
  "floatNo": 1
}
```

3. When a float check-in is persisted or returned in dashboard/progress payloads, include:
   - `isFloat?: boolean`
   - `floatNo?: number`
   - `status: 'FLOAT' | 'FLOAT-1' | 'FLOAT-2'`

### Implementation Guidance

- Treat all float fields as optional. Absence of `floats`, `isFloat`, or `floatNo` means the ride or check-in does not use float behavior.
- `Ride.floats` should be returned anywhere the client consumes ride definitions for check-in and dashboard views.
- For float check-ins, continue returning the standard CheckIn shape and add `isFloat` and `floatNo` alongside the existing fields.
- The create-check-in response should echo the persisted float fields and the derived wire `status` string so the client can update recent activity and dashboard state without refetch ambiguity.
- For multi-float rides, derive the wire `status` value from `floatNo` as `FLOAT-<n>` while preserving `isFloat: true` for explicit client-side branching.

### Backward Compatibility

- All new fields are optional and additive.
- Existing clients can ignore `floats`, `isFloat`, `floatNo`, and `FLOAT*` status values if they do not implement float behavior.
- Existing rides and historical check-ins without float metadata remain valid and should continue to behave as non-float records.
