# Configuration-Driven Rider Profile — Session Record & Final Design

**Date:** 2026-09-28 · **Owner:** kvijay77-in · **Author role:** Solution Architect (GitHub Copilot)
**Repositories:** `tour-rider-app`, `tour-mgmt-app`, `tour-data-api`

> Purpose: one reference for checking the three repos separately against the approved design.
> The Copilot review could only list the first 30 changed files of each pull request, so the gap report in section 7 may be incomplete. Check every PR's full file list yourself.

---

## 1. The problem

The information collected about riders keeps growing: blood group, dietary preference, one-off extra fields and so on. Every addition needs new development in `tour-rider-app`.

**What the owner asked for:**
- Admins define rider profile attributes in configuration, managed from `tour-mgmt-app`.
- The rider app builds the profile screens (create, view, edit) from that configuration.
- **Removing an attribute** hides it from input and from read-only views. Data already captured **stays in DynamoDB**.
- **No automatic clean-up, ever.** When a rider saves, data for removed attributes is kept. Any clean-up is done manually by the Admin team.
- The design only covers what the apps show. Data maintenance is out of scope.
- All backend work (infrastructure, API) goes in `tour-data-api`.
- Each repo's plan includes doc updates.
- No development starts until the owner approves the design.

## 2. What the analysis found (before any changes)

| Repo | Finding |
|---|---|
| tour-rider-app | Profile fields were hard-coded in `types/rider.ts`, `utils/profileForm.ts`, `ProfileFormFields.tsx`, `ProfileScreen.tsx` and `ProfileCreationScreen.tsx`. Updates already sent only the changed fields. |
| tour-data-api | `update_rider_profile.py` only accepted a fixed list of fields and silently dropped anything else. `create_rider_profile.py` built the saved record field by field. Updates were already merged into the stored record (`{**existing, **updates}`). The shared AppConfig table and `GET /v1/config` already existed. There was no API for writing AppConfig. `dietaryPreference` was saved by the backend but not used by the rider app. |
| tour-mgmt-app | Already read AppConfig and already had ADMINISTRATOR-only admin screens in the Home hub and web sidebar. |
| Security risk | The Rider API had no check that a rider could only read or edit their **own** profile. |

## 3. Owner decisions (questions and answers)

| # | Question | Decision |
|---|---|---|
| 1 | What is configuration-driven? | **Everything**, including today's fixed fields. Special behaviour (photo, email, personal code) must also be supported, including for future attributes. |
| 2 | Where values are stored | A nested `attributes` map is OK. |
| 3 | `dietaryPreference` | Move it to the configuration model. Existing values are not migrated; the owner will clean them up. |
| 4 | Field types | Broad coverage, including phone, email, file upload and lists of values (lists are configuration themselves). |
| 5 | Required fields | Admin can mark fields required. **Option (c):** only enforced when the profile is next saved. |
| 6 | Grouping | Admin defines sections and the order within them. |
| 7 | Rider editing | An **admin-only** flag: riders can see these fields but not edit them. |
| 8 | Sensitive data | An optional **sensitive** flag that the admin sets. Definitions (not values) can be read by any signed-in user. |
| 9 | Rider cards | Rider cards show values. A flag controls whether all tour-mgmt-app users can see a value. |
| 10 | Who manages definitions | **ADMINISTRATOR only.** The screen is web-first, following the existing form-factor policy. |
| 11 | Key and type | Can't be changed after creation. To "rename", disable the old attribute and create a new one. |
| 12 | Rider app caching | Definitions are refreshed at sign-in. |
| Review | Seed data | Include the medical condition attribute. |
| Review | Tests | Keep tests light in both apps; UI testing stays manual. |
| Review | Security | The Rider API must only allow a rider to read and edit their **own** profile (mandatory). |
| A | Admin editing of admin-only fields | Yes, ADMINISTRATOR can edit them in tour-mgmt-app. |
| B | Existing `dietaryPreference` values | Not a concern; the owner will clean them up. |
| C | Who sees values not marked "visible to all" | ADMINISTRATOR and SUPER_USER. |
| D | Ownership fix timing | Must be part of Phase 1. |
| — | Phase 3 | Manual end-to-end testing by the owner. No agent task. |
| — | Extra changes in PRs #24 and #19 | **Accepted.** They came from the owner's user-testing feedback and are not deviations (see section 7.1). |

## 4. Final design

### 4.1 Definitions: three new AppConfig types (no new tables)
Every AppConfig row has `configType` (partition key), `configId` (sort key), `enabled`, `config`, `description`, `version`, `updatedAt` and `updatedBy`.

**`RIDER_PROFILE_SECTION`**
`config`: `{ label, icon?, order, description? }`

