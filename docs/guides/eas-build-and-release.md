# EAS build and release guide

_Last updated: 2026-11-19_

Use this guide to configure, build, submit and verify the Test and Production versions of tour-mgmt-app. The apps have separate store records and identifiers; the Test build is Dev-only. See the [app variants design](../design/app-variants-and-environments.md) for rationale and compliance decisions. Store builds normally run from the deployment workflow; its prerequisites, settings and steps are in the [deployment guide](deployment.md). `develop` builds Test (profile `test`, EAS environment `preview`) and `main` builds Production (profile `production`, EAS environment `production`).

## 1. Prerequisites

1. Have an Expo account with access to the project and the App Store Connect / Play Console accounts.
2. Install Node.js and npm, then install this repository's dependencies with `npm ci`.
3. Sign in to EAS:

   ```sh
   npx eas-cli@latest login
   ```

4. Confirm the EAS project is linked to the project ID in `app.json`. Do not run `eas init` against an established project without release-owner approval.
5. Ensure each new store record exists before its first build or submit. Configure credentials and EAS environment variables before starting EAS Build.

## 2. Variant and version checks

`APP_VARIANT` is a build-time input. The `test` and `production` profiles set it explicitly; absent or unrecognized values default to Production. Verify the public Expo config without starting a build:

```sh
APP_VARIANT=test npx expo config --type public
APP_VARIANT=production npx expo config --type public
```

Check the name, scheme, iOS bundle ID, Android package, `extra.appVariant`, icon paths and Firebase file path. Test should resolve to `Tour Mgmt (Test)`, `tour-mgmt-app-dev` and `com.tourmgmt.app.dev`; Production should resolve to `Tour Mgmt`, `tour-mgmt-app` and `com.tourmgmt.app`. With `GOOGLE_SERVICES_JSON` unset, `googleServicesFile` must be absent.

Build numbers are managed remotely by EAS (`cli.appVersionSource: remote`). Initialize or inspect them per platform/app as needed:

```sh
npx eas-cli@latest build:version:set
```

Follow the prompts for the applicable EAS project and platform. Do not restore local `ios.buildNumber` or `android.versionCode` values in `app.json`.

## 3. Create the store records

### App Store Connect

Create a separate iOS app record for each bundle identifier:

- Production: `com.tourmgmt.app`
- Test: `com.tourmgmt.app.dev`

Set the names to match the variant table. Enable the Push Notifications capability for each app ID. Record the numeric App Store Connect app ID of each record in `eas.json`. `submit.test.ios.ascAppId` is set; `submit.production.ios.ascAppId` keeps the placeholder `<ASC_APP_ID_PROD>` until the Production record exists. Configure manual release / developer-controlled release timing rather than automatically releasing on approval.

### Google Play Console

Create one Play app record per Android package (`com.tourmgmt.app` and `com.tourmgmt.app.dev`). Complete App content, privacy policy, Data safety, content rating, target audience and the required account/data deletion link for each listing. Enable managed publishing if release approval must be separated from review approval.

The first Android upload for a new Play app must be uploaded manually in Play Console. After Play App Signing is enabled and the first artifact is accepted, subsequent submissions can use EAS Submit. Follow Play's current account-specific closed-testing rules; for affected personal developer accounts, maintain at least 12 opted-in testers for 14 continuous days against the Production app, then request production access and clean up the test records from Production.

## 4. Credentials and push setup

Run `npx eas-cli@latest credentials` and select each platform/profile/app as prompted.

### iOS

- Create/select an iOS distribution certificate and provisioning profile for each bundle ID.
- Enable Push Notifications on both App IDs.
- Configure an App Store Connect API key (`.p8`) with App Manager access for EAS Submit. Keep the key out of the repository and back it up securely.
- Configure an APNs authentication key for push; the same APNs key can be used for both apps when the Apple account permits it.

### Android

