# Notification Framework Handoff: tour-data-api ➜ tour-mgmt-app

## What was implemented in `tour-data-api`

## 1) Notification rule/template refinements
- `messageTemplate` is now the primary message field in `NotificationRule`.
- Backward compatibility is preserved for legacy `bodyTemplate` reads/writes.
- Rule/template limits are enforced from AppConfig (`NOTIFICATION/LIMITS`):
  - `maxTitleLength` (default `120`)
  - `maxMessageLength` (default `500`)
  - `archiveAfterReadHours` (default `48`)

## 2) Tour notification storage refinement
- All `TOUR#...` audiences are stored in `Notification-{tourId}`.
- New tour table `NotificationArchive-{tourId}` stores age+read-state archived rows.
- Inbox APIs read from active + archive store for tour-scoped audiences.

## 3) New/updated trigger behaviors
- Added rule-driven triggers for:
  - check-in creation (`CHECKIN_CREATED`)
  - check-in cancellation (`CHECKIN_CANCELLED`)
  - event completion by rider (`EVENT_COMPLETED_BY_RIDER`)
- Event completion notification is sent only when all activities are completed for the rider, excluding activities that are:
  - disabled, or
  - marked `skipped=true` by organizers via occurrence activity overrides.

## 4) Event-definition notification controls
- Event definition now supports optional `notificationConfig`:
  - `completionNotifyEnabled`
  - `completionRuleId`
  - `reminderEnabled`
  - `reminderRuleId`
- Activity override supports optional `skipped` boolean.

## 5) Reminder API
- New endpoint (TourDataApi): `POST /v1/notifications/reminders`
- Supports:
  - `RIDE_CHECKIN_NOT_STARTED`
  - `EVENT_CHECKIN_NOT_STARTED`
- Event reminder runs only when event definition `notificationConfig.reminderEnabled=true`.
- For ride reminders, riders whose stage-0 check-in was cancelled are treated as “not started”.

---

## Expected `tour-mgmt-app` changes

## A) Notification rule management UI/API payloads
- Use `messageTemplate` in rule create/update forms and payloads.
- Continue tolerating existing rules that still expose `bodyTemplate` during migration windows.
- Add client-side guards based on config-driven limits from `GET /v1/config?configType=NOTIFICATION`.

## B) Event definition editor
- Add controls for `notificationConfig`:
  - enable completion notification
  - completion rule selector/id
  - enable reminders
  - reminder rule selector/id
- Ensure event create/update payloads include `notificationConfig` when configured.

## C) Activity override editor
- Add `skipped` toggle in occurrence activity override UX.
- Send `skipped` in `PUT .../activity-overrides` payload as needed.

## D) Reminder action flows
- Add admin action(s) to call `POST /v1/notifications/reminders`:
  - ride not-started reminder
  - event not-started reminder
- Required request fields by mode:
  - ride: `reminderType=RIDE_CHECKIN_NOT_STARTED`, `tourId`, `rideId`
  - event: `reminderType=EVENT_CHECKIN_NOT_STARTED`, `tourId`, `eventId`, `occurrenceId`
- Surface response metadata (`targetCount`, optional `riderIds`) for operator confirmation.

## E) Contract compatibility note
- Existing endpoint paths remain unchanged.
- New reminder endpoint and additive payload fields are backward compatible.
