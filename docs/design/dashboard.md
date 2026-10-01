# Dashboard design

_Last updated: 2026-10-01_

`DashboardScreen.tsx` renders the Ride Day grid, stage filters, sorting, zoom and legend. `StageFilterBar.tsx` and `DashboardTabsHeader.tsx` supply controls; `RiderCardModal.tsx` loads the selected rider's details and timeline. `CheckInLogScreen.tsx` lists entries and offers authorized cancellations. `RideInfoScreen.tsx` provides ride context. Progress is refreshed through the split dashboard adapter described in [data integration](data-integration-and-offline.md), with roster and ride metadata reused rather than reloaded on every progress update.

Stage-filtered color indicates whether a rider reached that stage; the default grid reflects latest status. Not Riding and Quit Riding remain visually distinct, Float adds a badge without implying arrival, and EXITED adds an X rather than changing stage color. Historical rides are read-only. See the single [dashboard requirements](../requirements/dashboard.md) for expected behavior.

When the latest check-in record available to the dashboard has `method=SELF_SERVICE`, show a compact **Self** badge on that rider's tile. Do not infer the method for RiderCardModal's timeline: the rider-details response does not include it.

The event occurrence dashboard shows `registeredCount` when registration is enabled and marks riders with `registered=false` as **Not registered**. Cancelled event records and rider event progress items show **Self** when their method is `SELF_SERVICE`; the event dashboard activity cells do not include a method and cannot be labeled.
