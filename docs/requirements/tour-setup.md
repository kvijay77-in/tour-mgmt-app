# Tour setup and rides

_Last updated: 2026-10-01_

Administrators create and maintain tours and their dated rides. A ride defines its route stages (Start, zero or more Pit Stops, Finish), timing, float choices and participants. Start is always first and Finish always last; both are created automatically and remain locked. Administrators can add, edit, reorder and remove only Pit Stops. Only permitted administrators can add or modify rides or close them. Ride status governs the availability of today's check-ins, Not Riding and Quit Riding; past rides remain viewable but read-only.

### Rider self-service settings

Tour and ride settings control whether a rider can submit a check-in from the Rider App. Defaults are inherited as follows:

| Setting | Resolution | Default when no value is stored |
| --- | --- | --- |
| Stage self check-in | Stage setting → ride setting → stage type default | Start/Finish allowed; Pit Stop not allowed |
| Self Quit Riding | Ride setting → tour setting | Not allowed |
| Self Not Riding | Start-stage setting | Not allowed; applies only while the ride is Open |

At ride and stage level, choose Default/Follow to inherit, Allowed, or Not allowed. For example, if the tour allows Self Quit Riding, a ride that follows the tour allows it; setting that ride to Not allowed overrides the tour. A Pit Stop set to Follow ride still defaults to not allowed unless the ride-level stage setting allows it.

Returning a saved ride-level setting to Default clears its stored override with `null`; omitting the field on update preserves the stored value. Stage defaults are omitted from the complete stage list sent on save. Whether that omission reliably clears a previously stored stage override must be confirmed against backend stage-replacement behavior (BC-4).

If a stored ride does not contain exactly one Start first, exactly one Finish last, and only Pit Stops between them, show a warning and block Save ride and Save All for that ride. Do not offer an in-app repair; correct the ride data in the backend, then reload it.

Ride status follows PLANNED → OPEN → STARTED → COMPLETED. Opening and starting apply to today's ride; completion is available for a started ride dated today or earlier. Define/Update Tour is web-first with a mobile fallback; a Super User can open it read-only. Provisioning is requested by the app and performed by the backend, not by this repository.

For an active ride, Administrators and Super Users can open or close any eligible pit stop; a pit-stop user can manage only their assigned stage. Show the planned opening/duration and actual opened/closed times. Consult [tour setup design](../design/tour-setup.md) for the UI flow and backend [API reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md) for contracts.
