# Offline use

_Last updated: 2026-09-29_

The mobile app can display previously loaded tour, ride and rider data while disconnected and queue supported check-in and event scans locally for later delivery. The UI must distinguish locally pending entries from confirmed entries; server validation still decides conflicts when syncing. Operations requiring a live decision, including Start-stage overrides and hotel allocation changes, require connectivity. Offline readiness depends on a prior successful sign-in and cached data. The web app does not provide the mobile local database.

Sync Status shows pending, sent and failed work with a way to retry or verify when online. Advanced Settings exposes the available sync controls and local-content reset. See [integration and offline design](../design/data-integration-and-offline.md).

The user may select offline mode manually on mobile. Previously loaded information shows its last refresh time. Only the last online user on a device can use saved offline sign-in within the configured period; secure device unlock and retry limits apply. A different user's sign-in must not silently discard unsent data. Pending operations retain capture order and original time, retry with backoff and remain visible until delivered or explicitly discarded. Sync Status can verify sent check-ins with the server; warn if the device clock is significantly different. Retention must not automatically remove unsent work. Pit-stop context is selected from assigned stages and checked against the current ride.
