# Solution Design

[← Back to README](../README.md)

This document covers the solution design aspects of the Check-In App that must be adhered to at all times. If there is any conflict between the copilot-instructions.md and this document, it must be flagged for resolution.

This is an evolving document and hence latest info must be referred to at all times.

## Table of Contents

- [Design Principles](#design-principles)
- [Technology Stack](#technology-stack)
- [Application Architecture](#application-architecture)
- [Component Architecture](#component-architecture)
- [State Management](#state-management)
- [Authentication](#authentication)
- [Backend Integration](#backend-integration)
- [Offline Architecture](#offline-architecture)
- [Navigation Structure](#navigation-structure)
- [Styling Strategy](#styling-strategy)
- [Platform Considerations](#platform-considerations)

---

## Design Principles

1. **Common codebase** — App should have a single codebase to cater for Android, iOS, and Web App versions.
   - Any exception to have platform-specific code when common code is feasible must be flagged for review before proceeding with development.

2. **No direct AWS resource access** — Any direct access to AWS resources (DynamoDB, S3, etc.) from the Mobile App or Web client must not be permitted. Such access must always be through the tour-data-api backend (API Gateway → Lambda → DynamoDB).

3. **Amplify for authentication only** — AWS Amplify Auth SDK is used for Cognito authentication and JWT token management. Data access is via the RESTful tour-data-api, not Amplify Data/AppSync.

4. **SQLite as single source of truth** — The Dashboard and all UI reads come from the local SQLite database. Network operations (API calls) update SQLite, and the UI observes SQLite. This ensures consistent behaviour in both online and offline modes.

5. **Offline-first for check-ins** — All check-in operations write to SQLite first, then asynchronously sync to the backend. There is no separate "online" vs "offline" code path for check-ins.

6. **Security by default** — No hardcoded credentials, no inline sensitive data, JWT-based authentication for all API calls, RBAC enforcement in the UI layer.

7. **Reactive UI** — Use React Context and Hooks for state management. No class components. Minimize re-renders through proper state structuring and memoization.

8. **Modular and reusable** — Components should be small, focused, and reusable. Business logic should be isolated in the services layer, not embedded in UI components.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Framework** | React Native | 0.81.x | Cross-platform mobile |
| **Platform Tooling** | Expo (managed workflow) | SDK 54 | Build, deploy, native APIs |
| **Language** | TypeScript | ~5.x | Type safety |
| **Navigation** | React Navigation | 7.x | Screen navigation (native stack + bottom tabs) |
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
- **SQLite over AsyncStorage**: Structured data with relational queries needed for offline dashboard. AsyncStorage is key-value only and insufficient for complex queries.
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
│   └── DashboardScreen.tsx      # Main dashboard with rider grid
├── checkin/                      # QR scanning, check-in flow
├── admin/                        # Ride management (add/modify/close)
└── auth/                         # Login, authentication screens
```

### Reusable Components

Components are organized by scope — common components used across screens, and feature-specific components:

```
src/components/
├── common/                       # Shared across all screens
│   └── SortIcon.tsx             # Custom sort toggle icon
├── dashboard/                    # Dashboard-specific components
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

---

## Backend Integration

### API Service Layer

All communication with the tour-data-api is through the service layer at `src/services/api/`:

| File | Endpoints | Description |
|------|-----------|-------------|
| `apiClient.ts` | — | Base HTTP client with auth, retry, error handling |
| `tourApi.ts` | `GET /v1/tours/active`, `GET /v1/tours` | Tour resolution and listing |
| `riderApi.ts` | `GET /v1/tours/{tourId}/riders` | Rider data for dashboard |
| `rideApi.ts` | `GET /v1/tours/{tourId}/rides/today`, CRUD | Ride management |
| `checkInApi.ts` | `POST /v1/tours/{tourId}/checkins`, GET | Check-in operations |
| `dashboardApi.ts` | `GET /v1/tours/{tourId}/rides/{rideId}/dashboard` | Composite dashboard data |

### API Client Features

- **Base URL**: Configured from environment variable (`TOUR_DATA_API_BASE_URL`)
- **Authentication**: JWT token injected from Amplify Auth session
- **Auto-retry**: Exponential backoff for network failures (3 retries)
- **Token refresh**: Automatic on 401 responses (retry once)
- **Error standardization**: Backend errors mapped to consistent frontend error types
- **Logging**: Request/response logging (non-sensitive data only)

### Data Flow: API → SQLite → UI

The app never reads directly from API responses for the Dashboard. The flow is:
1. API client fetches data from tour-data-api
2. Data is written to SQLite tables
3. UI components read from SQLite

This ensures consistent behaviour whether online or offline. For detailed design, see [Data Integration Design](DataIntegrationDesign.md).

---

## Offline Architecture

### Design Principles

1. **SQLite is the single source of truth** — UI always reads from SQLite
2. **Same write path online and offline** — check-ins always go to SQLite first, then sync
3. **Manual + automatic offline control** — users can toggle offline mode; NetInfo detects automatically
4. **Conflict resolution is automatic** — no manual intervention needed (see [Data Integration Design § 4.5](DataIntegrationDesign.md#45-conflict-resolution))

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
- **Inbound sync**: Polls dashboard endpoint → writes to SQLite → UI re-renders

Both pause when offline (manual toggle or auto-detected) and resume when connectivity is restored.

For detailed sync flow, conflict resolution, and refresh strategy, see [Data Integration Design § 4](DataIntegrationDesign.md#4-offline-support-design).

---

## Navigation Structure

### Navigation Hierarchy

```
AppNavigator
├── AuthNavigator (unauthenticated)
│   └── LoginScreen
└── MainNavigator (authenticated)
    ├── DashboardScreen (Home / default tab)
    ├── CheckInScreen (QR scanner + check-in flow)
    └── AdminScreen (Ride management — role-restricted)
```

### Navigation Rules

- **Unauthenticated users** are restricted to the AuthNavigator
- **Authenticated users** are routed based on their role
- **Hotel Staff** role skips Dashboard and goes directly to check-in
- **Guest** role has read-only Dashboard with no check-in access
- **Deep links** are not currently required

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

## Multi-Tenancy (Single App, Multiple Organizers)

### Context

The app is intended to be usable by different tour organizers, each operating on their own dedicated AWS subscription (separate Cognito User Pool, separate `tour-data-api` deployment). The goal is to publish a **single app binary** to the Play Store / App Store that can be configured at runtime to point to any organizer's AWS backend — without requiring a new app build per organizer.

### Current State

AWS configuration (`userPoolId`, `userPoolClientId`, `apiBaseUrl`, etc.) is currently provided via `EXPO_PUBLIC_` environment variables that are **baked into the bundle at build time**. This requires a separate build per organizer and does not support a single-binary distribution model.

### Planned Approach

The approved direction (pending final decision — see [Multi-Tenancy Feasibility Study](MultiTenancy-Feasibility.md)) is **runtime configuration via a Bootstrap Service**:

1. The app ships with only a stable bootstrap service URL as a build-time constant.
2. On first launch, an **Organization Setup screen** prompts the user to enter their organizer's unique code.
3. The app fetches the org-specific AWS config from the bootstrap service.
4. Config is stored securely via `expo-secure-store` and used to call `Amplify.configure()` at runtime.
5. All subsequent launches use the stored config without requiring a network call to the bootstrap service.

This preserves full AWS account isolation per organizer while eliminating the need for per-organizer builds.

### Design Impact

| Component | Change Required |
|-----------|----------------|
| `src/config/amplify.ts` | Refactor to accept runtime config values instead of `EXPO_PUBLIC_` env vars |
| `src/screens/auth/` | Add `OrgSetupScreen` shown on first launch when no config is stored |
| App startup sequence | Load config from `expo-secure-store` before calling `Amplify.configure()` |
| Bootstrap service | New lightweight service (static S3/Lambda) — separate from `tour-data-api` |

> For full analysis, options comparison, security considerations, and implementation effort estimate, see [Multi-Tenancy Feasibility Study](MultiTenancy-Feasibility.md).

---

## Related Documentation

- [Requirements](Requirements.md) — Detailed feature specifications and business rules
- [Dashboard Feature](Dashboard-Feature.md) — Dashboard screen specification
- [Data Integration Design](DataIntegrationDesign.md) — Backend integration and offline architecture
- [Multi-Tenancy Feasibility](MultiTenancy-Feasibility.md) — Single-app multi-organizer architecture study
- [Project Structure](project-structure.md) — Folder organization

---

[← Back to README](../README.md)
