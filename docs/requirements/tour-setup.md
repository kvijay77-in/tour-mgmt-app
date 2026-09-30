# Tour setup and rides

_Last updated: 2026-09-29_

Administrators create and maintain tours and their dated rides. A ride defines its route stages (Start, zero or more Pit Stops, Finish), timing, float choices and participants; the last stage is Finish and cannot be assigned as a pit stop. Only permitted administrators can add or modify rides or close them. Ride status governs the availability of today's check-ins, Not Riding and Quit Riding; past rides remain viewable but read-only.

Ride status follows PLANNED → OPEN → STARTED → COMPLETED. Opening and starting apply to today's ride; completion is available for a started ride dated today or earlier. Define/Update Tour is web-first with a mobile fallback; a Super User can open it read-only. Provisioning is requested by the app and performed by the backend, not by this repository.

For an active ride, Administrators and Super Users can open or close any eligible pit stop; a pit-stop user can manage only their assigned stage. Show the planned opening/duration and actual opened/closed times. Consult [tour setup design](../design/tour-setup.md) for the UI flow and backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md) for contracts.
