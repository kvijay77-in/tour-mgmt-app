# Getting ID from QR Code

## Background

This document defines production ID Code handling requirements for QR scans.

The app currently supports a development QR format for synthetic test data.
Production uses a different QR format and requires ID Code parsing.

The dev format must remain available only when explicitly enabled using the env toggle.
Default behavior must use production parsing.

## Terminology

- Rider ID: Tour-scoped identifier used across tour operations (example: R123).
- Rider Personal Code: Permanent rider profile code (example: D220).
- Rider ID Code: QR-derived 5-character code (example: 1D220) composed of type code + personal code.

Rider ID Code is transient and is not persisted. Only Rider Personal Code is persisted.

## Production ID Code Format

In production, scanned QR text contains an ID Code that can represent Rider, Cycle, or Baggage.
The app currently accepts only Rider type for check-in flow.

### QR Code format

The current production format extracts ID Code from the scanned text by SUBSTRING:
- startPosition: 12 (1-based)
- length: 5

Sample QR text:
TICKET:VID:1D220;GIN:A253FC62;NB:QUFLQVNIIExPVVJERVM=;;

Extracted ID Code:
1D220

### ID Code composition

ID Code is a 5-character alphanumeric value:
- ID Code Type: position 1, length 1
- Rider Personal Code: positions 2 to 5, length 4

Note: Any wording that says positions 2 to 4 is incorrect.

#### ID Code Type values

0 - Blank (not used)
1 - Personal (RIDER)
2 - Cycle (CYCLE)
3 - Baggage 1 (BAGGAGE)
4 - Baggage 2 (BAGGAGE)
5 - Backpack (BAGGAGE)
6 - Heavy bag (BAGGAGE)
7 - Carton Box (BAGGAGE)
8 - Gunny Bag (BAGGAGE)
9 - Others (not used)

Examples:
- 1D220 -> Rider ID Code for personalCode D220
- 2A392 -> Cycle ID Code for personalCode A392
- 3C183 -> Baggage ID Code for personalCode C183

## Configuration

ID parsing configuration must be stored in a shared config table and served through one generic read API.

Required configuration sets:
- ID_CODE_FORMAT with method discriminator SUBSTRING or REGEX
- ID_CODE_TYPE mapping for code-to-type behavior

Rules:
- Exactly one ID_CODE_FORMAT item can be enabled at a time.
- REGEX patterns must be validated for safety.
- Config API must support single, multiple, and all-config reads.

## Requirement for App

When QR is scanned and ID Code is extracted:
1. Resolve ID Code Type using ID_CODE_TYPE config.
2. Type must resolve to RIDER; otherwise block with:
   Invalid ID type. Only Rider ID allowed.
3. For RIDER type, derive personalCode and resolve to tour Rider ID using preloaded local mapping.
4. Continue existing check-in flow only after Rider ID is resolved.

This mapping must be preloaded after sign-in and persisted locally for offline support.
No live per-scan network lookup is required.

## Configuration Loading in App

After user sign-in, app must load ID_CODE_FORMAT and ID_CODE_TYPE, then persist locally.
This load occurs every sign-in and supports offline use.

If config API is unavailable, app must fall back to built-in default SUBSTRING config.

## Decisions

These implementation decisions are fixed for this requirement:

- D1: Rider Personal Code is 4 chars (positions 2 to 5).
- D2: Rider ID Code is transient and not stored; personalCode is stored.
- D3: Local persistence uses SQLite tables for config and personalCode mapping.
- D4: EXPO_PUBLIC_QR_DEV_FORMAT=true enables legacy dev format only.
- D5: Non-RIDER type scan is blocked with exact message and failure sound.
- D6: Valid RIDER code without mapping fails immediately, no live retry lookup.
- D7: App ships with built-in default ID_CODE_FORMAT config.
- D8: Manual/fallback entry still accepts tour Rider ID unchanged.
- D9: configId values are SUBSTRING and REGEX, no version suffix in key.
- D10: No backfill/admin API required for personalCode assignment.
- D11: personalCode uniqueness must be enforced by backend.
- D12: AppConfig is shared across applications and app-agnostic.
