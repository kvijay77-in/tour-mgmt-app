# ID Code Configuration and Rider Personal Code Backend Change Request

Date: 2026-08-01

## Summary

This document requests backend support for production QR ID Code parsing and rider resolution in the Check-In App.

The key model decision is:
- Rider ID Code (example: 1D220) is transient and exists only in scanned QR payload text.
- Rider Personal Code (example: D220) is the persistent value on the rider profile.

The app will scan QR text, extract ID Code, validate type, derive personalCode, and map personalCode to the tour Rider ID locally.

To support this flow, backend changes requested are:
1. Add a shared, externally managed AppConfig table.
2. Provide a generic read API GET /v1/config.
3. Add personalCode to rider payloads, especially GET /v1/tours/{tourId}/riders/names.
4. Enforce backend uniqueness for personalCode.

## Background

Current development QR flow can extract tour Rider ID directly from scanned text.
Production flow cannot rely on direct Rider ID in the QR and must parse an ID Code structure.

The app must remain offline capable, so config and rider code mappings are loaded after sign-in and persisted locally (SQLite).
The app should not require a new per-scan backend lookup. This keeps scan latency low and supports offline use.

The configuration source must be shared across applications and app-agnostic.
No app secrets or credentials may be stored in configuration data.

## Recommendation (Preferred)

### 1. Add externally managed DynamoDB table: AppConfig

This table must be created and managed externally (not Amplify-generated) and tagged for cost tracking.

Recommended tags:
- project
- environment
- owner

Table notes:
- Entity name: AppConfig
- Billing mode: On-demand
- Expected volume: very small (typically < 20 items)
- Shared across applications as a single platform-level configuration source

Security constraints:
- ConfigType names must be globally meaningful.
- No app-specific secrets or credentials are permitted in this table.
- Read access pattern is broad (authenticated users), so content must remain non-sensitive.

Schema:

| Attribute | Type | Role |
|---|---|---|
| configType | S | Partition key |
| configId | S | Sort key |
| enabled | BOOL | Active marker |
| config | M | JSON payload |
| description | S | Human-readable note |
| version | N | Incremented on change |
| updatedAt | S | ISO-8601 timestamp |
| updatedBy | S | Cognito sub/admin actor |

No GSI is required for current access patterns.

### 2. Seed partition: ID_CODE_FORMAT

All positions are 1-based.

Seed item A:
- configType: ID_CODE_FORMAT
- configId: SUBSTRING
- enabled: true

```json
{
  "method": "SUBSTRING",
  "idCode": { "startPosition": 12, "length": 5 },
  "idCodeType": { "startPosition": 1, "length": 1 },
  "personalCode": { "startPosition": 2, "length": 4 }
}
```

Rules:
- idCode offsets apply to raw scanned QR text.
- idCodeType and personalCode offsets apply to the extracted 5-character ID Code.

Worked example:
- Raw QR text: TICKET:VID:1D220;GIN:A253FC62;NB:QUFLQVNIIExPVVJERVM=;;
- idCode: 1D220
- typeCode: 1
- personalCode: D220

Seed item B:
- configType: ID_CODE_FORMAT
- configId: REGEX
- enabled: false

```json
{
  "method": "REGEX",
  "idCode": { "pattern": "TICKET:VID:([0-9A-Z]{5});", "flags": "", "group": 1 },
  "idCodeType": { "pattern": "^(.)", "flags": "", "group": 1 },
  "personalCode": { "pattern": "^.(.{4})$", "flags": "", "group": 1 }
}
```

Validation and safety rules:
- Exactly one ID_CODE_FORMAT item may have enabled=true at any time.
- Backend must enforce enabled-item exclusivity on write.
- Read API must never return two enabled format entries.
- REGEX patterns must be RE2/JS-safe.
- Reject unsupported regex features and potentially expensive patterns.
- Enforce pattern length limits (recommended < 200 chars).
- Compile and validate patterns before saving.
- method is the discriminator: SUBSTRING | REGEX.

### 3. Seed partition: ID_CODE_TYPE

Create one item per type code where configId is the single-character code.

| configId | config.code | config.type | config.name | enabled |
|---|---|---|---|---|
| 0 | 0 | null | Blank | false |
| 1 | 1 | RIDER | Personal | true |
| 2 | 2 | CYCLE | Cycle | true |
| 3 | 3 | BAGGAGE | Baggage 1 | true |
| 4 | 4 | BAGGAGE | Baggage 2 | true |
| 5 | 5 | BAGGAGE | Backpack | true |
| 6 | 6 | BAGGAGE | Heavy bag | true |
| 7 | 7 | BAGGAGE | Carton Box | true |
| 8 | 8 | BAGGAGE | Gunny Bag | true |
| 9 | 9 | null | Others | false |

