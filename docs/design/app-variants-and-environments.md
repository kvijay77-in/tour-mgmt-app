# App variants and environments

_Last updated: 2026-09-30_

This design defines two independently installable store apps built from the same code. `APP_VARIANT` is selected at build time; it does not add an in-app environment switch. The Test app always uses the Dev EAS environment, while the Production app uses Production except for the existing, narrowly scoped store-reviewer route.

## App identities

| Variant | iOS bundle ID / Android package | Store display name | URL scheme | Backend |
| --- | --- | --- | --- | --- |
| Production | `com.tourmgmt.app` | Tour Mgmt | `tour-mgmt-app` | Production; the configured store-reviewer username uses Dev |
| Test | `com.tourmgmt.app.dev` | Tour Mgmt (Test) | `tour-mgmt-app-dev` | Dev only; reviewer-routing variables are unset |

Create a fresh App Store Connect and Google Play record for each identifier (four records total). Abandon the earlier store record rather than trying to rename or reuse it. Test icon files currently copy the Production icons as placeholders; replace them with artwork carrying a clear **TEST** ribbon before distribution.

## Decisions

| ID | Decision |
| --- | --- |
| D1 | Keep one codebase and publish two separately installed store apps. |
| D2 | Production defaults to the Production Cognito pool and API. The Test app is built only with Dev Cognito/API values. |
| D3 | Sharing the Dev pool among Test apps and approved testers is acceptable; the Dev backend remains the authority for access control. |
| D4 | Create the app-reviewer account administratively in the Dev pool and assign the required review role there. |
| D5 | Rider sign-up in the Production experience always targets the primary Production pool. |
| D6 | Rider testers can self-sign-up in the Dev pool using the Test app. |
| D7 | Keep the existing username-based reviewer route only for the Production app. The Test EAS environment leaves every `EXPO_PUBLIC_REVIEW_*` variable unset. |
| D8 | Create four fresh store records, one iOS and one Android record per variant; abandon the earlier store record. |
| D9 | Use TestFlight external testing and Google Play testing tracks for Test distribution. iOS ad hoc distribution is an emergency-only fallback. |
| D10 | Store builds only; defer OTA updates. Do not configure an EAS Update release workflow for these variants. |
| D11 | Existing development-client and unit-testing workflows remain unchanged. Local mock data remains available for development only. |
| D12 | Do not commit populated `.env` files or backend values. Build-time values are configured in the EAS `preview` (Test) and `production` environments. |
| D13 | Register a separate Firebase Android app and FCM configuration for each package. A compatible APNs authentication key may be shared between the iOS apps. |
| D14 | The existing rider “Delete my account” behavior deletes the Cognito account only; it does not imply deletion of API-owned records. |

Google Play accounts subject to the personal-account policy must complete a closed test with at least 12 testers opted in continuously for 14 days against the Production app before applying for production access. Clean up test records from Production before go-live.

The existing OrgConfig/setup-link and QR behavior is dormant and out of scope. This change only renames the custom URL scheme; it does not alter setup parsing, signing, validation or routing.

## Store compliance and review

| Store requirement | Release consideration |
| --- | --- |
| Apple App Review Guideline 2.1 | Supply a working demo account and complete review instructions. Production review credentials use the existing reviewer routing to a Dev account. |
| Apple Guideline 5.1.1(v) | Keep the in-app account deletion path available. Explain accurately that current deletion is Cognito-only; backend-owned data deletion is a separate backend responsibility. |
| TestFlight expiry | TestFlight builds expire after 90 days. Publish a replacement build before testers' access expires. |
| TestFlight external testing | Complete Beta App Review when Apple requires it, and provide beta test information plus a usable Dev demo login. |
| Google Play internal testing | Internal testing supports up to 100 testers; use it for small, rapid distribution. |
| Google Play Data safety | Provide an account/data deletion URL and accurate disclosure of data collected and shared. |
| Google Play personal accounts | If applicable, complete the closed-test requirement (12 testers for 14 days) and request production access. |

## Build configuration

### `app.config.ts`

`APP_VARIANT` accepts `test` or `production`; absent or unrecognized values resolve to Production. The Expo config selects the app name, scheme, icons and platform identifiers, and exports `extra.appVariant` for runtime UI. `GOOGLE_SERVICES_JSON` is optional and is applied only when EAS supplies it. Do not reintroduce static bundle identifiers, Android packages, store build numbers or universal-link filters in `app.json`.

The Test icon paths currently point to copies of the existing icons pending final Test artwork.

### `eas.json`

| Profile | EAS environment | Purpose |
| --- | --- | --- |
| `development` | Existing development behavior | Development client; unchanged |
| `localpreview` | Preview/Test values | Existing internal APK workflow with `APP_VARIANT=test` |
| `test` | `preview` | Store-distributed Test app, Test channel, auto-increment |
| `adhoc` | Inherits `test` | Emergency internal iOS ad hoc build only |
| `production` | `production` | Store-distributed Production app, Production channel, auto-increment |

