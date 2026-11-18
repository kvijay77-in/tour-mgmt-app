# Deployment workflow

_Last updated: 2026-11-18_

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) builds and deploys the mobile apps (EAS Build with store submission) and the web app (S3 and CloudFront). It runs only when started manually. The branch you run it on decides the environment.

| Branch | Environment | EAS build profile | App | EAS environment | Web stack |
| --- | --- | --- | --- | --- | --- |
| `develop` | dev | `test` | `com.tourmgmt.app.dev`, "Tour Mgmt (Test)" | `preview` | `tour-mgmt-web-dev` |
| `main` | prod | `production` | `com.tourmgmt.app`, "Tour Mgmt" | `production` | `tour-mgmt-web-prod` |

A run on any other branch or on a tag fails before it calls AWS or EAS. The Test app's EAS environment is named `preview` because the EAS free plan offers only the fixed `development`, `preview` and `production` environments.

**Production is not set up yet.** Its settings are placeholders, so a run on `main` stops in the first job with "Not configured for prod" and lists what is missing. See [Production readiness](#production-readiness).

## Running it

Go to Actions > **Deploy** > **Run workflow**, then choose the branch and the inputs:

| Input | Values | Effect |
| --- | --- | --- |
| `target` | `all` (default), `mobile`, `web` | What to build and deploy |
| `platform` | `all` (default), `android`, `ios` | Mobile platforms; ignored for web |
| `submit` | on (default) / off | Mobile: submit each build to its store when it finishes (`--auto-submit`) |

The same run from the command line:

```sh
gh workflow run deploy.yml --ref develop -f target=all
gh workflow run deploy.yml --ref develop -f target=mobile -f platform=android -f submit=false
```

GitHub offers a manually started workflow only when the workflow file is on the default branch (`main`). Merge `deploy.yml` to `main` as well as `develop` before the first run.

Runs on the same branch queue behind each other and are never cancelled midway.

## What a run does

1. **Resolve.** Maps the branch to the environment and checks that every setting the selected targets need is present (not empty and not a `<placeholder>`).
2. **Verify.** Runs `npm run lint`, `npm run typecheck` and `npm test` once for both targets.
3. **Read backend config.** Assumes the tour-data-api read-only role through GitHub OIDC and reads `/tour-data-api/<env>/mgmt/*` from SSM Parameter Store. A run on `develop` reads the dev values. A run on `main` reads the prod values in a separate job, plus the dev values when mobile is selected (for store-reviewer routing). The two accounts' credentials never share a job.
4. **Mobile.** Installs the latest `eas-cli`, syncs the EAS environment ([below](#eas-environment-sync)), then starts `eas build --non-interactive --no-wait --freeze-credentials`, adding `--auto-submit` when `submit` is on. The run does not wait for EAS to finish building. The run summary links each queued build; follow builds and store submissions in the EAS dashboard.
5. **Web.** Assumes the web publisher role of the matching hosting stack, takes the `EXPO_PUBLIC_*` values from SSM and runs `tools/web.sh publish --env <env> --skip-checks`. See the [web deployment guide](web-deployment.md).

Jobs that assume AWS roles must not set `environment:`. Doing so changes the OIDC subject, and AWS then rejects the role.

## EAS environment sync

[`tools/backend-config.mjs`](../../tools/backend-config.mjs) makes the EAS environment match the backend values before every build. It writes only variables whose value changed, and the run summary lists each variable as `unchanged`, `create`, `update`, `split`, `unlink` or `delete`.

| EAS variable | Dev package (`preview`) | Production package (`production`) |
| --- | --- | --- |
| `EXPO_PUBLIC_AWS_REGION` | `dev/mgmt/region` | `prod/mgmt/region` |
| `EXPO_PUBLIC_AWS_USER_POOL_ID` | `dev/mgmt/cognito-user-pool-id` | `prod/mgmt/cognito-user-pool-id` |
| `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID` | `dev/mgmt/cognito-app-client-id` | `prod/mgmt/cognito-app-client-id` |
| `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` | `dev/mgmt/api-endpoint` | `prod/mgmt/api-endpoint` |
| `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` | `dev/mgmt/identity-pool-id` if present | `prod/mgmt/identity-pool-id` if present |
| `EXPO_PUBLIC_REVIEW_AWS_REGION`, `_USER_POOL_ID`, `_USER_POOL_WEB_CLIENT_ID`, `_TOUR_DATA_API_BASE_URL` | Removed | Matching `dev/mgmt/*` value |
| `EXPO_PUBLIC_REVIEW_AWS_IDENTITY_POOL_ID` | Removed | `dev/mgmt/identity-pool-id` if present |
| `EXPO_PUBLIC_REVIEW_USERNAME` | Removed | GitHub variable `REVIEW_USERNAME` |

Paths are shortened: `dev/mgmt/region` means `/tour-data-api/dev/mgmt/region`.

Rules:

- **Validation.** A missing or empty required value fails the run before anything is written.
- **Branch guard.** `preview` is written only from `develop` and `production` only from `main`. The Expo token can write every environment, so the script enforces this itself.
- **Variable types.** Values are written as plaintext string variables, because they are public and ship inside the app.
- **Identity pool.** The backend currently has no identity pool, so `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` is removed until `identity-pool-id` appears in SSM. That path name is this repo's assumption; it is not yet part of the backend contract.
- **Reviewer routing.** In `preview`, every `EXPO_PUBLIC_REVIEW_*` variable is removed. The Test app has no reviewer routing.
- **Unmanaged variables.** `GOOGLE_SERVICES_JSON`, `EXPO_PUBLIC_SETUP_HMAC_KEY` and any other variable not in the table are never touched. Manage them in the EAS dashboard or with `eas env:set`.
- **Shared variables.** A variable can be linked to several EAS environments, and writing it changes all of them. When the script finds a variable it manages that is linked to the target environment and others, it first unlinks the target environment, leaving the value in the others as it was. It then recreates the variable for the target environment only (`split` or `unlink` in the summary). Until 2026-11-18 the backend variables were shared between `preview` and `production`, so the first `develop` run splits them. Unlinking uses `eas env:update`, which is deprecated. If a later `eas-cli` drops it, the run fails before any value is written.
- **Verification.** After writing, the script lists the environment again and fails if anything differs from the expected state.

Preview the changes locally without writing anything. This reads the real EAS environment, so you must be logged in with `npx eas-cli@latest login`:

```sh
DEV_PARAMS="$(aws ssm get-parameters-by-path --path /tour-data-api/dev/mgmt \
  --query 'Parameters[].[Name,Value]' --output json --profile <dev>)" \
  node tools/backend-config.mjs sync-eas --environment preview --dry-run
```

## Store submission

| Profile | iOS | Android |
| --- | --- | --- |
| `test` | TestFlight, app `6822635381` | Play internal testing, `releaseStatus: completed` (rolled out to internal testers) |
| `production` | `ascAppId` is the placeholder `<ASC_APP_ID_PROD>` | Play closed testing (`alpha`), `releaseStatus: draft` (released manually in Play Console) |

CI cannot answer prompts. Every credential must already be stored on EAS:

- the App Store Connect API key, distribution certificate and provisioning profiles;
- the Google Play service account key;
- `GOOGLE_SERVICES_JSON` in each environment.

`--freeze-credentials` stops a CI build from creating or changing credentials. Run `npx eas-cli@latest credentials` locally to fix or renew them. Release approval in the stores stays manual; see the [EAS build and release guide](eas-build-and-release.md).

## Setup

Repository settings: Settings > Secrets and variables > Actions. Use repository-level secrets and variables, not GitHub Environments.

### Needed now (dev)

| Name | Kind | Value |
| --- | --- | --- |
| `EXPO_TOKEN` | Secret | Access token of the Expo robot user ([below](#expo-robot-user)) |
| `AWS_CONFIG_READ_ROLE_ARN_DEV` | Variable | ARN of `tour-data-api-mgmt-config-read-dev`, from the backend team |
| `REVIEW_USERNAME` | Variable | Store reviewer login. Needed for production mobile runs only; set it whenever convenient |
| `WEB_DEV_ROLE_ARN` | Variable | `PublisherRoleArn` output of stack `tour-mgmt-web-dev` ([below](#web-publisher-role-dev)) |
| `WEB_DEV_AWS_ACCOUNT_ID` | Variable | Dev (non-prod) AWS account ID |
| `WEB_AWS_REGION` | Variable | `ap-south-1` (already set) |
| `WEB_DEV_STACK_NAME` | Variable, optional | Only if the stack is not `tour-mgmt-web-dev` |
| `CONFIG_AWS_REGION` | Variable, optional | Region of the backend SSM parameters; default `ap-south-1` |

### Placeholders until production is approved

| Name | Kind | Value when production is ready |
| --- | --- | --- |
| `AWS_CONFIG_READ_ROLE_ARN_PROD` | Variable | ARN of `tour-data-api-mgmt-config-read-prod`, from the backend team |
| `WEB_PROD_ROLE_ARN` | Variable | `PublisherRoleArn` output of stack `tour-mgmt-web-prod` |
| `WEB_PROD_AWS_ACCOUNT_ID` | Variable | Prod AWS account ID |
| `WEB_PROD_STACK_NAME` | Variable, optional | Only if the stack is not `tour-mgmt-web-prod` |
| `submit.production.ios.ascAppId` | [`eas.json`](../../eas.json) | Numeric App Store Connect ID of `com.tourmgmt.app` |

Leave the variables unset until then. A value starting with `<` also counts as unset.

### Expo robot user

1. In the Expo dashboard for the `kvijay77.in` account, give the robot user the **Developer** role. It must be able to read and write project environment variables. If the sync step reports a permission error, raise it to **Admin**.
2. Create an access token for the robot user and store it as the `EXPO_TOKEN` secret. The token works for every EAS environment; the workflow and sync script stop it from writing `production` outside `main`.
3. Confirm that the credentials listed under [Store submission](#store-submission) are stored on EAS.

### Web publisher role (dev)

The dev hosting stack creates its CI publisher role only when the GitHub OIDC parameters are set. Check for it:

```sh
aws cloudformation describe-stacks --stack-name tour-mgmt-web-dev --region ap-south-1 --profile <dev> \
  --query "Stacks[0].Outputs[?OutputKey=='PublisherRoleArn'].OutputValue" --output text
```

If this prints nothing, add these lines to `.env.web.dev.local`, run `make web-infra ENV=dev AWS_PROFILE=<dev-admin>` and check that the change set only adds `WebPublisherRole`:

```
WEB_GITHUB_OIDC_PROVIDER_ARN=arn:aws:iam::<dev-account-id>:oidc-provider/token.actions.githubusercontent.com
WEB_GITHUB_OIDC_SUBJECT=repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/develop
```

### Old settings to remove

The retired `web-dev.yml` workflow read the build values from repository variables. If any of these exist, delete them; the values now come from SSM and the branch:

- `APP_VARIANT`
- `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_LOG_LEVEL`
- `EXPO_PUBLIC_AWS_REGION`, `EXPO_PUBLIC_AWS_USER_POOL_ID`, `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID`, `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID`
- `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL`
- `WEB_AWS_ACCOUNT_ID`, `WEB_STACK_NAME`

`WEB_DEV_ROLE_ARN` keeps its name.

### First dev run

1. Set the [dev settings](#needed-now-dev) and merge the workflow to `develop` and `main`.
2. Run `target=mobile`, `submit=off` on `develop`. Check the sync summary: the first run splits the shared variables and removes the reviewer variables from `preview`. Compare `npx eas-cli@latest env:list preview` and `env:list production` with the values you set by hand before.
3. Run `target=web` on `develop` and check that the smoke test passes.
4. Run `target=all` with `submit` on.

## Production readiness

When production is approved:

1. The backend deploys the prod stacks and sends the `tour-data-api-mgmt-config-read-prod` ARN. Its trust allows `main` of this repository.
2. Prod hosting: follow the web deployment guide's [Phase 5](web-deployment.md#to-do-phase-5---production-publishing). Set `WEB_GITHUB_OIDC_SUBJECT=repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/main` so the stack creates the prod publisher role.
3. Fill in the [placeholders](#placeholders-until-production-is-approved) and `REVIEW_USERNAME`.
4. On a brand-new Play listing the first Android upload must be manual. Run the first production build with `platform=android` and `submit` off, upload the AAB in Play Console, then use `submit` normally.
5. Run on `main` with `submit` off and check the `production` EAS environment, including the `EXPO_PUBLIC_REVIEW_*` values.

Until branch protection is added, anyone who can push to `main` can deploy to production.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "Run this workflow on develop (dev) or main (prod)" | You started it on another branch or a tag |
| "Not configured for dev/prod: ..." | Set the listed secret, variable or `eas.json` value |
| Read job: "Could not assume role" / "Not authorized to perform sts:AssumeRoleWithWebIdentity" | Wrong role ARN, or the role does not trust this branch. Make sure no `environment:` key was added to the job |
| "Missing or empty SSM parameters" | The backend has not published that value; contact the backend team |
| Sync: "may only be written from refs/heads/..." | Branch guard; run on the matching branch |
| Sync: "eas env:update failed" or "still linked" | `eas-cli` changed its unlink behaviour. Split the variable in the EAS dashboard (one variable per environment), then rerun |
| Sync: "Unexpected eas env:list output" | `eas-cli` changed its list format; update the parser in `tools/backend-config.mjs` |
| Sync: permission error | Give the robot user a higher role |
| Build fails on credentials | Run `npx eas-cli@latest credentials` locally for that profile and platform |
| Submission fails | See the build's submission in the EAS dashboard and the [EAS guide troubleshooting](eas-build-and-release.md#10-troubleshooting) |
| Web: "CI publish to dev requires refs/heads/develop" | Branch guard in `tools/web.sh` |
