# Rider Float

When a ride route with longer distance or big climbs or combined becomes quite challenging for a rider, tour organizer offer an option for the rider to start the actual ride at a stage other than Stage 0 or 'Start'. Stage can be no 1 or 2 (stage no. starts at 0) or sometime both given as choice for the rider to choose, depending on the ride route difficult. Rider will be taken in a van/truck to the chosen or designated stage location and then allowed to start their ride from there. This is called 'Float'. 'Float' will be decided by the organizers at their discretion.

When 'Float' is decided, it will be defined as part of the ride.

At 'Start' stage, rider will be checked-in 'Float' check-in instead of 'Regular' Check-in. If more than 1 float is planned, then check-in will be categorized as 'Float-1', 'Float-2' and so on. Float is always from Start to a subsequent stage and not between 2 intermediate stages.

Float will use visual representation using a badge.  The card colour will continue to follow status colours as per the existing process based on 'CHECKED_IN' status.

## 1 Float
1 Float means the ride will offer 1 float from 'Start' to one of the subsequent stages, stage 1 or 2 for example.

### Float to stage 1:
This scenario is the float is offered to stage 1 or Pit Stop 1.

Rider will check-in at 'Start' as 'Float' Check-in. After successful check-in, Rider card for 'Start' and stage 1 views should show a 'float badge' always.

Rider will take van/truck to reach stage 1 and prepare to start the ride. Before starting the ride, Float Rider will check-in at stage 1 (similar to other riders who started their ride at 'Start') and begin their ride. Now the rider card should show Stage 1 check-in color.

From stage 2 onwards the rider becomes regular rider and no float badge should be shown on the card.

### Float to stage 2:
This scenario is the float is offered to stage 2 or Pit Stop 2.

Rider will check-in as similar 'Float to stage 1'. After successful check-in, Rider card for 'Start', stage 1  and stage 2 views should show a 'float badge' always.

Rider will skip stage 1 or Pit Stop 1 will not have check-in for that stage. 'Skipped check-in' will not be applicable for this case i stage 1 view. This needs to be handled to avoid confusion for stage 1 pit crew user.

Similar to previous scenario, float rider will do check-in at stage 2 and start the ride. From stage 3 onwards the rider becomes regular rider and no float badge should be shown on the card.

## Multiple Float:
Though multiple floats are technically possible it is very likely max 2 floats will be used reality for a single ride. Hence 2 Float scenario is used in the scenraio below.

In this scenaio 'Float-1' will take riders from Start to Stage 1 or Pit Stop 1 in a van and they will start their ride from stage 1 after doing stage 1 check-in. 'Float-2' will take riders from Start to Stage 2 or Pit Stop 2 skipping stage 1 or Pit Stop 1 in another van and they will start their ride from stage 2 after doing stage 2 check-in.

For riders doing 'Float-1' check-in,  Rider card for 'Start' and stage 1 views should show a 'float badge' always. For riders doing 'Float-2' check-in, Rider card for 'Start', stage 1  and stage 2 views should show a 'float badge' always.

For 'Float-2' riders, though check-in at stage 1 or Pit stop 1 is skipped, it should not be shown as 'Skipped check-in' in Stage 1 view.

Rider taking single and double floats will check-in at 'Start' as 'Float-1' or 'Float-2' check-in respectively. Float-1 should show 'float badge' and Float-2 should show 2 'float badge' for the riders in the 'Start' stage . At stage 1, rider taking single float should show like regular rides who has not yet check-in (card colour) with float badge.


## Float badge
I want either Vector or SVG badge to show a moving van (with tailwind like representation at the back). If the visual can be too small to recognize, tell me what other options I can consider for the badge.

Float badge should not obscure the Rider no in the card.

#  Float Check-in
All existing validations applies for 'Float' type check-in. For this type of check-in use 'FLOAT', 'FLOAT-1' or 'FLOAT-2' as per the scenraio explained as check-in status attribute. All other check-in attributes remain same as 'Regular' check-in.

> The requirement using check-in status value as FLOAT will make make the Rider card colour to 'not checked-in' or 'yet to check-in' status.

# Float Ride definition

Float definition will be available as part of the respective Ride data. Sample values (Full ride data is not shown here)

Sample: 1 Float
```json
 "floats": [
 {
  "floatNo": 1,
  "floatToStage": 1
 }
 ]
```

Sample: 2 Floats (as DynamoDB JSON)
```json
 "floats": {
  "L": [
   {
    "M": {
     "floatNo": {
      "N": "1"
     },
     "floatToStage": {
      "N": "1"
     }
    }
   },
   {
    "M": {
     "floatNo": {
      "N": "2"
     },
     "floatToStage": {
      "N": "2"
     }
    }
   }
  ]
 }
```