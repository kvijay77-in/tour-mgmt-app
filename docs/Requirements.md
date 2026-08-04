# Requirements

[← Back to README](../README.md)

Detailed functional requirements, use cases, and feature specifications for the Check-In App.

## Table of Contents

- [Introduction](#introduction)
- [Rider Profile](#rider-profile)
- [Dashboard](#dashboard)
  - [Stage Count](#stage-count)
  - [Historical View](#historical-view)
  - [Pit Stop Management](#pit-stop-management)
  - [Stage View](#stage-view)
  - [Sort](#sort)
  - [Zoom In & Out](#zoom-in--out)
- [Check-In](#check-in)
  - [Start - Flag Off](#start---flag-off)
  - [Pit Stops](#pit-stops)
  - [Finish](#finish)
  - [Not Riding (NR)](#not-riding-nr)
  - [Quit Riding](#quit-riding)
  - [Check In for Stage View](#check-in-for-stage-view)
- [Role Based App Access](#role-based-app-access)
  - [Administrator](#administrator)
  - [Super User](#super-user)
  - [Pit Stop Stage User (PS_x_USER)](#pit-stop-stage-user-ps_x_user)
  - [Hotel Staff](#hotel-staff)
  - [Guest](#guest)
- [Offline Capability](#offline-capability)
- [Administrator Features](#administrator-features)
  - [Ride Status Management](#ride-status-management)
  - [User Management](#user-management)
    - [New User Onboarding](#new-user-onboarding)
    - [Enable/Disable Existing User](#enabledisable-existing-user)
    - [Delete User](#delete-user)
    - [Modify User](#modify-user)
- [Backend](#backend)
- [Others](#others)

---

## Introduction  
An application is required for the usage in non-competitive Cycling Tour to manage daily rides and track riders in each ride. This app will be used by Cycling Tour administrators, pit stop team and optionally by hotel front desk staff to check-in riders at various stages of the daily ride - Start - Flag Off, Pit Stop(s) and Finish.

This app should provide 2 primary features:  
1. Dashboard - for Ride progress & Rider tracking  
1. Rider Check-In  

Apart from these following Admin features should also be available.  
1. Add/Modify Ride
1. Close Pit Stop
1. Close Ride

Future additions:  
- Push Notifications
- Room allocation at Finish stage check in

App must implement RBAC for all the features using clearly defined labels at feature level and Roles that can defined by group multiple features. Roles will be assigned to registered users of this application by an Administrator.

Following sections elaborates on what features required in the app together with more information about ride progress and rider tracking process.

# Rider Profile  
Each Rider registered for the tour will be assigned a unique Rider ID which must be used for all tracking purposes in this app. Rider ID together with some additional info about the Rider will be stored in a table for various purposes. Assignment of Rider ID and collecting and storing Rider info is out of scope for this app. This data expected to be available for the app to use and no modification of this data can be allowed in the app.

ID terminology used in this app:
- Rider ID: tour-scoped identifier used in all check-in payloads and dashboard tracking (example: R123).
- Rider Personal Code: permanent profile-level code stored with rider profile and exposed by rider APIs (example: D220).
- Rider ID Code: transient QR-derived code composed of type + personalCode (example: 1D220). This value is not persisted.

QR Code will be generated for each Rider and in production carries an ID Code value that must be resolved to Rider ID for app processing.

# Dashboard
This is the Home Screen for the app. A sample mock up for visualization purpose is available [here](./Images/Dashboard_sample.png).

Dashboard should list all riders similar to that in the mock up in a grid format. Source for the dashboard should be from a Cloud based database table. Each icon should have the Rider ID as the label and should have various color based representation to indicate the last stage at which the Rider has checked in. Color code Stage legend should be displayed for easy understanding.

By default Dashboard should give the full picture of the Ride with latest Rider check in status and sorted by Rider ID in lexicographical order. There should be filter and sort options available.  

## Stage Count

This is part of the Header section in the Dashboard. Logic for count:
- Start: Now counts all riders who have checked in at Start or beyond (includes PS1, PS2, Finish, and QR riders who started)
- PS1: Counts riders who reached PS1 or beyond (includes PS2, Finish, and QR riders who reached PS1)
- PS2: Counts riders who reached PS2 or beyond (includes Finish and QR riders who reached PS2)
- Finish: Counts only riders who completed
- QR: Total QR riders (counted separately, but also included in their respective stage counts based on where they reached before quitting)
- NR: Excluded from stage counts as they never started

## Historical View
Dashboard should always display the respective calendar day's ride by default. There should be an option to view previous days or historical ride. When viewing historical ride, it must be alway in read-only mode i.e. check in feature must be disabled. Historical view should be available for all dates from the start of the tour with dates listed based on the ride dates available in the database as a list. A calender view instead of list can be considered if that provides a good user experience.

## Pit Stop Management

Pit Stop management is available from the Dashboard hamburger menu for today's ride only.

Functional behavior:

1. Show menu item label as `Pit Stop management` only for users with role permission:
  - `ADMINISTRATOR`
  - `SUPER_USER`
  - `PS_x_USER`
2. Do not show this menu item when current ride is completed/closed.
3. Each allowed pit stop stage must be listed as a submenu item.
  - `ADMINISTRATOR` and `SUPER_USER` can see all `PIT_STOP` stages for today's ride.
  - `PS_x_USER` can see only the mapped pit stop stage(s).
4. Selecting a submenu opens a popup for that stage.
5. Popup content and actions:
  - Show pit stop name and configured duration.
  - Enable `OPEN` action only when `pitStopStatus` is null.
  - Enable `CLOSE` action only when `pitStopStatus` is `OPEN`.
  - Display `openedAt` and `closedAt` when available.
  - Trigger backend API call for every enabled action.

## Stage View
When App is launched and Dashboard is displayed it give a complete view of the riders' progress. A Stage-wise view is also required for someone to see what's the stage's status. Each stage should have a button that can toggle Stage View on and off. When stage view is on, it should display check in status relative to the stage i.e. show all riders and Rider icon color should have respective Stage color for checked in riders and a different color for not checked in riders. When stage view is off (toggle), view should go back to default complete view.

Rider icon with Not Riding and Quit Riding status should appear with respective fix color.

Tour rider registration status handling:
- Riders with `TourRider.status = EXITED` must remain visible in Dashboard and historical check-in data remains viewable.
- `EXITED` must be highlighted with a prominent `X` mark rendered inside the rider icon box.
- Do not use stage colors or text badges for `EXITED` indication to avoid confusion with stage/state color coding.

## Sort  
Sort should made available as a toggle option - sorted and unsort (which is actually sorted by Rider ID). Sorting when activated should group and order riders by stage. When sorting is activated within filtered view, show not checked in first and then checked in. When sorting is activated it should always have sub-sorting on Rider ID.  

Rider IDs with Not Riding and Quit Riding status should appear in the end when sorting is activated.

## Zoom In & Out
Dashboard should have a pinch and zoom feature for mobile app. Zoom should have 4 levels. For all levels grid format should be used.
- Level 1: Rider ID only
- Level 2: Rider ID and Name.
- Level 3: Rider ID, Name and Contact no.
- Level 4: Rider ID, Name, Photo and Contact no.

Dashboard will use level 1 as default zoom level. 

In Level 1 and 2, when an Rider icon is clicked, full Rider card pop-up should appear. Rider Card is complete detail of the Rider that is available and for time being card will have Rider ID, Name, Photo and Contact no. 

# Check-In
This is the key process to track riders in each ride. Tracking is done by registering the riders at every stage as they cycle along the planned route and reach the destination to finish the ride.

Check-in process (at all stages) required to be done by scanning the Rider's QR code and recording the time when the scanning was done. In production, scanned QR text yields a Rider ID Code that must be parsed and resolved to Rider ID before creating check-in records. This needs to be updated in a table to allow persistence and make data available centrally to allow other App users to get live status of the progress in the app Dashboard.

Production scan resolution rules:
- QR contains ID Code (example: 1D220).
- ID Code type must resolve to RIDER.
- If type is not RIDER, block with message: Invalid ID type. Only Rider ID allowed.
- For RIDER type, resolve personalCode to tour Rider ID using preloaded local mapping.
- Immediately after Rider ID resolution, validate rider registration status from rider API.
- Allow check-in only when rider status is `REGISTERED` or `ACTIVE`.
- If rider status is any other value, block and show: `Check-in not allowed for rider with status <STATUS>.`
- If mapping is missing, block and do not create check-in.

There can be 2 special cases as part of the check in:  
* Not Riding
* Quit Riding

Special cases should also be handled using QR Code scanning. User must select the check-in type (regular check-in, Not Riding, or Quit Riding) from a menu/UI option before scanning the QR code. These check in should be visible in Dashboard distinctively. An fixed color representation for these 2 cases should be implemented universally in the Dashboard.

A manual check-in option should be available to allow 'Quit Riding' check in remotely where QR Code scanning is not possible.

A fallback option should be automatically activated when QR Code scanning fails with 2 to 3 retries. This should allow manually inputting Rider ID as per the check in option. This is a sub-feature of check in and not same as manual check in option.

Manual and fallback entry behavior remains unchanged:
- Manual and fallback entry use Rider ID directly.
- ID Code parsing rules apply only to camera scan input.
- For manual Rider ID entry, rider registration status validation is the first validation step.
- Manual and scan flows must both block check-in for any rider status other than `REGISTERED` or `ACTIVE`.

## Future Placeholder: Cycle ID Code

Cycle ID Code support is not implemented yet. The type mapping is reserved for future use.

## Future Placeholder: Baggage ID Code

Baggage ID Code support is not implemented yet. The type mapping is reserved for future use.

## Start - Flag Off  
On each day of the tour, before the ride is Started/Flagged off all riders must be checked in to ensure all riders who will ride for the day are accounted for. Check-in can be done by any designated tour admin team member with access to the app and applicable role permission.  

Tour Director will use the dashboard to view the check-in progress and only when all check-ins are completed she/he will give go ahead to start the ride.

If a rider has already been checked in at Start and the user later attempts a Not Riding check-in, or if a rider has already been marked Not Riding at Start and the user later attempts a regular Start check-in, the app must prompt to Override or Cancel before writing any data. On Override, the previous Start-stage check-in must be cancelled and the new check-in must be created.

## Pit Stops  
Pit Stops are pre-determined location along the ride route for riders to take a break and refuel/recharge and there will be one or 2 tour staff to manage each pit stop. From the app scope, their primary responsibility is to check-in each and every Rider who reaches the corresponding pit stop. Assigned pit-stop stage users (`PS_x_USER`) will have the control on to flag the assigned pit stop as 'Open' and 'Closed'. This will help to a tracking view for Pit Stops. In future this status can even be used for Rider App (not scope for this project) to let riders know Pit Stop as been opend and closed.

No. of pit stops may vary as per the day's ride plan and distance. Dashboard should dynamically adapt to the corresponding ride and no. of pit stops automatically.

Ride/stage attributes used for pit stop management:

1. Ride level:
  - `openTime`: planned ride opening time.
  - `closeTime`: planned ride closing time.
2. Stage level (`PIT_STOP` stages):
  - `estimatedOpenTime`: planned open offset in minutes.
  - `pitStopDuration`: pit stop window duration in minutes.
  - `pitStopStatus`: runtime status (`null`, `OPEN`, `CLOSED`).
  - `openedAt`: runtime timestamp when pit stop is opened.
  - `closedAt`: runtime timestamp when pit stop is closed.
3. `estimatedTimeFromStart` is deprecated and must not be used.

## Finish  
Finish point is usually a hotel at the destination town where the riders will complete the day's ride. A pre-authorized hotel front desk staff will use the app to scan Rider's QR Code to check in for the Finish stage.

## Not Riding (NR)  
When a Rider decides to not ride for the day, same needs to be registered by a tour staff with relevant permission  at the starting point before the ride starts for the day. Once a Rider is marked 'Not Riding' no further check should be allowed at any other stages.

In multi-user scenarios (multiple crew users and rider self check-in channels), check-in validation must use the latest central status at submission time. If the rider is already marked 'Not Riding', any subsequent regular or 'Quit Riding' check-in attempt must be blocked and shown to the app user as a Warning (not an app error/exception).

The Start-stage override flow described above is an online-only interaction. It is expected to happen at ride start when network coverage is available, so it does not require offline queueing or deferred sync handling.

## Quit Riding  
A rider can decide to quit the ride or call it a day at any point in the ride after starting the ride. A Rider can decide to 'Quit Riding' at a pit stop or any location between stages.  

If Rider decides at a pit stop, the assigned pit-stop stage user should register the Rider as 'Quit Riding'. This can be done before or after pit stop check in is completed.

If a Rider decides to Quit Riding in between any stage, QR Code scanning is not possible as there is no user around to do it. In this scenario usually Rider inform/post in the WhatsApp Group Chat monitored by Tour Director or user with Super User role and one of them can perform a manual check in using the Rider ID, remotely.

Once a Rider is registered as 'Quit Riding' any further check in should not be allowed for that Rider.  

In multi-user scenarios, 'Quit Riding' creation must validate the rider's latest status before write. If the rider is already marked 'Not Riding', the app must not create a 'Quit Riding' entry and must display a Warning response to the user.

## Check-In Validation Matrix

For all interactive online check-ins, validation must use the latest rider status from backend before final write. Locally available status is not authoritative in online mode.

Tour rider registration-status gate (applies to both QR-scan and manual check-in flows):
- `REGISTERED` and `ACTIVE`: eligible for check-in processing.
- Any other rider status: block and show a UI error message, do not raise app exception.
- QR flow order: validate ID type first, then rider registration status.
- Manual flow order: validate rider registration status first.

| Requested Action | Latest Rider Status | Expected Result |
|---|---|---|
| Regular check-in | `NOT_CHECKED_IN` or `CHECKED_IN` | Allow, subject to stage and ride-status rules |
| Regular check-in | `NOT_RIDING` | Block and show Warning |
| Regular check-in | `QUIT_RIDING` | Block and show Warning |
| Not Riding | `NOT_CHECKED_IN` or `CHECKED_IN` | Allow |
| Not Riding | `NOT_RIDING` | Block and show Warning |
| Not Riding | `QUIT_RIDING` | Block and show Warning |
| Quit Riding | `NOT_CHECKED_IN` or `CHECKED_IN` | Allow |
| Quit Riding | `NOT_RIDING` | Block and show Warning |
| Quit Riding | `QUIT_RIDING` | Block and show Warning |

Offline mode exception:
1. When offline, local SQLite status can be used for pre-validation.
2. Final conflict/validity is still enforced when pending operations sync to backend.
3. The Start-stage Override/Cancel flow is excluded from offline handling because it is only expected at ride start in a network-available location.

## Check In for Stage View  
When a Rider checks in at multiple stages implies that the Rider has checked in all stages till the last checked in stage. This is important in Stage View.

Say a Rider latest checked in stage is PS1 and this implies that the Rider has checked in at Start and PS1. So in the Dashboard default view, PS1 color should be assigned to corresponding Rider ID icon. But in Stage views it slightly varies. Same Rider in Start stage view, should have Start color and in PS1 Stage view as PS1 stage color.

Another example and in this let's take a Rider has finished the ride i.e. the latest check-in is at Finish stage. So in Stage Views, Start, PS1 and PS2 the Rider ID icon color should be that of the respective stages. For clarity, in default view it should be Finish stage color.

For Rider who quit and checked in as QR, in Stage View, Stage check-in should take precedence if already checked in in that stage before quitting. In default view, QR check in status should be used. For Stage Views after QR check in, Rider status should show QR and not 'not checked in yet' to indicate to the pit crew that the rider will not be checking in further and no need to track.

# Role based app Access  
App access should be access controlled based on role. Each feature or function in the app must have a specific label or name to it. These labels can be combined in different combinations to create roles. Only user assigned with a valid role should have access to the corresponding feature/function.  

Function can be disabled or should not appear in the app if it not permitted to use by a user based on their role. This needs to be determined based on app design and ease of code maintenance. This will be decided on case by case basis.

Possible Roles expected:
- Administrator
- Super User
- Pit Stop Stage User (`PS_x_USER`)
- Hotel Staff
- Guest

## Administrator
This role will have unrestricted full access to all features and functions available in the app.

## Super User
This role will have access to all features and functions except Add/Modify and Close Ride features.

## Pit Stop Stage User (PS_x_USER)
Pit-stop roles are stage-specific Cognito groups in the format `PS_x_USER` where `x` maps to the ride stage number and Start is always stage `0`.

Default deployed pit-stop role groups are:
- `PS_1_USER`
- `PS_2_USER`
- `PS_3_USER`
- `PS_4_USER`
- `PS_5_USER`

Rules:
- These roles apply only to stages with type `PIT_STOP`.
- Last stage is always `FINISH` and must never be mapped to a pit-stop role.
- Regular check-in is allowed only for the exact pit-stop stage(s) mapped by the role(s).
- Pit Stop management is allowed only for the mapped pit-stop stage(s).
- Quit Riding check-in is allowed for all `PS_x_USER` roles.
- Not Riding check-in is not allowed for `PS_x_USER` roles.
- Manual check-in is not allowed for `PS_x_USER` roles.

Multiple pit-stop role assignments for one user are valid (example: `PS_1_USER` and `PS_3_USER`). In this case the app must provide a stage-context selector so the user can choose the active pit-stop context for regular check-ins.

## Hotel Staff
This should be flagged as a special role where Dashboard access should not be available. User with this role can only scan QR code to mark a Rider as finished the ride. There is a future functionality linked to this role. To be taken up at a later stage.  

## Guest
This role is a read-only Dashboard role with all other features disabled or removed. Purpose of having this role is basically to allow users to view the ride progress or historical dashboard.

# Offline Capability:
Sometime pit stop can be in a very remote location where cellular reception may not be available or intermittent. App should be able to support offline mode. User must have an option to turn on/off 'Offline mode' manually to give user better control when data connectivity is not stable or intermittent. Offline mode indicator is required at Dashboard level.

All check in should be captured in mobile device local database/storage and asynchronously updated in the main cloud based database table. If network is not available the async update process should be put on hold until network is available.

Dashboard view should use the check in data available in the local database for display in offline mode. For `PS_x_USER`, the Dashboard should use the selected pit-stop context stage. If the user has multiple pit-stop roles, they must be able to select and persist the active pit-stop context.

Persisted pit-stop context must be validated at login/day-start against the current ride stages. If no longer valid for that ride (for example fewer stages, or no matching PIT_STOP stage), the context must be invalidated and the user informed.

Since 'Not Riding' status is records before the ride starts, this data should be synced to local offline database and used in the offline mode Dashboard view. This is to ensure pit-stop stage users are made aware of riders who won't be checking in for the day at their pit stop location.

# Administrator Features  

1. Add/Modify Ride
1. Close Ride - Lock the day's ride as completed and disable any further check ins.  

## Ride Status Management

Ride status management is available from the Dashboard hamburger menu as an Administrator-only feature.

Allowed transitions and constraints:

1. PLANNED to OPEN
  - Allowed only for today's ride
  - API: `POST /v1/tours/{tourId}/rides/open`
  - `rideId` is not sent from frontend; backend resolves today's ride

2. OPEN to STARTED
  - Allowed only for today's ride
  - API: `POST /v1/tours/{tourId}/rides/start`
  - `rideId` is not sent from frontend; backend resolves today's ride

3. STARTED to COMPLETED
  - Allowed only for rides with date as today or in the past
  - Ride must be in STARTED status
  - API: `POST /v1/tours/{tourId}/rides/{rideId}/close`
  - `rideId` is determined by the frontend and sent in the API path

Access control:

1. Only users with `ADMINISTRATOR` role should see the "Ride status management" menu option.
2. Only `ADMINISTRATOR` role should be able to use this feature.

## User Management

User Management is available from the Dashboard hamburger menu as an Administrator-only menu item with sub-menu options.

Access control:

1. Only users with `ADMINISTRATOR` role should see the "User Management" menu option.
2. Only `ADMINISTRATOR` role should be able to use User Management screens and actions.

### New User Onboarding

1. Launches a dedicated screen.
2. Required field: Email ID.
3. Optional fields: Phone no and Name.
4. Role assignment must be loaded from Cognito groups and support multi-select.
5. On submit, create the user in Cognito using standard Cognito API.
6. Phone validation should be lightweight and accept international format. UI defaults phone input to `+91`.

### Enable/Disable Existing User

1. Launches a dedicated screen with registered users list.
2. User list displays Name, Email ID and Roles.
3. Selecting a user prompts confirmation for enable/disable depending on current Cognito state.
4. On confirmation, call standard Cognito API to enable/disable the selected user.
5. Cognito User ID (`sub`) must be used as the key from UI selection through action execution.

### Modify User

1. Launches a dedicated screen with registered users list.
2. Selecting a user opens editable fields with existing values: Email ID, Phone no, Name.
3. Update/Save writes modified values to Cognito via standard Cognito API.
4. Cognito User ID (`sub`) must be used as the key from UI selection through update execution.
5. Phone validation should be lightweight and accept international format. UI defaults phone input to `+91` when missing.

### Delete User

1. Launches a dedicated screen with registered users list.
2. User list displays Name, Email ID and Roles.
3. Selecting delete for a user must show an extra destructive confirmation prompt stating that delete is permanent and cannot be undone.
4. Only after confirmation should the app call the standard Cognito delete user API.
5. Cognito User ID (`sub`) must be used as the key from UI selection through delete execution.

Data model and fields to be determined as part of design and development stage.

# Backend
Data model and APIs for data access is provided by solution developed by the repo - [Backend](https://github.com/kvijay77-in/tour-data-api). Read through it's requirements and how it is implemented. Follow guidelines and recommendations in this repo for any data access implementation. Ensure data privacy and security is not compromised for any reason. 

**API Gap / Change Request:**

- The CheckIn `checkedInBy` field is currently a Cognito username which non-admin clients cannot map to a human-friendly display name. Recommend the backend include an optional `checkedInByName` string on CheckIn payloads returned by `GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress` and check-in creation responses when available.
- Alternative: expose a minimal read-only mapping endpoint `GET /v1/tours/{tourId}/users?fields=cognitoUserName,displayName` restricted to check-in roles. Clients should fallback to `"Not Available"` when the field is absent.

# Others
Mobile device permission is only required for Camera to scan QR Code. 
Check if local database requires storage permission??

UI layout must account for safe areas and system bars on all supported platforms. On Android edge-to-edge devices, top headers must not overlap the status bar and bottom-anchored controls (footer actions, tab bars, and primary action rows) must remain fully visible above the navigation bar.

---

## Related Documentation

- [Solution Design](SolutionDesign.md) — Architecture and technical design
- [Dashboard Feature](Dashboard-Feature.md) — Dashboard screen specification
- [Data Integration Design](DataIntegrationDesign.md) — Backend integration and offline sync design
- [tour-data-api Requirements](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/Requirements.md) — Backend data requirements

---

[← Back to README](../README.md)
