# Development guide

_Last updated: 2026-09-29_

Install Node.js and npm, then run `npm ci` from the repository root to use the checked-in lockfile. Copy `.env.example` to `.env` for local fallback configuration; see [configuration](configuration.md). Never commit `.env`, populated EAS environment files or organizer credentials.

Use `npm start` to launch Expo interactively, `npm run android` or `npm run ios` for development clients, and `npm run web` for browser development. The app uses Expo native capabilities; test camera and offline behavior on a device/development build rather than assuming browser or Expo Go support. `EXPO_PUBLIC_USE_MOCK_DATA=true` enables synthetic data for local UI work. Local config defaults to the Production app identity; use `APP_VARIANT=test` when you need to inspect the Test identity. The `localpreview` profile is a Test-identity APK; the `test` and `production` store profiles select their corresponding EAS environments. See [app variants](../design/app-variants-and-environments.md).

Before shipping changes, run `npm run lint`, `npm run typecheck` and `npm test`. Tests use Jest under `src/**/__tests__/`; edit only tests relevant to the code changed. The code uses React Native components, StyleSheet styling, hooks, typed API services and the centralized logger. See [project structure](project-structure.md) and the [design index](../design/README.md).

Backend responses and permissions are defined by [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/design/api-reference.md); do not provision local copies of its resources. For build profiles and tester distribution, see [release](release.md).
