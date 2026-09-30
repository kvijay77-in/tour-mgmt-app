# App release and distribution

_Last updated: 2026-09-29_

This guide is a short overview of **EAS client builds**, not backend infrastructure deployment. The authoritative step-by-step instructions for the separate Test and Production store apps are in the [EAS build and release guide](eas-build-and-release.md) and [app-variants design](../design/app-variants-and-environments.md). The backend's [deployment guide](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md) owns all AWS resources and service setup.

1. Complete `npm run lint`, `npm run typecheck` and `npm test` as described in the [development guide](development.md).
2. Sign in with `npx eas-cli@latest login` and verify the linked Expo project.
3. Configure distinct EAS `preview` (Test) and `production` values, then inspect the resolved variant with `APP_VARIANT=test npx expo config --type public` or the Production equivalent.
4. Use the `test` profile for the Dev-only Test app and the `production` profile for the Production app. `localpreview` remains an internal APK profile; `adhoc` is emergency-only.
5. Verify the EAS environment-variable summary, app identity, TEST banner and backend before distributing or submitting.

See the full [build, credential, store setup, tester and troubleshooting steps](eas-build-and-release.md).

Never publish tester passwords, signing keys or real setup links in release notes.
