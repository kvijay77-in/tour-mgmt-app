# Core and roles

_Last updated: 2026-09-29_

The management app helps organizers, pit-stop crew, hotel staff and guests follow a non-competitive cycling tour. After sign-in, Home and the web sidebar show only permitted modules; a user with only one available module may open it directly. Authorization is enforced by the backend; the client also gates screens and actions by role and permission.

The Administrator has all management functions. The Super User can operate ride-day, occurrences, hotels, baggage and rider-exit functions, but cannot create or modify rides, manage announcements, edit event definitions or assign users to tours. Pit-stop groups `PS_1_USER` through `PS_5_USER` handle their assigned pit-stop stage(s), can record Quit Riding and may scan assigned event activities; they cannot mark Not Riding or make manual check-ins. Hotel Staff can finish check-ins and scan assigned event activities; the ride dashboard is not available to them. Guest access is read-only for ride and event progress. Event and hotel access is further scoped by the user's tour assignment.

See [user management](user-management.md) for assignments and [check-in](check-in.md) for stage-specific actions. The app's exact visibility rules are in `src/constants/roles.ts`, `src/utils/permissions.ts` and `src/navigation/modules.ts`. For authoritative server permission names consult the backend [RBAC reference](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/rbac.md).

Event registration management uses the app permission `MANAGE_EVENT_REGISTRATIONS`, mapped to backend `EVENT_REGISTRATION_MANAGE`. It is assigned only to Administrator and Super User roles.
