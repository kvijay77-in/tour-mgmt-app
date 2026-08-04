# Solution Design

[← Back to README](../README.md)

This document covers the solution design aspects of the Check-In App that must be adhered to at all times. If there is any conflict between the copilot-instructions.md and this document, it must be flagged for resolution.

This is an evolving document and hence latest info must be referred to at all times.

> **Note on the initial ToT release build.**
> The design in this document covers a **generic** Check-In App capable of
> serving multiple organizers via a runtime OrgConfig delivered as a
> signed setup link or QR code (see [App Distribution — Runtime
> Configuration](#app-distribution--runtime-configuration-single-app-multiple-organizers)).
>
> The **first APK release is intentionally tied to the Tour of Trails
> (ToT) AWS subscription only.** Cognito IDs and the tour-data-api base
> URL are baked into the APK at build time via `EXPO_PUBLIC_*` environment
> variables (stored as EAS project secrets). The setup deep link / QR
> flow and HMAC signing key are therefore **not exercised** by this build
> — the existing dev-mode env-var fallback in `App.tsx` (which
> short-circuits `OrgSetupScreen` when both `EXPO_PUBLIC_AWS_USER_POOL_ID`
> and `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` are present) is used instead.
>
> The generic distribution design remains valid and unchanged for future
> multi-organizer releases; the ToT build is a specialisation, not a
> replacement. See [docs/release-guide.md](./release-guide.md) for the
> concrete APK build and distribution procedure.

## Table of Contents

- [Design Principles](#design-principles)
- [Technology Stack](#technology-stack)
- [Application Architecture](#application-architecture)
- [Component Architecture](#component-architecture)
- [State Management](#state-management)
- [Authentication](#authentication)
- [Backend Integration](#backend-integration)
- [ID Code Scan Resolution](#id-code-scan-resolution)
- [Offline Architecture](#offline-architecture)
- [Navigation Structure](#navigation-structure)
- [Styling Strategy](#styling-strategy)
- [Logging](#logging)
- [Platform Considerations](#platform-considerations)
- [App Distribution — Runtime Configuration](#app-distribution--runtime-configuration-single-app-multiple-organizers)

---

## Design Principles

1. **Common codebase** — App should have a single codebase to cater for Android, iOS, and Web App versions.
   - Any exception to have platform-specific code when common code is feasible must be flagged for review before proceeding with development.

2. **No direct AWS resource access** — Any direct access to AWS resources (DynamoDB, S3, etc.) from the Mobile App or Web client must not be permitted. Such access must always be through the tour-data-api backend (API Gateway → Lambda → DynamoDB).

3. **Amplify for authentication only** — AWS Amplify Auth SDK is used for Cognito authentication and JWT token management. Data access is via the RESTful tour-data-api, not Amplify Data/AppSync.

4. **SQLite for offline check-in and sync durability** — Local SQLite is the durable store for offline-capable check-in capture and pending sync operations. Dashboard Phase 3+4 uses split API orchestration for online reads (ride list + rider roster + dashboard progress) plus targeted refresh controls and local check-in event updates, while maintaining offline-safe check-in behavior.

5. **Offline-first for check-ins** — All check-in operations write to SQLite first, then asynchronously sync to the backend. There is no separate "online" vs "offline" code path for check-ins, except the Start-stage Override/Cancel flow, which is intentionally online-only.

6. **Security by default** — No hardcoded credentials, no inline sensitive data, JWT-based authentication for all API calls, RBAC enforcement in the UI layer.

7. **Reactive UI** — Use React Context and Hooks for state management. No class components. Minimize re-renders through proper state structuring and memoization.

8. **Modular and reusable** — Components should be small, focused, and reusable. Business logic should be isolated in the services layer, not embedded in UI components.

9. **Safe-area first layout for edge-to-edge Android** — Android edge-to-edge is enforced on modern SDK levels, so all top-anchored headers must respect top safe area insets and all bottom-anchored UI (tab bars, footers, fixed action rows) must apply bottom safe area padding. Avoid hardcoded status-bar spacing values such as fixed `paddingTop` for screen headers.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Framework** | React Native | 0.81.x | Cross-platform mobile |
| **Platform Tooling** | Expo (managed workflow) | SDK 54 | Build, deploy, native APIs |
| **Language** | TypeScript | ~5.x | Type safety |
| **Navigation** | React Navigation | 7.x | Screen navigation (native stack only — no bottom tabs, no drawer) |
| **Authentication** | AWS Amplify Auth | 6.x | Cognito integration, JWT management |
| **HTTP Client** | fetch (built-in) | N/A | API calls to tour-data-api |
| **Local Database** | expo-sqlite | 16.x | SQLite for offline and caching |
| **QR Scanning** | expo-camera + expo-barcode-scanner | 17.x / 13.x | Camera-based QR code scanning |
| **Connectivity** | @react-native-community/netinfo | 12.x | Network state detection |
| **Secure Storage** | expo-secure-store | 15.x | Sensitive data storage (tokens) |
| **Icons** | @expo/vector-icons | 15.x | UI icons |
| **SVG** | react-native-svg | 15.x | Custom SVG rendering |

### Why These Choices

- **Expo managed workflow**: Simplifies build and deployment across platforms. No need to eject for native modules — all required features are available via Expo SDK.
- **fetch over axios/other HTTP libraries**: Built into React Native, reduces bundle size. The apiClient wrapper adds retry, auth, and error handling.
- **SQLite over AsyncStorage**: Structured relational storage is required for offline check-in capture, pending operation queueing, and sync-safe conflict handling. AsyncStorage is key-value only and insufficient for these workflows.
- **React Context over Redux/MobX**: Application state is straightforward (active tour, auth state, offline mode, role). Context + Hooks provides sufficient state management without additional dependencies.

---

## Application Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    App.tsx (Entry Point)                  │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Context Providers                       │ │
│  │  AuthContext → TourContext → OfflineContext → Role   │ │
│  │                                                      │ │
│  │  ┌───────────────────────────────────────────────┐  │ │
│  │  │            Navigation (React Navigation)       │  │ │
│  │  │                                                │  │ │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐      │  │ │
│  │  │  │Dashboard │ │ Check-In │ │  Admin   │      │  │ │
│  │  │  │ Screen   │ │  Screen  │ │  Screen  │      │  │ │
│  │  │  └────┬─────┘ └────┬─────┘ └────┬─────┘      │  │ │
│  │  │       │             │             │            │  │ │
│  │  └───────┼─────────────┼─────────────┼────────────┘  │ │
│  └──────────┼─────────────┼─────────────┼───────────────┘ │
│             │             │             │                  │
│  ┌──────────┴─────────────┴─────────────┴───────────────┐ │
│  │                 Services Layer                        │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │ │
│  │  │ API      │  │ Database │  │  Sync    │           │ │
│  │  │ Client   │  │ (SQLite) │  │ Service  │           │ │
│  │  └────┬─────┘  └──────────┘  └────┬─────┘           │ │
│  └───────┼────────────────────────────┼─────────────────┘ │
└──────────┼────────────────────────────┼───────────────────┘
           │                            │
           ▼                            ▼
    ┌──────────────┐            ┌──────────────┐
    │  tour-data-  │            │  tour-data-  │
    │  api (REST)  │            │  api (REST)  │
    └──────────────┘            └──────────────┘
```

### Layer Responsibilities

| Layer | Path | Responsibility |
|-------|------|---------------|
| **Screens** | `src/screens/` | Page-level components, layout, screen-specific logic |
| **Components** | `src/components/` | Reusable UI components, presentational logic |
| **Context** | `src/context/` | Global state management (auth, tour, offline, role) |
| **Services** | `src/services/` | Business logic, API calls, database, sync |
| **Types** | `src/types/` | TypeScript type definitions and interfaces |
| **Constants** | `src/constants/` | Application-wide constants (colors, roles, stages) |
| **Hooks** | `src/hooks/` | Custom React hooks for reusable stateful logic |
| **Utils** | `src/utils/` | Pure utility functions (formatting, validation, permissions) |
| **Config** | `src/config/` | Configuration (Amplify, database) |

---

## Component Architecture

### Screen Components

Screens are the top-level components rendered by the navigator. Each screen:
- Lives in its own folder under `src/screens/`
- May compose multiple smaller components
- Connects to context providers for global state
- Handles screen-level navigation logic

```
src/screens/
├── dashboard/
│   ├── DashboardScreen.tsx      # Main dashboard with rider grid
│   └── RideInfoScreen.tsx       # Shared ride-info modal host screen
├── checkin/                      # QR scanning, check-in flow
├── admin/                        # Administrator-only management screens
│   ├── RideStatusManagementScreen.tsx
│   ├── UserOnboardingScreen.tsx
│   ├── UserEnableDisableScreen.tsx
│   └── UserModifyScreen.tsx
└── auth/                         # Login, authentication screens
```

### Reusable Components

Components are organized by scope — common components used across screens, and feature-specific components:

```
src/components/
├── common/                       # Shared across all screens
│   └── SortIcon.tsx             # Custom sort toggle icon
├── dashboard/                    # Dashboard-specific components
│   └── RideInfoContent.tsx      # Reusable ride-info content UI
└── checkin/                      # Check-in-specific components
```

### Component Guidelines

1. **Functional components only** — use hooks for state and effects
2. **Props over context** where possible — prefer explicit data flow
3. **Memoize expensive renders** — use `React.memo`, `useMemo`, `useCallback` appropriately
4. **Separate concerns** — keep styling in `StyleSheet.create()`, logic in hooks/services
5. **Type all props** — define TypeScript interfaces for component props

---

## State Management

### Context Providers

The app uses React Context for global state, structured in a provider hierarchy:

| Context | Purpose | Key State |
|---------|---------|-----------|
| **AuthContext** | Authentication state | User info, JWT tokens, login/logout |
| **TourContext** | Active tour context | `tourId`, tour details, resolved at startup |
| **OfflineContext** | Offline mode state | Manual toggle, connectivity status, effective mode |
| **RoleContext** | RBAC role context | User role, permissions, feature-level access |

**Provider Order** (in `App.tsx`):
```
AuthContext
  → TourContext (depends on auth for API calls)
    → OfflineContext (independent but nested for access)
      → RoleContext (depends on auth for user role)
        → Navigation
```

### Local State

Screen-specific and component-specific state uses `useState` and `useReducer` hooks. Examples:
- Dashboard: current sort mode, active stage filter, zoom level
- Check-in: scan mode, selected check-in type, scan results
- Admin: form state for ride creation/modification

### Derived State

State that can be computed from other state should not be stored separately. Examples:
- Check-in status (derived from `isNotRiding` / `isQuitRiding` flags)
- Stage counts (derived from check-in data)
- Filtered/sorted rider lists (derived from riders + check-ins + filter/sort state)

---

## Authentication

### Flow

1. User opens app → `AuthContext` checks for existing Amplify session
2. If no session → navigate to login screen
3. User authenticates via `Amplify.Auth.signIn()` → Cognito returns JWT tokens
4. `AuthContext` stores auth state and provides it to child components
5. `TourContext` resolves active tour using authenticated API calls
6. Navigation routes user to Dashboard

### Token Management

- **Automatic refresh**: Amplify Auth SDK handles JWT token refresh transparently
- **Token injection**: `apiClient.ts` retrieves the current token from Amplify session and includes it as `Authorization: Bearer <token>` in every API request
- **401 handling**: If the API returns 401, the API client attempts token refresh and retries once
- **Secure storage**: Amplify uses `expo-secure-store` for token persistence

### Cognito Integration

The app uses the **same Cognito User Pool** as the tour-data-api backend. Configuration is provided via environment variables:

```typescript
// src/config/amplify.ts
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.EXPO_PUBLIC_AWS_USER_POOL_ID,
      userPoolClientId: process.env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID,
      identityPoolId: process.env.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID,
    },
  },
});
```

> **Note**: All environment variables must use the `EXPO_PUBLIC_` prefix. This is an Expo requirement — Metro only bundles variables with this prefix. See [Development Guide → Environment Configuration](development-guide.md#environment-configuration) for details.

### Google Play Review Account Routing

A single production build is published to Google Play, but Google requires a
full-access `ADMINISTRATOR` account for app review. To keep production data
isolated from the reviewer, one env-configured username (`EXPO_PUBLIC_REVIEW_USERNAME`)
is routed to a separate **Dev** backend — its own Cognito User Pool, App Client,
Identity Pool, and tour-data-api — configured via the `EXPO_PUBLIC_REVIEW_*`
variables. The reviewer account exists only in the Dev pool.

- The routing decision is made at **login time** (`src/config/reviewAccess.ts`),
  because the username is only known when the user signs in, before `signIn()`.
- The primary (production) backend is applied once at startup and is the default,
  so real-user logins incur **no reconfiguration**. The backend is only switched
  on an actual transition to/from review mode, tracked internally.
- With `EXPO_PUBLIC_REVIEW_USERNAME` unset the switch is disabled (fail-safe), and
  no non-reviewer username can reach the Dev backend.
- See [Release Guide → §3.1.1](release-guide.md#311-google-play-review-account-dev-backend-routing).

### Role Resolution from Cognito Groups

- The app resolves roles directly from `cognito:groups` in the ID token.
- Supported groups include static roles (`ADMINISTRATOR`, `SUPER_USER`, `HOTEL_STAFF`, `GUEST`) and dynamic pit-stop roles in the format `PS_<stageNumber>_USER`.
- Effective role precedence is: `ADMINISTRATOR` > `SUPER_USER` > `PS_x_USER` > `HOTEL_STAFF` > `GUEST`.
- When a user has multiple `PS_x_USER` groups, all mapped pit-stop stages are considered for regular check-in authorization.
- Pit-stop context selection is persisted locally and revalidated against the currently loaded ride; invalid context is automatically cleared and the user is informed.

---

## Backend Integration

### API Service Layer

All communication with the tour-data-api is through the service layer at `src/services/api/`:

| File | Endpoints | Description |
|------|-----------|-------------|
| `apiClient.ts` | — | Base HTTP client with auth, retry, error handling |
| `tourApi.ts` | `GET /v1/tours/active`, `GET /v1/tours` | Tour resolution and listing |
| `riderApi.ts` | `GET /v1/tours/{tourId}/riders`, `GET /v1/tours/{tourId}/rides/{rideId}/riders/{riderId}/details` | Rider roster and on-demand rider popup data |
| `rideApi.ts` | `GET /v1/tours/{tourId}/rides/today`, `POST /v1/tours/{tourId}/rides/open`, `POST /v1/tours/{tourId}/rides/start`, `POST /v1/tours/{tourId}/rides/{rideId}/close`, `POST /v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/open`, `POST /v1/tours/{tourId}/rides/{rideId}/stages/{stageNumber}/pitstop/close`, CRUD | Ride management, status transitions, and pit-stop runtime state updates |
| `checkInApi.ts` | `POST /v1/tours/{tourId}/checkins`, GET | Check-in operations |
| `dashboardApi.ts` | `GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress` | Lightweight dashboard progress data (`checkIns` + `summary`) |

Administrator user-management flows use `src/services/auth/cognitoUserManagementService.ts` and standard Cognito Identity Provider APIs for:
- Cognito group listing for role selection
- User listing with group membership resolution
- User creation with role assignment
- User enable/disable
- User attribute updates

### API Client Features

- **Base URL**: Configured from environment variable (`TOUR_DATA_API_BASE_URL`)
- **Authentication**: JWT token injected from Amplify Auth session
- **Auto-retry**: Exponential backoff for network failures (3 retries)
- **Token refresh**: Automatic on 401 responses (retry once)
- **Error standardization**: Backend errors mapped to consistent frontend error types
- **Logging**: Structured, level-gated logging via the app logger (see [Logging](#logging))

### Data Flow: API Split-Load + Offline Queue

Implemented Dashboard Phase 3 flow:
1. API client fetches ride list and active ride metadata from ride APIs
2. API client fetches tour rider roster from rider API
3. API client fetches ride progress from `/dashboard/progress` (`checkIns` + `summary`)
4. Dashboard screen composes UI status from ride + rider roster + progress check-ins
5. Rider popup fetches rider details and timeline on demand via rider-details endpoint

Implemented storage/privacy behavior:
1. Rider popup details are held in memory only for the current modal session
2. Rider popup details are not persisted to SQLite or SecureStore in the default path
3. Offline rider-profile cache remains a future enhancement behind a disabled flag placeholder

Offline-capable check-ins still use SQLite-first durable writes and pending queue sync. For detailed design, see [Data Integration Design](DataIntegrationDesign.md).

Implemented Dashboard Phase 4 behavior:
1. Returning from Check-In does not force full dashboard reload; dashboard state is updated from check-in success event payload.
2. Dashboard server refresh is targeted to explicit triggers (manual refresh, explicit ride switch) and stale-session recovery.
3. Fetch orchestrator has in-flight guards to avoid concurrent duplicate bootstrap/progress requests.
4. Initial dashboard load removes redundant ride-resolution overlap by using ride-list response as the today-ride decision source.

### Backend Change Request: `checkedInByName`

- Problem: the Dashboard `checkIns` payload currently provides `checkedInBy` as a Cognito username which non-admin clients cannot map to a display name.
- Preferred fix: server should include an optional `checkedInByName` string on CheckIn payloads returned by `GET /v1/tours/{tourId}/rides/{rideId}/dashboard/progress` and on check-in creation responses where available. Clients will fallback to `"Not Available"` when the field is absent.
- Alternative: expose a minimal read-only endpoint `GET /v1/tours/{tourId}/users?fields=cognitoUserName,displayName` restricted to check-in roles.

See [docs/dashboard-backend-api-change-request.md](dashboard-backend-api-change-request.md) for a formal request and implementation guidance.

---

## ID Code Scan Resolution

Production QR scan flow resolves Rider ID in-app using config + local mapping.

### Flow

1. Scan raw QR text.
2. Load active ID format config (SUBSTRING or REGEX).
3. Extract 5-character ID Code from raw text.
4. Split ID Code into:
  - typeCode (position 1)
  - personalCode (positions 2 to 5)
5. Resolve typeCode through ID_CODE_TYPE config.
6. Validate type is RIDER.
7. Resolve personalCode to tour Rider ID using local SQLite mapping.
8. Validate rider registration status from rider API using resolved Rider ID.
9. Continue existing check-in flow only when rider status is `REGISTERED` or `ACTIVE`.

If validation fails:
- Non-RIDER type must be blocked with message: Invalid ID type. Only Rider ID allowed.
- Unparseable payload must be treated as invalid QR input.
- Missing personalCode mapping must fail fast with no network retry lookup.
- Rider status other than `REGISTERED` or `ACTIVE` must be blocked with message: Check-in not allowed for rider with status <STATUS>.

Manual entry validation order:
1. Manual entry uses Rider ID directly (no ID Code parsing).
2. Validate rider registration status first.
3. Continue only when status is `REGISTERED` or `ACTIVE`.

Check-in type selection includes `regular`, `not_riding`, `quit_riding`, and `float`. Float is a Start-only check-in type that is available only when the ride status is `OPEN`; it always submits against the Start stage and participates in the same online-only Start-stage Override or Cancel flow as regular Start and Not Riding, making those three Start decisions mutually exclusive.

### Post-sign-in bootstrap

After sign-in, app loads and persists:
- ID_CODE_FORMAT config
- ID_CODE_TYPE config
- rider personalCode to Rider ID mapping from rider names payload

Bootstrap is best-effort and non-blocking:
- If config API is unavailable, app uses built-in default SUBSTRING config and default type map.
- Rider mapping still depends on names payload containing personalCode.

### Environment behavior

- Default mode (unset or false): production ID Code parsing.
- Dev override mode (true): EXPO_PUBLIC_QR_DEV_FORMAT=true uses legacy development QR parsing.

This toggle exists only for controlled development/testing compatibility.
---

## Offline Architecture

### Design Principles

1. **SQLite is the durable source for offline check-in and sync queue**
2. **Same write path online and offline** — check-ins always go to SQLite first, then sync
3. **Manual + automatic offline control** — users can toggle offline mode; NetInfo detects automatically

Float check-ins persist `isFloat` and `floatNo` locally in SQLite alongside the existing `isNotRiding` and `isQuitRiding` flags so offline capture and later sync preserve the Start-stage decision. The literal backend `status` string for Float remains API-only and is not stored in SQLite, matching the existing approach where cancelled-record status metadata is handled outside local durable storage.
4. **Conflict resolution is automatic** — no manual intervention needed (see [Data Integration Design § 4.5](DataIntegrationDesign.md#45-conflict-resolution))

The Start-stage Override/Cancel flow is excluded from offline handling. It is expected to occur at ride start where network coverage is available, so the UI must submit it live and avoid queueing it for deferred sync.

### SQLite Schema Overview

| Table | Purpose | Data Source |
|-------|---------|-------------|
| `tour` | Active tour context | Cached from API |
| `riders` | Rider profiles | Cached from API (read-only locally) |
| `rides` | Ride details and stages | Cached from API (read-only locally) |
| `check_ins` | Check-in records | API cache + local check-ins |
| `pending_operations` | Sync queue | Locally created, processed by sync service |

For complete schema and storage estimates, see [Data Integration Design § 4.2](DataIntegrationDesign.md#42-sqlite-schema).

### Sync Service

Two independent processes:
- **Outbound sync**: Processes `pending_operations` queue → POST to tour-data-api → update status
- **Inbound sync (offline-readiness path)**: Refreshes locally cached ride/rider/check-in datasets when enabled for offline scenarios

Both pause when offline (manual toggle or auto-detected) and resume when connectivity is restored.

For detailed sync flow, conflict resolution, and refresh strategy, see [Data Integration Design § 4](DataIntegrationDesign.md#4-offline-support-design).

---

## Navigation Structure

> Implemented via a phased SPA→multi-screen migration. See
> `/memories/repo/spa-to-multiscreen-migration-plan.md` (repo memory) for the
> phase-by-phase implementation log. No bottom tabs and no drawer navigator
> are used — the app is a single native-stack per auth state, with a custom
> slide-in menu component for account/admin actions.

### Navigation Hierarchy

```
App.tsx (GestureHandlerRootView > SafeAreaProvider > ErrorBoundary
          > AuthProvider > NavigationContainer)
└── RootNavigator                         # src/navigation/RootNavigator.tsx
    ├── (loading)  → spinner
    ├── (no user)  → AuthNavigator         # src/navigation/AuthNavigator.tsx (native stack)
    │   ├── LoginScreen
    │   ├── ForgotPasswordScreen
    │   └── NewPasswordScreen
    └── (user)     → TourProvider > AppNavigator   # src/navigation/AppNavigator.tsx (native stack)
        ├── DashboardScreen           (headerShown: false, custom header + AppMenu)
      ├── RideInfoScreen            (fullScreenModal, params: ride, source)
        ├── CheckInScreen             (fullScreenModal, params: ride, managedPitStopStageNumber)
        ├── ChangePasswordScreen      (fullScreenModal — all authenticated roles)
        ├── RideStatusManagementScreen (fullScreenModal — ADMINISTRATOR only)
        ├── UserOnboardingScreen       (fullScreenModal — ADMINISTRATOR only)
        ├── UserEnableDisableScreen    (fullScreenModal — ADMINISTRATOR only)
        ├── UserDeleteScreen           (fullScreenModal — ADMINISTRATOR only)
        └── UserModifyScreen           (fullScreenModal — ADMINISTRATOR only)
```

- `RootNavigator` reads `useAuth()` and swaps the whole Auth/App subtree on sign-in/sign-out (so the Auth stack always remounts fresh at Login on logout — no leftover navigation state).
- Admin-only screens are registered **conditionally** on the stack (`isAdministrator` check in `AppNavigator`), not just hidden behind a role check inside the screen — an unauthorized user cannot navigate to them at all.
- All non-Dashboard app screens keep their pre-migration prop-based API (`onClose`, etc.); thin wrapper components in `AppNavigator.tsx` adapt `navigation`/`route` to those props, so the screen components themselves stay framework-API-agnostic.
- `GestureHandlerRootView` lives once at the app root (required by react-native-gesture-handler for the Dashboard's pinch-zoom gesture); it is not duplicated per-screen.

### Navigation Rules

- Unauthenticated users only ever see the Auth stack (Login/ForgotPassword/NewPassword).
- Dashboard is the single landing screen for all authenticated roles; role-based restrictions are enforced as **feature gates within Dashboard/menu**, not as separate landing routes:
  - The check-in FAB is shown only when the user has the `CHECKIN_RIDER` permission and the ride is not historical.
  - Admin menu entries (Ride status management, User Management) and their routes are shown/registered only for `ADMINISTRATOR`.
  - `Guest`/read-only roles see the Dashboard grid without check-in capability (no FAB).
- Deep links are not currently required/supported.

### Dashboard Header Menu (AppMenu)

- `src/components/common/AppMenu.tsx` is a custom slide-in panel (full height, right edge, RN `Animated`-driven — no drawer/reanimated dependency) opened from the Dashboard header hamburger icon.
- Menu items call `navigation.navigate(...)` on the `AppNavigator` stack, then close the menu.
- "Ride status management" and "User Management" (with New User Onboarding / Enable-Disable / Delete / Modify sub-items) are shown only to `ADMINISTRATOR` users.
- For users whose effective role is `PS_x_USER` and who have multiple pit-stop stage mappings, the menu includes "Set pit stop context" to choose the active pit-stop stage for regular check-ins (opens the Pit Stop Context Picker, which — like the Rider Card and Ride Picker — intentionally remains a `Modal` popup rather than a stack route, since it is a transient selection, not a navigable screen).
- For users with pit-stop management access (`ADMINISTRATOR`, `SUPER_USER`, mapped `PS_x_USER`), the menu includes "Pit Stop management" with pit-stop stage submenu items.
  - `ADMINISTRATOR` and `SUPER_USER` see all current ride `PIT_STOP` stages.
  - `PS_x_USER` sees only mapped `PIT_STOP` stages.
  - Selecting a stage opens a popup modal where actions are state-gated (`OPEN` only when status is null, `CLOSE` only when status is `OPEN`) and API calls are sent to backend pit-stop open/close endpoints.
  - This menu item is hidden when viewing historical rides and when current ride status is `COMPLETED` or `CLOSED`.
- "Change password", the skipped-check-in visibility toggle, and "Logout" are available to all authenticated roles.
- Under "All Rides", planned rides remain blocked for dashboard launch; a dedicated ride-info action opens shared ride details for all rides (including planned).

### User Management Input Validation

- User onboarding and modify-user flows apply lightweight client-side validation for Email and Phone.
- Phone input defaults to `+91` in these admin forms.
- Phone is optional; when provided, it must follow international format (`+` prefix and digits).

---

## Styling Strategy

### Guidelines

1. **StyleSheet.create()** for all styles — no inline styles
2. **Constants** for colors in `src/constants/colors.ts`
3. **Consistent spacing** — use multiples of 4 or 8 for padding/margin
4. **Platform-aware** — use `Platform.select()` when platform-specific adjustments are needed
5. **Responsive** — use `Dimensions` or `useWindowDimensions()` for screen-size-dependent layouts

### Color System

Stage colors are defined in `src/constants/colors.ts` and used consistently across all views:

| Element | Color | Hex |
|---------|-------|-----|
| Start | Dark Orange | `#D97706` |
| PS1 | Dark Brown | `#7C2D12` |
| PS2 | Dark Blue | `#1E40AF` |
| Finish | Dark Green | `#15803D` |
| Quit Riding (QR) | Dark Red | `#B91C1C` |
| Not Riding (NR) | Gray | `#9CA3AF` |
| Not Checked In | White with gray border | `#FFFFFF` / `#D1D5DB` |

---

## Platform Considerations

### Mobile (iOS and Android)

- **Primary platform** — full feature set including QR scanning, offline mode, and all check-in capabilities
- **Portrait orientation** by default (configured in `app.json`)
- **Camera permission** required for QR code scanning
- **Expo Go** for development; Expo EAS Build for production

### Web

- **Simplified version** — Dashboard and reporting views primarily
- **Limited features** — QR scanning may not be available (camera API varies by browser)
- **Built with react-native-web** — same codebase, automatic web rendering
- **Responsive layout** — adapts to browser window size

### Platform-Specific Notes

- `expo-sqlite` works across iOS, Android, and Web
- `@react-native-community/netinfo` provides connectivity events on all platforms
- Camera/barcode scanning is mobile-focused — web fallback should use manual entry
- `expo-secure-store` is mobile-only; web uses equivalent browser storage

---

## Logging

The app uses a centralised, structured logger (`src/utils/logger.ts`) for all diagnostic and operational output. Direct `console.log` / `console.warn` / `console.error` calls must not be used in application code — all output should go through the logger.

### Log Levels

| Level | When to use | Console method |
|-------|-------------|----------------|
| **DEBUG** | Verbose detail useful only during development (request URLs, response codes, state transitions) | `console.log` |
| **INFO** | Noteworthy application events (session found, tour loaded, ride selected) | `console.log` |
| **WARN** | Recoverable issues that may need attention (JSON parse failure, retryable error, missing optional data) | `console.warn` |
| **ERROR** | Failures requiring investigation (API errors, unhandled exceptions, data integrity issues) | `console.error` |

### Usage

```typescript
import { logger } from '../utils/logger';

logger.info('AuthContext', 'Session found', { username });
logger.error('Dashboard', 'fetchDashboard failed', err);
```

Every call takes a **tag** (module or component name), a **message**, and an optional **data** argument. Errors passed as `data` are automatically formatted with name, message, and any `ApiError`-specific fields (`statusCode`, `errorCode`).

### Level Configuration

The active log level is set via the `EXPO_PUBLIC_LOG_LEVEL` environment variable:

| Value | Output |
|-------|--------|
| `DEBUG` | Everything (default in `__DEV__`) |
| `INFO` | INFO + WARN + ERROR |
| `WARN` | WARN + ERROR (default in production) |
| `ERROR` | Errors only |
| `NONE` | Silent |

Messages below the active level are suppressed at no runtime cost.

For API interaction logs, GET request/response DEBUG logging is additionally
gated by `EXPO_PUBLIC_API_DEBUG_GET` (default `false`) so verbose read-path
tracing can be enabled only during focused troubleshooting. Write operations
(`POST`, `PUT`, `DELETE`) continue to emit DEBUG diagnostics when the active
log level includes DEBUG.

### Output Format

```
[LEVEL] [Tag] Message — optional data
```

Example: `[ERROR] [Dashboard] fetchDashboard failed — ApiError: HTTP 500 | statusCode=500`

### Where Logs Appear

| Environment | Destination |
|-------------|-------------|
| Expo Dev Server | Terminal running `npx expo start` |
| JS Debugger | Browser Console (press `j` in Expo CLI) |
| Android (no debugger) | `adb logcat *:S ReactNativeJS:V` |
| iOS (no debugger) | Xcode Console / Console.app |

> **Note**: Standard `console.*` output is not persisted or remotely accessible in production builds. Remote log collection (e.g. Sentry, CloudWatch) can be added later by extending the `log()` function in `logger.ts`.

### Network Error Detection

`isNetworkError()` (exported from `apiClient.ts`) distinguishes genuine network connectivity failures from other `TypeError`s by matching against known network-failure messages (`"Network request failed"`, `"Failed to fetch"`, `"Load failed"`). This prevents data-processing bugs from being mis-classified as connection errors in catch blocks.

---

## App Distribution — Runtime Configuration (Single App, Multiple Organizers)

### Context

The app is intended to be used by different tour organizers, each operating on their own dedicated AWS subscription (separate Cognito User Pool, separate `tour-data-api` deployment). The goal is to publish a **single generic app binary** to the Play Store / App Store that can be configured at runtime to point to any organizer's AWS backend — without building a separate binary per organizer and without baking any organizer-specific values into the bundle.

### Current State

AWS configuration (`userPoolId`, `userPoolClientId`, `apiBaseUrl`, etc.) is currently provided via `EXPO_PUBLIC_` environment variables that are **baked into the bundle at build time**. This requires a separate EAS Build per organizer and does not support a single-binary distribution model.

### Implemented Approach — Setup Deep Link / QR Code in Invite Email

The chosen solution is **Option 3: Setup Deep Link / QR Code delivered via invite email**. This approach requires no publisher-maintained backend service after the app is published.

#### How It Works

1. The **publisher** runs a one-time tool (a local script or web form) to generate a **setup deep link** and/or **QR code** for each tour organizer from their AWS config values.
2. The **organizer** includes the setup deep link (and/or QR code image) in the **invite email** sent to each user, alongside the temporary Cognito password.
3. On first launch, the app checks for an incoming deep link. If the user tapped the setup link in their email on their mobile device, the app intercepts it automatically. If not, it shows an **OrgSetupScreen** with a QR code scanner as the fallback.
4. The app **verifies the HMAC-SHA256 signature** on the payload before accepting the config — this prevents forged setup links from redirecting the app to a malicious backend.
5. The decoded config is stored securely via `expo-secure-store` (Android Keystore / iOS Keychain).
6. `Amplify.configure()` is called with the stored values. All subsequent app launches skip setup and use the stored config directly.

#### Setup Link Format

```
https://setup.checkin-app.example.com/setup?payload=<BASE64_JSON>&sig=<HMAC_SHA256>
```

Where the `payload` is the Base64-encoded form of:

```json
{
  "orgCode": "TOURFRANCE-2026",
  "orgName": "Tour de France 2026 (Non-Competitive)",
  "awsRegion": "eu-west-1",
  "userPoolId": "eu-west-1_XXXXXXXXX",
  "userPoolClientId": "XXXXXXXXXXXXXXXXXXXXXXXXXX",
  "identityPoolId": "eu-west-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "apiBaseUrl": "https://<api-id>.execute-api.eu-west-1.amazonaws.com/v1"
}
```

`sig` is the hex-encoded HMAC-SHA256 of the `payload` string, computed with a publisher-held signing key. The app verifies this signature before storing the config.

The same URL, encoded as a QR code, serves users who receive the email on a desktop.

#### App First-Launch Flow

```
App Start
    │
    ▼
[Check expo-secure-store for stored org config]
    │
    ├─ Config found ──► [Amplify.configure(storedConfig)] ──► Login screen
    │
    └─ No config ──────────────────────────────────────────────────────────────┐
                                                                               │
                  ┌────────────────────────────────────────────────────────────┘
                  │
                  ▼
         [Check for incoming deep link (from invite email)]
                  │
        ┌─────────┴────────────────────┐
        │ Deep link present            │  No deep link
        │ (payload + sig in URL)       │
        └─────────┬────────────────────┘   │
                  │                        ▼
                  │               [Show OrgSetupScreen]
                  │               [User scans QR code]
                  │                        │
                  └────────────────────────┘
                                   │
                            [Verify HMAC sig]
                            [Decode config payload]
                            [Store in expo-secure-store]
                                   │
                            [Amplify.configure(config)]
                                   ▼
                            [Login screen]
                            [New-password challenge on first login]
                                   ▼
                            [Normal app flow]
```

#### Reinstall and New-Device Behaviour

`expo-secure-store` is device-bound — data is deleted on uninstall and does not transfer to a new device. After a reinstall or on a new phone the setup screen is presented again. The user re-taps the setup link from their original invite email (it remains valid) or scans the QR code. Organizers should include the following note in the invite email:

> *"Save this email — you will need the setup link again if you reinstall the app or switch to a new device."*

If the organizer's AWS configuration changes after the original invite was sent, existing installed users are unaffected (they retain the old config). Only users who reinstall will need a fresh invite link; the organizer re-sends to that subset.

#### Security Notes

- Config values (`userPoolId`, `apiBaseUrl`, etc.) are **resource identifiers, not credentials** — they do not grant access on their own. Authentication still requires valid Cognito credentials.
- The `allowAdminCreateUserOnly: true` setting on each Cognito User Pool (invite-only model) means an attacker who reads the QR code cannot create an account.
- The HMAC signature prevents a malicious QR code from redirecting the app to a fraudulent backend.
- Deep links use **HTTPS-based Universal Links (iOS) / App Links (Android)** (domain ownership verified) — not custom URL schemes.

#### Universal Link / App Link Domain

The domain `setup.checkin-app.example.com` must serve:
- `apple-app-site-association` — for iOS Universal Links
- `.well-known/assetlinks.json` — for Android App Links

This domain does **not** need to serve a backend API. A static S3 bucket with CloudFront is sufficient.

### Design Impact

| Component | Change Required |
|-----------|----------------|
| `src/config/amplify.ts` | Refactor to accept a runtime `OrgConfig` parameter instead of `EXPO_PUBLIC_` env vars; remove all `EXPO_PUBLIC_` references |
| `src/screens/auth/OrgSetupScreen.tsx` | New screen: QR code scanner + deep link handler; shown on first launch when no config is stored |
| `src/services/config/orgConfigService.ts` | New service: deep link payload decoder, HMAC verifier, `expo-secure-store` persistence |
| App startup sequence (`App.tsx` / `AppNavigator.tsx`) | Check `expo-secure-store` for config before calling `Amplify.configure()`; navigate to `OrgSetupScreen` if config is absent |
| `app.json` | Add Universal Link / App Link intent filter for the setup domain |
| `src/screens/auth/` | Remove sign-up screen; add new-password challenge screen (first-login flow) |
| `src/types/config.ts` | New file: `OrgConfig` TypeScript type |
| Environment variables | Remove organizer-specific `EXPO_PUBLIC_` vars; retain only neutral build-time constants (e.g., HMAC verification key, app version) |

> For the full options analysis, comparison matrix, QR obfuscation discussion, and alternatives considered, see [Generic App Distribution Analysis](Generic-App-Distribution-Analysis.md).

---

## Related Documentation

- [Requirements](Requirements.md) — Detailed feature specifications and business rules
- [Dashboard Feature](Dashboard-Feature.md) — Dashboard screen specification
- [Data Integration Design](DataIntegrationDesign.md) — Backend integration and offline architecture
- [Generic App Distribution Analysis](Generic-App-Distribution-Analysis.md) — Options analysis and alternatives considered
- [Project Structure](project-structure.md) — Folder organization

---

[← Back to README](../README.md)
