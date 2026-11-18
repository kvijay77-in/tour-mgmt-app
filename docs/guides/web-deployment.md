# Web deployment guide

_Last updated: 2026-11-18_

The web app is hosted on private S3 behind CloudFront, defined in [infra/web.yaml](../../infra/web.yaml). See the [web deployment design](../design/web-deployment.md) for architecture, stages and boundaries. One script, [tools/web.sh](../../tools/web.sh), provides both commands, wrapped by the [Makefile](../../Makefile).

## Prerequisites

- AWS CLI v2, SAM CLI (infra only), Node/npm per `package.json`, and an SSO profile per environment (`AWS_PROFILE`).
- Account admin: needed for `make web-infra` (CloudFormation, S3, CloudFront; IAM only when the publisher role is enabled).
- Developer / release owner: only needs `s3:ListBucket`, `s3:PutObject`, `s3:GetObject`, `cloudfront:CreateInvalidation` and `cloudformation:DescribeStacks` on the stack.

## Configuration

For local runs, copy [.env.web.example](../../.env.web.example) to `.env.web.<env>.local` (gitignored). In CI the same names are read from the process environment; the deployment workflow sets them from repository variables and the backend SSM values. Only allow-listed keys are read; the file is parsed, never sourced. Never add `EXPO_PUBLIC_SETUP_HMAC_KEY` or `EXPO_PUBLIC_REVIEW_*` variables.

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

- Publish runs `npm ci`, lint, typecheck and tests as a release gate (`--skip-checks` skips the checks; the workflow uses it because its verify job already ran them), exports with a clean environment, uploads (hashed assets immutable, `index.html` last with `source-sha` metadata), invalidates `/*` and smoke-checks the site.
- `make web-publish ENV=dev DRY_RUN=1` builds and runs `aws s3 sync --dryrun`; nothing is written.
- Rollback: check out the older commit or tag and publish again.

## CI

The [deployment workflow](deployment-workflow.md) (`.github/workflows/deploy.yml`) publishes the web app when started manually with `target` set to `web` or `all`:

- **Branches.** `develop` publishes to dev and `main` to prod. Inside CI, `tools/web.sh` refuses any other combination.
- **Credentials.** The workflow assumes the stack's `WebPublisherRole` through GitHub OIDC; no AWS keys are stored.
- **Build values.** The `EXPO_PUBLIC_*` values come from the tour-data-api SSM handover (`/tour-data-api/<env>/mgmt/*`), not from repository variables.
- **Checks.** Lint, typecheck and tests run once in the workflow's verify job, so the publish step passes `--skip-checks`.
- **Clean-worktree check.** The local clean-worktree and ancestor-of-`origin/main` checks are skipped in CI, because the branch guard already pins the exact ref.

