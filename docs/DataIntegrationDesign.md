# Data Backend Integration Design

This document provides the analysis and design for integrating the `tour-data-api` backend with the Check-In App (poc-app) frontend. It must be reviewed and approved before any development work begins.

---

## 1. API Approach Analysis

### 1.1 Backend Overview

> **Terminology Note:** AWS API Gateway offers two products: **API Gateway HTTP API** (newer, cheaper, lower latency) and **API Gateway REST API** (older, more features, higher cost). The `tour-data-api` backend uses **API Gateway HTTP API**. Throughout this document, "RESTful" refers to the architectural style (resource-based URLs, standard HTTP methods, JSON responses), while "HTTP API" and "REST API" refer to the specific AWS API Gateway product types.

The `tour-data-api` provides a RESTful API built with AWS SAM, Lambda, API Gateway HTTP API, and DynamoDB. Key characteristics:

- **20 Lambda functions** covering tours, riders, rides, check-ins, and users
- **JWT authentication** via AWS Cognito
- **Tour-scoped tables** — each tour has its own set of DynamoDB tables (TourRider, Ride, CheckIn, User)
- **Dashboard endpoint** (`GET /v1/tours/{tourId}/rides/{rideId}/dashboard`) returns a composite response with ride details, all riders with profiles, all check-ins, and summary statistics in a single call
- **Small data volume** — ~100 riders, ~8 rides per tour, ~600 check-ins per ride maximum

### 1.2 Efficiency for Mobile App

**Assessment: The RESTful API approach is efficient and suitable for this mobile app.**

Reasons:

| Aspect | Assessment | Detail |
|--------|-----------|--------|
| **Data Volume** | ✅ Low | ~100 riders, max 600 check-ins per ride. Total dashboard payload estimated at 50-80KB uncompressed |
| **Network Calls** | ✅ Optimised | Dashboard endpoint returns all data in a single call (ride + riders + check-ins + summary), avoiding N+1 queries |
| **Payload Size** | ✅ Acceptable | API returns only needed fields. No bloat from GraphQL type overhead or over-fetching |
| **Latency** | ✅ Acceptable | Lambda cold starts are acceptable for 10-15 concurrent users. API Gateway HTTP API has lower latency than API Gateway REST API |
| **Cost** | ✅ Minimal | API Gateway HTTP API is 70% cheaper than API Gateway REST API. Estimated <$10/month during tour |
| **Offline Support** | ✅ Compatible | API responses are simple JSON — easily cached in SQLite for offline use |
| **Authentication** | ✅ Standard | JWT tokens from Cognito — standard flow, tokens can be refreshed by Amplify SDK |

**Why RESTful API over GraphQL for this use case:**

1. **Dashboard is the primary view** — the backend already provides a composite dashboard endpoint that returns everything needed. GraphQL's selective querying advantage is minimal here since we need all the data anyway.
2. **Low complexity queries** — most reads are "get all riders," "get all check-ins for ride," "get today's ride." These are simple and don't benefit from GraphQL's flexibility.
3. **Write operations are simple** — check-in creation is a single POST with a fixed payload structure.
4. **Amplify Data (AppSync)** would require redefining the data model in Amplify schema, which contradicts the design principle that DynamoDB tables are managed externally by `tour-data-api`.

**Recommendation:** Use the `tour-data-api` RESTful API directly via `fetch`/HTTP client with JWT authentication from Amplify Auth. No need for AppSync/GraphQL — it would add complexity without benefit for this use case.

### 1.3 Design Principle Compliance

Per `docs/SolutionDesign.md`:
> "Any direct access to AWS Resource access from Mobile App or Web client must not be permitted. Such access must always be through Amplify backend."

**Interpretation:** The app must not access DynamoDB, S3, or other AWS resources directly. Access through the `tour-data-api` (API Gateway HTTP API → Lambda → DynamoDB) satisfies this requirement since the API acts as the intermediary. Amplify Auth will be used for Cognito authentication to obtain JWT tokens.

---

## 2. Integration Architecture

### 2.1 High-Level Flow

```
Mobile/Web App
    ↓
[Amplify Auth (Cognito)]     ← Authentication, token management
    ↓ (JWT token)
[API Service Layer]           ← src/services/api/
    ↓ (HTTP calls with Bearer token)
[tour-data-api]               ← API Gateway HTTP API → Lambda → DynamoDB
```

