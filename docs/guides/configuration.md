# Configuration and setup links

_Last updated: 2026-09-29_

The repository root [`.env.example`](../../.env.example) lists development fallback variables for organizer setup, authentication, the tour-data-api HTTP endpoint, optional mock data, logging and scan format. Copy it to an ignored `.env` for development. Expo variables with `EXPO_PUBLIC_` are embedded in the client and **must never contain secrets**; review any signing material and use an approved secure publishing process. The existing setup-link flow is described in [app distribution](../design/app-distribution.md).

[`tools/setup-link-generator.html`](../../tools/setup-link-generator.html) assists an authorized organizer in preparing an invite setup link or QR. Keep generated links and configuration private; do not paste real configuration into documentation.

[`tools/EAS.env`](../../tools/EAS.env) and [`tools/push-eas-env.sh`](../../tools/push-eas-env.sh) relate to EAS build-time configuration; inspect values before use and do not add credentials to tracked files. [`eas.json`](../../eas.json) defines app build profiles and [`app.json`](../../app.json) defines Expo application settings. Follow the [release guide](release.md) when distributing a build.

Backend authentication, API and storage resources are owned by [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md); this repository creates no AWS infrastructure.
