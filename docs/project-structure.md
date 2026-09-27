# Project Folder Structure

[← Back to README](../README.md)

Following structure will be used in the project and any addition/restructure should be updated here. But first changes should be approved before it be applied.

```
tour-mgmt-app/
│
├── .git/
├── .github/
│   └── copilot-instructions.md
│
├── docs/
│   ├── Requirements.md
│   ├── SolutionDesign.md
│   ├── Dashboard-Feature.md
│   ├── DataIntegrationDesign.md
│   ├── Generic-App-Distribution-Analysis.md
│   ├── development-guide.md
│   ├── docs-index.md
│   ├── project-structure.md
│   ├── release-guide.md
│   ├── Requirements-ID-format.md
│   ├── idcode-backend-api-change-request.md
│   ├── Event-Engine-Requirements.md
│   ├── Event-Engine-Design.md
│   ├── Project-Audit-Findings.md
│   └── Images/
│   ├── dashboard-backend-api-change-request.md
│
├── src/
│   ├── screens/                    # Screen components
│   │   ├── home/                   # Home hub
│   │   │   └── HomeScreen.tsx      # Group-aware module tiles + account menu (initial route)
│   │   ├── events/                 # Event engine screens
│   │   │   ├── EventsHomeScreen.tsx             # Scan list (assignment-filtered) + event list with today's occurrences (Events module)
│   │   │   ├── EventDefinitionListScreen.tsx    # MANAGE_EVENTS definition list
│   │   │   ├── EventDefinitionEditorScreen.tsx  # MANAGE_EVENTS create/edit (web-first, Move up/down)
│   │   │   ├── OccurrenceManagementScreen.tsx   # MANAGE_EVENT_OCCURRENCES lifecycle, create/range, overrides
│   │   │   ├── EventScanScreen.tsx              # EVENT_SCAN activity scanning (write-local-first, offline capable)
│   │   │   ├── OccurrenceDashboardScreen.tsx    # VIEW_DASHBOARD occurrence tiles, outstanding riders, cancelled records (snapshot offline)
│   │   │   ├── BaggageReconciliationScreen.tsx  # VIEW_DASHBOARD loaded vs unloaded + missing riders
│   │   │   ├── RiderProgressScreen.tsx          # Per-occurrence activity stepper for one rider (all roles)
│   │   │   ├── HotelManagementScreen.tsx        # MANAGE_HOTEL_ALLOCATIONS hotel CRUD + room-wise stays per night (Hotels & Baggage module)
│   │   │   ├── HotelAllocationUploadScreen.tsx  # MANAGE_HOTEL_ALLOCATIONS CSV upload: presign, S3 PUT, status polling, all-or-nothing outcome
│   │   │   └── HotelAllocationAdjustScreen.tsx  # MANAGE_HOTEL_ALLOCATIONS single-night manual allocation with clash/capacity pre-check
│   │   ├── dashboard/              # Dashboard related screens
│   │   │   ├── DashboardScreen.tsx # Main dashboard with rider grid
│   │   │   └── RideInfoScreen.tsx  # Shared ride info modal host screen
│   │   ├── checkin/                # Check-in related screens
│   │   ├── admin/                  # Admin feature screens
│   │   │   ├── ArtifactsScreen.tsx              # Administrator-only artifact upload and maintenance
│   │   │   ├── RideStatusManagementScreen.tsx  # Administrator-only ride status transitions
│   │   │   ├── UserOnboardingScreen.tsx        # Administrator-only new user onboarding ("Assign to this tour →" on success)
│   │   │   ├── UserEnableDisableScreen.tsx     # Administrator-only user enable/disable
│   │   │   ├── UserDeleteScreen.tsx            # Administrator-only user delete
│   │   │   ├── UserModifyScreen.tsx            # Administrator-only user profile modify
│   │   │   ├── RiderExitScreen.tsx             # RIDER_EXIT rider exit (baggage disposition), cancel exit, retained-baggage release
│   │   │   ├── TourUserAssignmentScreen.tsx    # MANAGE_TOUR_USERS User-{tourId} create/update (role from groups, stage, hotel, events, activities)
│   │   │   ├── RiderProfileDefinitionsScreen.tsx # RIDER_PROFILE_DEFINITION_MANAGE rider profile definitions (sections/attributes/LOV)
│   │   │   └── TourManagementScreen.tsx        # Tour definition, provisioning, re-provisioning, and ride tabs
│   │   ├── settings/               # Offline sync screens (mobile)
│   │   │   ├── SyncStatusScreen.tsx         # Unsent items, retry/discard, Sync now, Verify with server, clock warning
│   │   │   └── AdvancedSettingsScreen.tsx   # Per-device overrides of OFFLINE_SYNC settings (all roles except GUEST)
│   │   └── auth/                   # Authentication screens
│   │       ├── LoginScreen.tsx
│   │       ├── ForgotPasswordScreen.tsx
│   │       ├── NewPasswordScreen.tsx
│   │       ├── ChangePasswordScreen.tsx        # Full stack screen (all authenticated roles)
│   │       └── OrgSetupScreen.tsx              # Pre-auth runtime OrgConfig setup
│   │
│   ├── components/                 # Reusable UI components
│   │   ├── common/                 # Common components (buttons, inputs, etc.)
│   │   │   ├── AppMenu.tsx         # Custom slide-in ride header menu (ride items; no drawer/reanimated dep)
│   │   │   ├── SideNav.tsx         # Persistent web sidebar (≥ DESKTOP_MIN_WIDTH) listing Home hub modules
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── OfflineBanner.tsx   # Offline strip: toggle, readiness, unsent/failed counts, stale/clock warnings (full + compact)
│   │   │   └── SortIcon.tsx
│   │   ├── artifacts/              # Artifact upload and management components (Phase 3)
│   │   │   ├── ArtifactRow.tsx     # Presentational row/card for artifact display
│   │   │   └── ConfirmDialog.tsx   # Confirmation modal (optional extra content and primary tone; also used by events)
│   │   ├── events/                 # Event engine components
│   │   │   ├── StatusBanner.tsx          # error/info/warning banner with optional actions
│   │   │   ├── EventScreenHeader.tsx     # Header bar with back/Home button for event screens
│   │   │   ├── OccurrenceStatusBadge.tsx # Occurrence status pill
│   │   │   ├── TypeCodeMultiSelect.tsx   # ID_CODE_TYPE chip multi-select (+ useIdCodeTypeOptions)
│   │   │   ├── ActivityChipList.tsx      # Read-only activity chips with per-occurrence override badges
│   │   │   ├── ActivityOverrideEditor.tsx # Per-activity override editor (side panel ≥768, sheet below)
│   │   │   ├── ActivityStepper.tsx       # Vertical activity stepper (pending/completed/opted-out/flagged/blocked/queued)
│   │   │   ├── RowErrorTable.tsx         # Hotel upload issues (Row/Code/Message, row 0 = File, capped-list footer)
│   │   │   ├── ReadOnlyProfileHeader.tsx # Read-only rider identity strip (name, riderId, photo or initials)
│   │   │   └── ScanConfirmationCard.tsx  # Scanned rider confirmation: variant radio, opt-out, confirm/rescan
│   │   ├── dashboard/              # Dashboard specific components
│   │   │   ├── RideInfoContent.tsx # Reusable ride info content (dashboard + All Rides)
│   │   │   └── RiderCardModal.tsx  # Shared rider card popup (Dashboard tab + Check-In Log tab; "View event progress")
│   │   └── checkin/                # Check-in specific components
│   │
│   ├── navigation/                 # Navigation configuration (native stack + ride tabs; no drawer)
│   │   ├── RootNavigator.tsx       # Switches Auth stack vs (TourProvider > App stack) on auth state
│   │   ├── AuthNavigator.tsx       # Unauthenticated stack: Login, ForgotPassword, NewPassword
│   │   ├── AppNavigator.tsx        # App shell (web SideNav + stack): Home, MainTabs, RideInfo, ChangePassword, admin screens, TourManagement, event screens
│   │   ├── MainTabNavigator.tsx    # Ride module tabs: Dashboard, CheckIn, Log
│   │   ├── modules.ts              # Module/section registry shared by HomeScreen and SideNav
│   │   └── navigationRef.ts        # Navigation container ref (used by SideNav)
│   │
│   ├── services/                   # Business logic & API integration
│   │   ├── api/                    # tour-data-api RESTful HTTP calls
│   │   │   ├── apiClient.ts        # Base HTTP client with auth, retry, error handling
│   │   │   ├── tourApi.ts          # Tour list/detail, CRUD, provisioning and re-provisioning endpoints
│   │   │   ├── riderApi.ts         # Rider endpoints, rider exit/cancel exit/baggage release (outcome unions)
│   │   │   ├── rideApi.ts          # Ride endpoints
│   │   │   ├── checkInApi.ts       # Check-in endpoints
│   │   │   ├── dashboardApi.ts     # Dashboard progress endpoint helpers
│   │   │   ├── configApi.ts        # Generic app configuration API helpers
│   │   │   ├── riderProfileConfigApi.ts # Rider profile definitions admin API helpers
│   │   │   ├── eventsApi.ts        # Event definitions, occurrences, overrides, dashboards/progress/reconciliation, rider progress, records, bootstrap (outcome unions)
│   │   │   ├── hotelsApi.ts        # Hotels, hotel stays, manual stay upsert, allocation upload presign/status, upload error groups (outcome unions)
│   │   │   ├── tourUserApi.ts      # Tour-scoped users: own record (/users/me), list, create, update (outcome unions)
│   │   │   ├── artifactApi.ts      # Artifact manifest and presign endpoints (Phase 2)
│   │   │   └── mockData.ts         # Mock data for dev/demo mode (EXPO_PUBLIC_USE_MOCK_DATA)
│   │   ├── artifacts/              # File upload and artifact handling (Phase 2)
│   │   │   └── artifactUploader.ts # File picking and presigned URL upload
│   │   ├── dashboard/              # Dashboard cross-screen pub/sub events
│   │   │   └── dashboardEvents.ts  # Local check-in/cancel event bus (Dashboard ⇄ Check-In Log live sync)
│   │   ├── config/                 # Runtime org configuration service
│   │   │   ├── orgConfigService.ts # HMAC verification, expo-secure-store persistence
│   │   │   └── pitStopContextService.ts # Persist/clear selected pit-stop stage context
│   │   ├── auth/                   # AWS Cognito authentication and user management
│   │   │   ├── cognitoUserManagementService.ts # Admin create/list/enable/disable/delete/update via Cognito APIs
│   │   │   ├── offlineAuthPolicy.ts        # Offline sign-in rules (last user, max days, attempts) — pure
│   │   │   ├── offlineCredentialService.ts # Remember me / offline credential in SecureStore, biometric unlock
│   │   │   └── __tests__/                  # Unit tests
│   │   ├── database/               # SQLite for offline support
│   │   │   ├── database.ts         # Database open, local stores, withWriteTransaction, retention purge
│   │   │   ├── migrations.ts       # Versioned schema migrations (PRAGMA user_version)
│   │   │   ├── appConfigStore.ts   # AppConfig SQLite persistence and lookups
│   │   │   ├── tourStore.ts / rideStore.ts / riderStore.ts / checkInStore.ts # Offline data caches
│   │   │   ├── pendingStore.ts     # Outbound queue storage
│   │   │   ├── syncMetaStore.ts    # Last refresh time per cached dataset
│   │   │   ├── nameDirectoryStore.ts # Rider and app-user name directories
│   │   │   ├── sentCheckInStore.ts # Check-ins sent from the queue (Verify with server)
│   │   │   ├── riderPersonalCodeStore.ts # Rider personalCode mapping persistence
│   │   │   ├── eventStore.ts       # Event definitions, occurrences, baggage status, dashboard snapshots, own tour assignment
│   │   │   ├── eventRecordStore.ts # Write-local-first event activity records with sync state
│   │   │   └── hotelStayStore.ts   # Nightly room allocation cache
│   │   ├── events/                 # Event engine services
│   │   │   ├── eventBootstrapService.ts # Events bootstrap (ETag/304) + own tour assignment → SQLite cache
│   │   │   └── eventDashboardService.ts # Occurrence dashboard/progress (ETag reuse) + reconciliation → snapshot cache
│   │   ├── idcode/                 # Production ID code parsing and resolution service
│   │   │   └── idCodeService.ts
│   │   ├── offline/                # Offline readiness
│   │   │   ├── offlineDataService.ts # Cache-through loaders (online → SQLite; offline → SQLite)
│   │   │   └── retentionService.ts   # Purge of old synced data
│   │   ├── sync/                   # Outbound sync
│   │   │   ├── outboundSyncService.ts # Single engine: handlers, backoff, triggers, status
│   │   │   ├── checkInSync.ts      # CHECK_IN handler, offline capture, sent log
│   │   │   ├── eventSyncService.ts # Event record create/cancel handlers
│   │   │   ├── checkInCrossCheck.ts # Verify with server / Send again
│   │   │   ├── clockSkew.ts        # Device vs server clock check
│   │   │   ├── backoff.ts          # Retry backoff with jitter
│   │   │   ├── syncSettings.ts     # OFFLINE_SYNC settings, limits and defaults
│   │   │   ├── syncSettingsService.ts # AppConfig + device overrides
│   │   │   └── __tests__/          # Unit tests
│   │   └── qrcode/                 # QR code scanning service
│   │
│   ├── hooks/                      # Custom React hooks
│   │   ├── useAuth.ts              # Authentication hook
│   │   ├── useOffline.ts           # Offline mode hook
│   │   └── useSync.ts              # Data sync hook
│   │
│   ├── context/                    # React Context providers
│   │   ├── AuthContext.tsx         # Authentication context
│   │   ├── AppConfigContext.tsx    # ID code config bootstrap context
│   │   ├── TourContext.tsx         # Active tour context (resolves tourId at startup)
│   │   ├── OfflineContext.tsx      # Offline mode context (mounted in RootNavigator)
│   │   ├── SyncStatusContext.tsx   # Sync monitoring, readiness refresh, retention (mounted in AppNavigator)
│   │   ├── EventSessionContext.tsx # Event scan selection, local records, bootstrap + event sync lifecycle
│   │   └── RoleContext.tsx         # RBAC role context
│   │
│   ├── types/                      # TypeScript type definitions
│   │   ├── models.ts               # Data models
│   │   ├── api.ts                  # API types
│   │   ├── config.ts               # OrgConfig type for runtime org configuration
│   │   ├── riderProfile.ts         # Rider profile definition contracts (sections, attributes, LOV)
│   │   └── navigation.ts           # Navigation types
│   │
│   ├── utils/                      # Helper utility functions
│   │   ├── logger.ts               # Structured, level-gated logging utility
│   │   ├── permissions.ts          # RBAC permission utilities
│   │   ├── riderProfilePermissions.ts # Rider profile feature-label gate helpers
│   │   ├── riderProfileDefinitions.ts # Rider profile section ordering + visibleWhen evaluation
│   │   ├── riderProfileDefinitionEditor.ts # Definition editor immutable/system checks
│   │   ├── riderProfileMasking.ts  # Sensitive rider-profile attribute masking helpers
│   │   ├── eventActivity.ts        # Event engine effective-activity, assignment and local-date rules (pure)
│   │   ├── riderStatus.ts          # Shared RiderStatus derivation (Dashboard grid + RiderCardModal)
│   │   ├── checkInValidation.ts    # Check-in validation shared by online/offline flows (pure)
│   │   ├── __tests__/              # Unit tests (jest-expo; `npm test`)
│   │   ├── validators.ts           # Input validation
│   │   └── formatters.ts           # Data formatting utilities
│   │
│   ├── constants/                  # Application constants
│   │   ├── colors.ts               # Color scheme constants
│   │   ├── eventMessages.ts        # Event/hotel error-code and validation messages (FE §9.2)
│   │   ├── idCodes.ts              # ID code constants, defaults, and error messages
│   │   ├── layout.ts               # Layout and UI constants (Phase 1)
│   │   ├── roles.ts                # Role definitions
│   │   └── stages.ts               # Ride stage definitions
│   │
│   └── config/                     # Configuration files
│       ├── amplify.ts              # AWS Amplify configuration
│       └── database.ts             # Database configuration
│
├── assets/                         # Static assets
│   ├── images/                     # Image files
│   ├── fonts/                      # Custom fonts
│   └── icons/                      # Icon files
│
├── tools/                          # Publisher/admin utilities (not part of the app bundle)
│   └── setup-link-generator.html   # HMAC-signed setup link & QR code generator
│   └── push-eas-env.sh             # Sync populated EXPO_PUBLIC_* values from .env into EAS project environments
│
├── node_modules/                   # Dependencies (not in git)
│
├── .gitignore                      # Git ignore rules
├── .env.example                    # Environment variables template
├── .easignore                      # Files excluded from EAS Build upload tarball
├── App.tsx                         # Root application component
├── app.json                        # Expo configuration
├── eas.json                        # EAS Build profiles (development / preview / production)
├── package.json                    # NPM dependencies, scripts and Jest config (`npm test`, `npm run typecheck`)
└── tsconfig.json                   # TypeScript configuration
```

