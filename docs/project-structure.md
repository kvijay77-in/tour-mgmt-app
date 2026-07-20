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
│   └── Images/
│
├── src/
│   ├── screens/                    # Screen components
│   │   ├── dashboard/              # Dashboard related screens
│   │   ├── checkin/                # Check-in related screens
│   │   ├── admin/                  # Admin feature screens
│   │   │   ├── RideStatusManagementScreen.tsx  # Administrator-only ride status transitions
│   │   │   ├── UserOnboardingScreen.tsx        # Administrator-only new user onboarding
│   │   │   ├── UserEnableDisableScreen.tsx     # Administrator-only user enable/disable
│   │   │   ├── UserDeleteScreen.tsx            # Administrator-only user delete
│   │   │   └── UserModifyScreen.tsx            # Administrator-only user profile modify
│   │   └── auth/                   # Authentication screens
│   │       ├── LoginScreen.tsx
│   │       ├── ForgotPasswordScreen.tsx
│   │       ├── NewPasswordScreen.tsx
│   │       ├── ChangePasswordScreen.tsx        # Full stack screen (all authenticated roles)
│   │       └── OrgSetupScreen.tsx              # Pre-auth runtime OrgConfig setup
│   │
│   ├── components/                 # Reusable UI components
│   │   ├── common/                 # Common components (buttons, inputs, etc.)
│   │   │   ├── AppMenu.tsx         # Custom slide-in Dashboard header menu (no drawer/reanimated dep)
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── SortIcon.tsx
│   │   ├── dashboard/              # Dashboard specific components
│   │   └── checkin/                # Check-in specific components
│   │
│   ├── navigation/                 # Navigation configuration (native stack only — no tabs/drawer)
│   │   ├── RootNavigator.tsx       # Switches Auth stack vs (TourProvider > App stack) on auth state
│   │   ├── AuthNavigator.tsx       # Unauthenticated stack: Login, ForgotPassword, NewPassword
│   │   └── AppNavigator.tsx        # Authenticated stack: Dashboard, CheckIn, ChangePassword, admin screens
│   │
│   ├── services/                   # Business logic & API integration
│   │   ├── api/                    # tour-data-api RESTful HTTP calls
│   │   │   ├── apiClient.ts        # Base HTTP client with auth, retry, error handling
│   │   │   ├── tourApi.ts          # Tour endpoints
│   │   │   ├── riderApi.ts         # Rider endpoints
│   │   │   ├── rideApi.ts          # Ride endpoints
│   │   │   ├── checkInApi.ts       # Check-in endpoints
│   │   │   ├── dashboardApi.ts     # Dashboard composite endpoint
│   │   │   └── mockData.ts         # Mock data for dev/demo mode (EXPO_PUBLIC_USE_MOCK_DATA)
│   │   ├── config/                 # Runtime org configuration service
│   │   │   ├── orgConfigService.ts # HMAC verification, expo-secure-store persistence
│   │   │   └── pitStopContextService.ts # Persist/clear selected pit-stop stage context
│   │   ├── auth/                   # AWS Cognito authentication and user management
│   │   │   └── cognitoUserManagementService.ts # Admin create/list/enable/disable/delete/update via Cognito APIs
│   │   ├── database/               # SQLite for offline support
│   │   ├── sync/                   # Data synchronization service
│   │   └── qrcode/                 # QR code scanning service
│   │
│   ├── hooks/                      # Custom React hooks
│   │   ├── useAuth.ts              # Authentication hook
│   │   ├── useOffline.ts           # Offline mode hook
│   │   └── useSync.ts              # Data sync hook
│   │
│   ├── context/                    # React Context providers
│   │   ├── AuthContext.tsx         # Authentication context
│   │   ├── TourContext.tsx         # Active tour context (resolves tourId at startup)
│   │   ├── OfflineContext.tsx      # Offline mode context
│   │   └── RoleContext.tsx         # RBAC role context
│   │
│   ├── types/                      # TypeScript type definitions
│   │   ├── models.ts               # Data models
│   │   ├── api.ts                  # API types
│   │   ├── config.ts               # OrgConfig type for runtime org configuration
│   │   └── navigation.ts           # Navigation types
│   │
│   ├── utils/                      # Helper utility functions
│   │   ├── logger.ts               # Structured, level-gated logging utility
│   │   ├── permissions.ts          # RBAC permission utilities
│   │   ├── validators.ts           # Input validation
│   │   └── formatters.ts           # Data formatting utilities
│   │
│   ├── constants/                  # Application constants
│   │   ├── colors.ts               # Color scheme constants
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
│
├── node_modules/                   # Dependencies (not in git)
│
├── .gitignore                      # Git ignore rules
├── .env.example                    # Environment variables template
├── .easignore                      # Files excluded from EAS Build upload tarball
├── App.tsx                         # Root application component
├── app.json                        # Expo configuration
├── eas.json                        # EAS Build profiles (development / preview / production)
├── package.json                    # NPM dependencies and scripts
└── tsconfig.json                   # TypeScript configuration
```

**Key Structure Notes:**

### Source Code (`src/`)
- **`screens/`**: Page-level components organized by feature domain (dashboard, check-in, admin, auth). Each screen connects to context providers and services.
- **`components/`**: Reusable UI components. `common/` for shared components, feature-specific folders for domain components.
- **`navigation/`**: React Navigation stack configuration — `RootNavigator` (auth-state switch), `AuthNavigator`, `AppNavigator` (native stack only; no bottom tabs or drawer). See [SolutionDesign.md § Navigation Structure](SolutionDesign.md#navigation-structure).
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
