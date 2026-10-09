# Project structure

_Last updated: 2026-10-05_

This is a navigational overview of the current repository, not an inventory of every file.

```text
App.tsx                 Application entry point
app.config.ts           Variant-specific Expo configuration
app.json                Static Expo configuration
metro.config.js         Expo Metro defaults; excludes deployment-only .env.web.* files from bundling
eas.json                EAS build profiles
samconfig.toml          SAM Dev/Production deployment defaults
src/
├── components/         Shared UI (including the Test ribbon), dashboard, events, artifacts and rider profile
├── config/             App configuration and review routing
├── constants/          Colors, roles, stages, layout and ID codes
├── context/            Auth, app config, tours, rides, events, offline, notifications
├── navigation/         Auth/root/app navigators and Home module registry
├── screens/
│   ├── admin/          Tours, ride status, users, artifacts, notifications, exit
│   ├── auth/           Setup, login and password changes
│   ├── checkin/        Scanner and check-in log
│   ├── dashboard/      Ride dashboard and ride information
│   ├── events/         Events, occurrences, OccurrenceRegistrationsScreen, hotels, baggage and progress
│   ├── home/           Role-aware module hub
│   ├── notifications/  Inbox
│   └── settings/       Sync status and advanced settings
├── services/
│   ├── api/            HTTP client and feature-specific adapters (tourUserApi.ts)
│   ├── auth/           Authentication and offline credential policy
│   ├── config/         Organizer configuration and local settings
│   ├── database/       Mobile stores, web adapter and migrations
│   ├── events/         Event bootstrap and dashboards
│   ├── offline/        Offline data and retention
│   ├── push/           Push registration
│   ├── riderProfile/   Profile configuration
│   └── sync/           Outbound check-in and event delivery
├── types/              Models and navigation types
└── utils/              Permissions, validation, domain helpers (including eventRegistrations.ts) and logger
tools/                  EAS aids, setup-link generator, web.sh (web infra deploy and publish)
infra/                  SAM hosting template (infra/web.yaml)
Makefile                web-infra / web-publish targets
.env.web.example        Web deployment config template
docs/                   Requirements, design, guides, user guide, misc
```

See [architecture](../design/architecture.md) for responsibilities and the [web deployment design](../design/web-deployment.md) for hosting. `samconfig.toml` supplies SAM deploy defaults for `infra/web.yaml`.

Pure helper tests live under `src/utils/__tests__/` and `src/constants/__tests__/`.