**Key Structure Notes:**

### Source Code (`src/`)
- **`screens/`**: Page-level components organized by feature domain (dashboard, check-in, admin, auth). Each screen connects to context providers and services.
- **`components/`**: Reusable UI components. `common/` for shared components, feature-specific folders for domain components.
- **`navigation/`**: React Navigation configuration — `RootNavigator` (auth-state switch), `AuthNavigator`, `AppNavigator` (app shell + native stack), `MainTabNavigator` (ride module tabs), `modules.ts` (Home hub / sidebar registry). See [SolutionDesign.md § Navigation Structure](SolutionDesign.md#navigation-structure).
- **`services/`**: Business logic layer isolated from UI. Contains API client, org configuration service, SQLite database, and sync service.
- **`context/`**: React Context providers for global state — authentication, active tour, offline mode, RBAC roles.
- **`types/`**: TypeScript type definitions and interfaces for data models, API responses, and navigation.
- **`constants/`**: Application-wide constants — color definitions, role definitions, stage definitions.
- **`hooks/`**: Custom React hooks for reusable stateful logic (auth, offline mode, sync).
- **`utils/`**: Pure utility functions — permissions checking, input validation, data formatting.
- **`config/`**: Configuration files for Amplify and database setup.

### Documentation (`docs/`)
- **`Requirements.md`**: Detailed functional requirements, use cases, and feature specifications
- **`SolutionDesign.md`**: Architecture, design principles, component structure, technical decisions
- **`Dashboard-Feature.md`**: Dashboard screen specification — grid, stages, sorting, zoom, colors
- **`Event-Engine-Requirements.md`** / **`Event-Engine-Design.md`**: Events engine scope and frontend design
- **`DataIntegrationDesign.md`**: Backend API integration architecture, offline sync, conflict resolution
- **`Generic-App-Distribution-Analysis.md`**: Feasibility analysis for distributing one generic app across multiple organizer AWS subscriptions
- **`development-guide.md`**: Environment setup, running the app, testing, troubleshooting
- **`release-guide.md`**: Building and distributing the ToT Android APK via EAS Build
- **`docs-index.md`**: Complete documentation index with persona-based navigation
- **`project-structure.md`**: This file — project folder organization

### Infrastructure
- **`amplify/`**: AWS Amplify Gen 2 backend configuration (authentication, data resources). Auto-generated structure managed by Amplify CLI.
- **`App.tsx`**: Root application component — single entry point for Android, iOS, and Web.
- **`app.json`**: Expo configuration (app name, splash screen, platform settings).
- **`eas.json`**: EAS Build profiles for producing signed APKs. See [release-guide.md](./release-guide.md).
- **`.easignore`**: Excludes non-build artefacts (backend snapshot zip, docs, tools) from the EAS upload tarball.
- **`tools/`**: Publisher/admin utilities such as the setup-link generator and EAS env sync helper.

### Additional Notes
- **Single Entry Point**: `App.tsx` serves as the root component for Android, iOS, and Web
- **Platform Agnostic**: All code in `/src` is shared across platforms
- **Services Layer**: Business logic isolated in `/services` for reusability
- **Offline Support**: Database and sync services handle offline functionality
- **Type Safety**: TypeScript definitions in `/types` for type checking
- **RBAC Support**: Context and utilities for role-based access control
- **AWS Integration**: Amplify backend folder for cloud resources (auto-generated)

---

[← Back to README](../README.md)