### 2.2 Service Layer Design

The services layer follows the project structure defined in `docs/project-structure.md`:

```
src/services/
├── api/                    # API client (RESTful HTTP calls)
│   ├── apiClient.ts        # Base HTTP client with auth, error handling, retry
│   ├── tourApi.ts          # Tour endpoints
│   ├── riderApi.ts         # Rider endpoints
│   ├── rideApi.ts          # Ride endpoints
│   ├── checkInApi.ts       # Check-in endpoints
│   ├── dashboardApi.ts     # Dashboard endpoint
│   ├── userApi.ts          # User endpoints
│   └── mockData.ts         # Existing mock data (retained for development/testing)
├── database/               # SQLite for offline support
│   ├── database.ts         # Database initialisation, schema management
│   ├── riderStore.ts       # Rider data local storage
│   ├── rideStore.ts        # Ride data local storage
│   ├── checkInStore.ts     # Check-in data local storage
│   └── pendingStore.ts     # Pending sync queue storage
└── sync/                   # Data synchronisation
    └── syncService.ts      # Background sync logic
```

### 2.3 API Client (`apiClient.ts`)

Responsibilities:
- Base URL configuration from environment variables
- JWT token injection from Amplify Auth session
- Automatic token refresh on 401 responses
- Standardised error handling matching backend error format
- Request retry with exponential backoff (for network failures)
- Request/response logging (non-sensitive data only)

```typescript
// Conceptual interface
interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>>;
  post<T>(path: string, body: unknown): Promise<ApiResponse<T>>;
  put<T>(path: string, body: unknown): Promise<ApiResponse<T>>;
}
```

The client uses `fetch` (available in React Native) — no additional HTTP library needed.

### 2.4 Tour Context

A `tourId` is required for most API calls. This will be resolved once at app startup:

1. Call `GET /v1/tours/active` to get the current active tour
2. Store `tourId` in app context (React Context)
3. All subsequent API calls use this `tourId`

If no active tour exists, the app shows an appropriate message.

---

## 3. Data Model Alignment

### 3.1 Backend → Frontend Type Mapping

The frontend types in `src/types/models.ts` need updates to align with the backend data model.

#### New Types Needed

| Backend Entity | Frontend Type | Notes |
|---------------|--------------|-------|
| Tour (TourMaster) | `Tour` | New — needed for tour context |
| TourRider | `TourRider` | New — links riderId to profileId |

#### Updated Types

| Frontend Type | Changes Needed |
|--------------|---------------|
| `Rider` | Add `profileId`, `photoS3Key`; remove `qrCodeData` (moved to TourRider) |
| `Ride` | Add `rideNo`, `flagOffTime`, `description`; change status `IN_PROGRESS` → `ACTIVE` |
| `Stage` | Add `location` field |
| `CheckIn` | Replace `status` enum with `isNotRiding`/`isQuitRiding` boolean flags (status is derived); add `stageNumber`; `checkInId` format is `<riderId>#<stageNumber>#<timestamp>` |

#### Key Differences to Note

1. **Check-in status**: Backend does not store a `status` field. Status is derived from `isNotRiding` and `isQuitRiding` flags. The frontend `CheckInStatus` enum remains for UI purposes but the mapping function handles derivation.

2. **Ride status values**: Backend uses `ACTIVE` where frontend currently uses `IN_PROGRESS`. The frontend types should align with the backend (`PLANNED | ACTIVE | COMPLETED | CLOSED`).

3. **Rider ID format**: Backend uses `R1`, `R57` (no zero-padding). Frontend mock data uses `R001`, `R025` (3-digit padded). Frontend should align with backend format.

4. **Tour-scoping**: Backend API paths include `tourId` (e.g., `/v1/tours/{tourId}/rides`). The service layer abstracts this by using the active tour context.

### 3.2 API Response Mapping

The backend returns camelCase JSON (as stored in DynamoDB). The frontend types should use matching property names. Key response structures:

