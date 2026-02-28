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

1. **Detection:** Use React Native's `NetInfo` API to detect connectivity changes. Display offline indicator on Dashboard.

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
   - Detect connectivity restored
   - Process `pending_operations` queue sequentially (FIFO)
   - For each pending check-in: POST to API
     - On success: mark as SYNCED, remove from queue
     - On conflict (409): mark as FAILED with error (e.g., rider already quit)
     - On other error: retry with exponential backoff (max 5 retries)
   - After queue is processed: full dashboard refresh from API to reconcile state

### 4.4 Pre-Sync Strategy for Offline Readiness

Per requirements, "Not Riding" and "Quit Riding" data captured before a pit stop stage should be available locally. This is handled by:

1. **On app launch / when online:** Fetch and cache the complete dashboard data in SQLite
2. **Periodic refresh:** While online, periodically refresh check-in data (e.g., every 30 seconds for active ride)
3. **Before going to pit stop:** Pit stop crew should have the app open with a recent sync so "Not Riding" records are available locally

This ensures the SQLite cache has the latest "Not Riding" and "Quit Riding" statuses when connectivity is lost.

### 4.5 Conflict Resolution

Since check-ins are append-only (no updates) and business rules prevent duplicates, conflicts are minimal:

| Scenario | Resolution |
|----------|-----------|
| Offline check-in succeeds when synced | Normal — mark as SYNCED |
| Duplicate check-in (409 Conflict) | Mark as FAILED, show user notification, do not retry |
| Rider already quit (409 Conflict) | Mark as FAILED, show user notification, do not retry |
| Ride closed (409 Conflict) | Mark as FAILED, show user notification, do not retry |
| Network error | Retry with exponential backoff (max 5 retries) |

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

## 8. Open Questions

1. **Tour selection:** Currently assumes a single active tour. If multiple tours could be active simultaneously, a tour selection UI would be needed.
2. **Photo URLs:** Backend stores S3 keys (`photoS3Key`). How should the app resolve these to accessible URLs? Options: pre-signed URLs from a dedicated endpoint, or CloudFront distribution.
3. **Periodic refresh interval:** Recommended 30 seconds for active ride dashboard. Is this acceptable for data usage?
4. **Multi-stage pit stop crew offline:** Per Requirements.md TODO — if a pit stop crew user is assigned to multiple stages, which stage filter should be used in offline mode? Suggestion: show all assigned stages.
