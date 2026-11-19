# Configuration and setup links

_Last updated: 2026-11-19_

The repository root [`.env.example`](../../.env.example) lists local development fallback variables for organizer setup, authentication, the tour-data-api HTTP endpoint, optional mock data, logging and scan format. Copy it to an ignored `.env` for local development only. Store builds take backend and Firebase configuration from the EAS `preview` (Test) or `production` environment; do not commit populated environment files. `EXPO_PUBLIC_*` values are embedded in the app and **must never contain secrets**.

[`tools/setup-link-generator.html`](../../tools/setup-link-generator.html) assists an authorized organizer in preparing an invite setup link or QR. Keep generated links and configuration private; do not paste real configuration into documentation.

The backend `EXPO_PUBLIC_*` values for store builds are synced into EAS from the tour-data-api SSM handover by the [deployment workflow](deployment.md); do not set them by hand. Add `GOOGLE_SERVICES_JSON` through EAS as a file variable, one per environment. [`app.config.ts`](../../app.config.ts) resolves the variant identifiers and name from `APP_VARIANT`; [`eas.json`](../../eas.json) defines the profiles. Follow the [variant design](../design/app-variants-and-environments.md) and [EAS build guide](eas-build-and-release.md) before a store build.

Web hosting configuration is separate from EAS mobile configuration. It lives in an ignored `.env.web.<env>.local` file (template: `.env.web.example`) and never contains credentials or the HMAC/review variables. Public build values are passed to the web export through an allow-list only. See the [deployment guide](deployment.md#4-web-hosting-stack). App-owned SAM templates create only private S3/CloudFront hosting and an optional data-plane publisher role; backend authentication, API and storage resources remain owned by [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md).
