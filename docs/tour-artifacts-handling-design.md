# Tour Artifact Management — Design Guide

## Requirement
In 'tour-rider-app' there are certain artifacts include in the App package but this can change every year. I do not want to rebuild the App for just changing these artifacts. Hence I want to upload them to S3 buckets using 'tour-mgmt-app' and allow 'tour-rider-app' to get it from S3 for display.

Artifacts needs to be uploaded in different categories so that they remain organized and maintainable.
- 'tour' specific where 'tourId' will be identifier
- 'ride' specific where 'tourId' & 'rideId' will be the identifiers

Artifact list can be dynamic and platform should provide ability to add new artifact type through configuration which then can be activated by the respective App. 

Attributes, 'tourId, 'rideId', tour 'status' etc. are already available as part of the data model.

## Purpose

Allow year-changing artifacts (images, banners, documents) to be uploaded from `tour-mgmt-app` and consumed by `tour-rider-app`, without rebuilding or re-publishing the rider app. Artifacts are organized by category — tour-level and ride-level — and read efficiently on the rider app through a fetch-once, cache-locally pattern.

This builds on the existing platform:
- DynamoDB for data, JSON objects per table
- CRUD exclusively via APIs
- Lambda functions in Python
- API Gateway HTTP API
- S3 for file storage, with existing Put/Get presigned URL APIs (currently used for rider profile photos)
- React Native / Expo apps: `tour-mgmt-app` (organizers) and `tour-rider-app` (riders)

---

## Solution Design

### 1. S3 Key Structure

A single `tourId` is the parent prefix for everything related to that tour. Rides nest underneath it. There is no separate "active" prefix — active-tour status is a runtime concept the app already knows from the Tour data model (`status` attribute), not something encoded in storage.

| Category | Key pattern | Example |
|---|---|---|
| Tour | `tours/{tourId}/{artifactId}.{ext}` | `tours/TOT-2026/ride-plan.png` |
| Ride | `tours/{tourId}/rides/{rideId}/{artifactId}.{ext}` | `tours/TOT-2026/rides/RIDE003/ride-elevation.png` |

**Benefits of this layout:**
- One prefix per tour — deleting or archiving a tour is a single-prefix sweep, including all its rides.
- No cross-referencing an `active/` prefix; "active" artifacts are simply the tour artifacts of whichever `tourId` the app currently flags as active.
- Keep this artifacts bucket **separate** from the rider profile-photo bucket — access patterns differ significantly (shared/organizer-managed content vs. private per-rider content), and mixing them under one bucket policy gets messy.

---

### 2. Artifact metadata

**Table: `Artifacts`**

A new DynamoDB table should be created using Cloud Formation deployment. Partition key `artifactFor` is string and it can be unambiguous `tourId` or `tourId#rideId` and artifact name as Sort Key, `artifactId` make it all unique.

**Tour Artifact**
```json
{
  "artifactFor": "TOT-2026",
  "artifactId": "ride-plan",
  "s3Key": "tours/TOT-2026/ride-plan.png",
  "contentType": "image/png",
  "version": 3,
  "sizeBytes": 482113,
  "uploadedAt": "2026-08-01T09:12:00Z",
  "uploadedBy": "org-user-42",
  "title": "Route map"
}
```
**Ride Artifact**
```json
{
  "artifactFor": "TOT-2026#RIDE003",
  "artifactId": "ride-elevation",
  "s3Key": "tours/TOT-2026/rides/RIDE003/ride-elevation.png",
  "contentType": "image/png",
  "version": 1,
  "sizeBytes": 210044,
  "uploadedAt": "2026-08-01T09:20:00Z",
  "uploadedBy": "org-user-42",
  "title": "Elevation profile",
}
```

**Population strategy:** API is required for the `tour-mgmt-app` to get a pre-signed URL based on the metadata and allow upload from Frontend App. No S3 direct loading is recommended as it is prone to errors with correct Path and artifactId.

> Version bumping is necessary in the metadata to ensure local caching by the `tour-rider-app` and this should be achieved using POST and PUT API that `tour-mgmt-app` will use for images upload.

---

