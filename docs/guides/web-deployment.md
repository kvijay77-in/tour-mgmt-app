# Web deployment guide

_Last updated: 2026-10-05_

The web app is hosted on private S3 behind CloudFront, defined in [infra/web.yaml](../../infra/web.yaml). See the [web deployment design](../design/web-deployment.md) for architecture, stages and boundaries. One script, [tools/web.sh](../../tools/web.sh), provides both commands, wrapped by the [Makefile](../../Makefile).

## Prerequisites

- AWS CLI v2, SAM CLI (infra only), Node/npm per `package.json`, and an SSO profile per environment (`AWS_PROFILE`).
- Account admin: needed for `make web-infra` (CloudFormation, S3, CloudFront; IAM only when the publisher role is enabled).
- Developer / release owner: only needs `s3:ListBucket`, `s3:PutObject`, `s3:GetObject`, `cloudfront:CreateInvalidation` and `cloudformation:DescribeStacks` on the stack.

## Configuration

Copy [.env.web.example](../../.env.web.example) to `.env.web.<env>.local` (gitignored). In CI the same names are read from process environment. Only allow-listed keys are read; the file is parsed, never sourced. Never add `EXPO_PUBLIC_SETUP_HMAC_KEY` or `EXPO_PUBLIC_REVIEW_*` variables.

| Key | Required | Purpose |
|-----|----------|---------|
| `WEB_AWS_ACCOUNT_ID` | yes | Script refuses to run against any other account |
| `WEB_AWS_REGION` | no (`ap-south-1`) | Stack region |
| `WEB_STACK_NAME` | no (`tour-mgmt-web-<env>`) | Hosting stack |
| `WEB_OWNER` | infra | Owner tag |
| `WEB_CSP`, `WEB_CSP_MODE` | infra | Content-Security-Policy and `REPORT_ONLY`/`ENFORCE` |
| `WEB_GITHUB_OIDC_PROVIDER_ARN`, `WEB_GITHUB_OIDC_SUBJECT` | optional | Enable the CI publisher role |
| `APP_VARIANT` | no (`test` dev, `production` prod) | App variant |
| `EXPO_PUBLIC_ENVIRONMENT`, `_LOG_LEVEL`, `_AWS_REGION`, `_AWS_USER_POOL_ID`, `_AWS_USER_POOL_WEB_CLIENT_ID`, `_AWS_IDENTITY_POOL_ID`, `_TOUR_DATA_API_BASE_URL` | build | Public build values; mock data and QR dev format are forced to `false` |

Bucket, distribution and `SiteUrl` are read from the stack outputs at runtime.

## First-time Dev setup

1. Create `.env.web.dev.local` from the example.
2. Admin: `make web-infra ENV=dev AWS_PROFILE=<dev-admin>` (review the change set).
3. Developer: `make web-publish ENV=dev AWS_PROFILE=<dev>`.
4. Give the printed `SiteUrl` to the tour-data-api backend once for CORS, and again whenever it changes.

### Verified results (Dev, 2026-10-05)

- HTTPS 200, http redirects to https, direct S3 URL denied.
- Security headers present (HSTS, `x-frame-options`, `x-content-type-options`, `referrer-policy`, `content-security-policy-report-only`).
- Hashed JS: `cache-control: public, max-age=31536000, immutable`; `index.html`: `no-cache`.
- CloudFront passes `x-amz-meta-source-sha`, so the smoke check on the sha works as designed.
- Spot check: `curl -sI <SiteUrl>/` and `curl -sI <SiteUrl>/_expo/static/js/web/<hashed>.js`.

## Publish, dry run, rollback

- Publish runs `npm ci`, lint, typecheck and tests as a release gate, exports with a clean environment, uploads (hashed assets immutable, `index.html` last with `source-sha` metadata), invalidates `/*` and smoke-checks the site.
- `make web-publish ENV=dev DRY_RUN=1` builds and runs `aws s3 sync --dryrun`; nothing is written.
- Rollback: check out the older commit or tag and publish again.

## Dev CI

`.github/workflows/web-dev.yml` runs `tools/web.sh publish --env dev` on push to `develop` (path-filtered) and on manual dispatch. It assumes the publisher role through OIDC; no secrets are used. Dispatch from any branch other than `develop` fails at the role trust check by design.

### Setup

1. **Find or create the GitHub OIDC provider** (Dev account, admin profile):

   ```bash
   aws iam list-open-id-connect-providers --profile <dev-admin>
   ```

   Use the ARN ending in `oidc-provider/token.actions.githubusercontent.com`. If none exists, create it once:

   ```bash
   aws iam create-open-id-connect-provider --profile <dev-admin> \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com
   ```