Submit configuration maps the `test` iOS record to `<ASC_APP_ID_DEV>` and Production to `<ASC_APP_ID_PROD>`. Android submission uses the `internal` track for Test and `alpha` for Production; review and release timing remain controlled by the release owner.

### EAS environment variables

Configure app-specific values in the EAS environment; public `EXPO_PUBLIC_*` values are embedded in the app and are not secrets.

| Variable | `preview` (Test) | `production` |
| --- | --- | --- |
| `EXPO_PUBLIC_AWS_REGION` | Dev | Prod |
| `EXPO_PUBLIC_AWS_USER_POOL_ID` | Dev | Prod |
| `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID` | Dev | Prod |
| `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` | Dev, if used | Prod, if used |
| `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` | Dev | Prod |
| `EXPO_PUBLIC_REVIEW_USERNAME` | Not set | Reviewer email |
| `EXPO_PUBLIC_REVIEW_AWS_REGION`, `EXPO_PUBLIC_REVIEW_AWS_USER_POOL_ID`, `EXPO_PUBLIC_REVIEW_AWS_USER_POOL_WEB_CLIENT_ID`, `EXPO_PUBLIC_REVIEW_AWS_IDENTITY_POOL_ID`, `EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL` | Not set | Dev |
| `GOOGLE_SERVICES_JSON` (file, secret) | Test Firebase `google-services.json` | Production Firebase `google-services.json` |

Never define reviewer routing in `preview`: the Test app has no Production backend path. Keep service-account keys and Firebase files out of source control.

## Runtime reviewer routing

The Production build starts on its primary profile. Before authenticating, `routeBackendForLogin()` sends only the configured reviewer username to the Dev Cognito pool and API. After that sign-in succeeds, the app writes `review.active` to SecureStore.

On restart, `App.tsx` loads the current primary OrgConfig/environment and initializes the backend router first. It then checks `review.active`; when set, it configures Amplify and the API client for the Dev reviewer profile **before** mounting `AuthProvider`. `AuthContext` therefore calls `getCurrentUser()` and `fetchAuthSession()` against the same pool that owns the persisted session. Successful reviewer authentication refreshes the flag; sign-out clears it. Ordinary Production users, including users of the Test app, do not activate this routing. Server-side authorization remains authoritative.

## TEST banner and diagnostics

`TestBanner` is mounted at the app root and checks `Constants.expoConfig?.extra?.appVariant`. It shows an accessible, persistent red **TEST** strip in the Test app, including setup, loading, login and authenticated screens. Production has no banner, including during a reviewer session. Startup logging reports only the app variant and API host; do not log credentials, tokens or full configuration.

## Release process

1. Configure and verify EAS `preview` and `production` values independently, including each Android Firebase file.
2. Build and distribute the Test variant. Exercise Dev signup, login, push, offline behavior and key organizer/rider workflows using the TEST ribbon to confirm the backend.
3. Complete required store-track testing. Where Google's personal-account requirement applies, run the 12-tester / 14-day Production-app test and remove test data from Production before go-live.
4. Build the Production variant and smoke-test the actual Production build on iOS and Android before submission. Verify its name, IDs, scheme, absence of the TEST ribbon, API host, reviewer login and account deletion flow.
5. Submit to App Review / Play review with working reviewer credentials and release notes. Hold or manually release store submissions after approval; do not promote a Test binary to the Production app because they have different identifiers.
6. Keep the Test listing Dev-only after the Production app is live. Never use Production credentials or personal data in the Dev pool.

See the step-by-step [EAS build and release guide](../guides/eas-build-and-release.md).

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Testers mistake the Test app for Production | Distinct app name, bundle/package ID, URL scheme, store listing and persistent TEST ribbon. Replace placeholder icons with TEST-ribbon artwork. |
| A Production reviewer session restores against the wrong Cognito pool | Persist `review.active` only after successful reviewer authentication and apply the review profile before the Auth provider's first session lookup. |
| Dev identifiers or service files reach the wrong EAS environment | Maintain separate EAS values and file variables; verify the build's environment and app identity before submission. |
| Test data enters Production | Test app is Dev-only; smoke-test Production intentionally and follow the Google test-data cleanup step. Backend access control remains required. |
| Testers confuse Production-track app and Dev Test app | Explain which listing/build is being tested, and confirm the ribbon and demo login in each test invitation. |
| Placeholder branding creates store/review confusion | Replace copied Test icons with final artwork containing a prominent TEST ribbon before store distribution. |

## Implementation plan

- [x] Add variant-specific Expo identifiers, names, schemes and icons.
- [x] Configure EAS Test, emergency ad hoc and Production store profiles and submission tracks.
- [x] Restore reviewer sessions before Amplify session lookup and show the Test-only root banner.
- [x] Document environment isolation, compliance and the EAS build/release procedure.
- [ ] Replace placeholder Test icons with final TEST-ribbon artwork before first public Test distribution.