Config object shape:

```json
{ "code": "1", "type": "RIDER", "name": "Personal", "description": "..." }
```

Notes:
- Valid type values currently: RIDER, CYCLE, BAGGAGE.
- Codes 0 and 9 are disabled and do not carry type.
- CYCLE and BAGGAGE are reserved placeholders for future app features.

### 4. New generic API: GET /v1/config

This endpoint is shared across applications and returns configuration by type scope.

Supported reads:
- GET /v1/config -> all enabled config items across all configType partitions.
- GET /v1/config?configType=ID_CODE_FORMAT -> one configType partition.
- GET /v1/config?configType=ID_CODE_FORMAT,ID_CODE_TYPE -> multiple partitions.
- GET /v1/config?includeDisabled=true -> admin/debug use only.
- Optional endpoint variant: GET /v1/config/{configType}/{configId}.

Auth and access:
- Any authenticated Cognito user can read.
- This API is read-only for app clients.
- Write/update operations remain out-of-band admin operations.

Response format must follow the standard envelope pattern:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "configType": "ID_CODE_FORMAT",
        "configId": "SUBSTRING",
        "enabled": true,
        "version": 1,
        "updatedAt": "2026-08-01T00:00:00Z",
        "config": { "method": "SUBSTRING" }
      }
    ]
  },
  "error": null,
  "timestamp": "2026-08-01T00:00:00Z"
}
```

Caching requirement:
- Support ETag and If-None-Match with 304 Not Modified for low-cost repeated fetches.

Errors:
- 400 INVALID_CONFIG_TYPE
- 401 Unauthorized
- 500 Internal Server Error

### 5. Rider Personal Code persistence and payload updates

Clarification:
- Rider ID Code is not persisted.
- personalCode is persisted on rider profile and used for matching.

Requested payload additions:
1. GET /v1/tours/{tourId}/riders/names

```json
{ "riderId": "R123", "name": "Jane Doe", "personalCode": "D220" }
```

2. GET /v1/tours/{tourId}/riders
- Add personalCode to each TourRider record.

3. GET /v1/tours/{tourId}/riders/{riderId}
- Add personalCode to the single rider payload.

Backend requirements:
- Enforce personalCode uniqueness at backend layer.
- Uniqueness is global and permanent at rider profile level.
- Normalize personalCode to uppercase at write time and return uppercase on read.
- Matching must be case-insensitive.
- During rollout, field remains optional/nullable to avoid breaking existing clients.
- No backfill/admin assignment API is required in this scope.
- Future type derivations reuse same personalCode:
  - Cycle ID Code: 2 + personalCode
  - Baggage ID Codes: 3 to 8 + personalCode

Suggested enforcement patterns:
- GSI-backed uniqueness check plus conditional write, or
- dedicated reservation item with conditional write.

## Alternative

If rollout sequencing needs strict isolation, backend may initially release GET /v1/config first,
then release rider personalCode payload fields in a second deployment.

Client behavior remains safe because app includes default SUBSTRING format locally.
However, production rider resolution should be treated as not go-live ready until names payload includes personalCode.

## Implementation Guidance

1. Provision AppConfig table externally.
2. Seed ID_CODE_FORMAT and ID_CODE_TYPE partitions as specified.
3. Implement GET /v1/config with configType filter support and standard response envelope.
4. Implement ETag handling on GET /v1/config.
5. Extend rider entities and serializers with personalCode.
6. Add backend normalization and uniqueness enforcement for personalCode.
7. Add contract tests for:
   - enabled exclusivity
   - regex validation
   - configType filter combinations
   - personalCode uniqueness and normalization

Operational guidance:
- Keep table small and human-auditable.
- Preserve backward compatibility for existing rider consumers.
- Log validation failures with safe, non-sensitive metadata.

## Backward Compatibility and Client Behavior

Client fallback rules:
- If GET /v1/config fails or is unavailable, app uses built-in SUBSTRING default and built-in ID type map.
- Legacy dev QR parsing is used only when EXPO_PUBLIC_QR_DEV_FORMAT=true.
- If names payload does not include personalCode, production-format scan cannot resolve rider and app blocks with Rider not found for this ID code.

Go-live gate:
- Production QR scan go-live depends on rider names endpoint including personalCode for riders.

## Notes / Next Steps

1. Backend team to confirm AppConfig table provisioning model per environment.
2. Backend team to estimate rollout order:
   - config API,
   - rider payload additions,
   - personalCode uniqueness enforcement.
3. Client team will proceed with app-side Phase 2 and Phase 3 implementation once backend contract is accepted.
4. This request intentionally excludes:
   - admin write API for config,
   - personalCode backfill tooling,
   - Cycle/Baggage app workflows.