- Configure an Android upload keystore and enable Play App Signing. Back up the upload keystore and recovery information securely outside the repository.
- Invite a Google service account in Play Console with the release permissions needed by EAS Submit.
- Create a separate Firebase Android app for each package and enable FCM. Download a matching `google-services.json` for each app.
- Upload each Firebase file as an EAS **file** environment variable named `GOOGLE_SERVICES_JSON`: Test file in `preview`, Production file in `production`. Set the variable visibility to sensitive: the file's contents are compiled into the app binary, so `secret` adds no protection and makes EAS warn about hidden values in the app config. The app config uses the supplied file only when the variable exists. The repository ignores `google-services*.json`.
- Configure Firebase Cloud Messaging v1 credentials for Expo Push Service using the matching project. Do not mix the Test and Production Firebase projects.

`google-services.json` files must be uploaded as EAS **file** environment variables (`--type file`). Without `--type file`, EAS stores the path text instead of the file, and the build fails in Prebuild with `"google-services.json" is missing`. Run the command from the folder that holds the matching Firebase file.

The file is not a secret: its API key and IDs are readable in any built APK. Protect the project by restricting the API key to the Android package and signing SHA-1 in Google Cloud Console, and keep the FCM service-account key out of the app.

```sh
npx eas-cli@latest env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --visibility sensitive --scope project
```

## 5. Configure EAS environments

The Test app uses the EAS environment `preview` and Production uses `production`. The EAS free plan has no custom environment names, so the Test environment cannot be renamed to `test`. `EXPO_PUBLIC_*` variables are bundled into the app; treat them as public configuration, never as secrets.

