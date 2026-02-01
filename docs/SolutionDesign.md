This document covers the solution design aspects of the App that must be adhered to. If there is any conflict between the copilot-instructions.md and this document, it must be flagged for resolution.

This is an evolving document and hence latest info must be referred to at all times.

# Design Principles:  

- App should have a common code base to cater for Android, iOS and Web App versions.  
  * Any except to have flavour specific code when common code is feasible must be flagged for review before proceeding with the development.
- Any direct access to AWS Resource access from Mobile App or Web client must not be permitted. Such access must always be through Amplify backend.
- 


# Project Folder Structure

```
poc-app/
│
├── .git/
├── .github/
│   └── copilot-instructions.md
│
├── docs/
│   ├── Requirements.md
│   ├── SolutionDesign.md
│   └── Images/
│
├── src/
│   ├── screens/                    # Screen components
│   │   ├── dashboard/              # Dashboard related screens
│   │   ├── checkin/                # Check-in related screens
│   │   ├── admin/                  # Admin feature screens
│   │   └── auth/                   # Authentication screens
│   │
│   ├── components/                 # Reusable UI components
│   │   ├── common/                 # Common components (buttons, inputs, etc.)
│   │   ├── dashboard/              # Dashboard specific components
│   │   └── checkin/                # Check-in specific components
│   │
│   ├── navigation/                 # Navigation configuration
│   │   ├── AppNavigator.tsx        # Main app navigation
│   │   └── AuthNavigator.tsx       # Authentication navigation
│   │
│   ├── services/                   # Business logic & API integration
│   │   ├── api/                    # AWS AppSync/GraphQL API
│   │   ├── auth/                   # AWS Cognito authentication
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
│   │   ├── OfflineContext.tsx      # Offline mode context
│   │   └── RoleContext.tsx         # RBAC role context
│   │
│   ├── types/                      # TypeScript type definitions
│   │   ├── models.ts               # Data models
│   │   ├── api.ts                  # API types
│   │   └── navigation.ts           # Navigation types
│   │
│   ├── utils/                      # Helper utility functions
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
├── amplify/                        # AWS Amplify backend (auto-generated)
│
├── node_modules/                   # Dependencies (not in git)
│
├── .gitignore                      # Git ignore rules
├── .env.example                    # Environment variables template
├── App.tsx                         # Root application component
├── app.json                        # Expo configuration
├── package.json                    # NPM dependencies and scripts
└── tsconfig.json                   # TypeScript configuration
```

**Key Structure Notes:**

- **Single Entry Point**: `App.tsx` serves as the root component for Android, iOS, and Web
- **Platform Agnostic**: All code in `/src` is shared across platforms
- **Services Layer**: Business logic isolated in `/services` for reusability
- **Offline Support**: Database and sync services handle offline functionality
- **Type Safety**: TypeScript definitions in `/types` for type checking
- **RBAC Support**: Context and utilities for role-based access control
- **AWS Integration**: Amplify backend folder for cloud resources (auto-generated)
