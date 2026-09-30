# Tour and ride setup design

_Last updated: 2026-09-29_

`TourManagementScreen.tsx` is the management entry point for tour and ride definitions. It uses `tourApi.ts` and `rideApi.ts` via the shared client; `RideStatusManagementScreen.tsx` handles status changes, and ride-day controls handle eligible pit-stop opening and closing. The Home registry routes permitted users to Tour Management (read-only for users who cannot edit) and Ride Status Management. Backend state controls which status transitions are accepted.

Tour dates, rides, ordered stages and ride-specific float settings are edited in the tour context, not defined by this app's infrastructure. Today's ride is selected through `TourContext.tsx` and `RideSessionContext.tsx`; past rides are presented read-only. See [tour setup requirements](../requirements/tour-setup.md) and backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md).