The workflow syncs the backend `EXPO_PUBLIC_*` values, including the reviewer variables in `production`, from the tour-data-api SSM handover before every build; see [EAS environment sync](deployment.md#eas-environment-sync) for the full variable table. Set only these by hand:

| Variable | `preview` (Test) | `production` |
| --- | --- | --- |
| `GOOGLE_SERVICES_JSON` (file, sensitive) | Test Firebase file | Production Firebase file (section 4) |
| `EXPO_PUBLIC_SETUP_HMAC_KEY` | As needed | As needed |

Each variable must belong to one environment only. A variable linked to both `preview` and `production` takes the same value in both, and writing it changes both. The workflow splits such variables automatically; when you add a variable by hand, select a single environment.

Inspect the environments with:

```sh
npx eas-cli@latest env:list preview --format long
npx eas-cli@latest env:list production --format long
```

`env:pull` writes local environment files; keep those files private and untracked. The build profiles own `APP_VARIANT`, mock-data mode, log level, API debug logging and QR dev-format flags.

## 6. `eas.json` profile reference

| Profile | Distribution | Environment / channel | Notes |
| --- | --- | --- | --- |
| `development` | Internal | Existing | Development client; unchanged |
| `localpreview` | Internal APK | Preview values | Existing Android local-preview workflow, Test app identity |
| `test` | Store | `preview` / `test` | Test app, auto-increment, EAS Submit targets internal testing (`completed`) |
| `adhoc` | Internal | Inherits `test` | Emergency iOS ad hoc only |
| `production` | Store | `production` / `production` | Production app, auto-increment, EAS Submit targets alpha (`draft`) |

Confirm the EAS `preview` and `production` variables are populated before starting either store profile. Never override `APP_VARIANT` when invoking a store build.

## 7. Build and submit

Run the deployment workflow on `develop` for the Test app or on `main` for Production. The [deployment guide](deployment.md) covers the prerequisites, [first run](deployment.md#first-dev-run) (including the manual first Android upload), [inputs](deployment.md#running-a-deployment), [store tracks](deployment.md#store-submission) and [terminal builds for emergencies](deployment.md#local-and-emergency-publishing). Review build logs and generated metadata before each release; EAS Submit does not replace human review of the target app and release track.

### Emergency iOS ad hoc

This is for urgent direct distribution only, not the normal TestFlight workflow. Register tester devices, then build:

```sh
npx eas-cli@latest device:create
npx eas-cli@latest build -p ios --profile adhoc
```

The ad hoc build inherits the Test variant and its Dev backend. Recreate the provisioning profile after adding devices if EAS requests it.

## 8. Verify builds and tester distribution

For each build, verify in the EAS build details' **Environment variables** tab which environment and variables were used. Also inspect the binary and test it on a real device:

- Confirm app name, store record, iOS bundle ID / Android package and URL scheme match the intended variant.
- Confirm the Test app shows the persistent TEST strip on login and every subsequent screen, and the Production app does not show it even for the reviewer account.
- Confirm Test signup, authentication, API calls and push notifications use Dev. Confirm Production uses Prod for normal accounts and Dev only for the reviewer username.
- Smoke-test the actual Production build on iOS and Android before each release. Verify sign-in, account deletion, key organizer operations, offline behavior and the reviewer's demo path.

### Testers

- **TestFlight:** add testers to an external group, provide test information and a Dev demo login, and complete Beta App Review if requested. Remind testers that TestFlight builds expire after 90 days.
- **Google Play internal testing:** add up to 100 testers and share the opt-in link. Use the Test app for Dev-only testing.
- **Google Play closed testing:** where personal-account policy applies, keep at least 12 testers opted in for 14 continuous days against the Production app before applying for production access. Check that test records are removed from Production before launch.

### Store review

Supply working reviewer credentials and clear sign-in instructions in App Review / Play review notes. The configured reviewer username in the Production app routes to the Dev Cognito pool/API; the review account must be pre-created in that Dev pool with the required role. Leave all reviewer routing variables unset in EAS `preview`. Keep a manual release hold until the authorized release owner approves publication.

## 9. Release checklist

- [ ] Confirm correct app record, profile, EAS environment and identifiers for the platform.
- [ ] Confirm environment values and matching Firebase file are set; verify no unintended reviewer variables are in `preview`.
- [ ] Run lint, typecheck and tests; review the actual EAS build's environment-variable summary.
- [ ] Verify TEST banner behavior, API destination, sign-up, authentication, push, offline and account deletion.
- [ ] Smoke-test the Production app build on both iOS and Android before release.
- [ ] Complete TestFlight / Play testing requirements and clean Production test records where required.
- [ ] Provide working reviewer credentials, app review notes, privacy disclosures and deletion URL.
- [ ] Submit with managed/manual release controls, inspect review feedback, then release only with approval.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Test build has Production name or IDs | Verify `APP_VARIANT=test`, selected `test` profile and resolved public Expo config. Check the EAS environment summary. |
| Test login/API uses Production | Ensure the EAS `preview` AWS/API variables contain Dev values and `EXPO_PUBLIC_REVIEW_*` is unset. Verify Test has `extra.appVariant=test`. |
| TEST strip missing in a Test build | Check `Constants.expoConfig?.extra?.appVariant`, app config output, and that the binary was built with the `test`/`adhoc` profile. |
| Reviewer restart cannot restore the persisted session | Confirm the Production build includes all reviewer variables and SecureStore contains the reviewer flag. The app must restore the review profile before `AuthProvider` mounts. |
| Android Firebase/FCM setup fails | Ensure `GOOGLE_SERVICES_JSON` is an EAS file variable from the Firebase app matching the exact Android package. Do not commit it or reuse the other variant's file. |
| iOS push notifications fail | Check the App ID Push capability, provisioning profile and APNs key; verify credentials for the right Apple team. |
| EAS Submit targets the wrong listing/track | Verify `ascAppId` or Android `track` under the chosen submit profile and the build's bundle ID/package before submitting. |
| First Android auto-submit fails | Upload the first AAB manually in Play Console and enable Play App Signing before using EAS Submit for later releases. |
| Store build number conflict | Run `npx eas-cli@latest build:version:set` and confirm the remote version for the correct app/platform. |
| `googleServicesFile` points to a missing local path (`"google-services.json" is missing` in Prebuild) | Run `npx eas-cli@latest env:list --environment <env> --format long` and check that `GOOGLE_SERVICES_JSON` has `type file`. A `string` variable holds only the path text; delete it and recreate it with `--type file`. The property is intentionally omitted if the variable is absent. |
| TestFlight build expires | TestFlight builds expire after 90 days; build and distribute a replacement. |
