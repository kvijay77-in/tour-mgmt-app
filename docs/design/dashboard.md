# Dashboard design

_Last updated: 2026-09-29_

`DashboardScreen.tsx` renders the Ride Day grid, stage filters, sorting, zoom and legend. `StageFilterBar.tsx` and `DashboardTabsHeader.tsx` supply controls; `RiderCardModal.tsx` loads the selected rider's details and timeline. `CheckInLogScreen.tsx` lists entries and offers authorized cancellations. `RideInfoScreen.tsx` provides ride context. Progress is refreshed through the split dashboard adapter described in [data integration](data-integration-and-offline.md), with roster and ride metadata reused rather than reloaded on every progress update.

Stage-filtered color indicates whether a rider reached that stage; the default grid reflects latest status. Not Riding and Quit Riding remain visually distinct, Float adds a badge without implying arrival, and EXITED adds an X rather than changing stage color. Historical rides are read-only. See the single [dashboard requirements](../requirements/dashboard.md) for expected behavior.
