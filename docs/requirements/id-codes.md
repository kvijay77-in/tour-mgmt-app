# ID codes and scans

_Last updated: 2026-09-29_

Production QR codes contain a typed ID code, not a rider ID. The scan first validates that its type is RIDER, then resolves the personal code against the tour's loaded mapping and checks the rider's registration status. Reject unknown codes, wrong types and riders who are not REGISTERED or ACTIVE without writing a check-in. Manual/fallback entry takes a rider ID directly, not a QR code; rider eligibility is checked before submission.

The default production format extracts five characters beginning at one-based position 12 from the scanned text. The first character is a configured type code; the remaining four characters are the personal code. Only one code format is active at a time; configured substring or safe regular-expression extraction and type mappings are loaded after sign-in. If configuration is unavailable, use the built-in production substring format, not the legacy development format. Cache configuration and personal-code-to-tour-rider mappings for offline scanning; an unmapped code must fail without an ad-hoc lookup. Legacy development QR parsing is explicitly enabled only for development testing.

Configuration of code types and mappings comes from the backend, with a cached copy for supported offline scans. Cycle and baggage code types are reserved; they are not rider check-in inputs. See [integration design](../design/data-integration-and-offline.md) and the backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md).