**Dashboard Response** (`GET /v1/tours/{tourId}/rides/{rideId}/dashboard`):
```json
{
  "success": true,
  "data": {
    "ride": { "rideId": "RIDE001", "stages": [...], ... },
    "riders": [
      {
        "riderId": "R1",
        "profileId": "uuid",
        "name": "John Doe",
        "phone": "+1-555-1234",
        "photoS3Key": "photos/R1.jpg",
        ...
      }
    ],
    "checkIns": [
      {
        "rideId": "RIDE001",
        "checkInId": "R1#001#2026-02-10T08:00:00Z",
        "riderId": "R1",
        "stageNumber": 1,
        "stageId": "S001",
        "isNotRiding": false,
        "isQuitRiding": false,
        "method": "QR_SCAN",
        "timestamp": "2026-02-10T08:00:00Z",
        "checkedInBy": "user-uuid"
      }
    ],
    "summary": {
      "totalRiders": 100,
      "checkedIn": 75,
      "notRiding": 5,
      "quitRiding": 2,
      "notCheckedIn": 18
    }
  },
  "timestamp": "2026-02-10T10:00:00Z"
}
```

**Check-in Request** (`POST /v1/tours/{tourId}/checkins`):
```json
{
  "riderId": "R57",
  "rideId": "RIDE001",
  "stageNumber": 2,
  "method": "QR_SCAN",
  "isNotRiding": false,
  "isQuitRiding": false,
  "notes": ""
}
```

---

## 4. Offline Support Design

### 4.1 Overview

Offline support is critical for Pit Stop Crew users at remote locations. The design uses SQLite (via `expo-sqlite`) as the local database for caching and offline check-in capture.

### 4.2 SQLite Schema

```sql
-- Tour context (single active tour cached)
CREATE TABLE IF NOT EXISTS tour (
  tourId TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  startDate TEXT,
  endDate TEXT,
  lastSyncedAt TEXT
);

-- Riders (cached from API - read only locally)
CREATE TABLE IF NOT EXISTS riders (
  riderId TEXT PRIMARY KEY,
  profileId TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  emergencyContactName TEXT,
  emergencyContactPhone TEXT,
  photoS3Key TEXT,
  qrCodeData TEXT,
  status TEXT,
  lastSyncedAt TEXT
);

-- Current ride (cached from API - read only locally)
CREATE TABLE IF NOT EXISTS rides (
  rideId TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  rideNo INTEGER,
  name TEXT,
  startLocation TEXT,
  finishLocation TEXT,
  totalDistance REAL,
  flagOffTime TEXT,
  status TEXT,
  stagesJson TEXT,  -- JSON serialized stages array
  description TEXT,
  startedAt TEXT,
  completedAt TEXT,
  closedAt TEXT,
  lastSyncedAt TEXT
);

-- Check-ins (cached from API + locally created)
CREATE TABLE IF NOT EXISTS check_ins (
  checkInId TEXT PRIMARY KEY,
  riderId TEXT NOT NULL,
  rideId TEXT NOT NULL,
  stageNumber INTEGER NOT NULL,
  stageId TEXT,
  timestamp TEXT NOT NULL,
  checkedInBy TEXT,
  method TEXT,
  isNotRiding INTEGER DEFAULT 0,
  isQuitRiding INTEGER DEFAULT 0,
  isManualEntry INTEGER DEFAULT 0,
  notes TEXT,
  locationLat REAL,
  locationLng REAL,
  isLocal INTEGER DEFAULT 0,  -- 1 if created locally (not yet synced)
  syncStatus TEXT DEFAULT 'SYNCED',  -- SYNCED | PENDING | SYNCING | FAILED
  syncError TEXT,
  syncRetryCount INTEGER DEFAULT 0,
  createdAt TEXT,
  lastSyncedAt TEXT
);

-- Pending operations queue (for offline writes)
CREATE TABLE IF NOT EXISTS pending_operations (
  localId TEXT PRIMARY KEY,
  operationType TEXT NOT NULL,  -- CHECK_IN
  payload TEXT NOT NULL,  -- JSON serialized request body
  createdAt TEXT NOT NULL,
  syncStatus TEXT DEFAULT 'PENDING',  -- PENDING | SYNCING | FAILED
  syncError TEXT,
  retryCount INTEGER DEFAULT 0,
  lastAttemptAt TEXT
);
```