2. **Enable the publisher role.** Add to `.env.web.dev.local`:

   ```
   WEB_GITHUB_OIDC_PROVIDER_ARN=arn:aws:iam::<dev-account-id>:oidc-provider/token.actions.githubusercontent.com
   WEB_GITHUB_OIDC_SUBJECT=repo:<owner>/<repo>:ref:refs/heads/develop
   ```

   Redeploy and review the change set (it should only add `WebPublisherRole`):

   ```bash
   make web-infra ENV=dev AWS_PROFILE=<dev-admin>
   ```

   Note the `PublisherRoleArn` output. If it is not printed:

   ```bash
   aws cloudformation describe-stacks --stack-name tour-mgmt-web-dev --region ap-south-1 \
     --query "Stacks[0].Outputs[?OutputKey=='PublisherRoleArn'].OutputValue" --output text
   ```

3. **Set the repository variables** (below), via the GitHub UI or `gh variable set NAME --body VALUE`. No secrets are needed. Never add `EXPO_PUBLIC_SETUP_HMAC_KEY` or `EXPO_PUBLIC_REVIEW_*`.
4. **Verify.** Ensure `develop` exists and contains the workflow, then run it once from Actions > Run workflow on `develop`. Check the run succeeds and the smoke check passes.
5. **Stop manual Dev publishing** except in emergencies.

Repository variables (Settings > Secrets and variables > Actions > Variables):

| Variable | Purpose |
| --- | --- |
| `WEB_DEV_ROLE_ARN` | `PublisherRoleArn` of the Dev stack |
| `WEB_AWS_REGION`, `WEB_AWS_ACCOUNT_ID`, `WEB_STACK_NAME` | Target account, region and stack |
| `APP_VARIANT` | `test` for Dev |
| `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_LOG_LEVEL`, `EXPO_PUBLIC_AWS_REGION`, `EXPO_PUBLIC_AWS_USER_POOL_ID`, `EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID`, `EXPO_PUBLIC_AWS_IDENTITY_POOL_ID` (optional), `EXPO_PUBLIC_TOUR_DATA_API_BASE_URL` | Same values as in `.env.web.dev.local` (mock data and QR dev format are forced to `false` by the script) |

Each run installs, lints, tests and exports, so watch the monthly Actions minutes. Rollback: re-run the workflow for an older `develop` commit (or republish locally in an emergency). Avoid manual Dev publishing otherwise; the last writer wins.

## Prod (manual)

Release owner only, with Prod SSO: clean worktree on a commit that is an ancestor of `origin/main`, then `make web-publish ENV=prod AWS_PROFILE=<prod>`. The script refuses Prod in CI, dirty worktrees and non-`main` commits.

## CSP

Start with `WEB_CSP_MODE=REPORT_ONLY`; once no violations are seen, set `ENFORCE` and rerun `make web-infra`.

## Troubleshooting

- *Wrong AWS account*: profile does not match `WEB_AWS_ACCOUNT_ID`.
- *Missing stack outputs*: stack name/region wrong or hosting stack not deployed.
- *AccessDenied*: the S3 error means `ListBucket`/`PutObject`/`GetObject`; invalidation means `cloudfront:CreateInvalidation`; stack outputs means `cloudformation:DescribeStacks`.
- *CORS error in the browser*: after a hosting stack rebuild the CloudFront domain changes; send the new `SiteUrl` to the backend team so they update the origin list and redeploy.
- *Smoke check fails on sha*: usually an old cached `index.html`; wait for the invalidation and retry.

## To-do: Phase 5 - Production manual publishing

_Blocked until the Production AWS account is ready and the app is ready to go live. Do not start earlier._

**Prerequisites**

- Prod AWS account and SSO profile exist; release owner and an account admin identified.
- Prod tour-data-api backend is deployed and the Prod Cognito pool, identity pool (if used) and API base URL are known.
- Backend team is ready to receive the Prod `SiteUrl` (Prod CORS allows `SiteUrl` only).

**Steps**

