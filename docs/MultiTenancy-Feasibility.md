# Multi-Tenancy Feasibility Study

[← Back to README](../README.md)

This document analyses the feasibility of distributing a **single app package** through the Google Play Store / Apple App Store that supports multiple tour organizers, each operating on their own dedicated AWS subscription, without requiring a separate app build per organizer.

This is a **feasibility study only**. No implementation changes are included in this document.

---

## Table of Contents

- [Context and Problem Statement](#context-and-problem-statement)
- [Current Architecture Constraints](#current-architecture-constraints)
- [Options Analysis](#options-analysis)
  - [Option 1: Shared AWS Infrastructure (Single Tenant)](#option-1-shared-aws-infrastructure-single-tenant)
  - [Option 2: Runtime Configuration via Bootstrap Service](#option-2-runtime-configuration-via-bootstrap-service)
  - [Option 3: Configuration via Setup QR Code / Deep Link](#option-3-configuration-via-setup-qr-code--deep-link)
  - [Option 4: Dedicated App Build per Organizer (Status Quo)](#option-4-dedicated-app-build-per-organizer-status-quo)
- [Comparison Matrix](#comparison-matrix)
- [Recommendation](#recommendation)
- [Technical Design: Recommended Approach](#technical-design-recommended-approach)
  - [Bootstrap Configuration Service](#bootstrap-configuration-service)
  - [App First-Launch Flow](#app-first-launch-flow)
  - [Dynamic Amplify Configuration](#dynamic-amplify-configuration)
  - [Security Considerations](#security-considerations)
- [Implementation Effort Estimate](#implementation-effort-estimate)
- [Decision Required](#decision-required)

---

## Context and Problem Statement

The Check-In App currently uses **Expo-managed environment variables** (prefixed `EXPO_PUBLIC_`) to carry AWS configuration at build time:

```
EXPO_PUBLIC_AWS_REGION
EXPO_PUBLIC_AWS_USER_POOL_ID
EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID
EXPO_PUBLIC_AWS_IDENTITY_POOL_ID
EXPO_PUBLIC_TOUR_DATA_API_BASE_URL
```

These variables are **embedded into the JavaScript bundle by Metro** at build time. The bundle is then packaged into the `.apk` / `.aab` / `.ipa` file that is distributed via the Play Store / App Store.

**Consequence:** Every different AWS subscription requires a new app build with that subscription's values baked in. A tour organizer running their own AWS account cannot use another organizer's app package without configuration mismatch.

**Goal:** Publish **one app** to the Play Store that any tour organizer can install and point at their own AWS backend, without the publisher needing to build and release a new binary per organizer.

---

## Current Architecture Constraints

| Constraint | Detail |
|------------|--------|
| `EXPO_PUBLIC_` variables are build-time constants | Metro bundles them into the JS bundle; they cannot be changed post-build |
| `Amplify.configure()` requires values at startup | Configuration must be present before the first auth call |
| No runtime config injection from Expo | Expo managed workflow does not support per-device environment overrides |
| EAS Build / CI required per config set | Each organizer would need their own EAS environment profile and build job |

---

## Options Analysis

### Option 1: Shared AWS Infrastructure (Single Tenant)

All organizers share **one AWS account** managed by the app publisher. Isolation is achieved at the data layer — each tour gets its own `tourId` namespace in DynamoDB.

**How it works:**
- One Cognito User Pool with organizer-specific user groups
- One API Gateway / Lambda deployment serving all organizers
- `tourId` carries the organizer context in every API request
- One app build with one set of `EXPO_PUBLIC_` values

**Pros:**
- Truly single binary — no per-organizer build or config needed
- No changes to app startup or onboarding flow
- Simplest to operate

**Cons:**
- **No AWS isolation** — all organizer data lives in one AWS account; a breach or misconfiguration affects all organizers
- **Shared cost** — publisher bears all AWS costs and must bill organizers separately
- **Ownership ambiguity** — organizer cannot independently manage their AWS resources
- **Compliance risk** — organizers with data-residency or privacy requirements cannot comply independently
- Does not meet the stated goal of "each organizer uses their own dedicated AWS subscription"

**Verdict:** ❌ Does not meet the requirement of per-organizer AWS isolation.

---

### Option 2: Runtime Configuration via Bootstrap Service

The app ships with **only a single, stable bootstrap URL** baked in. All organizer-specific AWS config is fetched at runtime during first launch.

**How it works:**

1. The published app contains only a `BOOTSTRAP_SERVICE_URL` constant (e.g., `https://config.checkin-app.example.com`).
2. On first launch, the app presents an **Organization Setup screen** where the user enters a short **Organization Code** provided by their tour organizer (e.g., `TOURFRANCE-2026`).
3. The app calls `GET /config/{orgCode}` on the bootstrap service.
4. The bootstrap service returns the organizer's AWS configuration (Cognito pool IDs, API URL, region).
5. The app stores this config securely via `expo-secure-store`.
6. `Amplify.configure()` is called with the fetched values before any auth or API operation.
7. All subsequent app launches skip the setup screen and use the stored config.

**Pros:**
- **Single app binary** in Play Store / App Store — one build serves all organizers
- **Each organizer has full AWS isolation** — their own Cognito, their own API, their own DynamoDB
- Organizer onboarding is self-service: they register their config in the bootstrap service
- The bootstrap service itself can be very simple and inexpensive (a Lambda + DynamoDB or even a static JSON file on S3)
- `Amplify.configure()` already supports dynamic (runtime) configuration — no Amplify API changes needed

**Cons:**
- Requires a **central bootstrap service** to be built and maintained by the app publisher
- Adds a first-launch setup step (user must enter org code)
- Bootstrap service is a dependency: if it is unavailable, new installs cannot complete setup (existing configured installs are unaffected)
- Config values returned by the bootstrap service must not include actual secrets (User Pool IDs and API URLs are not secrets — see Security Considerations below)

**Verdict:** ✅ **Feasible and recommended.** Meets all requirements. Technical complexity is low.

---

### Option 3: Configuration via Setup QR Code / Deep Link

The organizer distributes a **setup QR code** (or a deep link URL) that encodes all AWS config values. The user scans/opens it once and the app extracts and stores the config.

**How it works:**

1. App publisher provides a tool to generate a setup QR code from the organizer's config values.
2. Organizer distributes the QR code to their users (printed, email, WhatsApp, etc.).
3. On first launch, the app presents a **Scan Setup Code** screen.
4. User scans the QR code; the app reads config values, validates and stores them via `expo-secure-store`.
5. `Amplify.configure()` is called with the stored values.

**Pros:**
- No central bootstrap service needed
- Each organizer's setup is completely independent
- Works offline (no network call needed during setup)

**Cons:**
- Config values are encoded in a QR code — anyone who photographs it can see them (User Pool IDs / API URLs are not secret, but exposure is higher than Option 2)
- Organizer must regenerate and redistribute QR codes if config changes (e.g., after Cognito migration)
- More friction for the end user: must have the QR code available at install time
- Deep links require additional Universal Link / App Link configuration in `app.json` and on the server

**Verdict:** ⚠️ Feasible but with higher user friction and config distribution overhead. Could complement Option 2 (the QR code triggers the same bootstrap lookup rather than encoding raw values).

---

### Option 4: Dedicated App Build per Organizer (Status Quo)

Each tour organizer receives a custom build of the app with their AWS config baked into the `EXPO_PUBLIC_` variables. The builds may share the same package name or each have a unique one.

**How it works:**
- Organizer provides their AWS config values
- Publisher runs a new EAS Build with that organizer's `.env` overrides
- Resulting binary is either published to Play Store under a separate listing, or distributed via direct APK / MDM

**Pros:**
- Maximum isolation — each organizer's app is completely independent
- Simplest code architecture — no runtime config machinery needed
- Familiar Expo/EAS workflow

**Cons:**
- **Does not scale** — a new build, review cycle, and Play Store submission is required per organizer
- Play Store listing management becomes complex with multiple apps or tracks
- Any app-code update requires rebuilding every organizer's binary
- High maintenance overhead for the publisher

**Verdict:** ❌ Does not meet the goal of a single Play Store app usable by multiple organizers without per-build effort.

---

## Comparison Matrix

| Criterion | Option 1 (Shared AWS) | Option 2 (Bootstrap Service) | Option 3 (Setup QR) | Option 4 (Dedicated Build) |
|-----------|----------------------|------------------------------|---------------------|---------------------------|
| Single app binary | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Per-organizer AWS isolation | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| No build per organizer | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| Central service dependency | ❌ None | ⚠️ Bootstrap service | ❌ None | ❌ None |
| Onboarding friction | Low | Low (enter code) | Medium (scan QR) | Low |
| Security posture | Low isolation | ✅ High | ⚠️ Medium | ✅ High |
| Organizer self-service | ❌ No | ✅ Yes | ✅ Yes | ❌ No |
| Implementation effort | Low | Medium | Medium | None (current) |

---

## Recommendation

> **Recommended approach: Option 2 — Runtime Configuration via Bootstrap Service**

This is the only approach that simultaneously satisfies:
1. A single app binary in the Play Store / App Store
2. Full per-organizer AWS account isolation
3. No new build required when onboarding a new organizer

The technical changes to the app are well-contained:
- Replace build-time `EXPO_PUBLIC_` Amplify config with a runtime fetch + secure store
- Add a one-time **Organization Setup screen** shown only on fresh installs
- `Amplify.configure()` already supports being called with runtime values — no Amplify API changes needed

### Dedicated App vs. Single App — Security Trade-off

The question raised in the issue — *"Is it better to have a dedicated App for security and clear isolation?"* — is worth addressing directly.

A dedicated build (Option 4) adds **code-level isolation** (each binary carries only one organizer's credentials), but this provides minimal real security benefit because:
- Cognito User Pool IDs and API base URLs are **not secrets** — they identify a resource but do not grant access to it
- Authentication still requires valid Cognito credentials (username + password), which are not embedded in the app
- A malicious actor can extract User Pool IDs from any Expo bundle with basic tooling regardless of which option is chosen

The meaningful security isolation comes from the **AWS account boundary** (separate Cognito pools, separate DynamoDB, separate IAM policies), which is preserved in Option 2.

**Conclusion:** For this use case, a single app binary with runtime configuration provides equivalent security to a dedicated build, with substantially less operational overhead.

---

## Technical Design: Recommended Approach

This section outlines the high-level technical design for Option 2, to be used as the basis for implementation when approved.

### Bootstrap Configuration Service

A lightweight, read-only API that maps organization codes to their AWS configuration:

```
GET /config/{orgCode}

Response 200:
{
  "orgCode": "TOURFRANCE-2026",
  "orgName": "Tour de France 2026 (Non-Competitive)",
  "awsRegion": "eu-west-1",
  "userPoolId": "eu-west-1_XXXXXXXXX",
  "userPoolClientId": "XXXXXXXXXXXXXXXXXXXXXXXXXX",
  "identityPoolId": "eu-west-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "apiBaseUrl": "https://<api-id>.execute-api.eu-west-1.amazonaws.com/v1"
}

Response 404:
{ "error": "Organization not found" }
```

**Implementation options (simplest to most robust):**
- **Static JSON on S3** with CloudFront CDN — no backend code, just a JSON file per org code; low cost, high availability
- **Lambda + DynamoDB** — enables self-service organizer registration, config updates, and audit logging
- **Existing tour-data-api extension** — add a public `/config/{orgCode}` endpoint to the existing backend

### App First-Launch Flow

```
App Start
    │
    ▼
[Check expo-secure-store for stored org config]
    │
    ├─ Config found ──► [Call Amplify.configure(storedConfig)] ──► Normal auth flow
    │
    └─ No config ────► [Show OrgSetupScreen]
                            │
                            ▼
                       [User enters Org Code]
                            │
                            ▼
                       [GET /config/{orgCode}]
                            │
                       ┌────┴────┐
                       │ Success │
                       └────┬────┘
                            │
                       [Store config in expo-secure-store]
                            │
                            ▼
                       [Call Amplify.configure(fetchedConfig)]
                            │
                            ▼
                       [Proceed to Login]
```

### Dynamic Amplify Configuration

AWS Amplify Gen 2 supports `Amplify.configure()` being called at runtime with values that are not known at build time. The `src/config/amplify.ts` module will need to change from:

```typescript
// Current (build-time): values from EXPO_PUBLIC_ env vars
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.EXPO_PUBLIC_AWS_USER_POOL_ID!,
      userPoolClientId: process.env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID!,
      identityPoolId: process.env.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID,
    },
  },
});
```

to a function that accepts runtime values:

```typescript
// Proposed (runtime): values fetched and stored at first launch
export function configureAmplify(config: OrgConfig): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        identityPoolId: config.identityPoolId,
      },
    },
  });
}
```

This is called once per app session after the config is loaded from `expo-secure-store` or fetched from the bootstrap service.

### Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Bootstrap service availability | Cache the last-known config in `expo-secure-store`; only initial setup requires bootstrap service |
| Config tampering in transit | Bootstrap service uses HTTPS; pin certificate if required |
| Org code brute-forcing | Use sufficiently long, non-guessable org codes (e.g., UUID or 16+ character codes); rate-limit the bootstrap endpoint |
| Config values in secure store | `expo-secure-store` uses Android Keystore / iOS Keychain — OS-level encryption |
| User Pool ID exposure | User Pool IDs are not secrets; they identify the pool but authentication still requires valid credentials |
| Organizer data isolation | Preserved — each organizer has their own Cognito pool and DynamoDB; the app merely discovers which pool to use at runtime |

---

## Implementation Effort Estimate

> This is a rough estimate for planning purposes. Actual effort depends on bootstrap service choice.

| Work Item | Effort |
|-----------|--------|
| Bootstrap service (static S3/CloudFront) | 1–2 days |
| `OrgSetupScreen` (enter org code, validate, store) | 1–2 days |
| Refactor `src/config/amplify.ts` for runtime config | 0.5 days |
| App startup flow (load config from store before auth) | 0.5 days |
| `expo-secure-store` integration for config persistence | 0.5 days |
| Testing across organizer configs | 1 day |
| **Total** | **~4.5–6.5 days** |

---

## Decision Required

Before implementation can begin, the following decisions need to be made:

1. **Confirm approach**: Proceed with Option 2 (Runtime Bootstrap Service)?
2. **Bootstrap service implementation**: Static S3/CloudFront vs. Lambda + DynamoDB? Who owns and hosts it?
3. **Org code format**: UUID-based? Human-readable code (e.g., `TOUR-2026-AU`)?
4. **Org self-service registration**: Can organizers register themselves, or does the publisher manage registrations?
5. **Config change handling**: What happens when an organizer migrates their Cognito pool? Should the app re-prompt for org code, or silently fetch updated config?

---

## Related Documentation

- [Solution Design](SolutionDesign.md) — Architecture and design principles
- [Requirements](Requirements.md) — Functional requirements
- [Development Guide → Environment Configuration](development-guide.md#environment-configuration) — Current env variable setup
- [Issue #11](https://github.com/kvijay77-in/poc-app/issues/11) — Auth integration context

---

[← Back to README](../README.md)