**`RIDER_PROFILE_ATTRIBUTE`** (`configId` is the attribute key)
`config` fields:
- `label`, `helpText?`, `placeholder?`, `sectionId`, `order`
- `type`, `lovId?`
- `storage`: `{scope:"CORE", path}` or `{scope:"ATTRIBUTES"}`
- flags: `required`, `adminOnly`, `sensitive`, `visibleToAllMgmtUsers`, `system`
- `validation?`, `visibleWhen?` (`{attribute, op: EQ|NEQ|IN|NOT_EMPTY, value?}`)
- `dependsOn?`, `fallbackToText?`
- `fields?`, `repeatable?`, `maxItems?` (for GROUP)
- `handler?`, `handlerOptions?`

**`LOV`** (list of values)
`config`: `{ label, parentLovId?, items:[{value,label,order,enabled,parent?,meta?}] }`

### 4.2 Field types
| Type | Stored as | Settings |
|---|---|---|
| TEXT, TEXTAREA | string | minLength, maxLength, pattern |
| EMAIL | string | email format |
| PHONE | E.164 string | 6–15 digits; dialling code from `COUNTRY` meta.callingCode |
| URL | string | http(s) |
| NUMBER | number | min, max, decimals, unit |
| DATE | `YYYY-MM-DD` | minDate/maxDate, absolute or relative (e.g. `-18y`) |
| BOOLEAN | boolean | — |
| SELECT | string | lovId, dependsOn, fallbackToText |
| MULTI_SELECT | list of strings | lovId, minItems, maxItems |
| FILE, IMAGE | `{s3Key,fileName,contentType,sizeBytes,uploadedAt}` | allowedMimeTypes, maxFileSizeBytes |
| GROUP | map, or list of maps | fields, repeatable, maxItems |

### 4.3 Special behaviour (handlers)
Special behaviour is supported in three layers:
1. Built-in field types.
2. Rules set in configuration (dependent lists, `visibleWhen`, validation).
3. Named handlers, each written once per repo and reusable by any attribute.

| Handler | Behaviour |
|---|---|
| `PERSONAL_CODE` | Normalises the code and checks it is unique (PersonalCodeIndex). Admin-only. |
| `COGNITO_EMAIL` | Email is controlled by the system (Cognito); read-only for riders. |
| `PROFILE_PHOTO` | Binds to `photoS3Key` (a string) and uses the existing picture upload endpoint. |

- The backend rejects unknown handler names when a definition is saved.
- The frontends treat an unknown handler as its base field type.

### 4.4 Lifecycle and data rules
- **No delete.** Removing an attribute means `enabled=false`. Disabled attributes are never shown and their stored values are never returned.
- **Key and type can't change.** System attributes can't be disabled, and their key, type and storage are locked.
- **Merge per key:** only the submitted CORE fields and `attributes.<key>` entries are updated. Keys that weren't sent are never removed.
  - Top-level CORE fields are matched by storage path first, then by attribute key.
- Submitting an unknown or disabled key gives 422 `UNKNOWN_OR_DISABLED_ATTRIBUTE`, but existing stored values are never pruned.
- **Required fields** are checked on the merged result, only when saving. Rider saves skip required admin-only fields. Hidden fields (by `visibleWhen`) are skipped.
- **Admin-only:** a rider writing one gets 403 `ADMIN_ONLY_ATTRIBUTE`. ADMINISTRATOR is allowed through TourDataApi.
- **Out-of-date definitions:** every save sends `definitionsVersion`. The server computes it and returns it from `GET /v1/config` and on profile responses; clients must use the server value. A mismatch gives 409 `PROFILE_DEFINITIONS_CHANGED`; the app reloads the definitions and asks the user to review.
- **Conflicting admin edits:** each definition save sends `version`. A mismatch gives 409 `CONFIG_VERSION_CONFLICT`.
- **List-of-values matching:** a stored or submitted value matches an item by its value or its label (case-insensitive) and is normalised to the value. This keeps legacy names such as "India" working.
- **Visibility to staff:** `visibleToAllMgmtUsers=false` means only ADMINISTRATOR and SUPER_USER see the value. Visible sensitive values are listed in `sensitiveKeys`.
- **Sensitive values** are masked with tap-to-reveal in tour-mgmt-app, **never written to its offline SQLite cache**, and never logged.
- **Ownership:** on the Rider API a rider can only access their own profile. The caller's Cognito `sub` is mapped to a profileId through RiderCognitoUser. A mismatch gives 403 `PROFILE_ACCESS_DENIED` before any data is read.
  - Link routes require the path to equal the caller's `sub`.
  - `RIDER_API_ID` is set in `template.yaml`, and the check fails closed if it is missing.

