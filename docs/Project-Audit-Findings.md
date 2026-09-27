# Project Audit — Findings and Recommendations

[← Back to README](../README.md) · [Documentation Index](docs-index.md)

| | |
|---|---|
| **Branch audited** | `feature-event-engine` (commit `715f6b4` "Event engine major dev") |
| **Audit date** | 2026-09-27 |
| **Scope** | Whole repo: `src/**` (~33.5k lines TS/TSX), `App.tsx`, `app.json`, `eas.json`, `tools/`, build/lint config, docs vs code |
| **Baseline health** | `npx tsc --noEmit` → 0 errors · `npm run lint` → 0 errors, 12 warnings (10 × `no-explicit-any`, 1 × `no-unused-vars`, 1 × `exhaustive-deps`) · no automated tests |

## How to use this document

Each finding has an ID, severity, where it is, what we saw, why it matters and what to do. There is also a **Decision** line for you to fill in (Accept / Reject / Defer). No code has been changed as part of this audit.

**Severity scale**

- **High**: likely to cause a security incident, data loss, broken core flow or a requirement violation. Fix before the next production release.
- **Medium**: a real weakness or inefficiency with noticeable impact. Plan it in.
- **Low**: hygiene or polish, or a small improvement that is cheap to do.

**Categories:** `SEC` Security · `DES` Design / Architecture · `PERF` Performance · `REF` Code refactoring · `UX` UI / User experience.

---

## Summary

