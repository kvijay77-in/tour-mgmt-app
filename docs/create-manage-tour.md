# Tour creation & provisioning and Ride Definitions.

## Requirement
As part of Tour Management, an Administrator must Create Tour, provision it and define all rides that are part of the tour. A screen with Web app based User Experience as primary and Mobile app as fall-back and ad-hoc use is required.

Tour data are isolated by design in tour-specific tables. 'Provisioning' is a special step once a tour is created which will create tour-specific DynamoDB tables in the backend. Without these tables even rides can't be defined let alone managing the tour.

High Level Flow 
  - User launches the screen using 'Define/Update Tour' menu item.
  - user should be able to select from existing list of tours or creates a new tour. 
  - user adds details for the (new) tour or modify an existing tour definition.
  - User should be able to save and/or provision the tour
  - provision tour should be allowed only once.
  - Define Rides - 1 or many (only possible after provisioning is done).


When the screen is launched existing Tour and all Ride data for the Tour must be fetched from backend using the respective API. If any API returns not found, it should be treated as valid response i.e. the respective item is not created yet and no exception should be thrown.

`rideCount` is a required positive integer on every tour definition and controls the number of ride definition tabs opened in the ride-management phase. A missing tour detail or missing ride collection is a valid empty state, not a screen error.

### Tour
Tour section should be on top to allow 'Tour' definition  to be created/updated with 'Save', 'Provision' and 'Save All' buttons.  

**Save**  
  - Create 'new' Tour definition item (provisioning=false is default so not required) using POST API. OR
  - Update an existing item using PUT API. 'Save' button should be enabled only if any of the arrribute was changed to allow saving the update.

**Provision**  
  - For new item, use POST API and also include the attribute 'provisioning=true'. OR
  - For 'update' item i.e. if any Tour attribute has been modified, use PUT API. OR
  - For 'no update' i.e. no attribute has been modified but 'Provision' button is clicked, use PUT API with 'provisionOnly' = true. This is to allow 'Provisioning' only without update. 

Provisioning is a one-time initial operation and is authoritative from the returned `provisionedAt` value. Once `provisionedAt` exists, the initial Provision action is disabled. The dedicated backend re-provision endpoint remains a separate capability for repairing missing tables and is not the initial provisioning action in this screen.

**Save All**
  - Go through Tour and and each Ride and use POST or PUT API as per the state of the respective item. State of the item must be determined after getting all Tour and Rides as part of the initial loading of the existing data.
  - If POST is used for Tour, the 'provisioning=true' must be included.
  
> When Provisioning is indicated the response can take slightly longer than regular POST/PUT API call and this is expected.


### Ride 
Rides section should use Tab layout to show each ride in a tab. It should be below the 'Tour' section.

When an existing tour is loaded, all existing rides must be loaded in the order based on Ride ID. Then make sure the tab loaded are matching the tour 'rideCount' and if not open as many tabs to make tab count = 'rideCount'. Latter case is possible when user has defined only few rides previously and may want to continue later.

For new tour, open as many tabs as per 'rideCount' value.

Existing rides are sorted by `rideId` and are never removed when `rideCount` is reduced; new draft tabs are appended only until the requested count is reached. Draft IDs start at `RIDE001` and skip IDs already used by loaded rides.

Each tab should have a 'Save' button and it should be enabled for values are changed for an existing Ride. For new rides once a  field is filled up, Save button should be enabled. 'Save' button should only save the active tab ride and must perform mandatory attribute validation before saving the ride in backend. Validation should be applied only for the 'active tab' ride which is being saved.

Ride ID should be auto-generated starting from RIDE001. 

At Ride level, edit should be allowed only for rides with status PLANNED and ACTIVE.

COMPLETED rides should always be shown as 'read-only'.

The full ride editability matrix is: new drafts and existing `PLANNED` or `ACTIVE` rides are editable by `ADMINISTRATOR`; `OPEN`, `STARTED`, `COMPLETED`, and `CLOSED` rides are read-only. `SUPER_USER` can view all rides but has no write controls.

** Ride Layout **

Ride Tab should have 2 section with top to define the ride and bottom to add Pit Stop/Stage definitions.

Pit stop(i.e.) Stage section should have a tabular layout as per below. For existing Ride, do not show START and FINISH types i.e. only PIT_STOP types should be shown. For a new ride, while saving, add START and FINISH type stages automatically as below. 

In 'Pit Stops' section add a + and - buttons for each line to add and remove stage.

Existing `START` and `FINISH` stages remain part of the ride definition but are hidden from the pit-stop editor. Outgoing writes reconstruct `START` as `S000/0`, assign ordered pit stops `S001`, `S002`, and so on, and append `FINISH`. Runtime fields `pitStopStatus`, `openedAt`, and `closedAt` are never sent by the definition editor.

stageId and stageNumber should start with S000 and 0 for START and Pit Stop stages should be added in the order it is shown in the table. Finally FINISH stage should be added. This needs to be done for new ride mostly. However if an existing ride is modified to add/remove stages, stageId and stageNumber should be adjusted to have a sequence starting from 0.

START Stage:
```
  {
   "name": "Start",
   "stageId": "S000",
   "stageNumber": 0,
   "type": "START"
  }
```
FINISH Stage:
```
  {
   "name": "Finish",
   "stageId": "S003",
   "stageNumber": 3,
   "type": "FINISH"
  }
```
  
Ride ID (Tab label)  

=========================================================  
Name:  
Date:  
Start From:						Finish At:  
Distance:  

Open Time:  
Flag-off Time: 						Close Time:  

Status: (view only field)  

=========================================================  
					Pit Stops  
|Name|Distance (from start)|Open Time (Planned)|Duration (min)|  
|---|---|---|---|  
| Ride name | Distance in KM | Offset in minutes | Min as Int|

=========================================================  

For completed ride show, startedAt, completedAt time.  

=========================================================  


### Access Right
Create/Update only for 'ADMINISTRATOR' role. Screen should have 'read-only' or 'view only' mode for 'SUPER_USER' role. No access for any lower level roles.

The route and menu item are available only to `ADMINISTRATOR` and `SUPER_USER`. Administrator can edit and provision; Super User can select and inspect tour data but sees no write controls. Lower roles cannot reach the route through the registered navigation stack.

## Development approach
Analyse and create a plan to implement this requirement. Plan must be persisted in repo memory to allow multiple session implementation.

Refer to temp/api-guide.md for the latest API specs.

Each plan phase should also include applicable docs update instead having a separate phase for it.
