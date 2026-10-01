# Tour and ride setup design

_Last updated: 2026-10-01_

`TourManagementScreen.tsx` is the management entry point for tour and ride definitions. It uses `tourApi.ts` and `rideApi.ts` via the shared client; `RideStatusManagementScreen.tsx` handles status changes, and ride-day controls handle eligible pit-stop opening and closing. The Home registry routes permitted users to Tour Management (read-only for users who cannot edit) and Ride Status Management. Backend state controls which status transitions are accepted.

The tour form stores the tour-level `selfQuitRidingAllowed` default. Ride editing is modeled by the pure `src/utils/rideEditor.ts` helper: new drafts include locked Start and Finish stages, while only Pit Stops can be edited, moved or removed. Its serializer renumbers stages and omits inherited stage settings. `src/utils/rideSelfService.ts` supplies effective values and their sources for the editor. Ride-level Default clears a stored override with `null`; omission otherwise preserves it. A malformed stored Start/Pit Stop/Finish layout is shown as a warning and blocks both save actions until the backend data is corrected. Stage-setting replacement semantics remain to be confirmed with the backend (BC-4).

| Policy | Resolution | Default |
| --- | --- | --- |
| Stage self check-in | Stage → ride → type default | Start/Finish allowed; Pit Stop not allowed |
| Self Quit Riding | Ride → tour | Not allowed |
| Self Not Riding | Start stage | Not allowed; ride must be Open |

Example: a tour allows Self Quit Riding, and a ride follows that tour, so the effective ride value is Allowed. If the ride is explicitly Not allowed, it overrides the tour. A Pit Stop following a ride with no stage-level default remains Not allowed.

Tour dates, rides, ordered stages and ride-specific float settings are edited in the tour context, not defined by this app's infrastructure. Today's ride is selected through `TourContext.tsx` and `RideSessionContext.tsx`; past rides are presented read-only. See [tour setup requirements](../requirements/tour-setup.md) and backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md).