### 3. Artifact Type
Artifact Type is not a definitive list hence a configuration is required to provide the list of artifactId that can be used both at tour and ride levels.

Existing `AppConfig` table should be utilised for this purpose and it also got an API GET /v1/config.

The following are the intial list of Artifact Types to be seeded in this config table.  

| Artifact Type (configId) | Category | Description |
|---|---|---|
| ride-plan | tour | Tour of Tamil Nadu - Ride Plan |
| rider-docket | tour | Rider Docket |
| tour-elevation | tour | Tour Elevation |
| ride-elevation | ride | Ride Elevation |
| gpx-file | ride | Ride route GPX File |
| cue-sheet | ride | Cue Sheet |

Sample config:
```json
{
 "configType": "ARTIFACTS",
 "configId": "ride-plan",
 "config": {
  "category": "tour"
 },
 "description": "Tour of Tamil Nadu - Ride Plan",
 "enabled": true,
 "updatedAt": "2026-08-01T13:51:05Z",
 "updatedBy": "seed-script",
 "version": 1
}
```
> `catetory` will be **ride** for ride specific artifact type.

---

### 4. Upload flow 
Upload flow primarily for `tour-mgmt-app` on how it should be. There are some backend components like API to cater the frontend solution.

**Flow**  
`tour-mgmt-app` (referred as App in this section) will have a screen to manage image uploads and maintenance.

Phase 3 UI foundation is implemented in `src/components/artifacts/`. `ArtifactRow` renders the artifact model as a desktop table row or mobile card, while `ConfirmDialog` provides a cross-platform modal confirmation for destructive actions. Phase 4 implements the screen orchestration in `src/screens/admin/ArtifactsScreen.tsx`. Phase 5 registers the screen as an administrator-only full-screen modal and exposes it through the administrator menu.

The screen loads tours and enabled `ARTIFACTS` configuration in parallel, supports tour and ride scopes, joins configured artifact types with the selected manifest, validates file size and content type before presigning, uploads directly to the presigned URL, and refreshes the active manifest after upload or delete. Empty configuration is shown as an inline empty state.

> A responsive multi-view layout will be used as the Screen layout pattern. It should utilize the tabular grid on desktop device and automatically transforms into a structured list or card format on mobile devices.  
> As this is a complex screen, it is recommended to use the Web version as the primary method for image upload instead of Mobile version. Mobile version can be used for adhoc needs say to upload a new version of an image.

1. 'Artifacts' screen will provide a dropdown list of tourId for the user to select from.
1. When a tourId is selected,  
    - If there are any artifacts already uploaded, same will be loaded in the screen. For Artifact Types that do not have image in S3, it will be shown blank. User can change an existing image or upload new image for Types the doesn't have image.  
    - When there are no artifacts available for the selected tourId, blank screen will be opened with all Artifact Types configured to allow fresh image uploads.
1. Submit/Update should get the pre-signed URL for all applicable 

**Endpoints:**
Unchanged in shape from the existing presigned-URL pattern already used for profile photos — only the key-building logic changes to match the new prefix structure (no `active` category).


| Method & path | Body | Purpose |
|---|---|---|
| `POST /artifacts/tour/presign-upload` | `{ tourId, fileName, contentType }` | Presigned `put_item` for a tour-level artifact |
| `POST /artifacts/ride/presign-upload` | `{ tourId, rideId, fileName, contentType }` | Presigned `put_item` for a ride-level artifact |
| `DELETE /artifacts/tour/{tourId}/{artifactId}` | — | Deletes a tour-level artifact |
| `DELETE /artifacts/ride/{tourId}/{rideId}/{artifactId}` | — | Deletes a ride-level artifact |

> DELETE API-s should ensure both S3 object + metadata row are deleted properly to maintain data integrity.
---

### 5. Read flow

Read flow can be used by both `tour-mgmt-app` and `tour-rider-app`. This document focuses only on the former and latter will be handled using separate change request.

The platform currently uses the API Gateway invoke URL from the CloudFormation deployment (custom domain planned for production later). Reads reuse the existing presigned Get-URL pattern, but the **API is designed to be called once per tour/ride**, not once per screen view — everything after that is served from a local SQLite cache.