| ID | Title | Sev. |
|----|-------|------|
| [SEC-01](#sec-01-setup-link-hmac-key-is-shipped-inside-the-app-bundle) | Setup-link HMAC key is shipped inside the app bundle | High |
| [SEC-02](#sec-02-org-config-from-setup-link-is-not-validated-for-https--trusted-hosts) | Org config from setup link not validated for HTTPS / trusted hosts | High |
| [SEC-03](#sec-03-remember-me-stores-the-plaintext-password) | "Remember me" stores the plaintext password | High |
| [SEC-04](#sec-04-logout-does-not-clear-local-data) | Logout does not clear local data (SQLite / SecureStore / AsyncStorage) | Medium |
| [SEC-05](#sec-05-post-requests-are-auto-retried-without-an-idempotency-key) | POST requests are auto-retried without an idempotency key | Medium |
| [SEC-06](#sec-06-backend-config-values-hard-coded-in-easjson-and-committed-toolseasenv) | Backend config hard-coded in `eas.json` + committed `tools/EAS.env` | Medium |
| [SEC-07](#sec-07-unneeded-record_audio-permission-and-misleading-camera-rationale) | Unneeded `RECORD_AUDIO` permission and misleading camera rationale | Medium |
| [SEC-08](#sec-08-placeholder-deep-link-domain-and-hijackable-custom-scheme) | Placeholder deep-link domain and hijackable custom scheme | Low |
| [SEC-09](#sec-09-user_password_auth-flow-instead-of-srp) | `USER_PASSWORD_AUTH` flow instead of SRP | Low |
| [SEC-10](#sec-10-raw-backend--cognito-error-text-shown-to-users-and-usernames-in-logs) | Raw backend / Cognito error text shown to users and usernames in logs | Low |
| [SEC-11](#sec-11-backend-source-snapshot-zip-committed-in-the-app-repo) | Backend source snapshot `.zip` committed in the app repo | Low |
| [DES-01](#des-01-cold-start-while-offline-signs-the-user-out) | Cold start while offline signs the user out | High |
| [DES-02](#des-02-ride-check-in-is-online-only-offline-sync-layer-is-dead-code) | Ride check-in is online-only; offline sync layer is dead code | High |
| [DES-03](#des-03-today-is-computed-in-utc-in-the-ride-module) | "Today" is computed in UTC in the ride module | High |
| [DES-04](#des-04-no-sqlite-schema-versioning--migrations) | No SQLite schema versioning / migrations | Medium |
| [DES-05](#des-05-no-local-data-retention--cleanup) | No local data retention / cleanup | Medium |
| [DES-06](#des-06-event-sync-queue-has-no-backoff-max-retry-or-head-of-line-protection) | Event sync queue: no backoff, max-retry or head-of-line protection | Medium |
| [DES-07](#des-07-401-handling-retries-with-the-same-cached-token) | 401 handling retries with the same cached token | Medium |
| [DES-08](#des-08-no-automated-tests-ci-typecheck-script-or-prettier) | No automated tests, CI, typecheck script or Prettier | Medium |
| [DES-09](#des-09-error-boundaries-only-at-the-root) | Error boundaries only at the root | Low |
| [DES-10](#des-10-docs-out-of-sync-with-code) | Docs out of sync with code | Low |
| [PERF-01](#perf-01-dashboard-rider-grid-is-not-virtualised) | Dashboard rider grid is not virtualised | High |
| [PERF-02](#perf-02-four-context-providers-recreate-their-value-every-render) | Four context providers recreate their value every render | Medium |
| [PERF-03](#perf-03-bulk-sqlite-upserts-without-a-transaction) | Bulk SQLite upserts without a transaction | Medium |
| [PERF-04](#perf-04-worst-case-request-latency-of-over-a-minute) | Worst-case request latency of over a minute | Medium |
| [PERF-05](#perf-05-no-component-memoisation-inline-closures-in-large-lists) | No component memoisation; inline closures in large lists | Low |
| [PERF-06](#perf-06-event-sync-loop-keeps-running-in-the-background) | Event sync loop keeps running in the background | Low |
| [PERF-07](#perf-07-unbounded-failed-records-query) | Unbounded "failed records" query | Low |
| [REF-01](#ref-01-split-the-1000-line-screens) | Split the 1,000+ line screens | Medium |
| [REF-02](#ref-02-extract-a-shared-user-picker-for-the-four-admin-user-screens) | Extract a shared user picker for the four admin user screens | Medium |
| [REF-03](#ref-03-one-date-utility-and-one-resolvetodayride) | One date utility and one `resolveTodayRide` | Medium |
| [REF-04](#ref-04-one-sync-engine-for-check-ins-and-event-records) | One sync engine for check-ins and event records | Medium |
| [REF-05](#ref-05-tolerant-multi-shape-api-parsing-hides-contract-drift) | Tolerant multi-shape API parsing hides contract drift | Low |
| [REF-06](#ref-06-hard-coded-colours-and-ui-strings) | Hard-coded colours and UI strings | Low |
| [REF-07](#ref-07-state-clusters--usereducer-shared-loadingerrorempty-pattern) | State clusters → `useReducer`; shared loading/error/empty pattern | Low |
| [REF-08](#ref-08-clear-the-lint-warnings-and-the-one-inline-style) | Clear the lint warnings and the one inline style | Low |
| [REF-09](#ref-09-dead-code-and-empty-files) | Dead code and empty files | Low |
| [UX-01](#ux-01-alertalert-is-a-no-op-on-web-admin-actions-and-scan-recovery-break) | `Alert.alert` is a no-op on web: admin actions and scan recovery break | High |
| [UX-02](#ux-02-no-offline-indicator-or-manual-offline-toggle-in-the-ride-dashboard--check-in) | No offline indicator / manual toggle in Ride Dashboard & Check-In | Medium |
| [UX-03](#ux-03-accessibility-coverage-is-partial) | Accessibility coverage is partial | Medium |
| [UX-04](#ux-04-inconsistent-pull-to-refresh-retry-and-keyboard-handling) | Inconsistent pull-to-refresh, retry and keyboard handling | Low |
| [UX-05](#ux-05-scanner-pause-feedback-and-sync-issue-actions) | Scanner pause feedback and sync-issue actions | Low |
| [UX-06](#ux-06-app-identity-and-theme) | App identity and theme | Low |

Suggested order if you accept everything: **SEC-01, SEC-02, SEC-03, DES-01, DES-03, UX-01, DES-02** first, then the Medium items.

---

## 1. Security

### SEC-01 Setup-link HMAC key is shipped inside the app bundle
- **Severity:** High
- **Where:** `src/services/config/orgConfigService.ts:23-31` (`process.env.EXPO_PUBLIC_SETUP_HMAC_KEY`), `tools/setup-link-generator.html:327-329`, `.env.example`
- **Observation:** Setup links / QR codes are verified with HMAC-SHA256. HMAC is symmetric, so the same secret signs and verifies. Because the key is an `EXPO_PUBLIC_*` variable, Expo inlines it as plain text in the JS bundle of every APK/IPA/web build.
- **Impact:** Anyone who unpacks the app can pull out the key and **forge valid setup links**. A forged link can point the app at an attacker's Cognito pool and API (see SEC-02), and the real login screen would then send users' credentials to the attacker (phishing). The constant-time compare and signature check give a false sense of safety.
- **Recommendation:**
  1. Switch to **asymmetric signatures** (Ed25519 or ECDSA P-256). Bundle only the **public** key in the app. Keep the private key offline, in the generator or a small backend signing service.
  2. Add `iat`/`exp` (issued/expiry) and a `kid` (key id) to the payload so links expire and keys can be rotated.
  3. After the change, rotate the current HMAC key and treat old links as invalid.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-02 Org config from setup link is not validated for HTTPS / trusted hosts
- **Severity:** High
- **Where:** `src/services/config/orgConfigService.ts:163-174` (`isValidOrgConfig`), `src/screens/auth/OrgSetupScreen.tsx:57-73`
- **Observation:** Validation only checks that the fields are non-empty strings. `apiBaseUrl` can be `http://…` or any host. `awsRegion` / `userPoolId` are not checked for format.
- **Impact:** Together with SEC-01, a crafted link can move all API traffic, including the bearer token, to an untrusted or cleartext endpoint. Even without forgery, a typo in a real link could send the app to the wrong place.
- **Recommendation:** Require `https:`. Check `apiBaseUrl` against a host allow-list or pattern (for example `*.execute-api.<region>.amazonaws.com` or your custom API domain). Check `userPoolId` against `^<region>_[A-Za-z0-9]+$` and require `awsRegion` to match its prefix. Show the org name and API host on a confirmation screen before saving.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-03 "Remember me" stores the plaintext password
- **Severity:** High
- **Where:** `src/screens/auth/LoginScreen.tsx:56-76` (reads it back and pre-fills the field) and `:102-110` (stores `{ username, password }`), `src/screens/auth/NewPasswordScreen.tsx:75-80`
- **Observation:** The user's Cognito password is saved as JSON in `expo-secure-store` and pre-filled on the next launch.
- **Impact:** SecureStore uses the Keychain/Keystore, which is good. But a stored password can still be read on a rooted or jailbroken device, in some backup setups, or by anyone holding an unlocked device (the password field is pre-filled and has a "show password" toggle). Staff often share devices at pit stops. Amplify already keeps a refresh token, so the password is not needed to stay signed in. On web, SecureStore is not available at all.
- **Recommendation:** Store **only the username**. Rely on Amplify's refresh-token session for "stay signed in", and set the Cognito refresh-token validity to cover a whole tour. Optionally add biometric unlock (`expo-local-authentication`) to resume the session. On upgrade, delete any stored password.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed (offline feature). Password saved only with "Remember me" in SecureStore (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY, never AsyncStorage); offline sign-in verifies a salted hash, needs a device screen lock, biometric/PIN unlock via expo-local-authentication, expiry (offlineLoginMaxDays) and lock-out (offlineLoginMaxAttempts). Login screen warns when no screen lock is set.

### SEC-04 Logout does not clear local data
- **Severity:** Medium
- **Where:** `src/context/AuthContext.tsx:314-323` (`logout`). SQLite schema in `src/services/database/database.ts` (for example `riders` with email/phone/emergency contacts at `:49-61`, `event_dashboard_snapshots`, `my_tour_assignment`, `room_allocations`). SecureStore/AsyncStorage keys in `recentCheckInsService.ts`, `pitStopContextService.ts`, `HotelAllocationUploadScreen.tsx`.
- **Observation:** Logout only calls `signOut()` and resets React state. Rider names/IDs, dashboard snapshots, room allocations, the user's tour assignment and recent check-ins stay on the device. The next user of a shared device (or the same device after a role change) inherits them.
- **Impact:** A privacy / data-protection gap (rider PII, hotel room assignments). It can also show one user's assignment-filtered data to another user.
- **Recommendation:** Add one `clearUserData()` service (SQLite tables except app config, user-scoped SecureStore/AsyncStorage keys, in-memory caches such as `NameDirectoryContext`). Call it on logout and on a forced session invalidation. **Before wiping, warn if there are unsynced records** (`getUnsyncedEventRecordCount()`) and let the user choose: sync now, or discard and continue.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. User-scoped cache cleared and other users' queued data discarded on user switch; retention job limits stored data.

### SEC-05 POST requests are auto-retried without an idempotency key
- **Severity:** Medium (data integrity)
- **Where:** `src/services/api/apiClient.ts:271-422`: every method, including `POST`, is retried up to 3 times on 5xx, 429, network error **and timeout** (`AbortError`).
- **Observation:** A timeout does not mean the server did nothing. A POST that timed out may already have been committed. Event-record sync opts out (`maxRetries: 0`, `eventSyncService.ts:59`) and relies on the server's natural key (`riderId#activityId#timestamp`). Other POSTs (interactive check-in, tour/ride create, user onboarding, hotel stay upsert, rider exit) use the default retries.
- **Impact:** Possible duplicate side effects (for example a user created twice, or a double rider exit call) and confusing "already exists" errors after an apparent timeout.
- **Recommendation:** Default `maxRetries` to 0 for non-idempotent methods (POST), and opt in per call where the server dedupes. Longer term, send an `Idempotency-Key` header (client UUID, reusing `localId` for queued ops) and have the backend honour it.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. Offline fail-fast and clear offline error messages in apiClient.

### SEC-06 Backend config values hard-coded in `eas.json` and committed `tools/EAS.env`
- **Severity:** Medium
- **Where:** `eas.json:28-40` (`localpreview` profile: user pool ID, client ID, API URL, reviewer username); `tools/EAS.env` (committed, populated).
- **Observation:** Cognito pool/client IDs and API URLs are not secrets on their own (they ship in every build). But committing them breaks the project rule *"No hardcoding of any credentials, URLs, or configuration values directly in the codebase"*. It also publishes the **store-reviewer username** and the Dev API URL. `tools/push-eas-env.sh` already exists to push values to EAS environments.
- **Impact:** Configuration drift between profiles, reconnaissance value for attackers (reviewer account plus Dev endpoint), and a habit that makes it easy to commit a real secret one day (the HMAC key in SEC-01 already goes through the same `EXPO_PUBLIC_*` path).
- **Recommendation:** Move the `localpreview` values into an EAS environment (`eas env:create`/`push-eas-env.sh`). Rename `tools/EAS.env` to `tools/EAS.env.example` with empty values and add `tools/EAS.env` to `.gitignore`. Give the reviewer account a strong password, a minimal role and Dev-only data. Consider purging the history if the repo is ever made public.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-07 Unneeded `RECORD_AUDIO` permission and misleading camera rationale
- **Severity:** Medium (store review and privacy)
- **Where:** `app.json:48` (`android.permission.RECORD_AUDIO`), `app.json:66` (`cameraPermission` text)
- **Observation:** The app only plays sounds (`feedbackService.ts` uses `expo-audio` for playback). It never records. `Requirements.md` → *Others*: "Mobile device permission is only required for Camera". The camera rationale says it is for "the organisation setup QR code", but the camera is mainly used for rider check-in and event scanning.
- **Impact:** Google Play and App Store reviewers flag unexplained microphone permissions. Users see a permission they do not expect. A wrong rationale string is a known cause of iOS rejection.
- **Recommendation:** Remove `RECORD_AUDIO`. If an `expo-audio` or `expo-camera` plugin adds it automatically, set `"recordAudioAndroid": false` / `microphonePermission: false` in the plugin config and use `blockedPermissions`. Reword the camera text, for example "Camera is used to scan rider and setup QR codes."

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-08 Placeholder deep-link domain and hijackable custom scheme
- **Severity:** Low
- **Where:** `app.json:9` (`"scheme": "checkin-app"`), `app.json:12-14` and `:31-45` (`setup.checkin-app.example.com`)
- **Observation:** The universal/app-link domain is the `example.com` placeholder, so `autoVerify` can never succeed. Setup therefore depends on the custom scheme, which **any other app can also register**.
- **Impact:** Setup links may open in another app or not open at all. Combined with SEC-01, this widens the phishing surface.
- **Recommendation:** Host `assetlinks.json` / `apple-app-site-association` on a real domain you own and update `app.json`. Treat the custom scheme as a fallback only. Use a more unique scheme name (for example `com.kvijay77.tourmgmt`).

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-09 `USER_PASSWORD_AUTH` flow instead of SRP
- **Severity:** Low
- **Where:** `src/context/AuthContext.tsx:229-243`
- **Observation:** `USER_PASSWORD_AUTH` sends the password to Cognito (over TLS). The default `USER_SRP_AUTH` never sends the password. This flow is usually chosen for user migration Lambdas, and none seems to exist here.
- **Impact:** A small extra exposure if TLS is intercepted (corporate proxies, a compromised CA). The app client must also have `ALLOW_USER_PASSWORD_AUTH` enabled.
- **Recommendation:** Use the default SRP flow unless there is a specific reason. If you switch, turn off `ALLOW_USER_PASSWORD_AUTH` on the app client.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-10 Raw backend / Cognito error text shown to users and usernames in logs
- **Severity:** Low
- **Where:** `AuthContext.tsx:275-276, 306, 334` (`err.message` shown as is); many screens use `err instanceof Error ? err.message : …`. `AuthContext.tsx:115,118,185` log group lists and the username at INFO/WARN.
- **Impact:** Users see technical messages (for example `UserLambdaValidationException…`, `HTTP 500`). Logs from field devices hold identifiers. There is minor account enumeration through Cognito messages if "prevent user existence errors" is off.
- **Recommendation:** Map known Cognito/API error codes to friendly text in one helper, and fall back to a generic message plus a correlation id. Log usernames only at DEBUG, or masked. Make sure "Prevent user existence errors" is on in the pool.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### SEC-11 Backend source snapshot `.zip` committed in the app repo
- **Severity:** Low
- **Where:** `tour-data-api-main.zip` (≈760 KB; includes `samconfig.toml`, CloudFormation, and a nested `poc-app-main.zip`)
- **Impact:** Repo bloat. A stale copy of the backend that can drift from the real API. It exposes infrastructure details (stack names, parameters) to everyone with app-repo access.
- **Recommendation:** Remove it from the repo and reference the backend repo (a git submodule, since `.gitmodules` already exists but is empty, or just a link). If a reference copy is needed for AI tools, keep it outside git.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

---

## 2. Design / Architecture

### DES-01 Cold start while offline signs the user out
- **Severity:** High (breaks the offline requirement)
- **Where:** `src/context/AuthContext.tsx:181-216`
- **Observation:** On startup the app calls `fetchAuthSession({ forceRefresh: true })`. If that throws, or returns no token, the code calls `signOut()` and shows the login screen. Offline, the forced refresh cannot reach Cognito, so the user is signed out and local tokens are cleared.
- **Impact:** A pit-stop or hotel user who opens the app (or whose app was killed by the OS) in a no-signal area **cannot get back in** until they have connectivity. Offline event scanning (`EventScanScreen`, `eventSyncService`) and the offline dashboard snapshot are then unusable, although that is the main scenario in `Requirements.md` → *Offline Capability*.
- **Recommendation:** Do a **non-forced** `fetchAuthSession()` on startup and accept cached tokens. Only sign out on a definite auth failure (`NotAuthorizedException`, refresh token revoked), never on a network error. Keep the server-side "force revalidate" check for when the device is online. Show a "Signed in (offline)" state. Test in airplane mode.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. AuthContext rewritten: offline session resume/sign-in from the saved profile, re-authentication when connectivity returns, user-switch guard.

### DES-02 Ride check-in is online-only; offline sync layer is dead code
- **Severity:** High (requirement gap)
- **Where:** `src/screens/checkin/CheckInScreen.tsx:452-522` calls `createInteractiveCheckIn` / `overrideInteractiveCheckIn` directly. `src/services/sync/syncService.ts` (343 lines), `riderStore.ts`, `rideStore.ts`, `checkInStore.insertLocalCheckIn`, `pendingStore.enqueueCheckIn` and `database.purgeClosedRideData` are **not called anywhere** (`project-structure.md:137` also says "not wired yet").
- **Observation:** `Requirements.md` → *Offline Capability*: "All check in should be captured in mobile device local database/storage and asynchronously updated…". The event engine meets this (write-local-first). The ride module does not.
- **Impact:** Ride check-ins at remote pit stops fail without signal. A large, untested sync module sits in the codebase and is easy to assume works.
- **Recommendation:** Decide explicitly. **(a)** Wire ride check-ins through the same write-local-first queue the event engine uses (see REF-04), or **(b)** formally scope ride check-in as online-only, update the requirement, and delete `syncService.ts` and the unused stores and tables.

**Decision:** ☐ Accept (a) ☐ Accept (b) ☐ Reject ☐ Defer

**Status:** ✅ Completed. Ride check-ins are captured locally when offline (checkInSync.captureCheckInLocally), validated against cached history (utils/checkInValidation) and sent by the outbound sync engine with capture timestamps.

### DES-03 "Today" is computed in UTC in the ride module
- **Severity:** High (functional bug)
- **Where:** `new Date().toISOString().split('T')[0]` at `DashboardScreen.tsx:60`, `DashboardTabsHeader.tsx:40` and `:158`, `RideStatusManagementScreen.tsx:94`, `CheckInLogScreen.tsx:46`
- **Observation:** `toISOString()` is UTC. For IST (UTC+05:30), between 00:00 and 05:29 local time "today" is still **yesterday**. Ride flag-off is often early morning. The event engine already uses the correct local helper `toLocalDateString()` in `src/utils/eventActivity.ts:88`.
- **Impact:** Early in the morning the Dashboard picks the wrong ride, Ride Status Management refuses "Open/Start today's ride" ("Only today's ride…"), and the Check-In Log filters the wrong day.
- **Recommendation:** Replace all five places with a shared local-date helper (see REF-03). Better still, compare against the tour's time zone if tours can be outside the device's zone. Add unit tests around midnight and 05:30.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Shared utils/dates.ts (device-local date) used for "today".

### DES-04 No SQLite schema versioning / migrations
- **Severity:** Medium
- **Where:** `src/services/database/database.ts:35-279` (a single `CREATE TABLE IF NOT EXISTS` script plus ad-hoc `ALTER TABLE … ADD COLUMN` checks at `:250-264`)
- **Impact:** Column additions work, but renames, type changes, new constraints, index changes and data backfills cannot be expressed safely. There is no way to know what state a device's DB is in, and a failed half-migration is not detected.
- **Recommendation:** Use `PRAGMA user_version` and a list of ordered migration functions, each run in a transaction, with the version bumped on success. Freeze the current script as migration 1.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Versioned SQLite migrations (migrations.ts) and readiness caches with sync_meta timestamps; data is cached on every online load so offline is available instantly.

### DES-05 No local data retention / cleanup
- **Severity:** Medium
- **Where:** `database.purgeClosedRideData` (`database.ts:298-310`) is never called. There is no TTL for `event_dashboard_snapshots`, `event_activity_records` (synced), `pending_operations` (FAILED), `room_allocations` or `my_tour_assignment`.
- **Impact:** The DB grows for the whole tour and across tours. Old snapshots may be shown for the wrong day. It also adds to the privacy concern in SEC-04.
- **Recommendation:** Add a retention job on app start or foreground (for example: delete synced records older than N days and snapshots for occurrences before today−1, clear everything on tour change). Never delete unsynced rows automatically; surface them instead.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. services/offline/retentionService.ts purges synced data of past rides/events older than retentionDays (checked on start/foreground, at most twice a day). Unsynced rows are never deleted.

### DES-06 Event sync queue has no backoff, max-retry or head-of-line protection
- **Severity:** Medium
- **Where:** `src/services/sync/eventSyncService.ts:256-271` (`runBatch` stops at the first transient failure), `:295-323` (fixed 3 s `setInterval`), `:162-167` (transient errors only increment a counter)
- **Observation:** The design is sound: serialised, ordered, crash-recovery reset, natural-key dedupe. But if the **oldest** op keeps failing with a transient error (for example a persistent 5xx for one payload), every newer scan waits behind it forever. The loop retries every 3 s with no backoff. `retryCount` is recorded but never used to give up.
- **Impact:** A silent backlog of scans, battery and data use, and backend load when many devices reconnect at once.
- **Recommendation:** Add exponential backoff with jitter per op (`nextAttemptAt`). After N attempts, move the op to FAILED and continue with the next one, so it shows in "Sync issues" with Retry/Discard. Trigger an immediate batch on NetInfo "online" rather than relying only on polling.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Unified outbound sync engine (services/sync/outboundSyncService.ts) with exponential backoff + jitter, maxSyncAttempts, per-family head-of-line protection, FAILED items surfaced in Sync status.

### DES-07 401 handling retries with the same cached token
- **Severity:** Medium
- **Where:** `src/services/api/apiClient.ts:317-329`, token provider `AuthContext.tsx:163-170`
- **Observation:** On a 401 the client calls `_getAuthToken()` again, which runs `fetchAuthSession()` **without** `forceRefresh`. That usually returns the same token, so the retry fails the same way. It then falls through to the generic error path, and `_onAuthInvalidated` only fires when no token is returned at all.
- **Impact:** A token revoked server-side (user disabled, global sign-out) results in repeated errors instead of a clean re-login. Token refresh races are not handled.
- **Recommendation:** Let the provider accept `{ forceRefresh: true }` for the 401 path. If the forced refresh fails with an auth error, call `_onAuthInvalidated`. Share one in-flight refresh promise between concurrent requests.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. apiClient forces a token refresh and retries once on 401.

### DES-08 No automated tests, CI, typecheck script or Prettier
- **Severity:** Medium
- **Where:** `package.json` (scripts: only start/lint), no `.github/workflows/`, no Prettier dependency or config (although the Copilot instructions ask for ESLint + Prettier and unit tests for critical functions)
- **Impact:** Critical pure logic has no regression safety: role resolution, `permissions.ts`, `eventActivity.ts`, `riderStatus.ts`, `idCodeService.ts`, check-in validation matrix, date logic (DES-03 would have been caught). `tsc` currently passes, but nothing enforces that.
- **Recommendation:** Add `jest-expo` + `@testing-library/react-native`, start with the pure utils above, and add a `typecheck` (`tsc --noEmit`) script. Add a small GitHub Actions workflow (install → lint → typecheck → test) on PRs. Add Prettier with `eslint-config-prettier`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. jest-expo with lightweight unit tests (npm test) and a typecheck script added; CI/Prettier not in scope.

### DES-09 Error boundaries only at the root
- **Severity:** Low
- **Where:** `App.tsx:115-131` (the only `ErrorBoundary` usages)
- **Impact:** A render error in any screen (for example a malformed API payload on the Dashboard) replaces the whole app with the fallback, and the user loses navigation.
- **Recommendation:** Wrap each stack screen (or each module: Ride, Events, Admin) in a boundary with "Go Home / Retry". Log the error through `logger`, and to a crash reporter if you add one (for example Sentry's Expo SDK, free tier).

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### DES-10 Docs out of sync with code
- **Severity:** Low
- **Where:** `docs/project-structure.md` lists `src/hooks/*`, `RoleContext.tsx`, `utils/validators.ts`, `utils/formatters.ts`, `config/database.ts`, `services/qrcode/` and an `amplify/` folder, none of which exist. It does not list `NameDirectoryContext.tsx`, `RideSessionContext.tsx`, `config/reviewAccess.ts`, `constants/layout.ts`, `services/config/recentCheckInsService.ts` / `scanPauseConfigService.ts` or `services/feedback/`. `migration-cleanup.md` says `OfflineContext` is never mounted, but it is now mounted in `RootNavigator.tsx:41`.
- **Impact:** New contributors (and AI assistants that follow these docs strictly) are misled.
- **Recommendation:** Refresh `project-structure.md` and `migration-cleanup.md`. Consider generating the tree section from the file system.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. Audit findings updated; remaining offline design docs to be refreshed.

---

## 3. Performance

### PERF-01 Dashboard rider grid is not virtualised
- **Severity:** High (the most used screen)
- **Where:** `src/screens/dashboard/DashboardScreen.tsx:792-796`: `<ScrollView>` + `filteredRiders.map(...)`, with per-rider colour, float and status work done inside an IIFE in render
- **Observation:** Every rider tile is mounted at once and re-rendered on any state change (zoom, stage filter, check-in event, context update). Across the whole app there is only **1** `FlatList` against **33** `ScrollView`s.
- **Impact:** Janky pinch-zoom and scrolling and slow updates on low-end Android devices with 100+ riders. This gets worse with PERF-02.
- **Recommendation:** Use `FlatList` with `numColumns` (the key depends on zoom level), `getItemLayout` (fixed tile size per zoom), `initialNumToRender`/`windowSize`, and a `React.memo` `RiderTile` that receives precomputed props. Move the per-rider derivation into a `useMemo` keyed on riders/check-ins/ride/zoom.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### PERF-02 Four context providers recreate their value every render
- **Severity:** Medium
- **Where:** `AuthContext.tsx:342`, `TourContext.tsx:105`, `OfflineContext.tsx:100`, `RideSessionContext.tsx:100` (not memoised). `AppConfigContext`, `EventSessionContext` and `NameDirectoryContext` already use `useMemo`.
- **Impact:** Any re-render of these providers re-renders every consumer. The Auth and Tour providers wrap the whole app, and RideSession (19 fields) wraps Dashboard, Check-In and Log.
- **Recommendation:** Wrap each `value` in `useMemo`, and the callbacks in `useCallback`. Consider splitting `RideSessionContext` into data and UI-state contexts.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### PERF-03 Bulk SQLite upserts without a transaction
- **Severity:** Medium
- **Where:** `riderStore.ts:16` and `checkInStore.ts:106` (a loop of `runAsync`, one implicit transaction per row). `eventStore.ts:31`, `hotelStayStore.ts:15` and `riderPersonalCodeStore.ts:19` already do this correctly.
- **Impact:** Each row is an fsync. With hundreds of rows this takes seconds on low-end devices, and a failure leaves the data half-written. (It becomes relevant once DES-02(a) wires these stores; `upsertCheckInsFromApi` is at least reachable from the Log.)
- **Recommendation:** Use `db.withTransactionAsync` (or the existing `BEGIN IMMEDIATE` pattern) with a prepared statement (`prepareAsync` / `executeAsync`) for bulk writes.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Bulk writes use withWriteTransaction (serialised single transaction).

### PERF-04 Worst-case request latency of over a minute
- **Severity:** Medium
- **Where:** `apiClient.ts:35-37, 271-422`: 15 s timeout × 4 attempts + 2 s/4 s/8 s backoff ≈ **74 s** before an error is shown. The timeout also stops covering the request once headers arrive (`clearTimeout` at `:307`, before `response.json()`). `combineSignals` (`:438-452`) adds listeners that are never removed.
- **Impact:** On poor networks the user watches a spinner for over a minute before seeing "failed", and may tap again, creating parallel requests. Many devices retrying on the same schedule hit the backend together.
- **Recommendation:** For interactive GETs use a total time budget (for example 20 s) with 1 retry and jitter. Apply the timeout to the body read as well. Use `AbortSignal.any` where available, or remove the listeners in `finally`. Show "Still trying…" after a few seconds.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### PERF-05 No component memoisation; inline closures in large lists
- **Severity:** Low
- **Where:** 0 uses of `React.memo` in `src/`. Inline `onPress={() => …}` inside `.map()` lists in `OccurrenceManagementScreen.tsx` (around `:755-806`, `:836-911`), `EventScanScreen.tsx:822-843` and `HotelManagementScreen.tsx:358, 413`. Derived Maps/Sets rebuilt every render in `OccurrenceDashboardScreen.tsx:272-274`.
- **Impact:** Small individually. It matters on the 15 s poll-driven dashboard and on long occurrence lists.
- **Recommendation:** Memoise the pure presentational components (`ActivityChipList`, `OccurrenceStatusBadge`, `ScanConfirmationCard`, `ReadOnlyProfileHeader`, rider tiles). Wrap derived collections in `useMemo`. Pass ids to stable handlers instead of new closures. Do this together with REF-01.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### PERF-06 Event sync loop keeps running in the background
- **Severity:** Low
- **Where:** `eventSyncService.ts:312-323` (a 3 s interval started by `EventSessionContext`). The `AppState` listener at `EventSessionContext.tsx:144-158` only refreshes the bootstrap when the app returns to the foreground.
- **Impact:** A SQLite query every 3 s while the app is backgrounded, until the OS suspends JS. That means extra battery drain on Android.
- **Recommendation:** Stop the loop when the app is `background` and restart it (with an immediate batch) on `active`. Also trigger a batch on NetInfo reconnect (see DES-06).

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Timer loop removed; engine is event-driven (enqueue, reconnect, foreground) with a single timer for the next due retry, stopped in background/offline.

### PERF-07 Unbounded "failed records" query
- **Severity:** Low
- **Where:** `EventSessionContext.tsx:111-124` (`getFailedEventRecords()` has no limit and is loaded into context state on every sync notification)
- **Observation:** The full list is loaded only so that `OfflineBanner.tsx:11-12` can show `failedRecords.length`, and so that `EventScanScreen.tsx:676` can filter it down to one occurrence.
- **Recommendation:** Expose a `failedCount` (a `COUNT(*)` query) for the banner. Load failed records per occurrence, with a limit, only in `EventScanScreen`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Failed records are counted with COUNT(*) and listed per occurrence with a limit (50).

---

## 4. Code refactoring

### REF-01 Split the 1,000+ line screens
- **Severity:** Medium
- **Where:** `CheckInScreen.tsx` (1,385), `DashboardScreen.tsx` (1,348), `OccurrenceManagementScreen.tsx` (1,202), `EventScanScreen.tsx` (1,134), `DashboardTabsHeader.tsx` (997, a *component*), `EventDefinitionEditorScreen.tsx` (858), `TourUserAssignmentScreen.tsx` / `TourManagementScreen.tsx` (~700)
- **Impact:** Hard to review, test and change safely. Each screen has many `useState` values (13–17 in the event screens) and mixes data loading, business rules and layout.
- **Recommendation:** Split each into a container plus presentational parts plus a hook for the logic, for example:
  - `CheckInScreen` / `EventScanScreen` → a shared `useQrScanner` (scan lock, pause cooldown, duplicate suppression, feedback) and a `ScannerView` component. Both screens implement the same scan loop.
  - `DashboardScreen` → `RiderGrid`, `RiderTile`, `useDashboardData`.
  - `OccurrenceManagementScreen` → `OccurrenceList`, `CreateOccurrenceForm`, `OccurrenceCard` with a `useReducer` for the create/edit workflow.
  - `DashboardTabsHeader` → `RideSelector`, `PitStopContextPicker`, `ScanPauseSettings`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-02 Extract a shared user picker for the four admin user screens
- **Severity:** Medium
- **Where:** `UserModifyScreen.tsx` (537), `UserDeleteScreen.tsx` (347), `UserEnableDisableScreen.tsx` (343), `TourUserAssignmentScreen.tsx`. Each loads `listCognitoUsersWithRoles()` and has its own search, list, selection and error state.
- **Recommendation:** Add a `useManagedUsers()` hook (load, refresh, search filter) and a `ManagedUserList` component (name/email/roles row, search box, empty/loading state). Then each screen only keeps its action. This also fixes UX-01 for these screens in one place.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-03 One date utility and one `resolveTodayRide`
- **Severity:** Medium
- **Where:** `resolveTodayRideFromList` is duplicated in `DashboardScreen.tsx:59-69` and `DashboardTabsHeader.tsx:39-49`, with more "today" logic in the files listed in DES-03. `toLocalDateString`, `isValidDateString` and `listDatesInRange` live in `utils/eventActivity.ts`, which is the wrong home for general date helpers.
- **Recommendation:** Create `src/utils/dates.ts` (local date string, tour-timezone aware "today", range helpers) and `src/utils/rides.ts` (`resolveTodayRide`). Use them everywhere and cover them with tests (DES-08).

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-04 One sync engine for check-ins and event records
- **Severity:** Medium
- **Where:** `syncService.ts` (mutex + per-op retry for `CHECK_IN`) vs `eventSyncService.ts` (promise-chain serialiser + batch for event ops). Both use the same `pending_operations` table with different state rules.
- **Recommendation:** If DES-02(a) is chosen, generalise `eventSyncService` into a single `outboundQueue` with per-operation-type handlers (create check-in, create/cancel event record). Keep one serialiser, one backoff policy (DES-06), one "sync issues" UI. If DES-02(b) is chosen, delete `syncService.ts`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Check-in and event sync share one engine with registered handlers; legacy syncService.ts removed.

### REF-05 Tolerant multi-shape API parsing hides contract drift
- **Severity:** Low
- **Where:** `cognitoUserManagementService.ts:39-85` (accepts `users|Users|items`, `cognitoUserId|userId|sub|cognitoSub|id|usernameId`, `email|Email`, …). `apiClient.ts:176-195` camel-cases **every** request-body key recursively, which would also rename user-supplied map keys (for example a key like `room_type` in a free-form object).
- **Impact:** Backend contract changes go unnoticed. Types say one thing while runtime accepts anything, and bugs surface far from their cause.
- **Recommendation:** Settle one contract with the backend (`tour-data-api` already returns camelCase), parse at the boundary with a small validator (hand-written guards or `zod`, if you approve a dependency), and remove the fallbacks. Make body key normalisation opt-in per call, or remove it once the backend is consistent.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-06 Hard-coded colours and UI strings
- **Severity:** Low
- **Where:** ~87 hex/`rgba()` literals in `.tsx` files outside `constants/colors.ts` (for example `RiderCardModal.tsx:325-487`, `DashboardTabsHeader.tsx:756-931`, `RideInfoContent.tsx:294`). Many UI labels are inline in the event screens, although `constants/eventMessages.ts` exists.
- **Recommendation:** Add semantic tokens to `COLORS` (`overlay`, `dangerSurface`, `dangerBorder`, `dangerText`, `shadow`…) and replace the literals. Move repeated labels into the constants files. This is groundwork for dark mode (UX-06) and any future i18n.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-07 State clusters → `useReducer`; shared loading/error/empty pattern
- **Severity:** Low
- **Where:** `OccurrenceManagementScreen.tsx:184-211` (17 `useState`), `HotelManagementScreen.tsx:125-142` (13), `EventScanScreen.tsx:199-221` (13), `OccurrenceDashboardScreen.tsx:114-125` (12). Each event screen repeats a `isLoading → spinner / banner → StatusBanner / empty → text` block.
- **Recommendation:** Use `useReducer` for multi-field workflows (create/edit forms, upload state machine). Add a small `<AsyncContent loading error empty onRetry>` component so every screen gets retry and empty states the same way (see UX-04).

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-08 Clear the lint warnings and the one inline style
- **Severity:** Low
- **Where:** 12 ESLint warnings (10 × `no-explicit-any` in `feedbackService.ts`, `cognitoUserManagementService.ts`, `recentCheckInsService.ts`, `DashboardScreen.tsx`; 1 unused var; 1 `exhaustive-deps`). One inline style at `src/screens/dashboard/RideInfoScreen.tsx:18` (project rule: no inline styles).
- **Recommendation:** Fix them, then set `--max-warnings 0` in the lint script so new warnings fail the build. For `RideInfoScreen`, compute the size in a `useMemo` style or use `maxWidth`/percentage styles in the `StyleSheet`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### REF-09 Dead code and empty files
- **Severity:** Low
- **Where:** Unused `syncService.ts`, `riderStore.ts`, `rideStore.ts`, parts of `checkInStore.ts`/`pendingStore.ts` (see DES-02). `RideStatusManagementScreen.onStatusChanged` (listed in `migration-cleanup.md`). An empty `.gitmodules`. `mockData.ts` is bundled into production builds (guarded by `EXPO_PUBLIC_USE_MOCK_DATA`, which is `false` in store profiles).
- **Recommendation:** Remove the dead code once DES-02 is decided. Delete `.gitmodules` or use it (SEC-11). Load mock data through a dynamic `require` inside a `__DEV__`/mock-flag branch so it is tree-shaken out of release bundles.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. Unused sync helpers removed with the old sync service.

---

## 5. UI / User experience

### UX-01 `Alert.alert` is a no-op on web: admin actions and scan recovery break
- **Severity:** High (web)
- **Where:** 26 calls in 7 files: `DashboardTabsHeader.tsx` (6), `RideStatusManagementScreen.tsx` (6), `UserModifyScreen.tsx` (5), `UserDeleteScreen.tsx` (3), `UserOnboardingScreen.tsx` (3), `CheckInScreen.tsx` (2), `UserEnableDisableScreen.tsx` (1)
- **Observation:** In `react-native-web`, `Alert.alert` does nothing. Wherever the button callback performs the action, the action never happens on web:
  - **Delete user** (`UserDeleteScreen.tsx:70-90`) and **Enable/Disable user** (`UserEnableDisableScreen.tsx:55-65`) cannot be confirmed, so they cannot be done at all on web.
  - `CheckInScreen.tsx:659, 694`: the scan-error alert's `OK` releases the scan lock, so on web the scanner stays locked after the first error.
  - Every other message (errors, "not allowed", success) is silently dropped.
- **Impact:** Admin screens are listed as web-first in `Requirements.md` → *Others*, yet key admin actions do not work there. The event engine already uses the cross-platform `components/artifacts/ConfirmDialog.tsx` and `StatusBanner`, so there are two different patterns in the app.
- **Recommendation:** Replace all `Alert.alert` calls with `ConfirmDialog` (for confirmations) and `StatusBanner` or a toast (for messages), or add a small `showAlert()` helper that uses `window.confirm/alert` on web. Add an ESLint `no-restricted-imports` rule for `Alert` from `react-native` to stop it coming back.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### UX-02 No offline indicator or manual offline toggle in the Ride Dashboard / Check-In
- **Severity:** Medium (requirement)
- **Where:** `OfflineBanner` is used only in the event screens (`EventsHomeScreen`, `EventScanScreen`, `OccurrenceDashboardScreen`, `BaggageReconciliationScreen`, `RiderProgressScreen`). It is not used in `DashboardScreen` / `CheckInScreen` / `CheckInLogScreen`.
- **Observation:** `Requirements.md` → *Offline Capability*: "User must have an option to turn on/off 'Offline mode' manually… Offline mode indicator is required at Dashboard level."
- **Recommendation:** Show `OfflineBanner` (compact variant) in the ride tabs header. Until DES-02 is resolved, it should also tell the user plainly that check-ins need a connection.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ✅ Completed. Shared components/common/OfflineBanner (compact variant in the ride tabs header, full on Home/Events) with manual toggle, unsent/failed counts, stale alert and "data as of" time; tap opens Sync status.

### UX-03 Accessibility coverage is partial
- **Severity:** Medium
- **Where:** 88 `accessibilityLabel`s against about 228 `TouchableOpacity`/`Pressable` elements. Rider tiles in `DashboardScreen` convey status **only by colour** (for example red/green/white backgrounds). Some icon-only buttons (for example the undo icon in `EventScanScreen.tsx:948`) have small hit areas.
- **Impact:** Screen reader users cannot operate part of the app, and colour-blind users cannot read rider status. The Copilot instructions require accessibility standards to be met.
- **Recommendation:** Give every touchable `accessibilityRole` + `accessibilityLabel` (+ `accessibilityState` for toggles/chips). Add a text or icon status marker, or a status label in the tile's accessibility label, next to the colour. Use `hitSlop` or a minimum 44×44 touch target for icon buttons. Test once with TalkBack and VoiceOver.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### UX-04 Inconsistent pull-to-refresh, retry and keyboard handling
- **Severity:** Low
- **Where:** `RefreshControl` exists on 4 event screens (Events Home, Occurrence Dashboard, Baggage Reconciliation, Rider Progress) but not on the Ride Dashboard, Check-In Log, Occurrence Management, Hotel Management or the admin lists. Several error banners have no Retry action (for example the load-failure banner at `EventScanScreen.tsx:281-284`). `KeyboardAvoidingView` is missing on form-heavy screens (`EventDefinitionEditorScreen`, `HotelManagementScreen`, `OccurrenceManagementScreen`).
- **Recommendation:** Make pull-to-refresh and a Retry action standard through the shared component in REF-07. Wrap forms in `KeyboardAvoidingView` with `keyboardShouldPersistTaps="handled"`.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

### UX-05 Scanner pause feedback and sync-issue actions
- **Severity:** Low
- **Where:** `EventScanScreen.tsx:371-380` (cooldown shows only "Scanner paused"). The "Sync issues" list (`EventScanScreen.tsx:676, 900-915`) only offers a per-item "Dismiss", and dismissing loses the scan without a confirmation.
- **Recommendation:** Show a countdown ring or seconds remaining on the scanner overlay during the pause. Confirm before dismissing a sync issue. Once DES-06 moves exhausted transient failures to FAILED, add "Retry" or "Retry all" for those. Show the pending/failed count on the Events tile in Home.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

**Status:** ◐ Partially addressed. Retry / Retry all for failed scans and confirmation before discarding; pause countdown not changed.

### UX-06 App identity and theme
- **Severity:** Low
- **Where:** `app.json:3-4` (`name`/`slug` are `tour-mgmt-app`, which appears as the launcher label), `app.json:8` (`userInterfaceStyle: "light"`)
- **Recommendation:** Set a proper display name (for example "ToT Tour Manager"). Dark mode is optional. Outdoor pit-stop use favours a high-contrast light theme, so keep light unless users ask for dark. If you add dark mode later, do REF-06 first.

**Decision:** ☐ Accept ☐ Reject ☐ Defer

---

## 6. Things already done well (keep them)

- **Event engine offline design:** write-local-first records, a serialised ordered queue, crash recovery for stuck `SYNCING` ops, natural-key duplicate handling, ETag/304 on bootstrap and dashboards, and snapshot fallback when offline.
- **Focus-aware polling:** `OccurrenceDashboardScreen` polls only while focused, online and the occurrence is ACTIVE, and fetches the full dashboard only when progress changed.
- **User management goes through `tour-data-api`:** there are no Cognito admin SDK calls from the client (`cognitoUserManagementService.ts:1-7`).
- **Auth token handling:** tokens stay in Amplify storage, the `Authorization` header is not logged, and debug GET logging is off by default.
- **Styling discipline:** there is only one inline style in the whole codebase, and screens use `StyleSheet.create`.
- **Typed outcome unions** in `eventsApi.ts` / `hotelsApi.ts` make error handling explicit.
- **TypeScript `strict` is on** and the codebase currently type-checks cleanly.
- **Haptic and audio scan feedback** (`feedbackService.ts`) and a responsive web shell (`SideNav` at desktop widths).
- **Good documentation culture:** design docs per feature, API change requests and a call-audit checklist.

## 7. Reviewed and not raised

Automated review suggested these items. After checking, they were left out or downgraded:

- **"Rotate Cognito pool/client IDs"**: these are public identifiers, not secrets. They are covered under SEC-06 as a config-hygiene issue only.
- **"AsyncStorage hotel `uploadId` is sensitive"**: it is an opaque job id with no PII, so it was not raised.
- **"Mock-data mode reachable in production"**: the flag is compile-time `false` in store profiles. Only bundle size and hygiene remain, covered in REF-09.
- **"No haptic feedback"**: `expo-haptics` is already used in `feedbackService.ts`.
- **"Event records have no idempotency"**: event records are deduped on the natural key `riderId#activityId#timestamp`. The remaining risk is only for the other POSTs (SEC-05).
- **"Certificate pinning"**: not practical in Expo managed workflow without a config plugin, and it is a heavy maintenance burden. It is not recommended at this stage.

---

[← Back to README](../README.md)
