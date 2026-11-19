# Deployment

_Last updated: 2026-11-19_

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) builds and deploys the mobile apps (EAS Build with store submission) and the web app (S3 and CloudFront). It runs only when started manually. The branch you run it on decides the environment.

| Branch | Environment | EAS build profile | App | EAS environment | Web stack |
| --- | --- | --- | --- | --- | --- |
| `develop` | dev | `test` | `com.tourmgmt.app.dev`, "Tour Mgmt (Test)" | `preview` | `tour-mgmt-web-dev` |
| `main` | prod | `production` | `com.tourmgmt.app`, "Tour Mgmt" | `production` | `tour-mgmt-web-prod` |

A run on any other branch or on a tag fails before it calls AWS or EAS.

**Production is not set up yet.** Its settings are placeholders, so a run on `main` stops in the first job with "Not configured for prod" and lists what is missing. See [Production readiness](#production-readiness).

Backend resources (Cognito, API, data, file storage) belong to [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md); this repository owns only the web hosting stack. The reasons behind this setup are in the [deployment design](../design/deployment.md).

## Prerequisites

Do these once per environment, in order. Each step lists who does it and how to check that it is done. Steps 1 to 8 cover dev; production repeats them as described in [Production readiness](#production-readiness).

### 1. Tools and access

- Node.js and npm per `package.json`; run `npm ci`.
- AWS CLI v2, and SAM CLI for the hosting stack.
- AWS SSO profiles for the dev account:
  - an **admin** profile for the hosting stack (CloudFormation, S3, CloudFront, and IAM for the publisher role);
  - a **developer** profile for local publishing only, with `s3:ListBucket`, `s3:PutObject`, `s3:GetObject`, `cloudfront:CreateInvalidation` and `cloudformation:DescribeStacks` on the stack, and `ssm:GetParametersByPath` on `/tour-data-api/<env>/mgmt` for the backend values.
- An Expo account with access to the project, and access to App Store Connect and Google Play Console.
- Admin access to this GitHub repository to set secrets and variables. The `gh` CLI is optional.

### 2. Backend handover

**Who:** the tour-data-api team.

The backend publishes its values in SSM Parameter Store under `/tour-data-api/dev/mgmt/`: `region`, `cognito-user-pool-id`, `cognito-app-client-id` and `api-endpoint`. `identity-pool-id` is optional (see [EAS environment sync](#eas-environment-sync)). The team also sends the ARN of the `tour-data-api-mgmt-config-read-dev` role, whose trust allows `develop` of this repository.

**Done when** you have the ARN (it becomes `AWS_CONFIG_READ_ROLE_ARN_DEV`) and the parameters are listed:

```sh
aws ssm get-parameters-by-path --path /tour-data-api/dev/mgmt \
  --query 'Parameters[].Name' --output text --profile <dev>
```

### 3. GitHub OIDC provider

**Who:** dev account admin.

The hosting stack's publisher role trusts the account's GitHub OIDC provider. The stack does not create the provider. An account holds one provider per URL, so if the backend already uses GitHub OIDC in this account, reuse its provider. Check for it:

```sh
aws iam list-open-id-connect-providers --profile <dev-admin>
```

If no ARN ends in `oidc-provider/token.actions.githubusercontent.com`, create the provider once:

```sh
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com --profile <dev-admin>
```

**Done when** you have the provider ARN, `arn:aws:iam::<dev-account-id>:oidc-provider/token.actions.githubusercontent.com`.

### 4. Web hosting stack

**Who:** dev account admin.

The stack `tour-mgmt-web-<env>` is defined in [`infra/web.yaml`](../../infra/web.yaml) and deployed by [`tools/web.sh`](../../tools/web.sh) through the [Makefile](../../Makefile).

1. Copy [`.env.web.example`](../../.env.web.example) to `.env.web.dev.local` (gitignored) and set the infra keys. The file is parsed, never sourced, and only allow-listed keys are read. Never put credentials, `EXPO_PUBLIC_SETUP_HMAC_KEY` or any `EXPO_PUBLIC_REVIEW_*` variable in it.

   | Key | Required | Value |
   | --- | --- | --- |
   | `WEB_AWS_ACCOUNT_ID` | yes | Dev account ID; the script refuses to run against any other account |
   | `WEB_AWS_REGION` | no | `ap-south-1` (default) |
   | `WEB_STACK_NAME` | no | Default `tour-mgmt-web-dev` |
   | `WEB_OWNER` | yes | Owner tag |
   | `WEB_CSP`, `WEB_CSP_MODE` | yes | Content-Security-Policy value; keep `REPORT_ONLY` until QA confirms (see [CSP](#csp)) |
   | `WEB_GITHUB_OIDC_PROVIDER_ARN` | for CI | Provider ARN from [step 3](#3-github-oidc-provider) |
   | `WEB_GITHUB_OIDC_SUBJECT` | for CI | `repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/develop` |

   Without both OIDC keys the stack creates no publisher role and CI cannot publish. The optional build keys in the example file matter only for [local publishing](#local-and-emergency-publishing). The backend `EXPO_PUBLIC_*` values never go in this file; every publish reads them from SSM.

2. Deploy the stack and review the change set before confirming:

   ```sh
   make web-infra ENV=dev AWS_PROFILE=<dev-admin>
   ```

3. The command prints the stack outputs. Record `SiteUrl` for [step 5](#5-cors-handoff) and `PublisherRoleArn` for `WEB_DEV_ROLE_ARN`. This stack owns the publisher role; tour-data-api does not provide one. The value is a role ARN (`arn:aws:iam::<id>:role/...`), not the provider ARN from step 3. If the output is missing, the OIDC keys were empty: set them and deploy again.

**Done when** this prints the role ARN:

```sh
aws cloudformation describe-stacks --stack-name tour-mgmt-web-dev --region ap-south-1 --profile <dev> \
  --query "Stacks[0].Outputs[?OutputKey=='PublisherRoleArn'].OutputValue" --output text
```

### 5. CORS handoff

**Who:** you, then the tour-data-api team.

Send `SiteUrl` to the backend team. They add it to `ManagementWebAllowedOrigins` and redeploy the backend. Send it again only when it changes, for example when the hosting stack is recreated or a custom domain is added. The allowed origins, headers and methods are listed in the design's [backend CORS contract](../design/deployment.md#backend-cors-contract).

**Done when** the backend team confirms the deploy.

### 6. Expo robot user

**Who:** Expo account owner.

1. In the Expo dashboard for the `kvijay77.in` account, give the robot user the **Developer** role. It must be able to read and write project environment variables. If the sync step reports a permission error, raise it to **Admin**.
2. Create an access token for the robot user. It becomes the `EXPO_TOKEN` secret. The token can write every EAS environment; the workflow and sync script stop it from writing `production` outside `main`.

**Done when** you have the token.

### 7. Store records and credentials

**Who:** release owner.

CI cannot answer prompts, and the build uses `--freeze-credentials`, so a CI build cannot create or change credentials. Everything must already be stored on EAS. The [EAS build and release guide](eas-build-and-release.md) has the details:

- [ ] App Store Connect and Play Console records for `com.tourmgmt.app.dev` ([§3](eas-build-and-release.md#3-create-the-store-records)), and `submit.test.ios.ascAppId` set in [`eas.json`](../../eas.json).
- [ ] iOS: distribution certificate, provisioning profile and App Store Connect API key ([§4](eas-build-and-release.md#4-credentials-and-push-setup)).
- [ ] Android: upload keystore and Google Play service account key ([§4](eas-build-and-release.md#4-credentials-and-push-setup)).
- [ ] `GOOGLE_SERVICES_JSON` as a file variable in the `preview` EAS environment ([§4](eas-build-and-release.md#4-credentials-and-push-setup)).
- [ ] On a brand-new Play listing, the first Android upload is manual (see [First dev run](#first-dev-run)).

**Done when** `npx eas-cli@latest credentials` shows the credentials for the `test` profile on both platforms, and `npx eas-cli@latest env:list preview` lists `GOOGLE_SERVICES_JSON`.

### 8. GitHub settings

**Who:** repository admin.

Go to Settings > Secrets and variables > Actions. Use repository-level secrets and variables, not GitHub Environments (see the [design](../design/deployment.md#branches-and-identities)).

**Dev (needed now):**

| Name | Kind | Value | From |
| --- | --- | --- | --- |
| `EXPO_TOKEN` | Secret | Robot user access token | [Step 6](#6-expo-robot-user) |
| `AWS_CONFIG_READ_ROLE_ARN_DEV` | Variable | `tour-data-api-mgmt-config-read-dev` ARN | [Step 2](#2-backend-handover) |
| `WEB_DEV_ROLE_ARN` | Variable | `PublisherRoleArn` stack output | [Step 4](#4-web-hosting-stack) |
| `WEB_DEV_AWS_ACCOUNT_ID` | Variable | Dev AWS account ID | [Step 4](#4-web-hosting-stack) |
| `WEB_AWS_REGION` | Variable | `ap-south-1` (already set) | |
| `WEB_DEV_STACK_NAME` | Variable, optional | Only if the stack is not `tour-mgmt-web-dev` | [Step 4](#4-web-hosting-stack) |
| `CONFIG_AWS_REGION` | Variable, optional | Region of the backend SSM parameters; default `ap-south-1` | [Step 2](#2-backend-handover) |
| `REVIEW_USERNAME` | Variable | Store reviewer login. Needed for production mobile runs only; set it whenever convenient | [Production readiness](#production-readiness) |

**Production (placeholders until production is approved):**

| Name | Kind | Value when production is ready |
| --- | --- | --- |
| `AWS_CONFIG_READ_ROLE_ARN_PROD` | Variable | `tour-data-api-mgmt-config-read-prod` ARN, from the backend team |
| `WEB_PROD_ROLE_ARN` | Variable | `PublisherRoleArn` output of stack `tour-mgmt-web-prod` |
| `WEB_PROD_AWS_ACCOUNT_ID` | Variable | Prod AWS account ID |
| `WEB_PROD_STACK_NAME` | Variable, optional | Only if the stack is not `tour-mgmt-web-prod` |
| `submit.production.ios.ascAppId` | [`eas.json`](../../eas.json) | Numeric App Store Connect ID of `com.tourmgmt.app`; currently the placeholder `<ASC_APP_ID_PROD>` |

Leave the production variables unset until then. A value starting with `<` also counts as unset.

**Old settings to remove.** The retired `web-dev.yml` workflow read build values from repository variables. If any of these exist as repository variables, delete them; CI now takes the values from SSM and the branch. The same names remain valid as keys in your local `.env.web.<env>.local` for [local publishing](#local-and-emergency-publishing).

- `APP_VARIANT`
- `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_LOG_LEVEL`
- `EXPO_PUBLIC_AWS_REGION`, `EXPO_PUBLIC_AWS_USER_POOL_ID`, `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID`, `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID`
- `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL`
- `WEB_AWS_ACCOUNT_ID`, `WEB_STACK_NAME`

`WEB_DEV_ROLE_ARN` keeps its name.

## First dev run

1. Merge the workflow to `develop` and `main`. GitHub offers a manually started workflow only when the file is on the default branch (`main`).
2. Run `target=mobile`, `submit` off on `develop`. Check the sync summary: the first run splits the shared variables and removes the reviewer variables from `preview`. Compare `npx eas-cli@latest env:list preview` and `env:list production` with the values you set by hand before.
3. On a brand-new Play listing, upload the AAB from step 2 manually in Play Console. Later runs can submit.
4. Run `target=web` on `develop` and check that the smoke test passes.
5. Run `target=all` with `submit` on.

## Running a deployment

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

Runs on the same branch queue behind each other and are never cancelled midway. Each run installs, lints, tests and exports, so watch the monthly Actions minutes.

### What a run does

1. **Resolve.** Maps the branch to the environment and checks that every setting the selected targets need is present (not empty and not a `<placeholder>`).
2. **Verify.** Runs `npm run lint`, `npm run typecheck` and `npm test` once for both targets.
3. **Read backend config.** Assumes the tour-data-api read-only role through GitHub OIDC and reads `/tour-data-api/<env>/mgmt/*` from SSM. A run on `develop` reads the dev values. A run on `main` reads the prod values in a separate job, plus the dev values when mobile is selected (for store-reviewer routing).
4. **Mobile.** Installs the latest `eas-cli`, [syncs the EAS environment](#eas-environment-sync), then starts `eas build --non-interactive --no-wait --freeze-credentials`, adding `--auto-submit` when `submit` is on. The run does not wait for EAS. The run summary links each queued build; follow builds and store submissions in the EAS dashboard.
5. **Web.** Assumes the publisher role of the matching hosting stack, takes the `EXPO_PUBLIC_*` values from SSM and runs `tools/web.sh publish --env <env> --skip-checks` ([Web publish](#web-publish)).

## Reference

### EAS environment sync

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
- **Branch guard.** `preview` is written only from `develop` and `production` only from `main`.
- **Variable types.** Values are written as plaintext string variables, because they are public and ship inside the app.
- **Identity pool.** The backend currently has no identity pool, so `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` is removed until `identity-pool-id` appears in SSM. That path name is this repo's assumption; it is not yet part of the backend contract.
- **Reviewer routing.** In `preview`, every `EXPO_PUBLIC_REVIEW_*` variable is removed. The Test app has no reviewer routing.
- **Unmanaged variables.** `GOOGLE_SERVICES_JSON`, `EXPO_PUBLIC_SETUP_HMAC_KEY` and any other variable not in the table are never touched. Manage them in the EAS dashboard or with `eas env:set`, and select a single environment.
- **Shared variables.** When the script finds a variable it manages that is linked to the target environment and others, it first unlinks the target environment, leaving the value in the others as it was. It then recreates the variable for the target environment only (`split` or `unlink` in the summary). Until 2026-11-18 the backend variables were shared between `preview` and `production`, so the first `develop` run splits them. Unlinking uses `eas env:update`, which is deprecated. If a later `eas-cli` drops it, the run fails before any value is written.
- **Verification.** After writing, the script lists the environment again and fails if anything differs from the expected state.

Preview the changes locally without writing anything. This reads the real EAS environment, so you must be logged in with `npx eas-cli@latest login`:

```sh
DEV_PARAMS="$(aws ssm get-parameters-by-path --path /tour-data-api/dev/mgmt \
  --query 'Parameters[].[Name,Value]' --output json --profile <dev>)" \
  node tools/backend-config.mjs sync-eas --environment preview --dry-run
```

### Web publish

`tools/web.sh publish`, in CI and locally:

1. Checks the branch. In CI, `develop` may publish only to dev and `main` only to prod. Locally, prod needs a clean worktree whose HEAD is an ancestor of `origin/main`.
2. Takes the backend `EXPO_PUBLIC_*` values from the SSM handover. CI passes them in from the read job; a local publish reads `/tour-data-api/<env>/mgmt` with your profile and ignores any backend values in `.env.web.<env>.local`.
3. Reads the bucket, distribution and `SiteUrl` from the stack outputs.
4. Runs `npm ci`, lint, typecheck and tests. CI passes `--skip-checks` because the verify job already ran them.
5. Exports with a clean environment. Only allow-listed build keys are passed; mock data and the QR dev format are forced off. The export must contain one root `index.html` and no source maps.
6. Uploads content-hashed assets first (immutable), other files with `no-cache`, and `index.html` last with `source-sha` metadata. See [Caching](../design/deployment.md#caching).
7. Invalidates `/*` and smoke-checks that the site serves the new commit's `source-sha` within about two minutes.

Verified results (dev, 2026-10-05):

- HTTPS 200, http redirects to https, direct S3 URL denied.
- Security headers present (HSTS, `x-frame-options`, `x-content-type-options`, `referrer-policy`, `content-security-policy-report-only`).
- Hashed JS: `cache-control: public, max-age=31536000, immutable`; `index.html`: `no-cache`.
- CloudFront passes `x-amz-meta-source-sha`, so the smoke check on the sha works as designed.
- Spot check: `curl -sI <SiteUrl>/` and `curl -sI <SiteUrl>/_expo/static/js/web/<hashed>.js`.

### CSP

The stack sends `Content-Security-Policy-Report-Only` while `WEB_CSP_MODE=REPORT_ONLY`. Once QA sees no violations, set `ENFORCE` in `.env.web.<env>.local` and run `make web-infra` again.

### Store submission

| Profile | iOS | Android |
| --- | --- | --- |
| `test` | TestFlight, app `6822635381` | Play internal testing, `releaseStatus: completed` (rolled out to internal testers) |
| `production` | `ascAppId` is the placeholder `<ASC_APP_ID_PROD>` | Play closed testing (`alpha`), `releaseStatus: draft` (released manually in Play Console) |

Release approval in the stores stays manual; see the [EAS build and release guide](eas-build-and-release.md). Run `npx eas-cli@latest credentials` locally to fix or renew credentials.

## Local and emergency publishing

Use the workflow normally. Publishing by hand is for emergencies and first-time checks; the last writer wins.

**Web.** The publish reads the backend values from `/tour-data-api/<env>/mgmt` in SSM with your `AWS_PROFILE`, exactly as CI does, so `.env.web.<env>.local` needs only `WEB_AWS_ACCOUNT_ID`. Optional build keys: `APP_VARIANT` (default `test` for dev, `production` for prod), `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_LOG_LEVEL`, and `CONFIG_AWS_REGION` if the SSM parameters are not in `ap-south-1`. Then:

```sh
make web-publish ENV=dev AWS_PROFILE=<dev> DRY_RUN=1   # build and aws s3 sync --dryrun; nothing is written
make web-publish ENV=dev AWS_PROFILE=<dev>
```

Local prod publishing is for the release owner only, with the prod SSO profile, from a clean worktree whose HEAD is an ancestor of `origin/main`.

**Mobile.** A terminal build does not sync the EAS environment, so check it first with the [sync dry run](#eas-environment-sync):

```sh
npm run lint && npm run typecheck && npm test
npx eas-cli@latest build -p all --profile test --auto-submit
npx eas-cli@latest build -p all --profile production --auto-submit
```

For an emergency iOS ad hoc build, see the [EAS guide](eas-build-and-release.md#emergency-ios-ad-hoc).

## Rollback

- **Web.** Revert on the branch and run the workflow again, or check out the older commit or tag and [publish locally](#local-and-emergency-publishing).
- **Mobile.** Store releases are manual, so do not release the faulty build. Run the workflow again from the fixed commit.

## Production readiness

_Blocked until production is approved, the prod AWS account is ready and the app is ready to go live._

**Before you start:**

- The prod AWS account and SSO profiles exist, and a release owner and an account admin are named.
- The backend has deployed its prod stacks, publishes `/tour-data-api/prod/mgmt/*` and has sent the `tour-data-api-mgmt-config-read-prod` ARN. Its trust allows `main` of this repository.
- The backend team is ready to receive the prod `SiteUrl`. Prod CORS allows `SiteUrl` only (https, no localhost).

**Steps:**

1. Make sure the prod account has a GitHub OIDC provider, as in [step 3](#3-github-oidc-provider) with the prod admin profile.
2. Create `.env.web.prod.local` as in [step 4](#4-web-hosting-stack): prod `WEB_AWS_ACCOUNT_ID`, `WEB_OWNER`, `WEB_CSP`, `WEB_CSP_MODE=REPORT_ONLY`, the prod provider ARN, and `WEB_GITHUB_OIDC_SUBJECT=repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/main`.
3. Admin deploys the hosting stack with `make web-infra ENV=prod AWS_PROFILE=<prod-admin>`, after reviewing the change set. Record `SiteUrl` and `PublisherRoleArn`.
4. Send the prod `SiteUrl` to the tour-data-api team, then wait until the prod backend is deployed with it in `ManagementWebAllowedOrigins`.
5. Create the production store records and credentials, and add `GOOGLE_SERVICES_JSON` to the `production` EAS environment, as in [step 7](#7-store-records-and-credentials).
6. Fill in the [production placeholders](#8-github-settings) and `REVIEW_USERNAME`. Pre-create the reviewer account in the dev Cognito pool ([EAS guide](eas-build-and-release.md#store-review)).
7. On a brand-new Play listing, run on `main` with `target=mobile`, `platform=android` and `submit` off, then upload the AAB in Play Console.
8. Run on `main` with `target=mobile` and `submit` off. Check the `production` EAS environment, including the `EXPO_PUBLIC_REVIEW_*` values.
9. Run on `main` with `target=web`. Check what was checked for dev under [Web publish](#web-publish), and that `x-amz-meta-source-sha` matches the commit.
10. QA accepts the login and dashboard flows against the prod backend and checks the browser console for CSP violations.
11. Once there are no CSP violations, set `WEB_CSP_MODE=ENFORCE` and run `make web-infra ENV=prod` again.
12. Run on `main` with `target=all` and `submit` on.
13. Record the verified prod results (date, checks passed, deviations) and the release owner's responsibilities in this guide.

**Done when** the prod site is live over HTTPS through the workflow, the production builds reach their store tracks, QA has accepted them, CSP is enforced and this guide records the results.

Until branch protection is added, anyone who can push to `main` can deploy to production.

## Later: branch protection

_Out of scope for now. GitHub Free private repositories do not support branch protection; it becomes available on a paid plan or a public repository._

1. Before making the repository public:
   - scan the full git history for secrets with a tool the owner approves;
   - confirm no account IDs, ARNs, user pool IDs or URLs are hardcoded in tracked files;
   - set Actions to require approval for outside collaborators.
2. Add branch protection or rulesets on `develop` and `main`: require pull requests and block force pushes. The OIDC trust of the publisher and config-read roles is pinned to these branches, so protecting them protects deployment.
3. Optionally add a `pull_request` or `push` trigger to `deploy.yml`. Never deploy from `pull_request` events of forks.
4. Do not move deployment jobs into GitHub Environments without first changing the backend role trust (see the [design](../design/deployment.md#branches-and-identities)).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Resolve** | |
| "Run this workflow on develop (dev) or main (prod)" | You started it on another branch or a tag |
| "Not configured for dev/prod: ..." | Set the listed secret, variable or `eas.json` value ([GitHub settings](#8-github-settings)) |
| **AWS** | |
| "Could not assume role" / "Not authorized to perform sts:AssumeRoleWithWebIdentity" | Wrong role ARN, or the role does not trust this branch. Its trust `sub` must be exactly `repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/<branch>` (check with `aws iam get-role`). Make sure no `environment:` key was added to the job |
| "Missing or empty SSM parameters" | The backend has not published that value; contact the backend team. Locally, also check that `AWS_PROFILE` points at the right account and `CONFIG_AWS_REGION` at the right region |
| Local publish: *AccessDenied* on `ssm:GetParametersByPath` | Your profile needs read access to `/tour-data-api/<env>/mgmt` ([step 1](#1-tools-and-access)) |
| *Wrong AWS account* (local) | The profile does not match `WEB_AWS_ACCOUNT_ID` |
| *AccessDenied* | On S3: `ListBucket`/`PutObject`/`GetObject`. On invalidation: `cloudfront:CreateInvalidation`. On stack outputs: `cloudformation:DescribeStacks` |
| **EAS sync and build** | |
| "may only be written from refs/heads/..." | Branch guard; run on the matching branch |
| "eas env:update failed" or "still linked" | `eas-cli` changed its unlink behaviour. Split the variable in the EAS dashboard (one variable per environment), then rerun |
| "Unexpected eas env:list output" | `eas-cli` changed its list format; update the parser in `tools/backend-config.mjs` |
| Permission error | Give the robot user a higher role |
| Build fails on credentials | Run `npx eas-cli@latest credentials` locally for that profile and platform |
| Submission fails | See the build's submission in the EAS dashboard and the [EAS guide troubleshooting](eas-build-and-release.md#10-troubleshooting) |
| **Web** | |
| "CI publish to dev requires refs/heads/develop" | Branch guard in `tools/web.sh` |
| "Missing stack outputs" | Wrong stack name or region, or the hosting stack is not deployed |
| No `PublisherRoleArn` output | The OIDC keys were empty when the stack was deployed ([step 4](#4-web-hosting-stack)) |
| CORS error in the browser | The `SiteUrl` changed (for example after the stack was recreated); [send it to the backend team](#5-cors-handoff) |
| Smoke check fails on sha | Usually an old cached `index.html`; wait for the invalidation and retry |