Repository variables, the dev publisher role check and the first run are described in the [workflow setup](deployment-workflow.md#setup). The publisher role's OIDC subject must be `repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/develop` for dev and `...:ref:refs/heads/main` for prod. Do not use a GitHub Environment subject: the backend config-read roles trust branch subjects only.

Each run installs, lints, tests and exports, so watch the monthly Actions minutes. Rollback: rerun the workflow on the branch after reverting, or republish an older commit locally. Avoid manual publishing otherwise; the last writer wins.

## Local publishing

`make web-publish ENV=<env> AWS_PROFILE=<profile>` remains available for emergencies and first-time checks. Local Prod publishing is for the release owner only, with Prod SSO, from a clean worktree whose HEAD is an ancestor of `origin/main`. The script refuses dirty worktrees and non-`main` commits for local Prod publishing.

## CSP

Start with `WEB_CSP_MODE=REPORT_ONLY`; once no violations are seen, set `ENFORCE` and rerun `make web-infra`.

## Troubleshooting

- *Wrong AWS account*: profile does not match `WEB_AWS_ACCOUNT_ID`.
- *Missing stack outputs*: stack name/region wrong or hosting stack not deployed.
- *AccessDenied*: the S3 error means `ListBucket`/`PutObject`/`GetObject`; invalidation means `cloudfront:CreateInvalidation`; stack outputs means `cloudformation:DescribeStacks`.
- *CORS error in the browser*: after a hosting stack rebuild the CloudFront domain changes; send the new `SiteUrl` to the backend team so they update the origin list and redeploy.
- *Smoke check fails on sha*: usually an old cached `index.html`; wait for the invalidation and retry.

## To-do: Phase 5 - Production publishing

_Blocked until Production is approved, the Prod AWS account is ready and the app is ready to go live. Do not start earlier._

**Prerequisites**

- Prod AWS account and SSO profile exist; release owner and an account admin identified.
- Prod tour-data-api backend is deployed and publishes `/tour-data-api/prod/mgmt/*`; the backend team has sent the `tour-data-api-mgmt-config-read-prod` role ARN.
- Backend team is ready to receive the Prod `SiteUrl` (Prod CORS allows `SiteUrl` only).

**Steps**

1. Create `.env.web.prod.local` from [.env.web.example](../../.env.web.example).
   - Set `WEB_AWS_ACCOUNT_ID` (Prod account), `WEB_AWS_REGION` and `WEB_OWNER`.
   - Set `WEB_GITHUB_OIDC_PROVIDER_ARN` (the Prod account's GitHub OIDC provider; create it once if missing) and `WEB_GITHUB_OIDC_SUBJECT=repo:kvijay77-in/tour-mgmt-app:ref:refs/heads/main`.
   - Keep `WEB_CSP_MODE=REPORT_ONLY`.
   - For a local publish, also set `APP_VARIANT=production`, `EXPO_PUBLIC_ENVIRONMENT=prod` and the Prod `EXPO_PUBLIC_*` values.
   - Never add `EXPO_PUBLIC_SETUP_HMAC_KEY` or `EXPO_PUBLIC_REVIEW_*`.
2. Admin deploys hosting: `make web-infra ENV=prod AWS_PROFILE=<prod-admin>`; review the change set before confirming. Record the printed `SiteUrl` and `PublisherRoleArn`.
3. Send the Prod `SiteUrl` to the tour-data-api team and wait for confirmation that the Prod backend is deployed with it in `ManagementWebAllowedOrigins`. Order: hosting stack, `SiteUrl` handoff, backend Prod deploy, publish.
4. Set the repository variables `WEB_PROD_ROLE_ARN` (the `PublisherRoleArn`), `WEB_PROD_AWS_ACCOUNT_ID` and `AWS_CONFIG_READ_ROLE_ARN_PROD`; see the [placeholders](deployment-workflow.md#placeholders-until-production-is-approved).
5. Run the deployment workflow on `main` with `target=web`.
6. Verify as in "Verified results (Dev)": HTTPS 200, http redirects to https, direct S3 URL denied, security headers and CSP report-only present, hashed JS immutable, `index.html` `no-cache`, `x-amz-meta-source-sha` matches the commit.
7. QA accepts login and dashboard flows against the Prod backend; check browser console for CSP violations.
8. Once QA confirms no CSP violations, set `WEB_CSP_MODE=ENFORCE` and rerun `make web-infra ENV=prod`.
9. Update this guide: record the verified Prod results (date, checks passed, deviations) and the release owner responsibilities.

**Done when**: Prod site is live over HTTPS through the workflow, QA has accepted it, CSP is enforced and this guide records the verified results.

## To-do: Phase 6 - Branch protection

_Out of scope for now. GitHub Free private repositories do not support branch protection; it becomes available on a paid plan or a public repository._

1. Before making the repository public:
   - scan the full git history for secrets with a tool the owner approves;
   - confirm no account IDs, ARNs, user pool IDs or URLs are hardcoded in tracked files;
   - set Actions to require approval for outside collaborators.
2. Add branch protection or rulesets on `develop` and `main`: require pull requests and block force pushes. The OIDC trust of the publisher and config-read roles is pinned to these branches, so protecting them protects deployment.
3. Optionally add a `pull_request` or `push` trigger to `deploy.yml`. Never deploy from `pull_request` events of forks.
4. Do not move deployment jobs into GitHub Environments without first changing the backend role trust (see the [workflow guide](deployment-workflow.md#what-a-run-does)).