### 4.2.1 Storage Estimation and Optimisation

**Estimated storage per active ride:**

| Table | Row Count (max) | Estimated Row Size | Total |
|-------|----------------:|-------------------:|------:|
| `tour` | 1 | ~200 bytes | ~200 B |
| `riders` | 100 | ~500 bytes | ~50 KB |
| `rides` | 1 (active) + 7 (history) | ~1 KB | ~8 KB |
| `check_ins` | 600 per ride × 8 rides | ~350 bytes | ~1.7 MB |
| `pending_operations` | 0–50 (transient) | ~500 bytes | ~25 KB |
| **Total** | | | **~1.8 MB** |

SQLite overhead (indexes, metadata) adds ~20%, bringing the total to approximately **2–3 MB** for a full tour's data. This is negligible on modern mobile devices (which typically have 64–256 GB storage).

**Optimisation strategies:**

1. **Purge completed ride data:** After a ride is `CLOSED` and the tour moves on, retain only the current and most recent ride's check-in data locally. Older ride data can be fetched on-demand from the API when viewing historical rides.
2. **SQLite VACUUM:** Run `VACUUM` periodically (e.g., on app startup or after purging data) to reclaim unused space.
3. **Avoid storing large blobs:** Photos are not stored locally — only S3 keys are cached. Photo images are fetched/cached separately via the standard image caching mechanism (e.g., `expo-image` cache).
4. **Index only necessary columns:** Primary keys and foreign keys (`riderId`, `rideId`, `stageNumber`) are indexed. No additional indexes unless query performance requires it.

### 4.3 Data Flow

#### Online Mode (Normal Operation)

1. **App Launch:**
   - Fetch active tour → store in context and SQLite
   - Fetch today's ride → cache in SQLite
   - Fetch riders → cache in SQLite
   - Fetch dashboard data (check-ins) → cache in SQLite

2. **Check-In:**
   - Write to local SQLite immediately (isLocal = 1, syncStatus = PENDING)
   - Simultaneously POST to backend API
   - On success: update SQLite record (isLocal = 0, syncStatus = SYNCED)
   - On failure: keep in pending queue for retry

3. **Dashboard Refresh:**
   - Fetch from API and update SQLite cache
   - Dashboard reads from SQLite (consistent data source)

#### Offline Mode (No Connectivity)

1. **Detection:** Use React Native's `@react-native-community/netinfo` library to detect connectivity changes. This library is **event-driven** — it subscribes to OS-level network state change callbacks, not polling. Battery impact is negligible since no periodic network checks are required. Display offline indicator on Dashboard when connectivity is lost.

   ```
   NetInfo.addEventListener(state => {
     // Fires only on actual connectivity changes (event-driven, not polled)
     // state.isConnected: boolean
     // state.isInternetReachable: boolean (optional deeper check)
   });
   ```

   When the app needs to **verify** connectivity before a critical operation (e.g., starting sync), a single lightweight HEAD request to the API health endpoint can confirm reachability. This is a one-off check, not a recurring poll.

2. **Check-In (Offline):**
   - Write to SQLite (isLocal = 1, syncStatus = PENDING)
   - Add to `pending_operations` queue
   - Dashboard shows locally recorded check-ins immediately

3. **Dashboard (Offline):**
   - Read from SQLite cache
   - For Pit Stop Crew: automatically switch to their assigned stage filter view
   - Show "Not Riding" statuses that were synced before going offline
   - Show "Quit Riding" statuses that were synced before going offline

4. **Coming Back Online:**
   - Detect connectivity restored (via NetInfo event)
   - **Sync processor acquires a mutex lock** — only one sync process runs at a time. If a sync is already in progress, the new connectivity event is ignored. This prevents race conditions where multiple sync attempts could process the same pending operations concurrently.
   - Process `pending_operations` queue **sequentially (FIFO, one at a time)**:
     - Set operation `syncStatus` to `SYNCING` before each API call
     - POST to API with the **original capture timestamp** from the pending operation
     - On success: mark as `SYNCED`, remove from queue
     - On conflict (409): apply conflict resolution rules (see §4.5)
     - On network error: mark as `PENDING` again, release mutex, wait for next connectivity event
     - On other error: retry with exponential backoff (max 5 retries), then mark as `FAILED`
   - **Race condition prevention:** The `syncStatus` column acts as an optimistic lock. Before processing, the sync service queries only `PENDING` operations and atomically updates them to `SYNCING`. If the app is restarted mid-sync, any `SYNCING` records are reset to `PENDING` on startup.
   - After queue is fully processed: full dashboard refresh from API to reconcile local state with backend

