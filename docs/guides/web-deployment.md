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

Setup: set `WEB_GITHUB_OIDC_PROVIDER_ARN` (the account's existing GitHub provider; if none exists, an admin creates it once with URL `https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com`) and `WEB_GITHUB_OIDC_SUBJECT=repo:<owner>/<repo>:ref:refs/heads/develop` in `.env.web.dev.local`, run `make web-infra ENV=dev`, and note the `PublisherRoleArn` output.

Repository variables (Settings > Secrets and variables > Actions > Variables):

| Variable | Purpose |
| --- | --- |
| `WEB_DEV_ROLE_ARN` | `PublisherRoleArn` of the Dev stack |
| `WEB_AWS_REGION`, `WEB_AWS_ACCOUNT_ID`, `WEB_STACK_NAME` | Target account, region and stack |
| `APP_VARIANT`, `EXPO_PUBLIC_*` build keys | Same names as in `.env.web.example` |

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
