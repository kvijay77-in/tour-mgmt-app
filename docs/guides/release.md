# App release and distribution

_Last updated: 2026-09-29_

This guide covers **EAS client builds**, not deployment of backend infrastructure. The backend's [deployment guide](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md) owns all AWS resources and service setup. Have an authorized release owner review the current [`app.json`](../../app.json), [`eas.json`](../../eas.json) and [configuration guidance](configuration.md) before building.

1. Complete the checks in the [development guide](development.md).
2. Sign in to your Expo account with `npx eas-cli login`. If the project is not linked, initialize it with `npx eas-cli init` and review the resulting app configuration.
3. Set the required build environment in EAS using approved organizer configuration. `tools/push-eas-env.sh` and `tools/EAS.env` are local release aids; verify profile, values and visibility before running them. Expo public variables are packaged into the app and are not secrets.
4. Choose the profile from `eas.json`: `development` builds a development client; `localpreview` builds an internally distributed Android APK; `preview` and `production` build store-distribution bundles. Run `npx eas-cli build --platform android --profile localpreview` for an internal APK, or choose the matching platform/profile for a store build.
5. Distribute internal builds only to invited testers. For store releases, use the relevant store review and distribution process and verify the correct organizer configuration and account routing before submission.

Do not infer a profile's distribution type from its name: consult `eas.json` before each release. A generic organizer setup link/QR is separate from build-time fallback configuration. Never publish tester passwords, signing keys or real setup links in release notes.