1. Create `.env.web.prod.local` from [.env.web.example](../../.env.web.example): set `WEB_AWS_ACCOUNT_ID` (Prod account), `WEB_AWS_REGION`, `WEB_OWNER`, `APP_VARIANT=production`, `EXPO_PUBLIC_ENVIRONMENT=prod` and the Prod `EXPO_PUBLIC_*` build values. Leave `WEB_GITHUB_OIDC_PROVIDER_ARN` and `WEB_GITHUB_OIDC_SUBJECT` empty (no GitHub-trusted Prod role while the repo is private). Keep `WEB_CSP_MODE=REPORT_ONLY`. Never add `EXPO_PUBLIC_SETUP_HMAC_KEY` or `EXPO_PUBLIC_REVIEW_*`.
2. Admin deploys hosting: `make web-infra ENV=prod AWS_PROFILE=<prod-admin>`; review the change set before confirming. Record the printed `SiteUrl`.
3. Send the Prod `SiteUrl` to the tour-data-api team and wait for confirmation that the Prod backend is deployed with it in `ManagementWebAllowedOrigins`. Order: hosting stack, `SiteUrl` handoff, backend Prod deploy, publish.
4. Release owner: check out `main` (clean worktree, HEAD must be an ancestor of `origin/main`), then run `make web-publish ENV=prod DRY_RUN=1 AWS_PROFILE=<prod>` followed by `make web-publish ENV=prod AWS_PROFILE=<prod>`.
5. Verify as in "Verified results (Dev)": HTTPS 200, http redirects to https, direct S3 URL denied, security headers and CSP report-only present, hashed JS immutable, `index.html` `no-cache`, `x-amz-meta-source-sha` matches the commit.
6. QA accepts login and dashboard flows against the Prod backend; check browser console for CSP violations.
7. Once QA confirms no CSP violations, set `WEB_CSP_MODE=ENFORCE` and rerun `make web-infra ENV=prod`.
8. Update this guide: record the verified Prod results (date, checks passed, deviations), the release owner responsibilities and the Prod rollback (check out the older commit or tag on `main` history and publish again). Update the "Prod (manual)" section if anything differs.

**Done when**: Prod site is live over HTTPS, QA has accepted it, CSP is enforced and this guide records the verified results.

## To-do: Phase 6 - Public repository and full CI (Stage 3)

_Blocked until Phase 5 is complete, the first Production release has happened and the owner decides to make the repo public. GitHub Free private repos do not support Environments, required reviewers or branch protection; these become available when the repo is public._

**Steps**

1. Pre-public checklist:
   - Scan the full git history for secrets (for example gitleaks; use only a tool the owner approves).
   - Confirm no account IDs, ARNs, user pool IDs or URLs are hardcoded in tracked files.
   - Set Actions to require approval for outside collaborators; ensure no workflow deploys on `pull_request`.
2. GitHub settings (after making the repo public):
   - Create Environments `web-dev` (deployment branch `develop`) and `web-prod` (required reviewers, deployment branch `main`).
   - Add branch protection or rulesets on `main` and `develop`.
   - Move the repository variables into the matching environment variables (`WEB_DEV_ROLE_ARN`, `WEB_AWS_*`, `WEB_STACK_NAME`, `APP_VARIANT`, `EXPO_PUBLIC_*`). Prod values live only in `web-prod`.
3. AWS trust updates (admin, per account):
   - Dev: set `WEB_GITHUB_OIDC_SUBJECT=repo:<owner>/<repo>:environment:web-dev` in `.env.web.dev.local`.
   - Prod: set `WEB_GITHUB_OIDC_PROVIDER_ARN` (Prod account's GitHub OIDC provider; create once if missing) and `WEB_GITHUB_OIDC_SUBJECT=repo:<owner>/<repo>:environment:web-prod` in `.env.web.prod.local`.
   - Run `make web-infra ENV=dev` and `make web-infra ENV=prod`; review that the change sets only change `WebPublisherRole`. Record each `PublisherRoleArn` and store it as `WEB_DEV_ROLE_ARN` / `WEB_PROD_ROLE_ARN` in the matching environment.
4. Workflow and script changes:
   - Rename `.github/workflows/web-dev.yml` to `web-deploy.yml`; add a `develop` push job (`environment: web-dev`) and a `main` push job (`environment: web-prod`), both with `id-token: write`, pinned action SHAs and the same publish command.
   - In [tools/web.sh](../../tools/web.sh), replace the "refuse Prod in CI" guard with: Prod in CI only when `GITHUB_REF` is `refs/heads/main`. Keep the clean worktree and ancestor-of-`origin/main` checks for local Prod publishing.
5. Verify: run one approved deployment per environment and check the smoke test passes; confirm a run from a non-`main` branch cannot assume the Prod role.
6. Update this guide and the [web deployment design](../design/web-deployment.md): mark Stage 3 implemented, document Environment and approval setup and the new trust subjects, and rewrite the Dev CI and Prod sections accordingly.

**Done when**: Dev and Prod both deploy through CI with environment protection, local Prod publishing remains as an emergency path, and the docs reflect Stage 3.
