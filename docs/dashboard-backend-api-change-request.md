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
