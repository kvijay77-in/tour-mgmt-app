# Release Guide — Building & Distributing the ToT APK

This guide describes how to produce a signed Android APK of the Check-In App
for distribution to invited testers of the **Tour of Trails (ToT)** cycling
event.

> **Scope.** This build is tied to the ToT AWS subscription. Cognito and
> tour-data-api endpoints are baked into the APK via EAS build-time
> environment variables. The generic runtime-configuration flow (setup
> deep link / QR code) described in
> [SolutionDesign.md](./SolutionDesign.md) is **not** exercised by this
> build — see the note at the top of that document.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [One-time EAS setup](#2-one-time-eas-setup)
3. [Configuring build-time environment variables](#3-configuring-build-time-environment-variables)
4. [Building the APK](#4-building-the-apk)
5. [Distributing to testers](#5-distributing-to-testers)
6. [Version bumps & re-releases](#6-version-bumps--re-releases)
7. [Rotating credentials](#7-rotating-credentials)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

| Item | Details |
|------|---------|
| Expo account | Free tier is sufficient for internal APK builds. Sign up at [expo.dev](https://expo.dev). |
| EAS CLI | Run via `npx eas-cli` — do **not** install globally (see project convention). |
| Node.js | 18 LTS or 20 LTS (matches Expo SDK 54 requirements). |
| Repo clone | Local clone of `tour-mgmt-app`, dependencies installed via `npm install`. |
| AWS resources | ToT Cognito User Pool, App Client, Identity Pool, and tour-data-api base URL — obtain from the ToT AWS administrator. |

Verify EAS CLI works:

```bash
npx eas-cli --version
npx eas-cli whoami   # will prompt login if not authenticated
```

---

## 2. One-time EAS setup

Run these steps once when the EAS project is first linked to the repo. The
result is a permanent `extra.eas.projectId` value in `app.json`.

### 2.1 Log in

```bash
npx eas-cli login
```

### 2.2 Initialise the project

```bash
npx eas-cli init
```

This will:

- Create a new EAS project in your Expo account (or link to an existing one).
- Write the assigned project ID into `app.json` at `expo.extra.eas.projectId`,
  replacing the `REPLACE_WITH_EAS_PROJECT_ID_AFTER_EAS_INIT` placeholder.

Commit the updated `app.json`:

```bash
git add app.json
git commit -m "chore: link EAS project id"
```

### 2.3 Confirm build profiles

`eas.json` in the repo root already defines three profiles:

| Profile | Purpose | Distribution | Build type |
|---------|---------|--------------|------------|
| `development` | Dev-client + mock data | internal | apk |
| `preview` | Internal APK for testers (recommended for ToT rollout) | internal | apk |
| `production` | Same as preview but on the `production` channel for future OTA updates | internal | apk |

No edits are required for the ToT build.

---

## 3. Configuring build-time environment variables

The Check-In App reads AWS resource IDs and the tour-data-api URL from
`EXPO_PUBLIC_*` environment variables that are inlined into the JS bundle at
build time. For the ToT APK these values must be present when EAS builds
run — store them as **EAS project environment variables** so they are never
committed to git.

### 3.1 Required variables

| Variable | Example value | Where to find it |
|----------|---------------|------------------|
| `EXPO_PUBLIC_AWS_REGION` | `ap-south-1` | ToT AWS region. |
| `EXPO_PUBLIC_AWS_USER_POOL_ID` | `ap-south-1_XXXXXXXXX` | Cognito Console → User Pool → General settings. |
| `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxx` | Cognito Console → App client. |
| `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` | `ap-south-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` | Cognito Console → Federated Identities (if used). |
| `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` | `https://api.tot.example.com` | tour-data-api API Gateway invoke URL. |

> `EXPO_PUBLIC_USE_MOCK_DATA` and `EXPO_PUBLIC_LOG_LEVEL` are already set per
> profile in `eas.json` and should **not** be duplicated as EAS environment
> variables.

### 3.1.1 Google Play review account (Dev backend routing)

Google Play review requires a full-access ADMINISTRATOR account. To keep
production data isolated, one env-configured username is routed to the **Dev**
backend (separate Cognito User Pool + App Client + Identity Pool + tour-data-api)
while all real users stay on production. The switch happens at login time and
only for this exact username; leaving `EXPO_PUBLIC_REVIEW_USERNAME` empty disables
routing entirely.

| Variable | Example value | Where to find it |
|----------|---------------|------------------|
| `EXPO_PUBLIC_REVIEW_USERNAME` | `google-reviewer@someusefulapps.com` | The account shared with Google (must exist in the Dev pool). |
| `EXPO_PUBLIC_REVIEW_AWS_REGION` | `ap-south-1` | Dev AWS region. |
| `EXPO_PUBLIC_REVIEW_AWS_USER_POOL_ID` | `ap-south-1_XXXXXXXXX` | Dev Cognito Console → User Pool → General settings. |
| `EXPO_PUBLIC_REVIEW_AWS_USER_POOL_WEB_CLIENT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxx` | Dev Cognito Console → App client. |
| `EXPO_PUBLIC_REVIEW_AWS_IDENTITY_POOL_ID` | `ap-south-1:xxxxxxxx-...` | Dev Cognito Console → Federated Identities (if used). |
| `EXPO_PUBLIC_REVIEW_TOUR_DATA_API_BASE_URL` | `https://dev-api.tot.example.com/dev` | Dev tour-data-api API Gateway invoke URL. |

> Register these as EAS project environment variables for `preview` and
> `production` alongside the primary variables above (§3.2). The reviewer account
> must be created in the **Dev** Cognito pool, added to the `ADMINISTRATOR` group,
> and given a permanent password.

### 3.2 Register environment variables in EAS

For each variable above:

```bash
npx eas-cli env:create \
   --scope project \
   --name EXPO_PUBLIC_AWS_REGION \
   --value ap-south-1 \
   --type string \
   --visibility plaintext \
   --environment preview \
   --environment production
```

Repeat for each variable and target environment, using `preview` for tester
rollout and `production` for future production-channel builds.

To list existing environment variables:

```bash
npx eas-cli env:list --scope project
```

Alternatively, upload from a local file (do **not** commit this file):

```bash
npx eas-cli env:push --path .env.tot --environment preview --environment production
```

> **⚠️ Do not commit `.env.tot`.** Add it to your local `.gitignore` if you
> create one. The repository's `.gitignore` already excludes `.env` and
> `.env.*.local`.

### 3.3 Values that must NOT be added as secret-visibility variables

- `EXPO_PUBLIC_SETUP_HMAC_KEY` — the generic setup-link flow is out of
  scope for the ToT APK. Leave unset. If ever set, the app will silently
  keep the runtime OrgConfig path enabled but no setup link is exchanged
  for the ToT build.
- Any real AWS access keys, secret keys, or session tokens — the app never
  uses IAM credentials directly; it authenticates end-users via Cognito.

---

## 4. Building the APK

From the repo root:

```bash
# Preview APK — recommended for ToT tester rollout
npx eas-cli build --profile preview --platform android
```

What happens:

1. EAS uploads the project tarball (trimmed by `.easignore`).
2. Build runs on Expo cloud infrastructure.
3. The `EXPO_PUBLIC_*` environment variables from §3 are injected as environment
   variables during `expo export`.
4. `versionCode` is auto-incremented (per `eas.json`).
5. Android app is signed with an **EAS-managed keystore** — the private
   keystore never leaves EAS servers.
6. On completion, you receive a build URL such as
   `https://expo.dev/accounts/<you>/projects/tour-mgmt-app/builds/<uuid>`.

Download the signed `.apk` from that page.

> Typical build time: 8–15 minutes on the free tier.

---

## 5. Distributing to testers

Because `distribution: internal` is set on the preview profile, the APK is
suitable for **out-of-band installation** — no Google Play submission is
required.

Options in order of convenience:

1. **EAS install page (recommended).**
   Every internal build has a shareable install page — link testers to it
   and they scan a QR code from an Android device to install directly. See
   the build details page on expo.dev.
2. **Direct APK download.**
   Download the `.apk` from the build page and share it via any private
   channel (email, WhatsApp, direct download link on a private site).
   Testers must enable "Install unknown apps" for the source app (Chrome,
   Drive, etc.) on their device.
3. **MDM / Firebase App Distribution.**
   Out of scope for the initial ToT rollout; may be considered later if
   the tester count grows.

### Tester instructions template

```
1. Open the install link on your Android phone: <URL>
2. Tap "Install" — allow "Install unknown apps" if prompted.
3. Open the "Check-In App" from the app drawer.
4. Sign in with the Cognito username and temporary password issued
   to you separately.
5. Follow prompts to reset your password on first sign-in.
```

---

## 6. Version bumps & re-releases

- The **user-facing version** (`expo.version` in `app.json`) is a semver
  string; bump manually for meaningful feature/UI changes:
  ```bash
  # example: 1.0.0 → 1.1.0
  # edit app.json → expo.version, then commit
  ```
- The **Android `versionCode`** is auto-incremented by EAS on every
  `preview`/`production` build (per `eas.json` → `autoIncrement`), so no
  manual intervention is needed.
- Re-running `npx eas-cli build --profile preview --platform android`
  produces a new signed APK that testers install over the previous one
  (same package name, higher `versionCode`).

---

## 7. Rotating credentials

If a Cognito App Client secret, User Pool ID, or API URL changes:

1. Update the corresponding EAS environment variable in each relevant
    environment:
   ```bash
    npx eas-cli env:update preview \
       --scope project \
       --variable-name EXPO_PUBLIC_TOUR_DATA_API_BASE_URL \
       --value <new-url>

    npx eas-cli env:update production \
       --scope project \
       --variable-name EXPO_PUBLIC_TOUR_DATA_API_BASE_URL \
       --value <new-url>
   ```
2. Trigger a new build; testers will install the updated APK.

If the **keystore** ever needs to be rotated: use `npx eas-cli
credentials` and follow the interactive prompts. Note that rotating the
keystore changes the app's signing identity — testers will need to
uninstall the previous APK before installing the new one.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Build fails: `Missing EAS project ID` | `eas init` not run | Run `npx eas-cli init` (see §2.2). |
| Build succeeds but login fails on device | Cognito environment variables not set / typo | Check `eas env:list --scope project`; recreate or update the offending variable. |
| App gets stuck on setup screen | ToT env vars not injected at build time | Confirm `EXPO_PUBLIC_AWS_USER_POOL_ID` and `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` are EAS project environment variables and the build ran after they were added. |
| APK too large / build slow | Extraneous files being uploaded | Check `.easignore`; large binaries (e.g. `tour-data-api-main.zip`) should be listed. |
| `Install blocked` on tester device | "Install unknown apps" not enabled | Guide the tester through the OS setting for the source app. |

---

## Related documents

- [SolutionDesign.md](./SolutionDesign.md) — overall architecture; note the
  ToT-build clarification at the top.
- [development-guide.md](./development-guide.md) — local development setup.
- [project-structure.md](./project-structure.md) — where `eas.json` and
  this guide fit into the repo layout.