### 4.4 Dashboard Refresh Strategy

The refresh strategy must balance **live data visibility** (organising team needs real-time check-in status) with **battery and data usage optimisation** (pit stop crew at remote locations). An adaptive approach is used:

#### Adaptive Refresh Intervals

| Context | Interval | Rationale |
|---------|----------|-----------|
| **Dashboard active, online, ride in progress** | **5 seconds** | Organising team at ride start/finish needs near-real-time visibility. 5-second interval keeps the dashboard live with minimal perceived delay. |
| **Dashboard active, online, no active ride** | 60 seconds | Lower urgency — ride hasn't started or is completed. |
| **App backgrounded** | **Paused** | No polling when the app is not visible. Resume on foreground. This is critical for battery conservation. |
| **Offline** | **Paused** | No API calls. Dashboard reads from SQLite cache. |

#### Battery and Data Usage Impact

- **5-second polling (active ride):** Each dashboard request is ~50-80 KB. At 5-second intervals, this is ~600-960 KB/minute. During a typical ride (4-6 hours), a continuously active dashboard would use ~150-350 MB. However, in practice:
  - Dashboard screen is not continuously active for 6 hours — users switch between screens, lock the phone, etc.
  - **Conditional requests** (`If-None-Match` / ETag) reduce payload to near-zero when data hasn't changed. The server returns `304 Not Modified` with no body.
  - With ETags, actual data transfer during quiet periods drops to ~1 KB per request (headers only).
- **Battery:** HTTP requests over an existing connection are lightweight. The primary battery drain is the radio staying active. Grouping requests (single dashboard call vs multiple endpoints) and pausing when backgrounded keeps battery impact low.

> **Note:** If 5-second polling proves insufficient for the ride start scenario (where all organisers need truly instantaneous updates), a WebSocket-based push mechanism can be evaluated as a backend enhancement. However, the current API Gateway HTTP API does not support WebSocket — this would require either an API Gateway WebSocket API or a separate service. This is flagged as a **potential future enhancement** if 5-second polling is not acceptable.

#### Pre-Sync for Offline Readiness

Per requirements, "Not Riding" and "Quit Riding" data captured before a pit stop stage should be available locally. This is handled by:

1. **On app launch / when online:** Fetch and cache the complete dashboard data in SQLite
2. **Adaptive refresh while online:** Dashboard polling (per above intervals) keeps the SQLite cache updated with the latest "Not Riding" and "Quit Riding" statuses
3. **Before going to pit stop:** Pit stop crew should have the app open with a recent sync. The 5-second refresh ensures the cache is current when connectivity is lost
4. **Manual refresh:** A pull-to-refresh gesture is available on the dashboard for on-demand data sync

### 4.5 Conflict Resolution

#### Design Principle: Timestamp-Based Validity

Offline check-ins are **captured at a point in time** and carry their original `timestamp`. A check-in that was valid when captured does not become invalid simply because it is synced later. The sync process sends the original capture timestamp, and conflict resolution must respect the **time sequence** of events.

#### Scenario: PS1 Offline, PS2 Online (Cross-Stage Sync)

Consider:
1. Rider R1 checks in at PS1 (stage 1) — PS1 crew is **offline**. Check-in recorded locally with timestamp `T1`.
2. Rider R1 continues to PS2 (stage 2) — PS2 crew is **online**. Check-in recorded and synced immediately at timestamp `T2 > T1`.
3. At PS2, rider R1 decides to quit riding. Quit-riding recorded and synced at `T3 > T2`.
4. Later, PS1 crew regains connectivity and syncs their pending operations.

**Resolution:** The PS1 check-in (stage 1, timestamp `T1`) is **valid** — it happened before the rider quit at PS2. The check-in payload sent to the backend includes the original `timestamp` (`T1`). The backend should accept this because:
- The `checkInId` format is `<riderId>#<stageNumber>#<timestamp>` — this is a **unique record** (stage 1 ≠ stage 2).
- The check-in timestamp `T1` predates the quit-riding timestamp `T3`.

