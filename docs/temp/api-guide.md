# API Guide

[← Back to Solution Design](SolutionDesign.md)

This document contains detailed API design, endpoint contracts, validations, and authorization rules for the Tour Data API.

## API Structure

**Base URL:** `https://api.{domain}`

**Authentication:** JWT tokens from Cognito User Pool

**Authorization:** Role-based access control (RBAC) enforced in Lambda

## Core Principles

1. **RESTful Design:** Standard HTTP methods and status codes
2. **Consistent Response Format:** All responses follow same structure
3. **Error Handling:** Descriptive error messages with proper status codes
4. **Versioning:** URI versioning (/v1/)
5. **Pagination:** For list operations (though not critical for this volume)

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-02-10T10:30:00Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "RIDER_NOT_FOUND",
    "message": "Rider R57 not found in tour TOT-2026"
  },
  "timestamp": "2026-02-10T10:30:00Z"
}
```

## API Endpoints

All routes below are shown with the deployed API version prefix (`/v1`).

### Endpoint Catalog

| Domain | Method | Path | Purpose | Contract | Example | Mgmt App | Rider App |
|---|---|---|---|---|---|---|---|
| Config | GET | `/v1/config` | Get enabled app configuration items | [Config](#config) | [Example](#get-config) | ✅ | ✅ |
| Tours | GET | `/v1/tours/active` | Get currently active tour | [Tours](#tours) | [Example](#get-active-tour) | ✅ | ✅ |
| Tours | GET | `/v1/tours/{tourId}` | Get tour details | [Tours](#tours) | [Example](#get-tour) | ✅ | ✅ |
| Tours | GET | `/v1/tours` | List tours | [Tours](#tours) | [Example](#list-tours) | ✅ | ✅ |
| Tours | POST | `/v1/tours` | Create tour, optionally provision tables | [Tours](#tours) | [Example](#create-tour) | ✅ | ❌ |
| Tours | PUT | `/v1/tours` | Update tour and optionally provision it for the first time | [Tours](#tours) | [Example](#update-tour) | ✅ | ❌ |
| Tours | PUT | `/v1/tours/{tourId}/provision` | Re-provision missing tour tables | [Tours](#tours) | [Example](#re-provision-tour-tables) | ✅ | ❌ |
| Tours | POST | `/v1/tours/{tourId}/archive` | Archive tour | [Tours](#tours) | [Example](#archive-tour) | ✅ | ❌ |
| Riders | POST | `/v1/riders/profile` | Create rider profile | [Riders](#riders) | [Example](#create-rider-profile) | ❌ | ✅ |
| Riders | POST | `/v1/riders/profile/{profileId}` | Create rider profile | [Riders](#riders) | [Example](#create-rider-profile-with-path-profileid) | ❌ | ✅ |
| Riders | GET | `/v1/riders/link/{cognitoUserName}` | Get linked profile ID for a Cognito username | [Riders](#riders) | [Example](#get-cognito-link) | ❌ | ✅ |
| Riders | POST | `/v1/riders/link/{cognitoUserName}` | Create Cognito username to profile mapping | [Riders](#riders) | [Example](#create-cognito-link) | ❌ | ✅ |
| Riders | DELETE | `/v1/riders/link/{cognitoUserName}` | Delete Cognito username to profile mapping | [Riders](#riders) | [Example](#delete-cognito-link) | ❌ | ✅ |
| Riders | GET | `/v1/riders/profile/{profileId}` | Get rider profile | [Riders](#riders) | [Example](#get-rider-profile) | ✅ | ✅ |
| Riders | GET | `/v1/profile/{profileId}/tours` | List rider tour participation info across all tours for a profile | [Riders](#riders) | [Example](#list-rider-tour-participations) | ✅ | ✅ |
| Riders | GET | `/v1/profile/{profileId}/tours/{tourId}` | Get rider tour participation info | [Riders](#riders) | [Example](#get-rider-tour-participation) | ✅ | ✅ |
| Riders | PUT | `/v1/riders/profile/{profileId}` | Update rider profile | [Riders](#riders) | [Example](#update-rider-profile) | ❌ | ✅ |
| Riders | POST | `/v1/riders/profile/{profileId}/picture` | Get profile picture upload URL | [Riders](#riders) | [Example](#get-profile-picture-upload-url) | ❌ | ✅ |
| Riders | GET | `/v1/riders/profile/{profileId}/picture` | Get profile picture download URL | [Riders](#riders) | [Example](#get-profile-picture-download-url) | ❌ | ✅ |
| Riders | GET | `/v1/tours/{tourId}/riders` | List tour riders | [Riders](#riders) | [Example](#list-tour-riders) | ✅ | ❌ |
| Riders | GET | `/v1/tours/{tourId}/riders/names` | List tour riders with riderId, name, and personalCode | [Riders](#riders) | [Example](#list-tour-rider-names) | ✅ | ❌ |
| Riders | POST | `/v1/tours/{tourId}/riders` | Register rider for tour | [Riders](#riders) | [Example](#register-tour-rider) | ✅ | ❌ |
| Riders | GET | `/v1/tours/{tourId}/riders/{riderId}` | Get tour rider | [Riders](#riders) | [Example](#get-tour-rider) | ✅ | ❌ |
| Riders | POST | `/v1/tours/{tourId}/riders/{riderId}/exit` | Mark rider as exited from tour | [Riders](#riders) | [Example](#exit-rider) | ✅ | ❌ |
| Riders | POST | `/v1/tours/{tourId}/riders/{riderId}/exit/cancel` | Cancel rider exit and restore previous status | [Riders](#riders) | [Example](#cancel-rider-exit) | ✅ | ❌ |
| Riders | POST | `/v1/tours/{tourId}/riders/{riderId}/baggage/release` | Mark retained baggage as released back to the rider | [Riders](#riders) | [Example](#release-rider-baggage) | ✅ | ❌ |
| Riders | GET | `/v1/tours/{tourId}/riders/{riderId}/statistics` | Get rider statistics | [Riders](#riders) | [Example](#get-rider-statistics) | ✅ | ❌ |
| Artifacts | POST | `/v1/artifacts/tour/presign-upload` | Generate presigned upload URL for a tour artifact | [Artifacts](#artifacts) | [Example](#presign-tour-artifact-upload) | ✅ | ❌ |
| Artifacts | POST | `/v1/artifacts/ride/presign-upload` | Generate presigned upload URL for a ride artifact | [Artifacts](#artifacts) | [Example](#presign-ride-artifact-upload) | ✅ | ❌ |
| Artifacts | DELETE | `/v1/artifacts/tour/{tourId}/{artifactId}` | Delete a tour artifact | [Artifacts](#artifacts) | [Example](#delete-tour-artifact) | ✅ | ❌ |
| Artifacts | DELETE | `/v1/artifacts/ride/{tourId}/{rideId}/{artifactId}` | Delete a ride artifact | [Artifacts](#artifacts) | [Example](#delete-ride-artifact) | ✅ | ❌ |
| Artifacts | GET | `/v1/tours/{tourId}/artifacts` | Get tour artifacts manifest | [Artifacts](#artifacts) | [Example](#get-tour-artifacts) | ✅ | ✅ |
| Artifacts | GET | `/v1/tours/{tourId}/rides/{rideId}/artifacts` | Get ride artifacts manifest | [Artifacts](#artifacts) | [Example](#get-ride-artifacts) | ✅ | ✅ |
| Rides | GET | `/v1/tours/{tourId}/rides/today` | Get today's ride | [Rides](#rides) | [Example](#get-todays-ride) | ✅ | ✅ |
| Rides | GET | `/v1/tours/{tourId}/rides` | List rides | [Rides](#rides) | [Example](#list-rides) | ✅ | ✅ |
| Rides | GET | `/v1/tours/{tourId}/rides/{rideId}` | Get ride | [Rides](#rides) | [Example](#get-ride) | ✅ | ✅ |
| Rides | POST | `/v1/tours/{tourId}/rides` | Create ride | [Rides](#rides) | [Example](#create-ride) | ✅ | ❌ |
| Rides | PUT | `/v1/tours/{tourId}/rides/{rideId}` | Update ride | [Rides](#rides) | [Example](#update-ride) | ✅ | ❌ |
| Rides | POST | `/v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/open` | Open pit stop stage | [Rides](#rides) | [Example](#open-pit-stop) | ✅ | ❌ |
| Rides | POST | `/v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/close` | Close pit stop stage | [Rides](#rides) | [Example](#close-pit-stop) | ✅ | ❌ |
| Rides | POST | `/v1/tours/{tourId}/rides/open` | Open today's ride | [Rides](#rides) | [Example](#open-todays-ride) | ✅ | ❌ |
| Rides | POST | `/v1/tours/{tourId}/rides/start` | Start today's ride | [Rides](#rides) | [Example](#start-todays-ride) | ✅ | ❌ |
| Rides | POST | `/v1/tours/{tourId}/rides/{rideId}/close` | Close ride | [Rides](#rides) | [Example](#close-ride) | ✅ | ❌ |
| Check-Ins | POST | `/v1/tours/{tourId}/checkins` | Create check-in | [Check-Ins](#check-ins) | [Example](#create-check-in) | ✅ | ❌ |
| Check-Ins | GET | `/v1/tours/{tourId}/rides/{rideId}/checkins` | List ride check-ins | [Check-Ins](#check-ins) | [Example](#list-ride-check-ins) | ✅ | ❌ |
| Check-Ins | GET | `/v1/tours/{tourId}/riders/{riderId}/checkins` | List all check-ins for a rider | [Check-Ins](#check-ins) | [Example](#list-rider-check-ins) | ✅ | ✅ |
| Check-Ins | GET | `/v1/tours/{tourId}/riders/{riderId}/rides/{rideNo}/checkins` | List rider check-ins for a ride number | [Check-Ins](#check-ins) | [Example](#list-rider-check-ins-for-ride-number) | ✅ | ✅ |
| Check-Ins | POST | `/v1/tours/{tourId}/rides/{rideId}/checkins/{checkInId}/cancel` | Cancel check-in (special update) | [Check-Ins](#check-ins) | [Example](#cancel-check-in) | ✅ | ❌ |
| Check-Ins | GET | `/v1/tours/{tourId}/rides/{rideId}/dashboard` | Get dashboard payload | [Check-Ins](#check-ins) | [Example](#get-ride-dashboard) | ✅ | ❌ |
| Check-Ins | GET | `/v1/tours/{tourId}/rides/{rideId}/dashboard/progress` | Get lightweight dashboard progress payload | [Check-Ins](#check-ins) | [Example](#get-ride-dashboard-progress) | ✅ | ❌ |
| Check-Ins | GET | `/v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details` | Get rider popup details for selected ride | [Check-Ins](#check-ins) | [Example](#get-rider-ride-details) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events` | List event definitions | [Events](#events) | [Example](#list-events) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}` | Get event definition | [Events](#events) | [Example](#get-event) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events` | Create event definition | [Events](#events) | [Example](#create-event) | ✅ | ❌ |
| Events | PUT | `/v1/tours/{tourId}/events/{eventId}` | Update event definition | [Events](#events) | [Example](#update-event) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences` | List occurrences | [Events](#events) | [Example](#list-occurrences) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}` | Get occurrence | [Events](#events) | [Example](#get-occurrence) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences` | Create occurrence | [Events](#events) | [Example](#create-occurrence) | ✅ | ❌ |
| Events | PUT | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}` | Update occurrence | [Events](#events) | [Example](#update-occurrence) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/activity-overrides` | Get activity overrides | [Events](#events) | [Example](#get-activity-overrides) | ✅ | ❌ |
| Events | PUT | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/activity-overrides` | Update activity overrides | [Events](#events) | [Example](#update-activity-override) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/start` | Start occurrence | [Events](#events) | [Example](#start-occurrence) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/complete` | Complete occurrence | [Events](#events) | [Example](#complete-occurrence) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/cancel` | Cancel occurrence | [Events](#events) | [Example](#cancel-occurrence) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/records` | Create activity record | [Events](#events) | [Example](#create-activity-record) | ✅ | ❌ |
| Events | POST | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/records/{recordId}/cancel` | Cancel activity record | [Events](#events) | [Example](#cancel-activity-record) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/dashboard` | Get event dashboard | [Events](#events) | [Example](#get-event-dashboard) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/dashboard/progress` | Get event dashboard progress | [Events](#events) | [Example](#get-event-dashboard-progress) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/reconciliation` | Get event reconciliation payload | [Events](#events) | [Example](#get-event-reconciliation) | ✅ | ❌ |
| Events | GET | `/v1/tours/{tourId}/events/bootstrap` | Get event bootstrap payload | [Events](#events) | [Example](#get-event-bootstrap) | ✅ | ✅ |
| Events | GET | `/v1/tours/{tourId}/riders/{riderId}/events/progress` | Get rider event progress | [Events](#events) | [Example](#get-rider-event-progress) | ✅ | ✅ |
| Hotels | GET | `/v1/tours/{tourId}/hotels` | List hotels | [Hotels](#hotels) | [Example](#list-hotels) | ✅ | ❌ |
| Hotels | POST | `/v1/tours/{tourId}/hotels` | Create hotel | [Hotels](#hotels) | [Example](#create-hotel) | ✅ | ❌ |
| Hotels | PUT | `/v1/tours/{tourId}/hotels/{hotelId}` | Update hotel | [Hotels](#hotels) | [Example](#update-hotel) | ✅ | ❌ |
| Hotels | GET | `/v1/tours/{tourId}/hotelstays` | List hotel stays by date | [Hotels](#hotels) | [Example](#list-hotel-stays-by-date) | ✅ | ❌ |
| Hotels | GET | `/v1/tours/{tourId}/riders/{riderId}/hotelstays` | List hotel stays for a rider | [Hotels](#hotels) | [Example](#list-hotel-stays-for-rider) | ✅ | ✅ |
| Hotels | GET | `/v1/tours/{tourId}/hotels/{hotelId}/hotelstays` | List hotel stays for a hotel (optionally by date) | [Hotels](#hotels) | [Example](#list-hotel-stays-for-hotel) | ✅ | ❌ |
| Hotels | PUT | `/v1/tours/{tourId}/hotelstays/{stayDate}/{riderId}` | Upsert a single-night room allocation | [Hotels](#hotels) | [Example](#upsert-hotel-stay) | ✅ | ❌ |
| Hotels | POST | `/v1/tours/{tourId}/hotelstays/uploads/presign` | Generate upload URL for hotel allocations CSV | [Hotels](#hotels) | [Example](#presign-hotel-allocation-upload) | ✅ | ❌ |
| Hotels | GET | `/v1/tours/{tourId}/hotelstays/uploads/{uploadId}` | Get hotel allocation upload status | [Hotels](#hotels) | [Example](#get-hotel-allocation-upload-status) | ✅ | ❌ |
| Users | GET | `/v1/users/me` | Get current user claims | [Users](#users) | [Example](#get-current-user) | ✅ | ✅ |
| Users | GET | `/v1/users/cognito` | List Cognito users with only `sub` and `name` | [Users](#users) | [Example](#list-cognito-users) | ✅ | ❌ |
| Users | GET | `/v1/tours/{tourId}/users` | List tour users | [Users](#users) | [Example](#list-tour-users) | ✅ | ❌ |
| Users | GET | `/v1/tours/{tourId}/users/me` | Get current user's Tour specific details | [Users](#users) | [Example](#get-current-tour-user) | ✅ | ❌ |
| Users | POST | `/v1/tours/{tourId}/users` | Create a tour-scoped user assignment | [Users](#users) | [Example](#create-tour-user) | ✅ | ❌ |
| Users | PUT | `/v1/tours/{tourId}/users/{userId}` | Update a tour-scoped user assignment | [Users](#users) | [Example](#update-tour-user) | ✅ | ❌ |
| Admin UserMgmt | GET | `/v1/admin/usermgmt/roles` | List assignable Cognito groups | [Admin User Management](#admin-user-management) | [Example](#list-role-groups) | ✅ | ❌ |
| Admin UserMgmt | GET | `/v1/admin/usermgmt/users` | List Cognito users with roles | [Admin User Management](#admin-user-management) | [Example](#list-managed-users) | ✅ | ❌ |
| Admin UserMgmt | POST | `/v1/admin/usermgmt/users` | Create Cognito user and assign roles | [Admin User Management](#admin-user-management) | [Example](#create-managed-user) | ✅ | ❌ |
| Admin UserMgmt | POST | `/v1/admin/usermgmt/users/{cognitoUserId}/enable` | Enable Cognito user | [Admin User Management](#admin-user-management) | [Example](#enable-managed-user) | ✅ | ❌ |
| Admin UserMgmt | POST | `/v1/admin/usermgmt/users/{cognitoUserId}/disable` | Disable Cognito user | [Admin User Management](#admin-user-management) | [Example](#disable-managed-user) | ✅ | ❌ |
| Admin UserMgmt | DELETE | `/v1/admin/usermgmt/users/{cognitoUserId}` | Delete Cognito user | [Admin User Management](#admin-user-management) | [Example](#delete-managed-user) | ✅ | ❌ |
| Admin UserMgmt | PUT | `/v1/admin/usermgmt/users/{cognitoUserId}` | Update Cognito profile and roles | [Admin User Management](#admin-user-management) | [Example](#update-managed-user) | ✅ | ❌ |
| Notifications | POST | `/v1/notifications/devices` | Register/refresh current user device token | [Notifications](#notifications) | [Example](#register-device) | ✅ | ✅ |
| Notifications | DELETE | `/v1/notifications/devices/{token}` | Delete current user device token | [Notifications](#notifications) | [Example](#delete-device) | ✅ | ✅ |
| Notifications | GET | `/v1/notifications` | List inbox notifications | [Notifications](#notifications) | [Example](#list-notifications) | ✅ | ✅ |
| Notifications | GET | `/v1/notifications/unread-count` | Get unread count | [Notifications](#notifications) | [Example](#get-unread-count) | ✅ | ✅ |
| Notifications | PUT | `/v1/notifications/read` | Mark inbox as read up to timestamp | [Notifications](#notifications) | [Example](#mark-notifications-read) | ✅ | ✅ |
| Notifications | POST | `/v1/notifications` | Trigger manual announcement via rule | [Notifications](#notifications) | [Example](#create-notification) | ✅ | ❌ |
| Notifications | POST | `/v1/notifications/reminders` | Trigger reminder to riders who have not started ride/event check-in | [Notifications](#notifications) | [Example](#send-check-in-reminder) | ✅ | ❌ |
| Notifications | GET | `/v1/admin/notification-rules` | List notification rules | [Notifications](#notifications) | [Example](#list-notification-rules) | ✅ | ❌ |
| Notifications | GET | `/v1/admin/notification-rules/{ruleId}` | Get notification rule | [Notifications](#notifications) | [Example](#get-notification-rule) | ✅ | ❌ |
| Notifications | POST | `/v1/admin/notification-rules` | Create notification rule | [Notifications](#notifications) | [Example](#create-notification-rule) | ✅ | ❌ |
| Notifications | PUT | `/v1/admin/notification-rules/{ruleId}` | Update notification rule | [Notifications](#notifications) | [Example](#update-notification-rule) | ✅ | ❌ |
| Notifications | DELETE | `/v1/admin/notification-rules/{ruleId}` | Delete notification rule | [Notifications](#notifications) | [Example](#delete-notification-rule) | ✅ | ❌ |

### Request Contract Tables

#### Config

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/config` | None | `configType` (optional) | None | `configType` accepts `ALL` (default when omitted), any single config type (e.g. `ID_CODE_FORMAT`, `ID_CODE_TYPE`, `ARTIFACTS`, `HOTEL_UPLOAD`), or a comma-separated list of types; values are normalized to uppercase; returns enabled items only; response `data` includes both `items` and top-level `definitionsVersion`; `ALL` combined with other values returns `400 BAD_REQUEST`; returns `404 INVALID_CONFIG_TYPE` ("Missing or Invalid configType") when no enabled rows exist for the requested type(s); supports `If-None-Match` and `304 Not Modified` |

#### Tours

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/tours/active` | None | None | None | No body required |
| `GET /v1/tours/{tourId}` | `tourId` (required) | None | None | `tourId`: 3-50 chars, starts with letter/number, allowed `[a-zA-Z0-9_.-]` |
| `GET /v1/tours` | None | `status` (optional) | None | `status` in `PLANNING, PROVISIONING, ACTIVE, COMPLETED, ARCHIVED` |
| `POST /v1/tours` | None | None | Required: `tourId, name, startDate, endDate, rideCount`; Optional: `description, provisioning` | `tourId` format + uniqueness; dates `YYYY-MM-DD`; `endDate >= startDate`; `rideCount` must be a positive integer (total rides planned for the tour, may exceed the number of tour days); `provisioning` is boolean, defaults to `false`, is not stored in TourMaster, and provisions 11 tour tables only when `true`; successful provisioning sets `provisionedAt` |
| `PUT /v1/tours` | None | None | Required: `tourId`; Optional: `name, startDate, endDate, description, rideCount, status, provisioning` | Tour must exist; `tourId` format; dates `YYYY-MM-DD`; `endDate >= startDate`; `rideCount` must be a positive integer; `status` in `PLANNING, PROVISIONING, ACTIVE, COMPLETED, ARCHIVED`; `provisioning` is boolean and defaults to `false`; when `provisioning=false`, only TourMaster is updated; when `provisioning=true`, provisioning is allowed only when `provisionedAt` is absent, then it creates 11 tables and sets `provisionedAt`; repeat provisioning is rejected |
| `PUT /v1/tours/{tourId}/provision` | `tourId` (required) | None | None | Tour must exist and have `provisionedAt`; reruns idempotent provisioning to create only missing or newly defined table types; does not modify TourMaster, including `provisionedAt` |
| `POST /v1/tours/{tourId}/archive` | `tourId` (required) | `exportToS3` (optional, default true), `deleteTables` (optional, default true) | None | Tour exists; status must be `ACTIVE` or `COMPLETED`; ARCHIVED cannot be archived again |

#### Riders

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `POST /v1/riders/profile` | None | None | Config-driven body. Top-level keys map to CORE attributes (storage-path first, then key), optional `attributes` map for ATTRIBUTES-scope values, optional `definitionsVersion`. | Creates profile with auto-generated `profileId`; validates enabled profile definitions from AppConfig; optional attribute `null` clears value; SELECT accepts LOV value or label (case-insensitive) and stores LOV value; riders cannot write `adminOnly` attributes; duplicate email rejected (`EMAIL_ALREADY_EXISTS`); duplicate personalCode rejected (`PERSONAL_CODE_ALREADY_EXISTS`); stale `definitionsVersion` returns `409 PROFILE_DEFINITIONS_CHANGED`. |
| `POST /v1/riders/profile/{profileId}` | `profileId` (optional override route) | None | Required: `name, email, phone, emergencyContact, dateOfBirth, gender, address`; Optional: `personalCode, dietaryPreference` | Same validation as profile create; uses provided path `profileId` instead of auto-generating one; conflict on existing `profileId` returns `PROFILE_ALREADY_EXISTS` |
| `GET /v1/riders/link/{cognitoUserName}` | `cognitoUserName` (required) | None | None | Returns linked `profileId`; `404` if mapping does not exist |
| `POST /v1/riders/link/{cognitoUserName}` | `cognitoUserName` (required) | None | None | Creates mapping row with generated `profileId` UUID; duplicate `cognitoUserName` rejected (`COGNITO_USER_ALREADY_LINKED`) |
| `DELETE /v1/riders/link/{cognitoUserName}` | `cognitoUserName` (required) | None | None | Deletes mapping row; returns `404` if mapping does not exist |
| `GET /v1/riders/profile/{profileId}` | `profileId` (required) | None | None | `profileId` must exist |
| `GET /v1/profile/{profileId}/tours` | `profileId` (required) | None | None | Returns all RiderTours records for the profileId using partition key query (no `tourId` filter) |
| `GET /v1/profile/{profileId}/tours/{tourId}` | `profileId, tourId` (required) | None | None | `tourId` format: 3-50 chars, starts with letter/number, allowed `[a-zA-Z0-9_.-]`; returns one RiderTours record for the key pair |
| `PUT /v1/riders/profile/{profileId}` | `profileId` (required) | None | Partial config-driven body: submit only changed keys; optional `attributes` map; optional `definitionsVersion`. | Merges submitted values without deleting unsent keys; required checks run against merged result; top-level unknown keys return `422 UNKNOWN_OR_DISABLED_ATTRIBUTE`; `photoS3Key` must be a non-empty S3 key under `riders/{profileId}/photo/` (or legacy `profiles/{profileId}/`); stale `definitionsVersion` returns `409 PROFILE_DEFINITIONS_CHANGED`; ownership violations on RiderApi return `403 PROFILE_ACCESS_DENIED`. |
| `POST /v1/riders/profile/{profileId}/picture` | `profileId` (required) | None | Optional: `contentType` | `profileId` must exist; `contentType` in `image/jpeg, image/png`; default `image/jpeg` |
| `GET /v1/riders/profile/{profileId}/picture` | `profileId` (required) | `expiresIn` (optional) | None | `profileId` must exist and have `photoS3Key` set, else `404`; `expiresIn` is an integer between 60 and 3600 seconds, default 300; returns presigned `downloadUrl` |
| `GET /v1/tours/{tourId}/riders` | `tourId` (required) | None | None | `tourId` format rule |
| `GET /v1/tours/{tourId}/riders/names` | `tourId` (required) | None | None | Returns lightweight list with `riderId`, `name`, and `personalCode`; requires authenticated user with `READ` permission |
| `POST /v1/tours/{tourId}/riders` | `tourId` (required) | None | Required: `profileId`; Optional: `riderId, experienceLevel, medicalConditions, specialRequirements` | Tour exists with status `PLANNING/ACTIVE`; profile exists; duplicate profile registration rejected (`ALREADY_REGISTERED`); new registrations get `status=PENDING`; generates temporary riderId `PENDING-<first 8 chars of profileId>` if omitted |
| `GET /v1/tours/{tourId}/riders/{riderId}` | `tourId, riderId` (required) | None | None | `tourId` format; `riderId` format `R1..R999` |
| `POST /v1/tours/{tourId}/riders/{riderId}/exit` | `tourId, riderId` (required) | None | Required: `baggageDisposition`; Optional: `note` | Updates existing row only; sets `status=EXITED`, `prevStatus=<previous status>`, `exitedAt`, `exitedBy`, and `updatedAt`; `baggageDisposition` must be `RETAINED` or `WITH_RIDER` (else `400 BAGGAGE_DISPOSITION_REQUIRED`); `note` is stored as `baggageExitNote`; returns `409 RIDER_ALREADY_EXITED` when already exited; requires `RIDER_EXIT` permission (`ADMINISTRATOR` and `SUPER_USER` only) |
| `POST /v1/tours/{tourId}/riders/{riderId}/exit/cancel` | `tourId, riderId` (required) | None | None | Valid only when current status is `EXITED`; restores `status` from `prevStatus`; removes `prevStatus`, `exitedAt`, `exitedBy`, and associated baggage-exit metadata; returns `400 INVALID_EXIT_CANCEL_INVOCATION` for non-EXITED status; requires `RIDER_EXIT` permission (`ADMINISTRATOR` and `SUPER_USER` only) |
| `POST /v1/tours/{tourId}/riders/{riderId}/baggage/release` | `tourId, riderId` (required) | None | Optional: `note` | Valid only when the rider's baggage status is `RETAINED`; transitions baggage state to `WITH_RIDER`, stores `note` as `baggageExitNote`, and records release audit metadata; requires `RIDER_EXIT` permission (`ADMINISTRATOR` and `SUPER_USER` only) |
| `GET /v1/tours/{tourId}/riders/{riderId}/statistics` | `tourId, riderId` (required) | None | None | `tourId` + `riderId` format rules; rider must exist in tour |

#### Events

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/tours/{tourId}/events` | `tourId` (required) | None | None | Requires `READ`; returns all event definitions for the tour |
| `GET /v1/tours/{tourId}/events/{eventId}` | `tourId, eventId` (required) | None | None | Requires `READ`; `eventId` format `EVT-...`; returns `404 EVENT_NOT_FOUND` when absent |
| `POST /v1/tours/{tourId}/events` | `tourId` (required) | None | Required: `eventId, eventName, eventType, location, sequenceEnforced, defaultAllowedTypeCodes, activities`; Optional: `allowSelfService` (default `false`), `notificationConfig` | Requires `EVENT_MANAGE`; `eventType` in `SINGLE, REPEATING`; each activity requires `activityId, name, sequenceNo` (optional `enabled, mandatory, allowedTypeCodes, allowOptOut, prerequisiteActivityIds, restrictToAssignedUsers, variantOptions, notes`); validates event/activity IDs, allowed type codes (must be enabled `ID_CODE_TYPE` config), and ascending `sequenceNo`; duplicate event IDs rejected |
| `PUT /v1/tours/{tourId}/events/{eventId}` | `tourId, eventId` (required) | None | Optional: `eventName, eventType, location, sequenceEnforced, allowSelfService, defaultAllowedTypeCodes, activities` | Requires `EVENT_MANAGE`; same event/activity validations as create for supplied fields |
| `GET /v1/tours/{tourId}/events/{eventId}/occurrences` | `tourId, eventId` (required) | `date` (optional), `status` (optional) | None | Requires `READ`; lists occurrences for the event, filterable by date and status |
| `GET /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `READ`; `occurrenceId` format `EVT-...#YYYY-MM-DD#seq` |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences` | `tourId, eventId` (required) | None | Required: `date, seq`; Optional: `selfServiceEnabled, linkedOccurrenceRef` | Requires `EVENT_OCCURRENCE_MANAGE`; duplicate occurrence rejected; `activityOverrides` cannot be set on create — use the activity-overrides endpoint below after the occurrence exists |
| `PUT /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}` | `tourId, eventId, occurrenceId` (required) | None | Optional: `selfServiceEnabled, linkedOccurrenceRef` only | Requires `EVENT_OCCURRENCE_MANAGE`; rejects with `409 OCCURRENCE_CLOSED` when the occurrence is `COMPLETED`/`CANCELLED`; does not accept `date`, `seq`, or `activityOverrides` |
| `GET/PUT /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/activity-overrides` | `tourId, eventId, occurrenceId` (required) | None | For PUT: `activityId` (required); Optional: `enabled, selfServiceEnabled, skipped, allowedTypeCodes, note` | GET requires `READ`; PUT is a single-activity upsert (not a full-list replace) requiring `EVENT_OCCURRENCE_MANAGE`; omitting all optional fields removes the override entry |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/start` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `EVENT_OCCURRENCE_MANAGE`; occurrence transitions to `ACTIVE`; `startedAt` is always server-set, no client override |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/complete` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `EVENT_OCCURRENCE_MANAGE`; occurrence transitions to `COMPLETED`; `completedAt` is always server-set, no client override |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/cancel` | `tourId, eventId, occurrenceId` (required) | None | Optional: `cancelReason` | Requires `EVENT_OCCURRENCE_MANAGE`; occurrence transitions to `CANCELLED`; `cancelledAt` is always server-set, no client override |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/records` | `tourId, eventId, occurrenceId` (required) | None | Required: `activityId, riderId, method, timestamp`; Optional: `typeCode, outcome, variantSelected` | Requires `EVENT_SCAN`; occurrence must be `ACTIVE`; `typeCode` is required unless `outcome=OPTED_OUT`; sequence and activity restrictions enforced |
| `POST /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/records/{recordId}/cancel` | `tourId, eventId, occurrenceId, recordId` (required) | None | Optional: `cancelReason` | Requires `EVENT_SCAN`; retains the record and marks it cancelled with audit fields |
| `GET /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/dashboard` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `DASHBOARD`; aggregated occurrence dashboard payload (see [Get Event Dashboard](#get-event-dashboard)) |
| `GET /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/dashboard/progress` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `DASHBOARD`; lightweight progress refresh payload |
| `GET /v1/tours/{tourId}/events/{eventId}/occurrences/{occurrenceId}/reconciliation` | `tourId, eventId, occurrenceId` (required) | None | None | Requires `DASHBOARD`; returns `loadedCount`, `unloadedCount`, and `missingRiderIds` (riders with a bag loaded but not unloaded); only non-cancelled, non-`OPTED_OUT` records with a `typeCode` at each occurrence's last enabled activity are counted; `400 NO_LINKED_OCCURRENCE` when the occurrence has no `linkedOccurrenceRef` |
| `GET /v1/tours/{tourId}/events/bootstrap` | `tourId` (required) | None | None | Requires `READ`; bootstrap payload for event definitions, upcoming occurrences, and supporting lookup data |
| `GET /v1/tours/{tourId}/riders/{riderId}/events/progress` | `tourId, riderId` (required) | `eventId` (optional) | None | Requires `READ`; rider-centric event progress summary; cancelled records excluded |

#### Hotels

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/tours/{tourId}/hotels` | `tourId` (required) | None | None | Requires `READ`; lists hotel master records only |
| `POST /v1/tours/{tourId}/hotels` | `tourId` (required) | None | Required: `hotelId, name, city, address`; Optional: `contact, notes` | Requires `HOTEL_ALLOC_MANAGE`; `hotelId` format `HTL-AAA-99`; duplicate hotel rejected |
| `PUT /v1/tours/{tourId}/hotels/{hotelId}` | `tourId, hotelId` (required) | None | Optional: `name, city, address, contact, notes` | Requires `HOTEL_ALLOC_MANAGE`; updates supplied fields only |
| `GET /v1/tours/{tourId}/hotelstays` | `tourId` (required) | `date` (required) | None | Requires `READ`; returns `RoomAllocation` rows for one stay date |
| `GET /v1/tours/{tourId}/riders/{riderId}/hotelstays` | `tourId, riderId` (required) | None | None | Requires `READ`; returns hotel stays for a rider |
| `GET /v1/tours/{tourId}/hotels/{hotelId}/hotelstays` | `tourId, hotelId` (required) | `date` (optional) | None | Requires `READ`; returns hotel stays for one hotel, filtered to `date` when supplied; sorted by `roomNo`, `riderId` |
| `PUT /v1/tours/{tourId}/hotelstays/{stayDate}/{riderId}` | `tourId, stayDate, riderId` (required) | None | Required: `hotelId, roomNo`; Optional: `roomCapacity, sharingWith, checkInDate, checkOutDate` | Requires `HOTEL_ALLOC_MANAGE`; validates reciprocal sharing and room-capacity constraints |
| `POST /v1/tours/{tourId}/hotelstays/uploads/presign` | `tourId` (required) | None | None | Requires `HOTEL_ALLOC_MANAGE`; returns `uploadId`, presigned CSV upload URL, and S3 key |
| `GET /v1/tours/{tourId}/hotelstays/uploads/{uploadId}` | `tourId, uploadId` (required) | None | None | Requires `HOTEL_ALLOC_MANAGE`; returns upload processing status |

#### Users

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/users/me` | None | None | None | Returns current JWT claims as seen by the API (`emailVerified` as boolean); returns `401` for missing/invalid claims |
| `GET /v1/users/cognito` | None | None | None | Requires `READ` (any authenticated user group); returns only `sub` and `name` per Cognito user from the management user pool |
| `GET /v1/tours/{tourId}/users` | `tourId` (required) | `role` (optional) | None | Requires `USER_LIST`; `tourId` format; `role` in `ADMINISTRATOR, SUPER_USER, HOTEL_STAFF, GUEST, RIDER`, or `PS_<n>_USER`; lists tour-scoped user assignments |
| `GET /v1/tours/{tourId}/users/me` | `tourId` (required) | None | None | Requires `READ`; returns the caller's own `User-{tourId}` record (keyed by JWT `sub`); `404 USER_NOT_FOUND` if the caller has no tour-scoped record |
| `POST /v1/tours/{tourId}/users` | `tourId` (required) | None | Required: `userId, role`; Optional: `status, assignedStage, hotelId, eventAssignments, assignedActivityIds` | Requires `USER_MANAGE`; `userId` must be a valid Cognito sub and an existing managed user (`404 USER_NOT_FOUND` otherwise); `username`/`email`/`name` are snapshotted from the Cognito profile, not taken from the request body; validates referenced hotels/events |
| `PUT /v1/tours/{tourId}/users/{userId}` | `tourId, userId` (required) | None | Optional: `username, email, name, role, status, assignedStage, hotelId, eventAssignments, assignedActivityIds` | Requires `USER_MANAGE`; validates supplied referenced hotels/events and updates only provided fields |

#### Artifacts

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `POST /v1/artifacts/tour/presign-upload` | None | None | Required: `tourId, artifactId`; Optional: `contentType` (default `application/pdf`) | Requires `ARTIFACT_MANAGE`; `tourId` must exist; artifact type must be configured under `ARTIFACTS` with `category=tour`; `contentType` must be in the allow-list; upserts metadata (increments `version` on re-upload) and returns `200` with a presigned S3 `put_object` URL valid for 300 seconds |
| `POST /v1/artifacts/ride/presign-upload` | None | None | Required: `tourId, rideId, artifactId`; Optional: `contentType` (default `application/pdf`) | Requires `ARTIFACT_MANAGE`; `tourId` and `rideId` must exist; artifact type must be configured with `category=ride`; `contentType` must be in the allow-list; upserts metadata (increments `version` on re-upload) and returns `200` with a presigned `put_object` URL valid for 300 seconds |
| `DELETE /v1/artifacts/tour/{tourId}/{artifactId}` | `tourId, artifactId` (required) | None | None | Requires `ARTIFACT_MANAGE`; deletes the S3 object and corresponding `Artifacts-{tourId}` table record; returns `404` when not found |
| `DELETE /v1/artifacts/ride/{tourId}/{rideId}/{artifactId}` | `tourId, rideId, artifactId` (required) | None | None | Requires `ARTIFACT_MANAGE`; deletes the ride-scoped S3 object and metadata; returns `404` when not found |
| `GET /v1/tours/{tourId}/artifacts` | `tourId` (required) | `artifactId` (optional), `expiresIn` (optional) | None | Requires `READ`; `tourId` must exist; returns list of artifacts with presigned download URLs; `artifactId` filters to single artifact; `expiresIn` is integer between 60 and 3600 seconds (default 900); empty list if no artifacts found |
| `GET /v1/tours/{tourId}/rides/{rideId}/artifacts` | `tourId, rideId` (required) | `artifactId` (optional), `expiresIn` (optional) | None | Requires `READ`; `tourId` and `rideId` must exist; returns list of ride artifacts with presigned download URLs; `artifactId` filters to single artifact; `expiresIn` is integer between 60 and 3600 seconds (default 900); empty list if no artifacts found |

#### Rides

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/tours/{tourId}/rides/today` | `tourId` (required) | None | None | `tourId` format; 404 `NO_ACTIVE_RIDE` when no ride for current UTC date |
| `GET /v1/tours/{tourId}/rides` | `tourId` (required) | `status` (optional) | None | `tourId` format; `status` in `OPEN, STARTED, PLANNED, ACTIVE, COMPLETED, CLOSED`; date filter not implemented |
| `GET /v1/tours/{tourId}/rides/{rideId}` | `tourId, rideId` (required) | None | None | `tourId` format; `rideId` format `RIDE###` |
| `POST /v1/tours/{tourId}/rides` | `tourId` (required) | None | Required: `rideId, date, rideNo, name, startLocation, finishLocation, totalDistance, flagOffTime, stages`; Optional: `openTime, closeTime, floats, description` | date `YYYY-MM-DD`; `flagOffTime/openTime/closeTime` `HH:MM`; `totalDistance > 0`; `rideNo` positive integer; `stages` must be sequential with `START` first and `FINISH` last; `estimatedOpenTime` and `pitStopDuration` allowed only for `PIT_STOP`; `pitStopStatus/openedAt/closedAt` are system-managed; `floats` must be an array of unique positive `floatNo` values and `floatToStage` values between `1` and the ride's last stage number; tour status `PLANNING/ACTIVE`; duplicate `rideId` rejected |
| `PUT /v1/tours/{tourId}/rides/{rideId}` | `tourId, rideId` (required) | None | At least one of: `name, date, rideNo, startLocation, finishLocation, totalDistance, flagOffTime, openTime, closeTime, stages, floats, description, status` | date/time/number checks when fields present; `status` in `OPEN, STARTED, PLANNED, ACTIVE, COMPLETED, CLOSED`; stage updates preserve live pit-stop runtime state; `floats` follows the same validation rules as create |
| `POST /v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/open` | `tourId, rideId, stageNumber` (required) | None | None | Caller requires `PIT_STOP_MANAGE`; stage must exist, be `PIT_STOP`, and caller must hold matching `PS_<n>_USER` role unless SUPER_USER/ADMINISTRATOR; ride status must be `STARTED`; sets `pitStopStatus=OPEN` and `openedAt` |
| `POST /v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/close` | `tourId, rideId, stageNumber` (required) | None | None | Caller requires `PIT_STOP_MANAGE`; same stage rules as open; ride status must be `STARTED`; pit stop must already be `OPEN`; sets `pitStopStatus=CLOSED` and `closedAt` |
| `POST /v1/tours/{tourId}/rides/open` | `tourId` (required) | None | None | Finds ride for current UTC date and sets status to `OPEN`; rejects if already `OPEN`; no `rideId` accepted |
| `POST /v1/tours/{tourId}/rides/start` | `tourId` (required) | None | None | Finds ride for current UTC date and sets status to `STARTED`; rejects if already `STARTED`; no `rideId` accepted |
| `POST /v1/tours/{tourId}/rides/{rideId}/close` | `tourId, rideId` (required) | None | None | Ride must exist and must not already be `CLOSED` |

#### Check-Ins

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `POST /v1/tours/{tourId}/checkins` | `tourId` (required) | None | Required: `riderId, rideId, method`; Conditionally Required: `stageNumber` (normal/float check-ins), `floatNo` (when `isFloat=true`); Optional: `isNotRiding, isFloat, isQuitRiding, timestamp, notes` | `method` in `QR_SCAN, MANUAL, FALLBACK`; MANUAL requires `CHECKIN_MANUAL`; timestamp ISO UTC `Z`; `isNotRiding`, `isFloat`, and `isQuitRiding` are mutually exclusive; `floatNo` must be a positive integer when `isFloat=true`; `stageNumber` required unless status is Not Riding or Quit Riding; rider exists in tour; duplicate and status conflict checks enforced (`DUPLICATE_CHECKIN`, `DUPLICATE_NOT_RIDING`, `RIDER_NOT_RIDING`, `RIDER_QUIT_RIDING`, `RIDE_CLOSED`); cancelled check-ins are ignored during these validations |
| `GET /v1/tours/{tourId}/rides/{rideId}/checkins` | `tourId, rideId` (required) | None | None | `tourId` + `rideId` format rules; ride must exist; cancelled check-ins are excluded from the response; each check-in keeps core audit attribute `checkedInBy` |
| `GET /v1/tours/{tourId}/riders/{riderId}/checkins` | `tourId, riderId` (required) | None | None | `tourId` + `riderId` format rules; rider must be registered in tour; cancelled check-ins are excluded from the response |
| `GET /v1/tours/{tourId}/riders/{riderId}/rides/{rideNo}/checkins` | `tourId, riderId, rideNo` (required) | None | None | `tourId` + `riderId` format rules; `rideNo` positive integer; rider must be registered in tour; cancelled check-ins are excluded from the response |
| `POST /v1/tours/{tourId}/rides/{rideId}/checkins/{checkInId}/cancel` | `tourId, rideId, checkInId` (required) | None | Required: `status, prevStatus` | Invocation is valid only when `status` contains `CANCELLED` (case-insensitive); updates only `status`, `prevStatus`, `cancelledBy`, and `cancelledAt`; any non-cancel status returns `INVALID_CANCEL_INVOCATION` |
| `GET /v1/tours/{tourId}/rides/{rideId}/dashboard` | `tourId, rideId` (required) | None | None | `tourId` + `rideId` format rules; ride must exist; supports `If-None-Match` and `304 Not Modified` |
| `GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress` | `tourId, rideId` (required) | None | None | Lightweight refresh contract with `rideId`, `checkIns`, `cancelled`, `summary`, `dataVersion`; `checkIns` retains active (non-cancelled) entries, `cancelled` contains cancelled check-in entries, and both lists keep core attribute `checkedInBy`; excludes `ride` and `riders`; supports `If-None-Match` and `304 Not Modified` |
| `GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details` | `tourId, rideId, riderId` (required) | None | None | Returns popup-focused rider fields plus selected-ride `checkInTimeline`; cancelled entries excluded; returns `404` when ride or rider does not exist; supports `If-None-Match` and `304 Not Modified` |

#### Admin User Management

All endpoints below require caller role `ADMINISTRATOR` and are backed by the management Cognito User Pool.

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /v1/admin/usermgmt/roles` | None | None | None | Returns dynamic groups from management user pool, sorted lexicographically |
| `GET /v1/admin/usermgmt/users` | None | `role` (optional), `enabled` (optional), `limit` (optional), `nextToken` (optional) | None | `role` must exist in user-pool groups; `enabled` must be boolean string |
| `POST /v1/admin/usermgmt/users` | None | None | Required: `email, roles`; Optional: `phoneNumber, name` | `email` valid; `phoneNumber` E.164 when present; `roles` non-empty valid groups; role assignment failure triggers rollback + `ROLE_ASSIGNMENT_CONFLICT` |
| `POST /v1/admin/usermgmt/users/{cognitoUserId}/enable` | `cognitoUserId` (required UUID) | None | None | Idempotent success for already enabled users |
| `POST /v1/admin/usermgmt/users/{cognitoUserId}/disable` | `cognitoUserId` (required UUID) | None | None | Idempotent success for already disabled users |
| `DELETE /v1/admin/usermgmt/users/{cognitoUserId}` | `cognitoUserId` (required UUID) | None | None | Deletes the Cognito user directly with `AdminDeleteUser`; SDK/API flow does not require a prior disable |
| `PUT /v1/admin/usermgmt/users/{cognitoUserId}` | `cognitoUserId` (required UUID) | None | At least one of: `email, phoneNumber, name, roles` | `roles` when provided is full replacement set; empty `phoneNumber`/`name` clears Cognito attribute |

#### Notifications

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `POST /v1/notifications/devices` | None | None | Required: `token, platform` | `platform` in `ios,android`; identity from JWT claims only; idempotent upsert; if token exists under a different user it is moved |
| `DELETE /v1/notifications/devices/{token}` | `token` (required) | None | None | Deletes only current user's token; always returns `204` |
| `GET /v1/notifications` | None | `since` (optional ISO), `limit` (optional) | None | Merges audiences derived from JWT identity and tour context; returns `{items, unreadCount}` with `isRead` from per-user state row |
| `GET /v1/notifications/unread-count` | None | None | None | Returns current unread count based on `lastReadAt` state |
| `PUT /v1/notifications/read` | None | None | Optional: `readAt` | Upserts `STATE#<profileId|sub>/STATE` item; defaults `readAt` to now |
| `POST /v1/notifications` | None | None | Required: `ruleId`; Optional: `tourId, context, audiences` | TourDataApi only, requires `NOTIFICATION_MANAGE`; invokes notification framework |
| `POST /v1/notifications/reminders` | None | None | Required: `reminderType, tourId`; For ride reminder: `rideId`; For event reminder: `eventId, occurrenceId`; Optional: `ruleId` | TourDataApi only, requires `NOTIFICATION_MANAGE`; event reminders execute only when event definition allows reminders |
| `GET /v1/admin/notification-rules` | None | None | None | TourDataApi only, requires `NOTIFICATION_MANAGE` |
| `GET /v1/admin/notification-rules/{ruleId}` | `ruleId` (required) | None | None | TourDataApi only, requires `NOTIFICATION_MANAGE` |
| `POST /v1/admin/notification-rules` | None | None | Rule object | TourDataApi only, requires `NOTIFICATION_MANAGE`; validates enums/audiences/templates and sets `version=1` by default |
| `PUT /v1/admin/notification-rules/{ruleId}` | `ruleId` (required) | None | Rule object | TourDataApi only, requires `NOTIFICATION_MANAGE`; strict validation; increments `version` |
| `DELETE /v1/admin/notification-rules/{ruleId}` | `ruleId` (required) | None | None | TourDataApi only, requires `NOTIFICATION_MANAGE` |

### API Examples

#### Example Conventions

- **Headers:** every request needs `Authorization: Bearer <Cognito JWT>`. Requests with a body also need `Content-Type: application/json`.
- **Responses:** examples show only the `data` value of the success envelope (`{"success": true, "data": ..., "timestamp": ...}`) along with the HTTP status. Fields that hold `null` in DynamoDB come back as `null`. Optional fields that were never set are left out.
- **IDs containing `#`:** `checkInId`, `occurrenceId`, and `recordId` must be URL-encoded (`#` → `%23`) when used as path parameters. For example, `EVT-BAGLOAD#2026-02-12#1` becomes `EVT-BAGLOAD%232026-02-12%231`.
- **Conditional GETs:** endpoints that return an `ETag` header (config, ride dashboard, dashboard progress, rider ride details, event bootstrap) accept `If-None-Match: <ETag>`. If the ETag matches, they return `304 Not Modified` with an empty body.
- **Presigned URLs** are shortened with `...`. When uploading, send the same `Content-Type` that was used to sign the URL.
- **`{ ... }` placeholders** stand for an object shown in full in another example. The linked example is noted next to it.

Shared sample data used across the examples:

| Entity | Sample values |
|---|---|
| Tour | `TOT-2026` "Tour of Tamilnadu 2026", `2026-02-10` → `2026-02-17`, 8 rides |
| Riders | `R57` John Doe (`profileId` `3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f`, personalCode `D157`); `R12` Priya Raman (`profileId` `8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c`, personalCode `P012`) |
| Ride | `RIDE001` "Geneva to Lausanne" on `2026-02-11`, stages `S000` Start / `S001` PS1 / `S002` Finish, float `1` → stage `1` |
| Event | `EVT-BAGLOAD` "Baggage Loading", occurrence `EVT-BAGLOAD#2026-02-12#1`, linked to `EVT-BAGUNLOAD#2026-02-12#1` |
| Hotel | `HTL-MDU-01` Madurai Residency, room `204` shared by `R57` and `R12` |
| Mgmt users | Asha Kumar, `ADMINISTRATOR`, sub `7c9e6679-7425-40de-944b-e07fc1f90ae7`; Ravi Shankar, `HOTEL_STAFF`, sub `5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f`; Meena Iyer, `PS_1_USER`, sub `9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d` |

#### Config Examples

##### Get Config

```http
GET /v1/config?configType=ID_CODE_FORMAT
If-None-Match: "5f2b3c8d9e0a1b2c3d4e5f6a7b8c9d0e"
```

Response `200 OK` (header `ETag: "0a6d1e7c4b3f2a19e8d7c6b5a4f3e2d1"`):
```json
{
  "items": [
    {
      "configType": "ID_CODE_FORMAT",
      "configId": "SUBSTRING",
      "enabled": true,
      "description": "Substring based extraction for production QR payloads",
      "version": 1,
      "updatedAt": "2026-01-02T00:00:00Z",
      "updatedBy": "seed-script",
      "config": {
        "method": "SUBSTRING",
        "idCode": { "startPosition": 12, "length": 5 },
        "idCodeType": { "startPosition": 1, "length": 1 },
        "personalCode": { "startPosition": 2, "length": 4 }
      }
    }
  ]
}
```

Items returned for `configType=ID_CODE_TYPE,ARTIFACTS` have the same envelope. For example:
```json
{
  "items": [
    {
      "configType": "ARTIFACTS",
      "configId": "ride-plan",
      "enabled": true,
      "description": "Tour of Tamil Nadu - Ride Plan",
      "version": 1,
      "updatedAt": "2026-01-02T00:00:00Z",
      "updatedBy": "seed-script",
      "config": { "category": "tour" }
    },
    {
      "configType": "ID_CODE_TYPE",
      "configId": "3",
      "enabled": true,
      "description": "ID code type mapping for code 3",
      "version": 1,
      "updatedAt": "2026-01-02T00:00:00Z",
      "updatedBy": "seed-script",
      "config": { "code": "3", "type": "BAGGAGE", "name": "Baggage 1", "description": "Baggage type 1" }
    }
  ]
}
```

#### Tours Examples

##### Get Active Tour

```http
GET /v1/tours/active
```

Response `200 OK`:
```json
{
  "tourId": "TOT-2026",
  "name": "Tour of Tamilnadu 2026",
  "startDate": "2026-02-10",
  "endDate": "2026-02-17",
  "status": "ACTIVE",
  "rideCount": 8,
  "description": "Annual coastal cycling tour",
  "provisionedAt": "2026-01-05T09:01:30Z",
  "createdAt": "2026-01-05T09:00:00Z",
  "updatedAt": "2026-02-09T18:00:00Z"
}
```

##### Get Tour

```http
GET /v1/tours/TOT-2026
```

Response `200 OK`: same object as [Get Active Tour](#get-active-tour).

##### List Tours

```http
GET /v1/tours?status=ACTIVE
```

Response `200 OK`:
```json
{
  "tours": [
    {
      "tourId": "TOT-2026",
      "name": "Tour of Tamilnadu 2026",
      "startDate": "2026-02-10",
      "endDate": "2026-02-17",
      "status": "ACTIVE",
      "rideCount": 8,
      "description": "Annual coastal cycling tour",
      "provisionedAt": "2026-01-05T09:01:30Z",
      "createdAt": "2026-01-05T09:00:00Z",
      "updatedAt": "2026-02-09T18:00:00Z"
    }
  ],
  "count": 1
}
```

##### Create Tour

```http
POST /v1/tours
```
```json
{
  "tourId": "TOT-2026",
  "name": "Tour of Tamilnadu 2026",
  "startDate": "2026-02-10",
  "endDate": "2026-02-17",
  "rideCount": 8,
  "description": "Annual coastal cycling tour",
  "provisioning": true
}
```

Response `201 Created`. `provisioning` is not stored. `provisionedAt` is only present when `provisioning=true`:
```json
{
  "tourId": "TOT-2026",
  "name": "Tour of Tamilnadu 2026",
  "startDate": "2026-02-10",
  "endDate": "2026-02-17",
  "status": "PLANNING",
  "rideCount": 8,
  "createdAt": "2026-01-05T09:00:00Z",
  "updatedAt": "2026-01-05T09:01:30Z",
  "description": "Annual coastal cycling tour",
  "provisionedAt": "2026-01-05T09:01:30Z"
}
```

##### Update Tour

`TOT-2026` is already provisioned, so `provisioning` must be `false` or left out. Use [Re-provision Tour Tables](#re-provision-tour-tables) to add missing tables.

```http
PUT /v1/tours
```
```json
{
  "tourId": "TOT-2026",
  "status": "ACTIVE",
  "provisioning": false
}
```

Response `200 OK`:
```json
{
  "tour": {
    "tourId": "TOT-2026",
    "name": "Tour of Tamilnadu 2026",
    "startDate": "2026-02-10",
    "endDate": "2026-02-17",
    "status": "ACTIVE",
    "rideCount": 8,
    "description": "Annual coastal cycling tour",
    "provisionedAt": "2026-01-05T09:01:30Z",
    "createdAt": "2026-01-05T09:00:00Z",
    "updatedAt": "2026-02-09T18:00:00Z"
  },
  "provisioning": false,
  "provisionedTables": []
}
```

##### Re-provision Tour Tables

```http
PUT /v1/tours/TOT-2026/provision
```

Response `200 OK`. `provisionedTables` lists only the tables created by this call (`<stack>-<TableType>-<tourId>`):
```json
{
  "tour": {
    "tourId": "TOT-2026",
    "name": "Tour of Tamilnadu 2026",
    "startDate": "2026-02-10",
    "endDate": "2026-02-17",
    "status": "ACTIVE",
    "rideCount": 8,
    "description": "Annual coastal cycling tour",
    "provisionedAt": "2026-01-05T09:01:30Z",
    "createdAt": "2026-01-05T09:00:00Z",
    "updatedAt": "2026-02-09T18:00:00Z"
  },
  "provisionedTables": [
    "dev-Hotel-TOT-2026",
    "dev-RoomAllocation-TOT-2026"
  ]
}
```

##### Archive Tour

```http
POST /v1/tours/TOT-2026/archive?exportToS3=true&deleteTables=true
```

Response `200 OK`. Only non-empty tables are exported. `deletedTables` is a count:
```json
{
  "tour": {
    "tourId": "TOT-2026",
    "name": "Tour of Tamilnadu 2026",
    "startDate": "2026-02-10",
    "endDate": "2026-02-17",
    "status": "ARCHIVED",
    "rideCount": 8,
    "description": "Annual coastal cycling tour",
    "provisionedAt": "2026-01-05T09:01:30Z",
    "createdAt": "2026-01-05T09:00:00Z",
    "updatedAt": "2026-03-01T10:00:00Z",
    "archivedAt": "2026-03-01T10:00:00Z",
    "archiveExportKeys": {
      "TourRider": "archives/TOT-2026/TourRider.json",
      "Ride": "archives/TOT-2026/Ride.json",
      "CheckIn": "archives/TOT-2026/CheckIn.json"
    }
  },
  "exportedTables": ["TourRider", "Ride", "CheckIn"],
  "deletedTables": 11
}
```

#### Riders Examples

##### Create Rider Profile

```http
POST /v1/riders/profile
```
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "address": {
    "line1": "123 Main St",
    "line2": "Apartment 4B",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "postalCode": "600001"
  },
  "dietaryPreference": "VEG",
  "personalCode": "d157"
}
```

Response `201 Created` (`profileId` auto-generated, `personalCode` uppercased):
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "dietaryPreference": "VEG",
  "address": {
    "line1": "123 Main St",
    "line2": "Apartment 4B",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "postalCode": "600001"
  },
  "createdAt": "2026-01-10T08:15:00Z",
  "updatedAt": "2026-01-10T08:15:00Z",
  "personalCode": "D157"
}
```

##### Create Rider Profile With Path profileId

Uses the path `profileId` instead of generating one, for example the ID returned by [Create Cognito Link](#create-cognito-link).

```http
POST /v1/riders/profile/CUSTOM-PROFILE-001
```
```json
{
  "name": "John Doe",
  "email": "john.custom@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "address": {
    "line1": "123 Main St",
    "city": "Chennai",
    "country": "India",
    "postalCode": "600001"
  },
  "personalCode": "d220"
}
```

Response `201 Created`. `dietaryPreference` is returned as `null` when it isn't supplied:
```json
{
  "profileId": "CUSTOM-PROFILE-001",
  "name": "John Doe",
  "email": "john.custom@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "dietaryPreference": null,
  "address": {
    "line1": "123 Main St",
    "city": "Chennai",
    "country": "India",
    "postalCode": "600001"
  },
  "createdAt": "2026-02-10T10:30:00Z",
  "updatedAt": "2026-02-10T10:30:00Z",
  "personalCode": "D220"
}
```

Conflict response when `profileId` already exists (`409`, full envelope):
```json
{
  "success": false,
  "error": {
    "code": "PROFILE_ALREADY_EXISTS",
    "message": "Rider profile 'CUSTOM-PROFILE-001' already exists"
  },
  "timestamp": "2026-02-10T10:30:00Z"
}
```

##### Get Cognito Link

```http
GET /v1/riders/link/c1536d0a-e071-707f-571e-9526433c84ac
```

Response `200 OK`:
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f"
}
```

##### Create Cognito Link

```http
POST /v1/riders/link/c1536d0a-e071-707f-571e-9526433c84ac
```

Response `201 Created` (new `profileId` generated for the rider-app user):
```json
{
  "cognitoUserName": "c1536d0a-e071-707f-571e-9526433c84ac",
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f"
}
```

##### Delete Cognito Link

```http
DELETE /v1/riders/link/c1536d0a-e071-707f-571e-9526433c84ac
```

Response `200 OK`:
```json
{
  "cognitoUserName": "c1536d0a-e071-707f-571e-9526433c84ac",
  "deleted": true
}
```

##### Get Rider Profile

```http
GET /v1/riders/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f
```

Response `200 OK`:
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "dietaryPreference": "VEG",
  "address": {
    "line1": "123 Main St",
    "line2": "Apartment 4B",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "postalCode": "600001"
  },
  "personalCode": "D157",
  "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg",
  "createdAt": "2026-01-10T08:15:00Z",
  "updatedAt": "2026-01-12T19:05:00Z"
}
```

##### List Rider Tour Participations

```http
GET /v1/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/tours
```

Response `200 OK` (items are `RiderTours` records as stored; see [SolutionDesign.md](SolutionDesign.md)):
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
  "count": 1,
  "tours": [
    {
      "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
      "tourId": "TOT-2026",
      "appliedOn": "2025-12-01T10:00:00Z",
      "confirmedOn": "2025-12-20T10:00:00Z",
      "tourFeePaidOn": "2026-01-05T12:00:00Z",
      "registeredOn": "2026-01-15T10:00:00Z",
      "riderId": "R57",
      "status": "REGISTERED",
      "updatedAt": "2026-01-15T10:00:00Z"
    }
  ]
}
```

##### Get Rider Tour Participation

```http
GET /v1/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/tours/TOT-2026
```

Response `200 OK`: a single `RiderTours` record, the same object as the `tours[0]` item in [List Rider Tour Participations](#list-rider-tour-participations).

##### Update Rider Profile

Every request must include all mandatory profile fields. This example also saves the `photoS3Key` returned by [Get Profile Picture Upload URL](#get-profile-picture-upload-url).

```http
PUT /v1/riders/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f
```
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "+0987654321",
    "relation": "Spouse"
  },
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "address": {
    "line1": "123 Main St",
    "line2": "Apartment 4B",
    "city": "Chennai",
    "state": "Tamil Nadu",
    "country": "India",
    "postalCode": "600001"
  },
  "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg"
}
```

Response `200 OK`: the full updated profile, the same object as [Get Rider Profile](#get-rider-profile).

##### Get Profile Picture Upload URL

```http
POST /v1/riders/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/picture
```
```json
{
  "contentType": "image/jpeg"
}
```

Response `200 OK`:
```json
{
  "uploadUrl": "https://<photos-bucket>.s3.amazonaws.com/profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg",
  "contentType": "image/jpeg",
  "expiresIn": 300,
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f"
}
```

##### Get Profile Picture Download URL

```http
GET /v1/riders/profile/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/picture?expiresIn=600
```

Response `200 OK`:
```json
{
  "downloadUrl": "https://<photos-bucket>.s3.amazonaws.com/profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg",
  "expiresIn": 600,
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f"
}
```

##### List Tour Riders

```http
GET /v1/tours/TOT-2026/riders
```

Response `200 OK`. Each rider includes its full `profile` and a copy of `personalCode`:
```json
{
  "riders": [
    {
      "riderId": "R57",
      "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
      "status": "ACTIVE",
      "registeredAt": "2026-01-15T10:00:00Z",
      "createdAt": "2026-01-15T10:00:00Z",
      "updatedAt": "2026-01-20T09:00:00Z",
      "experienceLevel": "Intermediate",
      "specialRequirements": "Vegetarian meals",
      "profile": { ... },
      "personalCode": "D157"
    },
    {
      "riderId": "R12",
      "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
      "status": "ACTIVE",
      "registeredAt": "2026-01-16T11:30:00Z",
      "createdAt": "2026-01-16T11:30:00Z",
      "updatedAt": "2026-01-20T09:00:00Z",
      "profile": {
        "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
        "name": "Priya Raman",
        "email": "priya.raman@example.com",
        "phone": "+919840012345",
        "emergencyContact": {
          "name": "Karthik Raman",
          "phone": "+919840054321",
          "relation": "Brother"
        },
        "dateOfBirth": "1992-07-04",
        "gender": "Female",
        "dietaryPreference": "NON_VEG",
        "address": {
          "line1": "45 Race Course Road",
          "city": "Coimbatore",
          "country": "India",
          "postalCode": "641018"
        },
        "personalCode": "P012",
        "createdAt": "2026-01-11T09:00:00Z",
        "updatedAt": "2026-01-11T09:00:00Z"
      },
      "personalCode": "P012"
    }
  ],
  "count": 2,
  "tourId": "TOT-2026"
}
```
`R57.profile` is the object shown in [Get Rider Profile](#get-rider-profile).

##### List Tour Rider Names

```http
GET /v1/tours/TOT-2026/riders/names
```

Response `200 OK` (sorted by numeric rider ID):
```json
{
  "riders": [
    { "riderId": "R12", "name": "Priya Raman", "personalCode": "P012" },
    { "riderId": "R57", "name": "John Doe", "personalCode": "D157" }
  ],
  "count": 2,
  "tourId": "TOT-2026"
}
```

##### Register Tour Rider

```http
POST /v1/tours/TOT-2026/riders
```
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
  "riderId": "R57",
  "experienceLevel": "Intermediate",
  "specialRequirements": "Vegetarian meals"
}
```

Response `201 Created`. If `riderId` is left out, a temporary ID `PENDING-3f6c2a8e` (the first 8 characters of `profileId`) is assigned:
```json
{
  "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
  "status": "PENDING",
  "registeredAt": "2026-01-15T10:00:00Z",
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-15T10:00:00Z",
  "riderId": "R57",
  "experienceLevel": "Intermediate",
  "specialRequirements": "Vegetarian meals"
}
```

##### Get Tour Rider

```http
GET /v1/tours/TOT-2026/riders/R57
```

Response `200 OK`: the `R57` item from [List Tour Riders](#list-tour-riders), including `profile` and `personalCode`.

##### Exit Rider

```http
POST /v1/tours/TOT-2026/riders/R12/exit
```
```json
{
  "baggageDisposition": "RETAINED",
  "note": "Bag kept in support vehicle"
}
```

Response `200 OK`. With `WITH_RIDER`, the response has `baggageReleasedAt`/`baggageReleasedBy` instead of `baggageExitedAt`/`baggageExitedBy`:
```json
{
  "riderId": "R12",
  "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
  "status": "EXITED",
  "registeredAt": "2026-01-16T11:30:00Z",
  "createdAt": "2026-01-16T11:30:00Z",
  "updatedAt": "2026-02-13T15:00:00Z",
  "prevStatus": "ACTIVE",
  "exitedAt": "2026-02-13T15:00:00Z",
  "exitedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "baggageStatus": "RETAINED",
  "baggageExitNote": "Bag kept in support vehicle",
  "baggageExitedAt": "2026-02-13T15:00:00Z",
  "baggageExitedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Cancel Rider Exit

```http
POST /v1/tours/TOT-2026/riders/R12/exit/cancel
```

Response `200 OK`. `status` is restored from `prevStatus`, `baggageStatus` is reset to `ACTIVE`, and the exit and baggage audit fields are removed:
```json
{
  "riderId": "R12",
  "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
  "status": "ACTIVE",
  "registeredAt": "2026-01-16T11:30:00Z",
  "createdAt": "2026-01-16T11:30:00Z",
  "updatedAt": "2026-02-14T09:00:00Z",
  "baggageStatus": "ACTIVE"
}
```

##### Release Rider Baggage

Valid only while `baggageStatus` is `RETAINED`, i.e. after [Exit Rider](#exit-rider) and before the exit is cancelled.

```http
POST /v1/tours/TOT-2026/riders/R12/baggage/release
```
```json
{
  "note": "Handed over at Madurai hotel"
}
```

Response `200 OK`:
```json
{
  "riderId": "R12",
  "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
  "status": "EXITED",
  "registeredAt": "2026-01-16T11:30:00Z",
  "createdAt": "2026-01-16T11:30:00Z",
  "updatedAt": "2026-02-14T08:00:00Z",
  "prevStatus": "ACTIVE",
  "exitedAt": "2026-02-13T15:00:00Z",
  "exitedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "baggageStatus": "WITH_RIDER",
  "baggageExitNote": "Handed over at Madurai hotel",
  "baggageExitedAt": "2026-02-13T15:00:00Z",
  "baggageExitedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "baggageReleasedAt": "2026-02-14T08:00:00Z",
  "baggageReleasedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Get Rider Statistics

```http
GET /v1/tours/TOT-2026/riders/R57/statistics
```

Response `200 OK`:
```json
{
  "riderId": "R57",
  "tourId": "TOT-2026",
  "totalRides": 8,
  "ridesCompleted": 1,
  "ridesNotCompleted": 0,
  "currentStreak": 1,
  "totalDistance": 65.5,
  "totalCheckins": 1,
  "quitRiding": false
}
```

#### Artifacts Examples

##### Presign Tour Artifact Upload

```http
POST /v1/artifacts/tour/presign-upload
```
```json
{
  "tourId": "TOT-2026",
  "artifactId": "ride-plan",
  "contentType": "application/pdf"
}
```

Response `200 OK`. `title` comes from the `ARTIFACTS` config `description`, and `version` increases on every re-upload:
```json
{
  "artifactFor": "TOT-2026",
  "artifactId": "ride-plan",
  "s3Key": "tours/TOT-2026/ride-plan.pdf",
  "contentType": "application/pdf",
  "uploadUrl": "https://<artifacts-bucket>.s3.amazonaws.com/tours/TOT-2026/ride-plan.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "expiresIn": 300,
  "version": 1,
  "title": "Tour of Tamil Nadu - Ride Plan"
}
```

##### Presign Ride Artifact Upload

```http
POST /v1/artifacts/ride/presign-upload
```
```json
{
  "tourId": "TOT-2026",
  "rideId": "RIDE001",
  "artifactId": "gpx-file",
  "contentType": "application/gpx+xml"
}
```

Response `200 OK`:
```json
{
  "artifactFor": "TOT-2026#RIDE001",
  "artifactId": "gpx-file",
  "s3Key": "tours/TOT-2026/rides/RIDE001/gpx-file.gpx",
  "contentType": "application/gpx+xml",
  "uploadUrl": "https://<artifacts-bucket>.s3.amazonaws.com/tours/TOT-2026/rides/RIDE001/gpx-file.gpx?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "expiresIn": 300,
  "version": 1,
  "title": "Ride route GPX File"
}
```

##### Delete Tour Artifact

```http
DELETE /v1/artifacts/tour/TOT-2026/ride-plan
```

Response `200 OK`:
```json
{
  "artifactFor": "TOT-2026",
  "artifactId": "ride-plan",
  "deleted": true,
  "s3Key": "tours/TOT-2026/ride-plan.pdf"
}
```

##### Delete Ride Artifact

```http
DELETE /v1/artifacts/ride/TOT-2026/RIDE001/gpx-file
```

Response `200 OK`:
```json
{
  "artifactFor": "TOT-2026#RIDE001",
  "artifactId": "gpx-file",
  "deleted": true,
  "s3Key": "tours/TOT-2026/rides/RIDE001/gpx-file.gpx"
}
```

##### Get Tour Artifacts

```http
GET /v1/tours/TOT-2026/artifacts?expiresIn=900
```

Response `200 OK`. `data` is an array, or `[]` when there are no artifacts:
```json
[
  {
    "artifactId": "ride-plan",
    "s3Key": "tours/TOT-2026/ride-plan.pdf",
    "contentType": "application/pdf",
    "version": 1,
    "title": "Tour of Tamil Nadu - Ride Plan",
    "downloadUrl": "https://<artifacts-bucket>.s3.amazonaws.com/tours/TOT-2026/ride-plan.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "expiresIn": 900,
    "createdAt": "2026-01-25T10:00:00Z",
    "updatedAt": "2026-01-25T10:00:00Z"
  }
]
```

##### Get Ride Artifacts

```http
GET /v1/tours/TOT-2026/rides/RIDE001/artifacts?artifactId=gpx-file
```

Response `200 OK`:
```json
[
  {
    "artifactId": "gpx-file",
    "s3Key": "tours/TOT-2026/rides/RIDE001/gpx-file.gpx",
    "contentType": "application/gpx+xml",
    "version": 1,
    "title": "Ride route GPX File",
    "downloadUrl": "https://<artifacts-bucket>.s3.amazonaws.com/tours/TOT-2026/rides/RIDE001/gpx-file.gpx?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "expiresIn": 900,
    "createdAt": "2026-01-26T10:00:00Z",
    "updatedAt": "2026-01-26T10:00:00Z"
  }
]
```

#### Rides Examples

##### Get Today's Ride

```http
GET /v1/tours/TOT-2026/rides/today
```

Response `200 OK`: the ride scheduled for the current UTC date, in the same shape as [Get Ride](#get-ride). Returns `404 NO_ACTIVE_RIDE` when no ride is scheduled today.

##### List Rides

```http
GET /v1/tours/TOT-2026/rides?status=STARTED
```

Response `200 OK`:
```json
{
  "rides": [ { ... } ],
  "count": 1,
  "tourId": "TOT-2026"
}
```
Each item in `rides` is a ride object as shown in [Get Ride](#get-ride).

##### Get Ride

```http
GET /v1/tours/TOT-2026/rides/RIDE001
```

Response `200 OK` (ride in progress with PS1 open):
```json
{
  "rideId": "RIDE001",
  "date": "2026-02-11",
  "rideNo": 1,
  "name": "Geneva to Lausanne",
  "startLocation": "Geneva Central",
  "finishLocation": "Lausanne",
  "totalDistance": 65.5,
  "flagOffTime": "08:00",
  "stages": [
    { "stageId": "S000", "stageNumber": 0, "type": "START", "name": "Start" },
    {
      "stageId": "S001",
      "stageNumber": 1,
      "type": "PIT_STOP",
      "name": "PS1",
      "estimatedOpenTime": 90,
      "pitStopDuration": 45,
      "pitStopStatus": "OPEN",
      "openedAt": "2026-02-11T09:25:00Z"
    },
    { "stageId": "S002", "stageNumber": 2, "type": "FINISH", "name": "Finish" }
  ],
  "floats": [
    { "floatNo": 1, "floatToStage": 1 }
  ],
  "status": "STARTED",
  "openTime": "07:30",
  "closeTime": "13:30",
  "description": "Coastal stage with one pit stop",
  "createdAt": "2026-01-20T12:00:00Z",
  "updatedAt": "2026-02-11T09:25:00Z",
  "openedAt": "2026-02-11T07:30:05Z",
  "startedAt": "2026-02-11T08:00:10Z"
}
```

##### Create Ride

```http
POST /v1/tours/TOT-2026/rides
```
```json
{
  "rideId": "RIDE001",
  "date": "2026-02-11",
  "rideNo": 1,
  "name": "Geneva to Lausanne",
  "startLocation": "Geneva Central",
  "finishLocation": "Lausanne",
  "totalDistance": 65.5,
  "openTime": "07:30",
  "flagOffTime": "08:00",
  "closeTime": "13:30",
  "floats": [
    {
      "floatNo": 1,
      "floatToStage": 1
    }
  ],
  "stages": [
    {
      "stageId": "S000",
      "stageNumber": 0,
      "type": "START",
      "name": "Start"
    },
    {
      "stageId": "S001",
      "stageNumber": 1,
      "type": "PIT_STOP",
      "name": "PS1",
      "estimatedOpenTime": 90,
      "pitStopDuration": 45
    },
    {
      "stageId": "S002",
      "stageNumber": 2,
      "type": "FINISH",
      "name": "Finish"
    }
  ]
}
```

Response `201 Created` (new rides start as `PLANNED`):
```json
{
  "rideId": "RIDE001",
  "date": "2026-02-11",
  "rideNo": 1,
  "name": "Geneva to Lausanne",
  "startLocation": "Geneva Central",
  "finishLocation": "Lausanne",
  "totalDistance": 65.5,
  "flagOffTime": "08:00",
  "stages": [
    { "stageId": "S000", "stageNumber": 0, "type": "START", "name": "Start" },
    { "stageId": "S001", "stageNumber": 1, "type": "PIT_STOP", "name": "PS1", "estimatedOpenTime": 90, "pitStopDuration": 45 },
    { "stageId": "S002", "stageNumber": 2, "type": "FINISH", "name": "Finish" }
  ],
  "floats": [
    { "floatNo": 1, "floatToStage": 1 }
  ],
  "status": "PLANNED",
  "openTime": "07:30",
  "closeTime": "13:30",
  "createdAt": "2026-01-20T12:00:00Z",
  "updatedAt": "2026-01-20T12:00:00Z"
}
```

##### Update Ride

```http
PUT /v1/tours/TOT-2026/rides/RIDE001
```
```json
{
  "description": "Coastal stage with one pit stop"
}
```

Response `200 OK`: the full updated ride. This is the [Create Ride](#create-ride) response plus `"description": "Coastal stage with one pit stop"` and a new `updatedAt`. When `stages` are sent, live pit-stop fields (`pitStopStatus`, `openedAt`, `closedAt`) are kept.

##### Open Pit Stop

Called by a `PS_1_USER` (or `SUPER_USER`/`ADMINISTRATOR`) while the ride is `STARTED`.

```http
POST /v1/tours/TOT-2026/rides/RIDE001/stages/1/pitstop/open
```

Response `200 OK`: the full ride object ([Get Ride](#get-ride)). This call changes:
```json
{
  "stages": [
    { "stageId": "S000", "stageNumber": 0, "type": "START", "name": "Start" },
    { "stageId": "S001", "stageNumber": 1, "type": "PIT_STOP", "name": "PS1", "estimatedOpenTime": 90, "pitStopDuration": 45, "pitStopStatus": "OPEN", "openedAt": "2026-02-11T09:25:00Z" },
    { "stageId": "S002", "stageNumber": 2, "type": "FINISH", "name": "Finish" }
  ],
  "updatedAt": "2026-02-11T09:25:00Z"
}
```

##### Close Pit Stop

```http
POST /v1/tours/TOT-2026/rides/RIDE001/stages/1/pitstop/close
```

Response `200 OK`: the full ride object. This call changes:
```json
{
  "stages": [
    { "stageId": "S000", "stageNumber": 0, "type": "START", "name": "Start" },
    { "stageId": "S001", "stageNumber": 1, "type": "PIT_STOP", "name": "PS1", "estimatedOpenTime": 90, "pitStopDuration": 45, "pitStopStatus": "CLOSED", "openedAt": "2026-02-11T09:25:00Z", "closedAt": "2026-02-11T11:40:00Z" },
    { "stageId": "S002", "stageNumber": 2, "type": "FINISH", "name": "Finish" }
  ],
  "updatedAt": "2026-02-11T11:40:00Z"
}
```

##### Open Today's Ride

```http
POST /v1/tours/TOT-2026/rides/open
```

Response `200 OK`: the full ride object for the current UTC date. This call changes:
```json
{
  "status": "OPEN",
  "openedAt": "2026-02-11T07:30:05Z",
  "updatedAt": "2026-02-11T07:30:05Z"
}
```

##### Start Today's Ride

```http
POST /v1/tours/TOT-2026/rides/start
```

Response `200 OK`: the full ride object for the current UTC date. This call changes:
```json
{
  "status": "STARTED",
  "startedAt": "2026-02-11T08:00:10Z",
  "updatedAt": "2026-02-11T08:00:10Z"
}
```

##### Close Ride

```http
POST /v1/tours/TOT-2026/rides/RIDE001/close
```

Response `200 OK`: the full ride object. This call changes:
```json
{
  "status": "CLOSED",
  "closedAt": "2026-02-11T14:05:00Z",
  "updatedAt": "2026-02-11T14:05:00Z"
}
```

#### Check-Ins Examples

##### Create Check-In

Float check-in for `R57`. Other check-in types use the same request: a normal check-in sets `isFloat=false` and drops `floatNo`; Not Riding and Quit Riding set their flag and may leave out `stageNumber`.

```http
POST /v1/tours/TOT-2026/checkins
```
```json
{
  "riderId": "R57",
  "rideId": "RIDE001",
  "stageNumber": 0,
  "method": "QR_SCAN",
  "isNotRiding": false,
  "isFloat": true,
  "floatNo": 1,
  "isQuitRiding": false,
  "timestamp": "2026-02-11T10:30:00Z",
  "notes": "Boarded float 1"
}
```

Response `201 Created`. `checkInId` is `<riderId>#<stageNumber:3 digits>#<timestamp>`, and `status` is derived from the flags (`CHECKED_IN`, `FLOAT`, `NOT_RIDING`, `QUIT_RIDING`):
```json
{
  "checkInId": "R57#000#2026-02-11T10:30:00Z",
  "riderId": "R57",
  "rideId": "RIDE001",
  "timestamp": "2026-02-11T10:30:00Z",
  "checkedInBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "method": "QR_SCAN",
  "isNotRiding": false,
  "isFloat": true,
  "floatNo": 1,
  "isQuitRiding": false,
  "isManualEntry": false,
  "createdAt": "2026-02-11T10:30:02Z",
  "status": "FLOAT",
  "stageNumber": 0,
  "stageId": "S000",
  "notes": "Boarded float 1"
}
```

##### List Ride Check-Ins

```http
GET /v1/tours/TOT-2026/rides/RIDE001/checkins
```

Response `200 OK` (cancelled check-ins excluded):
```json
{
  "checkIns": [
    {
      "checkInId": "R12#000#2026-02-11T07:52:00Z",
      "riderId": "R12",
      "rideId": "RIDE001",
      "timestamp": "2026-02-11T07:52:00Z",
      "checkedInBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "method": "QR_SCAN",
      "isNotRiding": false,
      "isFloat": false,
      "isQuitRiding": false,
      "isManualEntry": false,
      "createdAt": "2026-02-11T07:52:01Z",
      "status": "CHECKED_IN",
      "stageNumber": 0,
      "stageId": "S000"
    },
    {
      "checkInId": "R57#000#2026-02-11T10:30:00Z",
      "riderId": "R57",
      "rideId": "RIDE001",
      "timestamp": "2026-02-11T10:30:00Z",
      "checkedInBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "method": "QR_SCAN",
      "isNotRiding": false,
      "isFloat": true,
      "floatNo": 1,
      "isQuitRiding": false,
      "isManualEntry": false,
      "createdAt": "2026-02-11T10:30:02Z",
      "status": "FLOAT",
      "stageNumber": 0,
      "stageId": "S000",
      "notes": "Boarded float 1"
    }
  ],
  "count": 2,
  "rideId": "RIDE001",
  "tourId": "TOT-2026"
}
```

##### List Rider Check-Ins

```http
GET /v1/tours/TOT-2026/riders/R57/checkins
```

Response `200 OK` (all rides, cancelled excluded):
```json
{
  "tourId": "TOT-2026",
  "riderId": "R57",
  "checkIns": [
    {
      "checkInId": "R57#000#2026-02-11T10:30:00Z",
      "riderId": "R57",
      "rideId": "RIDE001",
      "timestamp": "2026-02-11T10:30:00Z",
      "checkedInBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "method": "QR_SCAN",
      "isNotRiding": false,
      "isFloat": true,
      "floatNo": 1,
      "isQuitRiding": false,
      "isManualEntry": false,
      "createdAt": "2026-02-11T10:30:02Z",
      "status": "FLOAT",
      "stageNumber": 0,
      "stageId": "S000",
      "notes": "Boarded float 1"
    }
  ],
  "count": 1
}
```

##### List Rider Check-Ins for Ride Number

```http
GET /v1/tours/TOT-2026/riders/R57/rides/1/checkins
```

Response `200 OK`: same as [List Rider Check-Ins](#list-rider-check-ins), limited to ride number `1`, with an extra `"rideNo": 1` field next to `riderId`.

##### Cancel Check-In

Cancels `R12`'s stage 1 check-in `R12#001#2026-02-11T09:48:00Z` (`#` URL-encoded in the path).

```http
POST /v1/tours/TOT-2026/rides/RIDE001/checkins/R12%23001%232026-02-11T09:48:00Z/cancel
```
```json
{
  "status": "CANCELLED",
  "prevStatus": "CHECKED_IN"
}
```

Response `200 OK`:
```json
{
  "rideId": "RIDE001",
  "checkInId": "R12#001#2026-02-11T09:48:00Z",
  "riderId": "R12",
  "timestamp": "2026-02-11T09:48:00Z",
  "checkedInBy": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "method": "QR_SCAN",
  "isNotRiding": false,
  "isFloat": false,
  "isQuitRiding": false,
  "isManualEntry": false,
  "createdAt": "2026-02-11T09:48:01Z",
  "status": "CANCELLED",
  "stageNumber": 1,
  "stageId": "S001",
  "prevStatus": "CHECKED_IN",
  "cancelledBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "cancelledAt": "2026-02-11T09:55:00Z"
}
```

##### Get Ride Dashboard

```http
GET /v1/tours/TOT-2026/rides/RIDE001/dashboard
If-None-Match: "c0ffee0000000000000000000000beef"
```

Response `200 OK` (with `ETag` header). `ride` is the object from [Get Ride](#get-ride), and `checkIns` are the active check-ins from [List Ride Check-Ins](#list-ride-check-ins):
```json
{
  "ride": { ... },
  "riders": [
    {
      "riderId": "R12",
      "profileId": "8a1d4f2b-6c3e-4f5a-9b7c-0d1e2f3a4b5c",
      "status": "ACTIVE",
      "name": "Priya Raman",
      "email": "priya.raman@example.com",
      "phone": "+919840012345",
      "emergencyContact": { "name": "Karthik Raman", "phone": "+919840054321", "relation": "Brother" },
      "photoS3Key": null
    },
    {
      "riderId": "R57",
      "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
      "status": "ACTIVE",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "emergencyContact": { "name": "Jane Doe", "phone": "+0987654321", "relation": "Spouse" },
      "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg"
    }
  ],
  "checkIns": [ { ... }, { ... } ],
  "summary": {
    "totalRiders": 2,
    "checkedIn": 2,
    "notRiding": 0,
    "quitRiding": 0,
    "notCheckedIn": 0
  }
}
```

##### Get Ride Dashboard Progress

```http
GET /v1/tours/TOT-2026/rides/RIDE001/dashboard/progress
```

Response `200 OK` (with `ETag` header). `checkIns` has the same items as [List Ride Check-Ins](#list-ride-check-ins). `cancelled` holds cancelled check-ins as in [Cancel Check-In](#cancel-check-in). `dataVersion` is the latest timestamp across the ride, riders, and check-ins:
```json
{
  "rideId": "RIDE001",
  "checkIns": [ { ... }, { ... } ],
  "cancelled": [ { ... } ],
  "summary": {
    "totalRiders": 2,
    "checkedIn": 2,
    "notRiding": 0,
    "quitRiding": 0,
    "notCheckedIn": 0
  },
  "dataVersion": "2026-02-11T10:30:02Z"
}
```

##### Get Rider Ride Details

```http
GET /v1/tours/TOT-2026/rides/RIDE001/riders/R57/details
```

Response `200 OK` (with `ETag` header). `latestStatus` is one of `NOT_CHECKED_IN`, `CHECKED_IN`, `FLOAT`, `NOT_RIDING`, `QUIT_RIDING`:
```json
{
  "rider": {
    "riderId": "R57",
    "profileId": "3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f",
    "name": "John Doe",
    "phone": "+1234567890",
    "personalCode": "D157",
    "photoS3Key": "profiles/3f6c2a8e-5b1d-4c7a-9e2f-1a2b3c4d5e6f/0b7d4e2a-9c1f-4a8e-b6d3-5f2e1a7c9d40.jpg"
  },
  "checkInTimeline": [
    {
      "checkInId": "R57#000#2026-02-11T10:30:00Z",
      "stageNumber": 0,
      "stageId": "S000",
      "isNotRiding": false,
      "isFloat": true,
      "floatNo": 1,
      "isQuitRiding": false,
      "timestamp": "2026-02-11T10:30:00Z"
    }
  ],
  "latestStatus": "FLOAT"
}
```

#### Events Examples

##### List Events

```http
GET /v1/tours/TOT-2026/events
```

Response `200 OK` (sorted by `eventId`):
```json
{
  "items": [ { ... } ]
}
```
Each item is an event definition as shown in [Get Event](#get-event).

##### Get Event

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD
```

Response `200 OK`:
```json
{
  "eventId": "EVT-BAGLOAD",
  "eventName": "Baggage Loading",
  "eventType": "REPEATING",
  "location": "Hotel lobby",
  "sequenceEnforced": true,
  "defaultAllowedTypeCodes": ["3", "4", "5"],
  "allowSelfService": false,
  "activities": [
    {
      "activityId": "ACT-001",
      "name": "Collected from room",
      "sequenceNo": 1,
      "enabled": true,
      "mandatory": false,
      "allowedTypeCodes": [],
      "allowOptOut": true,
      "prerequisiteActivityIds": [],
      "restrictToAssignedUsers": true,
      "variantOptions": [],
      "notes": "Riders may bring bags to the lobby"
    },
    {
      "activityId": "ACT-002",
      "name": "Tagged at lobby",
      "sequenceNo": 2,
      "enabled": true,
      "mandatory": false,
      "allowedTypeCodes": [],
      "allowOptOut": false,
      "prerequisiteActivityIds": [],
      "restrictToAssignedUsers": true,
      "variantOptions": [],
      "notes": ""
    },
    {
      "activityId": "ACT-003",
      "name": "Loaded to truck",
      "sequenceNo": 3,
      "enabled": true,
      "mandatory": true,
      "allowedTypeCodes": [],
      "allowOptOut": false,
      "prerequisiteActivityIds": [],
      "restrictToAssignedUsers": true,
      "variantOptions": [],
      "notes": ""
    }
  ],
  "createdAt": "2026-01-25T09:00:00Z",
  "updatedAt": "2026-01-28T11:00:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Create Event

Omitted activity fields get defaults (`enabled=true`, `mandatory=false`, `allowOptOut=false`, `restrictToAssignedUsers=true`, empty lists, `notes=""`). An empty `allowedTypeCodes` means the activity uses `defaultAllowedTypeCodes`.

```http
POST /v1/tours/TOT-2026/events
```
```json
{
  "eventId": "EVT-BAGLOAD",
  "eventName": "Baggage Loading",
  "eventType": "REPEATING",
  "location": "Origin hotel",
  "sequenceEnforced": true,
  "defaultAllowedTypeCodes": ["3", "4", "5"],
  "activities": [
    { "activityId": "ACT-001", "name": "Collected from room", "sequenceNo": 1, "allowOptOut": true, "notes": "Riders may bring bags to the lobby" },
    { "activityId": "ACT-002", "name": "Tagged at lobby", "sequenceNo": 2 },
    { "activityId": "ACT-003", "name": "Loaded to truck", "sequenceNo": 3, "mandatory": true }
  ]
}
```

Response `201 Created`: the stored event definition. It has the same shape as [Get Event](#get-event), with `"location": "Origin hotel"` and `createdAt` = `updatedAt` = `2026-01-25T09:00:00Z`.

##### Update Event

```http
PUT /v1/tours/TOT-2026/events/EVT-BAGLOAD
```
```json
{
  "location": "Hotel lobby"
}
```

Response `200 OK`: the full updated event, as shown in [Get Event](#get-event). Sending `activities` replaces the whole activity list and goes through the same validation as create.

##### List Occurrences

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences?date=2026-02-12&status=ACTIVE
```

Response `200 OK` (sorted by `dateSeq`):
```json
{
  "items": [ { ... } ]
}
```
Each item is an occurrence as shown in [Get Occurrence](#get-occurrence).

##### Get Occurrence

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231
```

Response `200 OK`:
```json
{
  "eventId": "EVT-BAGLOAD",
  "dateSeq": "2026-02-12#1",
  "occurrenceId": "EVT-BAGLOAD#2026-02-12#1",
  "date": "2026-02-12",
  "seq": 1,
  "status": "ACTIVE",
  "activityOverrides": [
    {
      "activityId": "ACT-002",
      "allowedTypeCodes": ["3", "4", "5", "6"],
      "note": "Heavy bags allowed today",
      "updatedAt": "2026-02-12T05:20:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ],
  "selfServiceEnabled": false,
  "linkedOccurrenceRef": "EVT-BAGUNLOAD#2026-02-12#1",
  "restrictToAssignedUsers": true,
  "startedAt": "2026-02-12T05:30:00Z",
  "createdAt": "2026-02-11T18:00:00Z",
  "updatedAt": "2026-02-12T05:30:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Create Occurrence

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences
```
```json
{
  "date": "2026-02-12",
  "seq": 1
}
```

Response `201 Created`. `selfServiceEnabled` defaults to the event's `allowSelfService`:
```json
{
  "eventId": "EVT-BAGLOAD",
  "dateSeq": "2026-02-12#1",
  "occurrenceId": "EVT-BAGLOAD#2026-02-12#1",
  "date": "2026-02-12",
  "seq": 1,
  "status": "PLANNED",
  "activityOverrides": [],
  "selfServiceEnabled": false,
  "restrictToAssignedUsers": true,
  "createdAt": "2026-02-11T18:00:00Z",
  "updatedAt": "2026-02-11T18:00:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Update Occurrence

```http
PUT /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231
```
```json
{
  "linkedOccurrenceRef": "EVT-BAGUNLOAD#2026-02-12#1"
}
```

Response `200 OK`: the [Create Occurrence](#create-occurrence) response plus `"linkedOccurrenceRef": "EVT-BAGUNLOAD#2026-02-12#1"`, with `updatedAt` set to `2026-02-11T18:05:00Z`.

##### Get Activity Overrides

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/activity-overrides
```

Response `200 OK`:
```json
{
  "items": [
    {
      "activityId": "ACT-002",
      "allowedTypeCodes": ["3", "4", "5", "6"],
      "note": "Heavy bags allowed today",
      "updatedAt": "2026-02-12T05:20:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ]
}
```

##### Update Activity Override

Upserts the override for one activity. If `enabled`, `selfServiceEnabled`, and `allowedTypeCodes` all end up `null`, the override is removed.

```http
PUT /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/activity-overrides
```
```json
{
  "activityId": "ACT-002",
  "allowedTypeCodes": ["3", "4", "5", "6"],
  "note": "Heavy bags allowed today"
}
```

Response `200 OK`: the full override list for the occurrence, the same as [Get Activity Overrides](#get-activity-overrides).

##### Start Occurrence

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/start
```

Response `200 OK`: the full occurrence, as shown in [Get Occurrence](#get-occurrence), with `"status": "ACTIVE"` and `startedAt` = `updatedAt` = `2026-02-12T05:30:00Z`.

##### Complete Occurrence

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/complete
```

Response `200 OK`: the full occurrence plus `outstandingMandatoryCount`. Outstanding items don't block completion:
```json
{
  "eventId": "EVT-BAGLOAD",
  "dateSeq": "2026-02-12#1",
  "occurrenceId": "EVT-BAGLOAD#2026-02-12#1",
  "date": "2026-02-12",
  "seq": 1,
  "status": "COMPLETED",
  "activityOverrides": [
    {
      "activityId": "ACT-002",
      "allowedTypeCodes": ["3", "4", "5", "6"],
      "note": "Heavy bags allowed today",
      "updatedAt": "2026-02-12T05:20:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ],
  "selfServiceEnabled": false,
  "linkedOccurrenceRef": "EVT-BAGUNLOAD#2026-02-12#1",
  "restrictToAssignedUsers": true,
  "startedAt": "2026-02-12T05:30:00Z",
  "completedAt": "2026-02-12T09:45:00Z",
  "createdAt": "2026-02-11T18:00:00Z",
  "updatedAt": "2026-02-12T09:45:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "outstandingMandatoryCount": 1
}
```

##### Cancel Occurrence

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-13%231/cancel
```
```json
{
  "cancelReason": "Rest day, no baggage move"
}
```

Response `200 OK`:
```json
{
  "eventId": "EVT-BAGLOAD",
  "dateSeq": "2026-02-13#1",
  "occurrenceId": "EVT-BAGLOAD#2026-02-13#1",
  "date": "2026-02-13",
  "seq": 1,
  "status": "CANCELLED",
  "activityOverrides": [],
  "selfServiceEnabled": false,
  "restrictToAssignedUsers": true,
  "cancelledAt": "2026-02-12T20:00:00Z",
  "cancelledBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "cancelReason": "Rest day, no baggage move",
  "createdAt": "2026-02-11T18:10:00Z",
  "updatedAt": "2026-02-12T20:00:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Create Activity Record

Scanned by hotel staff Ravi Shankar, who is assigned to `EVT-BAGLOAD` and `ACT-003` at `HTL-MDU-01`.

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/records
```
```json
{
  "activityId": "ACT-003",
  "riderId": "R57",
  "typeCode": "3",
  "method": "QR_SCAN",
  "timestamp": "2026-02-12T05:42:10Z"
}
```

Response `201 Created`. `outcome` defaults to `COMPLETED`. `bagLabel` is resolved from the `ID_CODE_TYPE` config, and `hotelId` comes from the scanner's tour-user record:
```json
{
  "occurrenceId": "EVT-BAGLOAD#2026-02-12#1",
  "recordId": "R57#ACT-003#2026-02-12T05:42:10Z",
  "eventId": "EVT-BAGLOAD",
  "activityId": "ACT-003",
  "activityName": "Loaded to truck",
  "riderId": "R57",
  "scannedBy": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
  "timestamp": "2026-02-12T05:42:10Z",
  "method": "QR_SCAN",
  "outcome": "COMPLETED",
  "typeCode": "3",
  "bagLabel": "Baggage 1",
  "hotelId": "HTL-MDU-01",
  "syncedAt": "2026-02-12T05:42:15Z",
  "isFlagged": false,
  "createdAt": "2026-02-12T05:42:15Z"
}
```

An opt-out (only on activities with `allowOptOut=true`) sends `"outcome": "OPTED_OUT"` and can leave out `typeCode`, e.g. `R12` on `ACT-001`.

##### Cancel Activity Record

```http
POST /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/records/R12%23ACT-002%232026-02-12T05:50:30Z/cancel
```
```json
{
  "cancelReason": "Scanned wrong rider"
}
```

Response `200 OK`. The record is kept and marked cancelled:
```json
{
  "occurrenceId": "EVT-BAGLOAD#2026-02-12#1",
  "recordId": "R12#ACT-002#2026-02-12T05:50:30Z",
  "eventId": "EVT-BAGLOAD",
  "activityId": "ACT-002",
  "activityName": "Tagged at lobby",
  "riderId": "R12",
  "scannedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "timestamp": "2026-02-12T05:50:30Z",
  "method": "QR_SCAN",
  "outcome": "COMPLETED",
  "typeCode": "4",
  "bagLabel": "Baggage 2",
  "syncedAt": "2026-02-12T05:50:31Z",
  "isFlagged": false,
  "createdAt": "2026-02-12T05:50:31Z",
  "cancelledAt": "2026-02-12T05:52:00Z",
  "cancelledBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "cancelReason": "Scanned wrong rider"
}
```

##### Get Event Dashboard

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/dashboard
```

Response `200 OK`. `occurrence` is the object from [Get Occurrence](#get-occurrence). Activity `status` is `PENDING` (no active record) or the record `outcome` (`COMPLETED`, `OPTED_OUT`, `FLAGGED`). `cancelled` holds the full cancelled records, as in [Cancel Activity Record](#cancel-activity-record):
```json
{
  "occurrence": { ... },
  "riders": [
    {
      "riderId": "R12",
      "activities": [
        { "activityId": "ACT-001", "status": "OPTED_OUT" },
        { "activityId": "ACT-002", "status": "PENDING" },
        { "activityId": "ACT-003", "status": "PENDING" }
      ]
    },
    {
      "riderId": "R57",
      "activities": [
        { "activityId": "ACT-001", "status": "COMPLETED" },
        { "activityId": "ACT-002", "status": "COMPLETED" },
        { "activityId": "ACT-003", "status": "COMPLETED" }
      ]
    }
  ],
  "cancelled": [ { ... } ]
}
```

##### Get Event Dashboard Progress

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/dashboard/progress
```

Response `200 OK`. `outstandingMandatoryCount` counts rider × mandatory-activity pairs that have no active record:
```json
{
  "totalRiders": 2,
  "completedCount": 3,
  "outstandingMandatoryCount": 1,
  "optedOutCount": 1,
  "flaggedCount": 0
}
```

##### Get Event Reconciliation

```http
GET /v1/tours/TOT-2026/events/EVT-BAGLOAD/occurrences/EVT-BAGLOAD%232026-02-12%231/reconciliation
```

Response `200 OK`. Counts are distinct `(riderId, typeCode)` bags scanned at the **last enabled activity** (highest `sequenceNo`, after occurrence overrides) of this occurrence and of its `linkedOccurrenceRef`. Cancelled records, `OPTED_OUT` records, and records without a `typeCode` are ignored. Here only `R57`'s bag reached "Loaded to truck" (`ACT-003`) and it was unloaded, so nothing is missing (`R12` opted out of `ACT-001` and never reached `ACT-003`). Returns `400 NO_LINKED_OCCURRENCE` when there is no link:
```json
{
  "loadedCount": 1,
  "unloadedCount": 1,
  "missingRiderIds": []
}
```

##### Get Event Bootstrap

```http
GET /v1/tours/TOT-2026/events/bootstrap
```

Response `200 OK` (with `ETag` header), fetched on `2026-02-12`. `events` holds definitions as in [Get Event](#get-event). `activeOccurrences` holds `PLANNED`/`ACTIVE` occurrences dated today or later, as in [Get Occurrence](#get-occurrence). `hotelStaysToday` holds today's allocations, as in [List Hotel Stays by Date](#list-hotel-stays-by-date):
```json
{
  "events": [ { ... } ],
  "activeOccurrences": [ { ... } ],
  "riderBaggageStatus": [
    { "riderId": "R12", "baggageStatus": "ACTIVE", "baggageReleasedAt": null },
    { "riderId": "R57", "baggageStatus": "ACTIVE", "baggageReleasedAt": null }
  ],
  "hotelStaysToday": [ { ... }, { ... } ]
}
```

##### Get Rider Event Progress

```http
GET /v1/tours/TOT-2026/riders/R57/events/progress?eventId=EVT-BAGLOAD
```

Response `200 OK` (cancelled records excluded; `status` is the record `outcome`):
```json
{
  "items": [
    { "eventId": "EVT-BAGLOAD", "occurrenceId": "EVT-BAGLOAD#2026-02-12#1", "activityId": "ACT-001", "status": "COMPLETED" },
    { "eventId": "EVT-BAGLOAD", "occurrenceId": "EVT-BAGLOAD#2026-02-12#1", "activityId": "ACT-002", "status": "COMPLETED" },
    { "eventId": "EVT-BAGLOAD", "occurrenceId": "EVT-BAGLOAD#2026-02-12#1", "activityId": "ACT-003", "status": "COMPLETED" }
  ]
}
```

#### Hotels Examples

##### List Hotels

```http
GET /v1/tours/TOT-2026/hotels
```

Response `200 OK`:
```json
{
  "items": [
    {
      "hotelId": "HTL-MDU-01",
      "name": "Madurai Residency",
      "city": "Madurai",
      "address": "15 West Marret Street, Madurai 625001",
      "contact": "+91 452 234 5678",
      "notes": "Baggage room near service entrance",
      "createdAt": "2026-01-28T10:00:00Z",
      "updatedAt": "2026-02-05T09:00:00Z"
    }
  ]
}
```

##### Create Hotel

```http
POST /v1/tours/TOT-2026/hotels
```
```json
{
  "hotelId": "HTL-MDU-01",
  "name": "Madurai Residency",
  "city": "Madurai",
  "address": "15 West Marret Street, Madurai 625001",
  "contact": "+91 452 234 5678",
  "notes": "Baggage room on ground floor"
}
```

Response `201 Created`:
```json
{
  "hotelId": "HTL-MDU-01",
  "name": "Madurai Residency",
  "city": "Madurai",
  "address": "15 West Marret Street, Madurai 625001",
  "contact": "+91 452 234 5678",
  "notes": "Baggage room on ground floor",
  "createdAt": "2026-01-28T10:00:00Z",
  "updatedAt": "2026-01-28T10:00:00Z"
}
```

##### Update Hotel

```http
PUT /v1/tours/TOT-2026/hotels/HTL-MDU-01
```
```json
{
  "notes": "Baggage room near service entrance"
}
```

Response `200 OK`: the full updated hotel, the same as the item in [List Hotels](#list-hotels).

##### List Hotel Stays by Date

```http
GET /v1/tours/TOT-2026/hotelstays?date=2026-02-12
```

Response `200 OK`:
```json
{
  "items": [
    {
      "stayDate": "2026-02-12",
      "riderId": "R12",
      "hotelId": "HTL-MDU-01",
      "roomNo": "204",
      "roomCapacity": 2,
      "sharingWith": ["R57"],
      "source": "MANUAL",
      "checkInDate": "2026-02-11",
      "checkOutDate": "2026-02-13",
      "createdAt": "2026-02-01T10:05:00Z",
      "updatedAt": "2026-02-01T10:05:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    },
    {
      "stayDate": "2026-02-12",
      "riderId": "R57",
      "hotelId": "HTL-MDU-01",
      "roomNo": "204",
      "roomCapacity": 2,
      "sharingWith": ["R12"],
      "source": "MANUAL",
      "checkInDate": "2026-02-11",
      "checkOutDate": "2026-02-13",
      "createdAt": "2026-02-01T10:00:00Z",
      "updatedAt": "2026-02-01T10:00:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ]
}
```

##### List Hotel Stays for Rider

```http
GET /v1/tours/TOT-2026/riders/R57/hotelstays
```

Response `200 OK`: `{"items": [...]}` with every night allocated to `R57`. Items have the same shape as in [List Hotel Stays by Date](#list-hotel-stays-by-date).

##### List Hotel Stays for Hotel

```http
GET /v1/tours/TOT-2026/hotels/HTL-MDU-01/hotelstays?date=2026-02-12
```

Response `200 OK`: `{"items": [...]}` for the hotel, sorted by `roomNo` then `riderId` (here, the same two items as [List Hotel Stays by Date](#list-hotel-stays-by-date)). Leave out `date` to get every night.

##### Upsert Hotel Stay

The paired rider's record must reciprocate `sharingWith` (same hotel, room, and capacity). Otherwise the call fails with `409 NON_RECIPROCAL_SHARING`.

```http
PUT /v1/tours/TOT-2026/hotelstays/2026-02-12/R57
```
```json
{
  "hotelId": "HTL-MDU-01",
  "roomNo": "204",
  "roomCapacity": 2,
  "sharingWith": ["R12"],
  "checkInDate": "2026-02-11",
  "checkOutDate": "2026-02-13"
}
```

Response `200 OK`: the stored allocation, the same as the `R57` item in [List Hotel Stays by Date](#list-hotel-stays-by-date). `source` is always `MANUAL`, and `createdAt` is kept on re-upsert.

##### Presign Hotel Allocation Upload

```http
POST /v1/tours/TOT-2026/hotelstays/uploads/presign
```

Response `200 OK`. Upload the CSV with `PUT` and `Content-Type: text/csv`. Uploading starts processing automatically. Each attempt needs a new presign; if the same URL is used again, the second upload is ignored:
```json
{
  "uploadId": "UPL-418273645501",
  "uploadUrl": "https://<artifacts-bucket>.s3.amazonaws.com/tours/TOT-2026/uploads/hotel-allocation/UPL-418273645501.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
  "s3Key": "tours/TOT-2026/uploads/hotel-allocation/UPL-418273645501.csv",
  "expiresIn": 900
}
```

CSV format. Directive lines go before the header row. Use either `stayDates` or `startDate` with `nights`. `hotelId` is an optional default hotel. `sharingWith` separates rider IDs with `;`. `roomCapacity` is `2` (default) or `3`:
```csv
# stayDates=2026-02-11,2026-02-12
# hotelId=HTL-MDU-01
riderId,hotelId,roomNo,roomCapacity,sharingWith
R1,HTL-MDU-01,204,2,R2
R2,,204,2,R1
R57,HTL-MDU-02,311,2,
```

Each row is expanded into one `RoomAllocation` per stay date. Riders already allocated on those dates but not in the file are kept. For riders in the file, their existing allocation for each date is replaced.

##### Get Hotel Allocation Upload Status

```http
GET /v1/tours/TOT-2026/hotelstays/uploads/UPL-418273645501
```

Response `200 OK`. Poll every few seconds until `status` is `REJECTED` or `APPLIED`. The status moves `PENDING` → `VALIDATING` → `REJECTED` | `APPLIED`. Per D21 the whole file is applied or nothing is: `APPLIED` means every row was written, and `REJECTED` means no allocation was changed:
```json
{
  "uploadId": "UPL-418273645501",
  "status": "REJECTED",
  "rowCount": 3,
  "errorCount": 1,
  "errors": [
    { "row": 5, "code": "UNKNOWN_HOTEL_ID", "message": "Hotel HTL-MDU-09 does not exist in this tour." }
  ],
  "appliedCount": 0,
  "processedAt": "2026-02-10T08:15:02Z"
}
```

`row` is the line number in the source file. `row: 0` means the error is about the whole file. `errorCount` is the total number of errors, but `errors` returns at most `maxStoredErrors` of them. Error codes:

| Scope | Codes |
|-------|-------|
| File | `FILE_TOO_LARGE`, `INVALID_ENCODING`, `INVALID_HEADER`, `EMPTY_FILE`, `TOO_MANY_ROWS`, `MISSING_STAY_DATES`, `INVALID_STAY_DATES`, `TOO_MANY_STAY_DATES` |
| Row | `MALFORMED_ROW`, `MISSING_RIDER_ID`, `INVALID_RIDER_ID`, `UNKNOWN_RIDER_ID`, `RIDER_NOT_ELIGIBLE` (`WITHDRAWN`/`EXITED`), `MISSING_HOTEL_ID`, `INVALID_HOTEL_ID`, `UNKNOWN_HOTEL_ID`, `MISSING_ROOM_NO`, `INVALID_ROOM_NO`, `INVALID_ROOM_CAPACITY`, `INVALID_SHARING_WITH` |
| Cross-row / existing data | `DUPLICATE_RIDER_FOR_DATE`, `NON_RECIPROCAL_SHARING`, `ROOM_CLASH`, `ROOM_CAPACITY_EXCEEDED` |
| Processing | `CONCURRENT_MODIFICATION`, `PROCESSING_TIMEOUT`, `PROCESSING_ERROR` |

Limits (`maxFileSizeBytes`, `maxDataRows`, `maxStayDates`, `maxStoredErrors`) are set in AppConfig under `HOTEL_UPLOAD` / `PROCESSING`.

#### Users Examples

##### Get Current User

```http
GET /v1/users/me
```

Response `200 OK`. Values are taken from the JWT claims, and `emailVerified` is normalized to a boolean:
```json
{
  "userId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "email": "admin@example.com",
  "username": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "emailVerified": true,
  "groups": ["ADMINISTRATOR"]
}
```

##### List Cognito Users

```http
GET /v1/users/cognito
```

Response `200 OK`:
```json
{
  "users": [
    { "sub": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "name": "Asha Kumar" },
    { "sub": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f", "name": "Ravi Shankar" },
    { "sub": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", "name": "Meena Iyer" }
  ],
  "count": 3
}
```

##### List Tour Users

```http
GET /v1/tours/TOT-2026/users?role=HOTEL_STAFF
```

Response `200 OK`:
```json
{
  "users": [
    {
      "userId": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
      "username": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
      "email": "ravi.hotel@example.com",
      "name": "Ravi Shankar",
      "role": "HOTEL_STAFF",
      "status": "ACTIVE",
      "hotelId": "HTL-MDU-01",
      "eventAssignments": [
        { "eventId": "EVT-BAGLOAD", "dates": "ALL" }
      ],
      "assignedActivityIds": ["ACT-003"],
      "createdAt": "2026-02-01T09:00:00Z",
      "createdBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "updatedAt": "2026-02-02T09:00:00Z",
      "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ],
  "count": 1,
  "tourId": "TOT-2026"
}
```

##### Get Current Tour User

Called by Ravi Shankar:

```http
GET /v1/tours/TOT-2026/users/me
```

Response `200 OK`: the caller's `User-TOT-2026` record, the same as the item in [List Tour Users](#list-tour-users). Returns `404 USER_NOT_FOUND` when the caller has no record in the tour.

##### Create Tour User

```http
POST /v1/tours/TOT-2026/users
```
```json
{
  "userId": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
  "role": "HOTEL_STAFF",
  "hotelId": "HTL-MDU-01",
  "eventAssignments": [
    { "eventId": "EVT-BAGLOAD", "dates": ["2026-02-12", "2026-02-13"] }
  ],
  "assignedActivityIds": ["ACT-003"]
}
```

Response `201 Created`. `username`, `email`, and `name` are copied from Cognito. Optional fields that weren't supplied are stored as `null`:
```json
{
  "userId": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
  "username": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
  "email": "ravi.hotel@example.com",
  "name": "Ravi Shankar",
  "role": "HOTEL_STAFF",
  "status": "ACTIVE",
  "assignedStage": null,
  "hotelId": "HTL-MDU-01",
  "eventAssignments": [
    { "eventId": "EVT-BAGLOAD", "dates": ["2026-02-12", "2026-02-13"] }
  ],
  "assignedActivityIds": ["ACT-003"],
  "createdAt": "2026-02-01T09:00:00Z",
  "createdBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "updatedAt": "2026-02-01T09:00:00Z",
  "updatedBy": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

##### Update Tour User

Only the supplied fields change. Sending a field as `null` removes it.

```http
PUT /v1/tours/TOT-2026/users/5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f
```
```json
{
  "assignedStage": null,
  "eventAssignments": [
    { "eventId": "EVT-BAGLOAD", "dates": "ALL" }
  ]
}
```

Response `200 OK`: the full updated record, the same as the item in [List Tour Users](#list-tour-users).

#### Admin User Management Examples

##### List Role Groups

```http
GET /v1/admin/usermgmt/roles
```

Response `200 OK`:
```json
{
  "groups": ["ADMINISTRATOR", "GUEST", "HOTEL_STAFF", "PS_1_USER", "PS_2_USER", "SUPER_USER"]
}
```

##### List Managed Users

```http
GET /v1/admin/usermgmt/users?enabled=true&limit=2
```

Response `200 OK`. Pass `nextToken` back to get the next page (`null` on the last page):
```json
{
  "users": [
    {
      "cognitoUserId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "username": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "email": "admin@example.com",
      "phoneNumber": "+919800000001",
      "name": "Asha Kumar",
      "enabled": true,
      "status": "CONFIRMED",
      "roles": ["ADMINISTRATOR"]
    },
    {
      "cognitoUserId": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
      "username": "5d2f8b3e-1c4a-4e6b-9f7d-2a3b4c5d6e7f",
      "email": "ravi.hotel@example.com",
      "phoneNumber": null,
      "name": "Ravi Shankar",
      "enabled": true,
      "status": "CONFIRMED",
      "roles": ["HOTEL_STAFF"]
    }
  ],
  "nextToken": "CAISqAIIARKBAggDEvwB..."
}
```

##### Create Managed User

```http
POST /v1/admin/usermgmt/users
```
```json
{
  "email": "meena.ps1@example.com",
  "phoneNumber": "+919876543210",
  "name": "Meena Iyer",
  "roles": ["PS_1_USER"]
}
```

Response `201 Created`:
```json
{
  "cognitoUserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "username": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

##### Enable Managed User

```http
POST /v1/admin/usermgmt/users/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/enable
```

Response `200 OK`:
```json
{
  "cognitoUserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "enabled": true
}
```

##### Disable Managed User

```http
POST /v1/admin/usermgmt/users/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/disable
```

Response `200 OK`:
```json
{
  "cognitoUserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "enabled": false
}
```

##### Delete Managed User

```http
DELETE /v1/admin/usermgmt/users/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
```

Response `200 OK`:
```json
{
  "cognitoUserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "deleted": true
}
```

##### Update Managed User

`roles` replaces the full role set. An empty `phoneNumber` or `name` clears that attribute.

```http
PUT /v1/admin/usermgmt/users/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
```
```json
{
  "name": "Meena Iyer",
  "roles": ["PS_1_USER", "PS_2_USER"]
}
```

Response `200 OK`:
```json
{
  "cognitoUserId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
}
```

#### Notifications Examples

##### Register Device

```http
POST /v1/notifications/devices
Content-Type: application/json

{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "android"
}
```

Response `201 Created`:
```json
{
  "registered": true
}
```

##### Delete Device

```http
DELETE /v1/notifications/devices/ExponentPushToken%5Bxxxxxxxxxxxxxxxxxxxxxx%5D
```

Response `204 No Content`.

##### List Notifications

```http
GET /v1/notifications?since=2026-02-11T00:00:00Z&limit=20
```

Response `200 OK`:
```json
{
  "items": [
    {
      "notificationId": "b3e1c2d4-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
      "ruleId": "RIDE_STARTED",
      "title": "Ride has started",
      "body": "Please proceed to stage 1",
      "priority": "URGENT",
      "target": {"screen": "RideStatus", "paramKeys": ["tourId", "rideId"]},
      "tourId": "TOT-2026",
      "createdAt": "2026-02-11T05:10:00Z",
      "isRead": false
    }
  ],
  "unreadCount": 3
}
```

##### Get Unread Count

```http
GET /v1/notifications/unread-count
```

Response `200 OK`:
```json
{
  "unreadCount": 3
}
```

##### Mark Notifications Read

```http
PUT /v1/notifications/read
Content-Type: application/json

{
  "readAt": "2026-02-11T06:00:00Z"
}
```

Response `200 OK`:
```json
{
  "readAt": "2026-02-11T06:00:00Z"
}
```

##### Create Notification (Manual announce)

```http
POST /v1/notifications
Content-Type: application/json

{
  "ruleId": "ANNOUNCEMENT",
  "tourId": "TOT-2026",
  "context": {
    "title": "Dinner update",
    "message": "Dinner timing changed to 8:00 PM"
  },
  "audiences": ["TOUR#TOT-2026#ALL"]
}
```

Response `200 OK`:
```json
{
  "notificationId": "4a89d8f1-42d8-4db1-b5e1-e1c28630a011"
}
```

##### Send Check-in Reminder

```http
POST /v1/notifications/reminders
Content-Type: application/json

{
  "reminderType": "RIDE_CHECKIN_NOT_STARTED",
  "tourId": "TOT-2026",
  "rideId": "RIDE-001"
}
```

Response `200 OK`:
```json
{
  "notificationId": "4a89d8f1-42d8-4db1-b5e1-e1c28630a011",
  "targetCount": 12,
  "riderIds": ["R2", "R4"]
}
```

##### List Notification Rules

```http
GET /v1/admin/notification-rules
```

##### Get Notification Rule

```http
GET /v1/admin/notification-rules/ANNOUNCEMENT
```

##### Create Notification Rule

```http
POST /v1/admin/notification-rules
Content-Type: application/json

{
  "ruleId": "PIT_STOP_OPENED",
  "enabled": true,
  "category": "SYSTEM",
  "audiences": ["TOUR#{tourId}#ALL"],
  "titleTemplate": "Pit stop {stageLabel} is open",
  "messageTemplate": "Proceed to {location}",
  "push": true,
  "priority": "NORMAL",
  "androidChannel": "general",
  "target": {"screen": "RideStatus", "paramKeys": ["tourId", "rideId", "stageNumber"]},
  "ttlHours": 48,
  "allowOverride": false
}
```

##### Update Notification Rule

```http
PUT /v1/admin/notification-rules/PIT_STOP_OPENED
Content-Type: application/json

{
  "enabled": true,
  "category": "SYSTEM",
  "audiences": ["TOUR#{tourId}#ALL"],
  "titleTemplate": "Pit stop {stageLabel} is now open",
  "messageTemplate": "Proceed to {location}",
  "push": true,
  "priority": "NORMAL",
  "androidChannel": "general",
  "target": {"screen": "RideStatus", "paramKeys": ["tourId", "rideId", "stageNumber"]},
  "ttlHours": 48,
  "allowOverride": false
}
```

##### Delete Notification Rule

```http
DELETE /v1/admin/notification-rules/PIT_STOP_OPENED
```

## Event Engine & Hotel Error Codes

Request and response examples for the event engine and hotel endpoints (introduced alongside `docs/cycling-tour-events-design.md`) are in [Events Examples](#events-examples) and [Hotels Examples](#hotels-examples).

#### New error codes

In addition to the standard `400`/`401`/`403`/`404`/`409`/`500` statuses above, the event engine and hotel endpoints introduce the codes below. See `docs/cycling-tour-events-design.md` §8.25 for the complete reference table.

| Code | HTTP | Meaning |
|---|---|---|
| `EVENT_NOT_FOUND` / `EVENT_ALREADY_EXISTS` | 404 / 409 | Event definition lookup/create conflict |
| `OCCURRENCE_NOT_FOUND` / `OCCURRENCE_ALREADY_EXISTS` / `OCCURRENCE_CLOSED` | 404 / 409 / 409 | Occurrence lookup/create/edit conflicts |
| `INVALID_OCCURRENCE_TRANSITION` | 409 | Start/complete/cancel called from an invalid status |
| `NO_LINKED_OCCURRENCE` | 400 | Reconciliation requested with no `linkedOccurrenceRef` |
| `ACTIVITY_NOT_FOUND` | 404 | `activityId` not present/disabled on the event or occurrence |
| `SCAN_TYPE_NOT_ALLOWED` | 400 | Scanned `typeCode` not in the activity's effective `allowedTypeCodes` |
| `DUPLICATE_ACTIVITY_RECORD` | 409 | Rider already has a non-cancelled record for this activity+occurrence |
| `PREREQUISITE_NOT_MET` | 409 | Sequence/prerequisite activity not yet completed |
| `OCCURRENCE_NOT_ACTIVE` | 409 | Scan against an occurrence whose status is not `ACTIVE` |
| `BAGGAGE_NOT_IN_TOUR` | 409 | Rider's `baggageStatus=WITH_RIDER`, scan rejected |
| `RIDER_NOT_ASSIGNED` / `HOTEL_MISMATCH` | 403 / 403 | Second-layer authorisation failures (`eventAssignments`, hotel match) |
| `HOTEL_NOT_FOUND` / `HOTEL_ALREADY_EXISTS` | 404 / 409 | Hotel lookup/create conflict |
| `ROOM_CLASH` / `NON_RECIPROCAL_SHARING` / `ROOM_CAPACITY_EXCEEDED` | 409 | Room allocation validation failures |
| `UPLOAD_NOT_FOUND` | 404 | `uploadId` unknown |
| `BAGGAGE_DISPOSITION_REQUIRED` / `BAGGAGE_NOT_RETAINED` | 400 / 409 | Rider exit/baggage release validation |
| `RECORD_NOT_FOUND` / `RECORD_ALREADY_CANCELLED` | 404 / 409 | Activity record cancel conflicts |
| `USER_NOT_FOUND` / `USER_ALREADY_EXISTS` / `INVALID_EVENT_ASSIGNMENT` | 404 / 409 / 400 | Tour user assignment validation |

## HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Success (GET, PUT) |
| 201 | Created (POST) |
| 204 | No Content (DELETE) |
| 400 | Bad Request (validation errors) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (duplicate check-in) |
| 500 | Internal Server Error |

## Authorization Matrix

| Endpoint | Administrator | Super User | PS_<n>_User | Hotel Staff | Guest |
|----------|--------------|------------|-------------|-------------|-------|
| GET config | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET tours | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET riders | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST rider exit | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST rider exit cancel | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST rider baggage release | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET rides | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET dashboard | ✅ | ✅ | ✅ | ❌ | ✅ |
| GET dashboard progress | ✅ | ✅ | ✅ | ❌ | ✅ |
| GET rider details popup | ✅ | ✅ | ✅ | ❌ | ✅ |
| GET Cognito users (`/v1/users/cognito`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST check-in | ✅ | ✅ | Stage-bound regular PIT_STOP check-ins plus any Quit Riding check-in | ✅ | ❌ |
| POST tours (create/provision) | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST archive tour | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST/PUT rides | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST open/close pit stop | ✅ | ✅ | Assigned stage only | ❌ | ❌ |
| POST open ride | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST start ride | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST close ride | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET event/hotel read APIs | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST/PUT event definitions | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST/PUT/start/complete/cancel occurrences | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST event activity record / cancel event record | ✅ | ✅ | ✅ | ✅ | ❌ |
| POST/PUT hotels and hotel stays | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST/PUT tour users | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manual check-in | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST /v1/notifications (announce) | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /v1/notifications/reminders | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST riders/profile (create) | Any authenticated user | | | | |
| POST tours/{tourId}/riders (register) | Any authenticated user | | | | |
| GET rider statistics | Any authenticated user | | | | |
| POST profile picture | Any authenticated user | | | | |
| GET /v1/notifications + unread-count | Any authenticated user | | | | |
| PUT /v1/notifications/read | Any authenticated user | | | | |
| Device register/delete | Any authenticated user | | | | |
| /v1/admin/notification-rules CRUD | ✅ | ❌ | ❌ | ❌ | ❌ |

## Request Validation

All requests are validated at three levels: API Gateway auth, Lambda RBAC, and handler-level schema/business validation.

### Common Validation Rules

1. **Authentication**
   - All API routes are JWT-authorized via Cognito User Pool authorizers.

2. **Authorization (RBAC permissions in Lambda)**
   - `TOUR_MANAGE`: create/archive tours
  - `RIDE_MANAGE`: create/update/open/start/close rides
  - `PIT_STOP_MANAGE`: open/close pit-stop stages
  - `RIDER_EXIT`: mark rider as `EXITED`, release retained baggage, and cancel rider exit (ADMINISTRATOR and SUPER_USER only)
  - `CHECKIN`: create check-ins, with additional stage-aware enforcement for `PS_<n>_USER` roles on regular pit-stop check-ins
  - `EVENT_MANAGE`: create/update event definitions
  - `EVENT_OCCURRENCE_MANAGE`: create/update/start/complete/cancel event occurrences
  - `EVENT_SCAN`: create/cancel event activity records
  - `HOTEL_ALLOC_MANAGE`: manage hotels and room allocations
  - `USER_MANAGE`: create/update tour-scoped user assignments
  - `NOTIFICATION_MANAGE`: create announcements and manage notification rules

### Pit Stop Role Rules

1. `PS_1_USER` can create a regular check-in only for stage `1` when stage type is `PIT_STOP`.
2. `PS_2_USER`, `PS_3_USER`, and higher follow the same pattern using their numeric suffix.
3. Stage `0` is always `START`, the last stage is always `FINISH`, and pit stop roles cannot create regular check-ins for either of those stage types.
4. A user may hold multiple `PS_<n>_USER` groups and may create regular check-ins for any matching assigned pit-stop stage.
5. Any `PS_<n>_USER` role may create a `Quit Riding` check-in.
6. `PS_<n>_USER` may open or close only pit stop stage `n`; `SUPER_USER` and `ADMINISTRATOR` may manage any pit stop stage.
7. Pit stop open/close is valid only for `PIT_STOP` stages while the ride status is `STARTED`.

3. **Identifier and format validators**
   - Rider ID: `R1` to `R999` (`^R([1-9]\d{0,2})$`)
   - Tour ID: 3-50 chars, starts with letter/number, allowed chars `[a-zA-Z0-9_.-]`
   - Ride ID: `RIDE###` (for example `RIDE001`)
  - Stage ID: `S###` (for example `S000`)
   - Date: `YYYY-MM-DD`
   - Datetime: ISO 8601 UTC with `Z` suffix only
   - Time: `HH:MM` 24-hour format

4. **General body requirements**
   - `validate_required_fields` rejects missing fields and fields explicitly set to `null`.
   - Invalid JSON request body returns `400`.

### Implemented Check-In Business Validation

1. Stage number must be within ride stage range (0 to total stages - 1).
2. Rider must be registered in the tour.
3. Duplicate normal check-in at same stage is rejected (`DUPLICATE_CHECKIN`).
4. Duplicate Not Riding is rejected (`DUPLICATE_NOT_RIDING`).
5. Rider marked Not Riding cannot create normal check-in (`RIDER_NOT_RIDING`).
6. Rider with previous Quit Riding cannot check in again (`RIDER_QUIT_RIDING`), except offline timestamp pre-dating quit timestamp.
7. Ride in CLOSED status rejects check-ins (`RIDE_CLOSED`), except offline timestamp pre-dating `closedAt`.
8. `stageNumber` is mandatory only for normal check-ins; Not Riding and Quit Riding entries can be created without stage attributes.

### Additional Endpoint-Specific Validation Highlights

1. Create Tour enforces `endDate >= startDate` and unique `tourId`.
2. Create Ride enforces positive `totalDistance`, positive integer `rideNo`, and sequential `stages` with `START` first and `FINISH` last.
3. List filters validate enum values (`status`, `role`, `notification type`).
4. Dashboard, dashboard-progress, rider-details, and config endpoints support ETag and conditional `304 Not Modified`.

## Rate Limiting

Not critical for initial implementation given low volume, but consider:
- Per-user limits: 100 requests/minute
- API-wide limits: 1000 requests/minute
- Burst capacity: 200 requests

## API Development Phases

### Phase 1: Core Operations (MVP)
- ✅ Get today's ride
- ✅ Get tour riders
- ✅ Create check-in
- ✅ Get dashboard data
- ✅ Get rider by Rider ID

### Phase 2: Management
- Create/update rides
- Close ride
- User management

### Phase 3: Historical & Analytics
- Historical ride queries
- Check-in analytics
- Export to Excel


## Rider profile configuration and write contracts

### `GET /v1/config` (shared config reader)
This endpoint returns enabled AppConfig entries and the current schema hash used by profile writes.

```json
{
  "success": true,
  "data": {
    "definitionsVersion": "8d2a2a9f2c2e4b2f...",
    "items": [
      {
        "configType": "RIDER_PROFILE_ATTRIBUTE",
        "configId": "photo",
        "enabled": true,
        "config": {
          "type": "IMAGE",
          "storage": { "scope": "CORE", "path": "photoS3Key" }
        }
      }
    ]
  }
}
```

Clients **must use** `data.definitionsVersion` from the server response and **must not compute** their own value.

### Admin profile-config APIs (TourDataApi, `ADMINISTRATOR`)

#### `GET /v1/admin/config/{configType}`
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "configType": "RIDER_PROFILE_ATTRIBUTE",
        "configId": "name",
        "enabled": true,
        "version": 3,
        "updatedAt": "2026-09-28T10:00:00Z",
        "config": {
          "label": "Name",
          "sectionId": "personal",
          "type": "TEXT",
          "storage": { "scope": "CORE", "path": "name" },
          "required": true
        }
      }
    ]
  }
}
```

#### `PUT /v1/admin/config/{configType}/{configId}`
```json
{
  "version": 3,
  "enabled": true,
  "config": {
    "label": "Photo",
    "sectionId": "personal",
    "type": "IMAGE",
    "storage": { "scope": "CORE", "path": "photoS3Key" },
    "required": false,
    "system": true,
    "handler": "PROFILE_PHOTO"
  }
}
```

### Rider profile write APIs

#### `POST /v1/riders/profile`
```json
{
  "name": "Rider Name",
  "phone": "+919999999999",
  "photoS3Key": "riders/P123/photo/profile.jpg",
  "address": {
    "line1": "Street 1",
    "city": "Chennai",
    "country": "India",
    "state": "Tamil Nadu",
    "postalCode": "600001"
  },
  "attributes": {
    "dietaryPreference": "VEG"
  },
  "definitionsVersion": "8d2a2a9f2c2e4b2f..."
}
```

#### `PUT /v1/riders/profile/{profileId}`
```json
{
  "name": "Updated Name",
  "photoS3Key": "profiles/P123/legacy-photo.jpg",
  "attributes": {
    "bloodGroup": null
  },
  "definitionsVersion": "8d2a2a9f2c2e4b2f..."
}
```

Notes:
- Top-level keys resolve by CORE storage path first (for example `photoS3Key`), then by attribute key.
- `attributes.<key>` resolves by attribute key.
- Optional attributes accept `null` to clear the stored value.
- Required attributes are validated on the final merged profile.

### Attribute upload/download APIs
- `POST /v1/riders/profile/{profileId}/attributes/{key}/upload`
- `GET /v1/riders/profile/{profileId}/attributes/{key}/download`

Example upload response:
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...",
    "s3Key": "riders/P123/attributes/insuranceCard/7db8....pdf",
    "expiresIn": 900
  }
}
```

### Rider profile related error codes
- `UNKNOWN_OR_DISABLED_ATTRIBUTE`
- `ADMIN_ONLY_ATTRIBUTE`
- `PROFILE_DEFINITIONS_CHANGED`
- `CONFIG_VERSION_CONFLICT`
- `SYSTEM_ATTRIBUTE_PROTECTED`
- `IMMUTABLE_FIELD`
- `PROFILE_ACCESS_DENIED`

Attribute file routes are exposed on both APIs:
- RiderApi: owner access
- TourDataApi: management access subject to role/visibility filtering (and ownership when RiderApi context applies)