**Endpoints:**

| Endpoint | Path Params | Query Params | Body Attributes | Validation / Business Rules |
|---|---|---|---|---|
| `GET /tours/{tourId}/artifacts` | tourId (required) | artifactId (optional) | None | Must be an existing `tourId`. `artifactId` if supplied metadata for tha artifact is returned. |
| `GET /tours/{tourId}/rides/{rideId}/artifacts` | `tourId` (required) `rideId` (required) | artifactId (optional) | None | Both `tourId` and `rideId` are mandatory and should be existing. `artifactId` if supplied metadata for tha artifact is returned. |

**Manifest response shape** — each item carries a ready-to-use download URL alongside its version, so the app doesn't need a second round trip:

```json
{
  "artifactId": "ride-plan",
  "s3Key": "tours/TOT-2026/ride-plan.png",
  "version": 3,
  "contentType": "image/png",
  "sizeBytes": 482113,
  "uploadedAt": "2026-08-01T09:12:00Z",
  "title": "Route map",
  "downloadUrl": "https://<api-id>.execute-api.<region>.amazonaws.com/..."
}
```

Since the app calls this once and then downloads immediately, presigned GET URLs only need to stay valid long enough to complete that download — **15–60 minutes is sufficient**. Generating presigned URLs is a local signing operation (no S3 round trip), so returning one per artifact in a single Lambda invocation stays fast even for tours with many artifacts.

**Forward-compatibility note:** because the manifest already abstracts byte-serving behind a `downloadUrl` field, adopting CloudFront and a custom domain later is a backend-only change — the Lambda builds a CDN URL instead of a presigned one. The app doesn't need to know or care which it's getting.

---

### 6. Local caching notes

> This section is a technical note for `tour-rider-app` consideration and not in scope for this requirement development.

#### App-side flow
1. On opening a tour or ride, check SQLite for a manifest row matching `tourId` (or `tourId` + `rideId`).
2. **Cache hit** → use cached metadata and locally stored files. No network call.
3. **Cache miss** (first load, or after a reset) → call the artifacts API, download every returned file immediately via Expo FileSystem, then write metadata and local file paths into SQLite in one transaction.

This means the metadata API is read once per tour/ride and not called again — appropriate given artifacts rarely change once a tour is confirmed or completed.

SQLite schema:

```sql
CREATE TABLE cached_artifacts (
  tour_id TEXT,
  ride_id TEXT,          -- null for tour-level
  artifact_id TEXT,
  version INTEGER,
  content_type TEXT,
  title TEXT,
  local_path TEXT,
  downloaded_at TEXT,
  PRIMARY KEY (tour_id, ride_id, artifact_id)
);
```

#### Cache reset — "Reset downloaded content"

Rather than relying on OS-level "clear app cache" (behavior differs between iOS and Android, and isn't consistently user-triggerable), add an explicit action in `tour-rider-app` settings:

- Drops all rows from `cached_artifacts`.
- Deletes the associated locally stored files.
- Forces a fresh manifest fetch (and fresh downloads) the next time each tour/ride is opened.

This gives a reliable, cross-platform way to force refresh, independent of what the OS does with its cache directories. Files can still be stored under `FileSystem.cacheDirectory` as a secondary safety net, but the in-app reset action is the primary mechanism.

---

## 6. Security notes

- Artifacts bucket stays **private** — no public bucket policy. All reads go through presigned URLs generated by Lambda.
- Presigned PUT (upload) is scoped to the exact key and content type, short expiry (~5 min), and only issued after the Lambda confirms the caller has `ADMINISTRATOR` rights on the `tourId`.
- Presigned GET (download) expiry only needs to cover the immediate download window after a manifest fetch (~15–60 min) since the app persists files locally afterward.
- Keep this bucket and its access pattern separate from the rider profile-photo bucket, which remains private/per-user via the existing presigned flow.

---

## 7. What stays the same

- Lambda-per-API, API Gateway HTTP API, DynamoDB-as-JSON pattern is unchanged.
- The existing Put/Get presigned URL Lambda pattern is reused for artifact reads and writes — this is additive, not a parallel system.