**If the backend rejects** (409) because the rider's current status is `QUIT_RIDING`, the sync service marks this with a specific conflict type `TIMESTAMP_PRECEDES_QUIT` and presents it to the user with context: _"Check-in for R1 at Stage 1 was captured at T1, before the rider quit at T3. This may require manual resolution."_ The organising team can then decide whether to request backend reconciliation.

> **Backend consideration:** It is recommended that the backend `tour-data-api` validates check-in requests by comparing the check-in `timestamp` against the quit/not-riding timestamp, not just the rider's current status. This would allow legitimate pre-quit check-ins to succeed without manual intervention. This should be raised as a change request with the backend team if not already supported.

#### Scenario: Ride CLOSED with Valid Offline Check-Ins

A ride may be closed by an administrator while pit stop crew at a remote location still have pending offline check-ins. These check-ins were captured **while the ride was active** and are valid data — they cannot be discarded.

**Resolution:**
1. Each pending check-in carries its original capture `timestamp`.
2. When syncing, if the backend returns 409 because the ride is `CLOSED`, the sync service checks whether the check-in `timestamp` is **before** the ride's `closedAt` time.
3. If `check-in timestamp < ride closedAt`:
   - Mark as conflict type `RIDE_CLOSED_BUT_VALID`.
   - Show notification: _"Check-in for R1 at Stage X was captured at T1, before the ride was closed at T_close."_
   - The organising team can request backend reconciliation (e.g., a dedicated admin endpoint to accept late-synced check-ins).
4. If `check-in timestamp ≥ ride closedAt`:
   - Mark as `FAILED` — this check-in genuinely occurred after ride closure.

> **Backend consideration:** A dedicated endpoint (e.g., `POST /v1/tours/{tourId}/checkins/late-sync`) or a flag on the existing check-in endpoint (`allowLateSyncBeforeClose: true`) would allow the frontend to submit check-ins captured before ride closure. This avoids manual intervention for a common offline scenario.

#### Conflict Resolution Summary

| Scenario | Resolution | Retry? |
|----------|-----------|--------|
| Offline check-in syncs successfully | Normal — mark as `SYNCED` | No |
| Duplicate check-in (409: same rider+stage+time) | Mark `FAILED`, notify user, discard | No |
| Rider quit after check-in was captured (409) | Compare timestamps: if check-in `T` < quit `T`, mark `TIMESTAMP_PRECEDES_QUIT`, notify organiser for resolution | No (manual) |
| Rider quit before check-in was captured (409) | Mark `FAILED`, notify user — check-in is genuinely invalid | No |
| Ride CLOSED, check-in captured before closure (409) | Mark `RIDE_CLOSED_BUT_VALID`, notify organiser for late-sync resolution | No (manual) |
| Ride CLOSED, check-in captured after closure (409) | Mark `FAILED`, notify user | No |
| Network error (timeout, no connection) | Retry with exponential backoff (2s → 4s → 8s → 16s → 32s), max 5 retries | Yes |
| Server error (500) | Retry with exponential backoff, max 3 retries | Yes |
| Authentication error (401) | Refresh JWT token via Amplify Auth, retry once | Yes (once) |

---

## 5. Environment Configuration

The `.env` file needs the following additions:

```
# Tour Data API
TOUR_DATA_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/v1

# AWS Cognito (for JWT authentication)
AWS_REGION=<region>
AWS_USER_POOL_ID=<user-pool-id>
AWS_USER_POOL_WEB_CLIENT_ID=<client-id>
AWS_IDENTITY_POOL_ID=<identity-pool-id>
```

These values are provided by the `tour-data-api` deployment. The Cognito User Pool is shared between the backend and the frontend app.

---

## 6. Implementation Phases

### Phase 1: Core API Integration
1. API client with authentication (`apiClient.ts`)
2. Tour context (active tour resolution)
3. Dashboard API integration (replace mock data)
4. Rider API integration
5. Ride API integration
6. Check-in API integration