### 4.5 Seed data (insert-only; `--force-profile-config` to re-seed)
- **Sections:** personal, contact, address, emergency, medical, preferences, organizer.
- **Lists of values:** COUNTRY (full ISO list with calling codes, India first), STATE (all Indian states and union territories, full-name labels), GENDER, DIETARY_PREFERENCE, BLOOD_GROUP, RELATIONSHIP.
- **Attributes:**
  - system: name, email (COGNITO_EMAIL, admin-only), phone, photo (PROFILE_PHOTO), personalCode (PERSONAL_CODE, admin-only);
  - dateOfBirth (`maxDate -18y`), gender;
  - address (GROUP; state depends on country, with text fallback);
  - emergencyContact (GROUP; relation accepts legacy free text);
  - dietaryPreference (ATTRIBUTES);
  - bloodGroup, hasMedicalCondition, medicalConditions (sensitive, not visible to all; medicalConditions shows when hasMedicalCondition is true).

### 4.6 APIs (tour-data-api)
| Endpoint | API | Access |
|---|---|---|
| `GET /v1/config` (returns entries and `definitionsVersion`) | both | authenticated |
| `GET /v1/admin/config/{configType}` | TourDataApi | ADMINISTRATOR |
| `PUT /v1/admin/config/{configType}/{configId}` (body `{version, enabled, description?, config}`) | TourDataApi | ADMINISTRATOR |
| `POST /v1/riders/profile`, `PUT /v1/riders/profile/{profileId}` | both (the TourDataApi routes are accepted for admin use) | owner / ADMINISTRATOR |
| `POST /v1/riders/profile/{profileId}/attributes/{key}/upload` (`contentType`, `sizeBytes`) | both | owner / ADMINISTRATOR |
| `GET /v1/riders/profile/{profileId}/attributes/{key}/download` | both | owner / staff by visibility |
| Staff rider endpoints (riders list, rider, ride-details with `profileAttributes` and `sensitiveKeys`) | TourDataApi | staff, values filtered by role |

**Error codes:** UNKNOWN_OR_DISABLED_ATTRIBUTE, ADMIN_ONLY_ATTRIBUTE, PROFILE_DEFINITIONS_CHANGED, CONFIG_VERSION_CONFLICT, SYSTEM_ATTRIBUTE_PROTECTED, IMMUTABLE_FIELD, PROFILE_ACCESS_DENIED.

### 4.7 tour-mgmt-app
- **Rider Profile Definitions screen:** ADMINISTRATOR, web-first, read-only on mobile. Tabs for Sections, Attributes and Lists of Values (with CSV import), plus a Preview.
- **Rider card and details:** attribute values by section; sensitive values masked and never stored offline; file values have a View action.
- **Admin-only editing:** from rider details (`RIDER_PROFILE_ADMIN_EDIT`).
- **Shared field renderer:** `src/components/riderProfile/`.
- **RBAC labels:** `RIDER_PROFILE_DEFINITION_MANAGE`, `RIDER_PROFILE_ADMIN_EDIT` (ADMINISTRATOR).
- **Also in PR #24, accepted from user testing (section 7.1):**
  - web in-memory storage (`database.web.ts`, nothing kept after the browser session);
  - web check-ins and event scans sent straight to the API;
  - event definition view/edit mode;
  - web storage fallback for org config;
  - Expo patch version bumps.

### 4.8 tour-rider-app
- **Definitions:** loaded at sign-in into a SQLite cache. The cache is the fallback if loading fails and is cleared on logout.
- **Engine:** `src/profile-schema/`, with a field registry and handler registry.
- **Screens:** Profile Creation, View and Edit are built dynamically. Admin-only fields are read-only.
- **Access gate:** only required **system** fields decide whether a rider must finish their profile first.
- **`definitionsVersion`** is taken from the server, never computed in the app.
- **Lists of values** come only from configuration, including the country and phone dialling codes.
- **Legacy values** (names or free text) are matched by value or label, and shown raw if nothing matches.
- **FILE/IMAGE attributes** upload through presigned URLs.

### 4.9 Tests
- **tour-data-api:** full pytest + moto coverage.
- **Both apps:** light unit tests of pure logic only; no UI tests.

## 5. Phases and agent tasks

