# Notification design reference (tour-mgmt-app)

This app follows the notification framework owned by `kvijay77-in/tour-data-api`:

- Source of truth: `kvijay77-in/tour-data-api/docs/notification-framework-design.md`
- This document is a quick implementation summary for frontend contributors.

## Integration overview

```mermaid
flowchart LR
  MA[Mgmt App] -- JWT --> MAPI[TourDataApi] --> NAPI[Notification APIs]
  ADM[Announce / Rules screens] --> MAPI
  BL[Backend Lambdas] --> NS[[notify]] --> MN[(MgmtNotification)] & TN[(Notification-tourId)] & RN[(RiderNotification)]
  NAPI --> NR[(NotificationRule)]
  MN & TN & RN -- Streams --> SND[Push Sender] --> MPD[(MgmtPushDevice)]
  SND --> EXPO[Expo Push Service] --> FCM[FCM/APNs] --> MA
```

## Frontend constraints

- Push is the primary alert channel; inbox API is the source of truth.
- Web users get bell + inbox (no device push registration in web).
- Do not add a new `EXPO_PUBLIC` variable for push token auth; Expo access token stays in backend SSM only.
- Use `app.json` `extra.eas.projectId` when requesting Expo push tokens.
- Route targets from notification payloads must use the allow-list:
  `NOTIFICATIONS`, `DASHBOARD`, `RIDE_INFO`, `EVENTS_HOME`, `HOTEL_MANAGEMENT`.
  Unknown targets must open the inbox.