### Phase 2: Offline Support
1. SQLite database setup and schema
2. Data caching layer (riders, rides, check-ins)
3. Offline check-in capture
4. Connectivity detection and indicator
5. Pending operations queue

### Phase 3: Sync Service
1. Background sync for pending operations
2. Conflict resolution
3. Full dashboard reconciliation on reconnect
4. Periodic refresh while online

### Phase 4: User/Auth Integration
1. Amplify Auth configuration
2. Login/logout flow
3. User profile and role resolution
4. RBAC enforcement in UI

---

## 7. Security Considerations

1. **JWT tokens** are managed by Amplify Auth SDK — no manual token storage needed
2. **No AWS credentials** in the app — all access through API with JWT authentication
3. **SQLite data** is stored in the app's sandboxed storage (OS-level protection)
4. **Sensitive data** (tokens, credentials) stored via `expo-secure-store`
5. **API base URL** configured via environment variables, not hardcoded
6. **HTTPS only** for all API communication

---

## 8. Open Questions and Decisions

### 8.1 Resolved

1. **Tour selection:** Currently assumes a single active tour per organisation. This is confirmed as the current use case. A TODO issue should be created for handling concurrent multiple active tours as a future enhancement.

2. **Multi-stage pit stop crew offline:** When a pit stop crew user is assigned to multiple stages, the app will provide a **stage context selector** allowing the user to choose which stage is their active context for the dashboard. This avoids confusion since the pit stop crew's main objective is the currently active pit stop. The selector will be prominent in the dashboard header when the user has multiple stage assignments.

### 8.2 Photo URL Resolution

Backend stores S3 keys (`photoS3Key`) for rider photos. Two options for resolving these to accessible URLs:

| Aspect | Pre-Signed URLs (API Endpoint) | CloudFront Distribution |
|--------|-------------------------------|------------------------|
| **How it works** | A dedicated API endpoint (e.g., `GET /v1/photos/{key}`) returns a pre-signed S3 URL valid for a limited time (e.g., 15 minutes) | A CloudFront distribution serves photos from the S3 bucket via CDN edge locations |
| **Security** | ✅ Fine-grained: URLs are scoped to the requesting user's JWT session. Expired URLs cannot be reused | ⚠️ Requires signed URLs or signed cookies for access control. Without signing, photos are publicly accessible via the CDN |
| **Performance** | ⚠️ Extra API call per photo (or batch endpoint). Pre-signed URLs require a Lambda invocation | ✅ Excellent: CDN caching means photos are served from the nearest edge location. No Lambda involved after first request |
| **Mobile caching** | ⚠️ URL changes on each sign → image cache may not recognise the same photo. Requires custom cache key mapping | ✅ Stable URLs → standard image caching works out of the box (`expo-image` cache) |
| **Offline support** | ⚠️ Pre-signed URLs expire — cached images with expired URLs need re-signing when back online | ✅ Cached images remain valid (URL doesn't change) |
| **Cost** | Lambda invocation per URL generation (~$0.20 per 1M requests). Minimal for ~100 riders | CloudFront: ~$0.085/GB data transfer. For ~100 rider photos (~50 KB each = 5 MB total), cost is negligible. Monthly: <$1 |
| **Setup complexity** | Low — add one Lambda function to existing API | Medium — requires CloudFront distribution creation, S3 bucket policy, and optionally CloudFront signed URL configuration |
| **Recommendation** | Good for prototyping / if photos are sensitive | **Recommended** — better performance, simpler caching, stable URLs, negligible cost |

**Recommendation:** Use a **CloudFront distribution** with the S3 bucket as origin. For this use case (~100 rider photos, non-sensitive profile images), the performance, caching, and offline benefits outweigh the one-time setup effort. If access control is required beyond the tour participants, CloudFront signed URLs can be added later.

> **Decision needed:** Confirm CloudFront approach, or specify if pre-signed URLs are preferred for security reasons.

### 8.3 Dashboard Refresh: Live vs Efficient

**Decision:** Use adaptive polling with 5-second intervals during active rides (see §4.4 for full strategy). If 5-second latency is not acceptable for the ride start scenario, a WebSocket-based push mechanism can be evaluated as a backend enhancement.

> **Decision needed:** Is 5-second polling acceptable for ride start? If not, a WebSocket enhancement to the backend should be scoped.