| Phase | Repo / branch | Status |
|---|---|---|
| 1 Backend | tour-data-api / `copilot/create-rider-profile-attributes-design-docs` (PR #19, draft) | Implemented; fix task running |
| 2a Mgmt | tour-mgmt-app / `copilot/tour-mgmt-app-config-driven-rider-profile` (PR #24, draft) | Foundation done; completion task (Definitions screen, rider card, admin-only edit) running |
| 2b Rider | tour-rider-app / `copilot/configuration-driven-rider-profile` (PR #11, draft) | Implemented; fix task running |
| Fix: data-api | same branch as Phase 1 | Started |
| Fix: rider-app | same branch as Phase 2b | Started |
| 3 End-to-end | all | Manual testing by the owner, after merge and dev deploy |

## 6. Phase 3 manual test checklist
1. Deploy all three branches to dev and run `make seed-app-config` (or `--force-profile-config` if dev was already seeded).
2. Admin (web): create a section and an attribute of each type; reorder; edit a list of values; check the preview.
3. Confirm the key and type are locked, a system attribute can't be disabled, and two admins saving the same item gives a version conflict with reload.
4. Rider: sign in, and the new attribute appears. Create a profile, including a photo; edit and save.
5. Mark a new attribute required. Existing riders are not blocked, but it is enforced when they next save.
6. Disable an attribute. It disappears from both apps, and its value is still in DynamoDB after the rider saves again.
7. Admin-only field: read-only for the rider, editable by ADMINISTRATOR.
8. Sensitive, not-visible-to-all field: GUEST / PS_x_USER can't see it; ADMINISTRATOR and SUPER_USER see it masked with reveal; it is not stored offline.
9. Change definitions while a rider is editing. The rider's save gets 409, then the app reloads and asks for review.
10. Security: rider A calling rider B's profile, picture, attribute, tours or link routes gets 403 `PROFILE_ACCESS_DENIED`.
11. Legacy data: an existing profile with the country "India" and a free-text relation displays and saves.
12. Accepted extra changes: web check-in and event scans work online, the event view/edit mode works, and web session data clears on reload and sign-out.

## 7. Gap report (review of PRs #19, #24, #11; first 30 files per PR only)

| # | Repo | Severity | Gap | Fix task |
|---|---|---|---|---|
| 1 | data-api and rider-app | 🔴 | The two sides compute `definitionsVersion` differently, so every save gets 409 | data-api and rider-app (running) |
| 2 | data-api | 🔴 | Built-in fields are looked up by attribute key rather than storage path, so `photoS3Key` is rejected (422); the photo is checked as a file object instead of a string | data-api (running) |
| 3 | data-api | 🔴 | The ownership check only runs if `RIDER_API_ID` is set, and it isn't set in `template.yaml` | data-api (running) |
| 4 | mgmt-app | 🔴 | Definitions screen was a placeholder; rider card attributes, admin-only editing and the shared renderer were missing | mgmt-app completion (running) |
| 5 | rider-app | 🟠 | Country and state lists hard-coded | rider-app (running) |
| 6 | data-api and rider-app | 🟠 | Stored names vs list codes; free-text relation vs a list | data-api and rider-app (running) |
| 7 | data-api | 🟠 | Only 5 countries seeded; state labels are codes | data-api (running) |
| 8 | rider-app | 🟠 | Custom FILE/IMAGE attributes can't be uploaded | rider-app (running) |
| 9 | data-api | 🟠 | Docs are only short notes appended to files; the API guide has no examples | data-api (running) |

### 7.1 Accepted extra changes (not issues)
These came from the owner's user-testing feedback and are **approved**:

| Repo / PR | Change |
|---|---|
| tour-mgmt-app #24 | Web in-memory storage (`database.web.ts`), with SQLite used on mobile only. Documented in `project-structure.md` as an approved platform-specific exception. |
| tour-mgmt-app #24 | Web check-ins and event scans/cancels sent directly to the API, with a "connection needed" message. |
| tour-mgmt-app #24 | Event definition view/edit mode (list View/Edit/Occurrences buttons). |
| tour-mgmt-app #24 | Org config uses `localStorage` on web (non-secret identifiers only). |
| tour-mgmt-app #24 | Session data cleared on web sign-out; outbound sync engine turned off on web. |
| tour-mgmt-app #24 | Expo patch version bumps (`expo` 57.0.25, `expo-linking` 57.0.11). |
| tour-data-api #19 | POST/PUT rider profile routes on TourDataApi for admin use. |

## 8. Validating each repo

Check every changed file in each PR: `/pull/<n>/files` in the GitHub UI.

**tour-data-api (PR #19 + fix)**
- `profile_schema.py` resolves built-in fields by storage path.
- `GET /v1/config` returns `definitionsVersion`.
- `RIDER_API_ID` is set in `template.yaml`, and the check fails closed.
- Seeds use the full country list and state names; LOV values match by value or label.
- `--force-profile-config` works.
- The API guide has request/response examples.
- Tests pass.

**tour-mgmt-app (PR #24 + completion task)**
- The Definitions screen works end to end.
- The shared renderer covers every field type.
- Sensitive values are never persisted offline.
- Admin-only editing works.
- The accepted extra changes in section 7.1 behave as described.

**tour-rider-app (PR #11 + fix)**
- No client-computed `definitionsVersion`.
- No hard-coded lists of values.
- Legacy values are mapped or shown raw.
- FILE/IMAGE upload works.
- The access gate uses system fields only.
- The photo is sent as a string under `photoS3Key`.