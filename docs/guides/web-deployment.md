# Web deployment guide

_Last updated: 2026-10-04_

This guide covers SAM-managed app hosting, deployment identities and GitHub Environment setup. It does not create or change Cognito, API Gateway, Lambda, DynamoDB or backend file-storage resources; those remain owned by [tour-data-api](https://github.com/kvijay77-in/tour-data-api/blob/main/docs/guides/deployment.md). See the [web deployment design](../design/web-deployment.md) for architecture and security boundaries.

## Prerequisites and configuration

- Install the pinned Node.js `24.21.0`, SAM CLI `1.166.2`, AWS CLI v2 and GitHub CLI. Deployment checks versions and runs `sam validate --lint` on all three templates before infrastructure writes. SAM deploys the code-free templates directly; `sam build` is not required and is unrelated to Expo export.
- Use an approved AWS SSO profile and set `AWS_PROFILE` explicitly. The configured `localDeploymentPrincipalArn` must identify that account role; the command validates the account before writes and assumes the short-lived, environment-scoped infrastructure role for hosting/publisher reconciliation.
- Hosting and bootstrap stacks use `ap-south-1`; the backend stack region is an explicit config value. Production must use its separate account and matching backend.
- Create a private config from [`tools/web-deployment.example.json`](../../tools/web-deployment.example.json), for example `tools/web-deployment.dev.json`. Populated `tools/web-deployment.*.json` files are ignored by Git. Create a separate Production config with its own account, backend, stack names and reviewer IDs.
- Set `backend.outputKeys.apiBaseUrl` and any Cognito output keys to the exact labels in the approved backend stack. The implementation reads the values from `DescribeStacks`; it does not guess output names or append an API stage. The API URL must already be a complete HTTPS base URL including its configured stage path. Approved external Cognito IDs may be supplied as explicit `backend.publicOverrides`; missing required values stop setup.
- Set `readiness.apiUrl` to an owner-confirmed API route that permits unauthenticated CORS preflight and `readiness.artifactUrl` to the approved private artifact-bucket URL. The release checks API `GET`/`If-None-Match` CORS and `ETag` exposure, plus the S3 `PUT`/`Content-Type` preflight. Do not use a signed URL or query parameters.
- Use only public configuration values in `EXPO_PUBLIC_*`. Never store AWS credentials, passwords, tokens or signing keys in config, GitHub variables or exported application values.
- Preserve the existing `tour-mgmt-web-{env}` and `tour-mgmt-web-publisher-{env}` stack identities. Setup checks project/environment tags and existing logical resources. It reuses a verified account OIDC provider and keeps the original owner mode; ambiguous provider inventories stop for review.

## JSON configuration reference

The [example JSON](../../tools/web-deployment.example.json) is a template, not a ready-to-deploy configuration. Populate your ignored Dev configuration before running setup. JSON does not support comments. Keep account IDs and other identifiers as quoted strings, use `null` for an unused override, and replace every applicable placeholder with a confirmed value.

The tool does **not** fill in or rewrite your local JSON. You supply approved settings and the names of existing backend outputs. It creates or reuses app resources, reads their generated values, and configures GitHub Environment variables. Generated web bucket names, distribution IDs, `SiteUrl`, deployment-role ARNs and OIDC provider details do not need additional JSON fields.

### All configuration fields

Dotted names below describe nested JSON properties; for example, `github.owner` means `owner` inside the `github` object.

| Field | Meaning and how to obtain the Dev value |
| --- | --- |
| `schemaVersion` | Configuration format version. Keep the number `1`. |
| `environment` | Deployment target. Keep `"dev"` for Dev; Production uses `"prod"`. |
| `expectedAccountId` | Approved 12-digit Dev AWS account ID. Read `Account` from `aws sts get-caller-identity` using the intended profile. This is a safety check, not an instruction to select an account. |
| `hostingRegion` | Region for app hosting stacks. Keep `"ap-south-1"`; the tool currently requires it. CloudFront itself is global. |
| `backendRegion` | Region containing the existing Dev backend stack. Obtain from the backend deployment configuration or the backend owner. Do not migrate the backend or assume it matches hosting. |
| `backendProject` | Exact value of the backend CloudFormation stack's `Project` tag. Read the stack tags using the command below; do not infer it from the repository name. |
| `backendStackName` | Existing Dev backend CloudFormation stack name. Obtain from its deployment configuration or AWS Console > CloudFormation in the confirmed backend region. This tool does not create that stack. |
| `project` | App resource naming/tagging identifier. Keep `"tour-mgmt-app"` for this project. |
| `owner` | Approved ownership/cost-tracking tag for app resources, such as your team's established identifier. Agree it with the account owner; it is not an IAM ARN or automatically your GitHub username. |
| `localDeploymentPrincipalArn` | IAM role used by your local AWS profile and authorized to assume the app deployment roles. See the detailed lookup below. |
| `github.owner` | GitHub user or organisation owning this repository. Read it from the repository URL or the GitHub CLI command below. |
| `github.repository` | GitHub repository name, normally `"tour-mgmt-app"`. Supply the name only, not its URL or `owner/name`. |
| `github.productionReviewers` | Approved Production approvers. Keep `[]` for Dev. Production requires entries such as `{"type":"User","id":123456}` or `{"type":"Team","id":123456}` using numeric GitHub IDs, not usernames. |
| `stackNames.bootstrap` | Name for the app identity/bootstrap stack. Keep `"tour-mgmt-web-deploy-dev"` unless an existing approved deployment uses another supported naming family. |
| `stackNames.hosting` | Name for the app S3/CloudFront hosting stack. Keep `"tour-mgmt-web-dev"`; this is the stack the backend reads for `SiteUrl`. |
| `stackNames.publisher` | Name for the app publishing-role stack. Keep `"tour-mgmt-web-publisher-dev"`. All three names must use the same prefix and environment; do not rename existing deployments to obtain a new site. |
| `csp.mode` | Whether the browser only reports policy violations or enforces the policy. Start with `"REPORT_ONLY"`; see below. |
| `csp.contentSecurityPolicy` | Explicit, reviewed browser security-policy string. It is not generated from backend outputs; see below. |
| `public.logLevel` | Logging level embedded in the app build: `"error"`, `"warn"`, `"info"` or `"debug"`. `"info"` is the example's Dev choice. |
| `readiness.apiUrl` | Confirmed management API route used to check browser access. Not necessarily the API base URL. See below. |
| `readiness.artifactUrl` | Confirmed private backend artifact S3 URL used to check browser PUT preflight. Not the app's static hosting bucket. See below. |
| `backend.outputKeys.apiBaseUrl` | Exact backend CloudFormation output **name** whose value is the management API's full HTTPS base URL, including any stage path. Select the matching `OutputKey` from the stack outputs; do not put the URL here. Required; there is no API URL override. |
| `backend.outputKeys.userPoolId` | Optional additional mapping to the output name containing the existing management Cognito user pool ID. Add this key if using output discovery instead of its override. |
| `backend.outputKeys.userPoolWebClientId` | Optional additional mapping to the output name containing the existing public management Cognito app client ID. Add this key if using output discovery instead of its override. |
| `backend.outputKeys.identityPoolId` | Optional additional mapping to an existing identity pool output, only when required by the app's approved configuration. It is different from the user pool. |
| `backend.publicOverrides.userPoolId` | Existing approved Cognito user pool ID when not available through an output mapping. Obtain from the backend owner or Cognito > User pools > the matching Dev pool. Leave `null` when using its output mapping. |
| `backend.publicOverrides.userPoolWebClientId` | Existing public management app client ID from the backend owner or that pool's app clients. Use the approved client for the existing direct password-auth flow, without a client secret. Leave `null` when using its output mapping. |
| `backend.publicOverrides.identityPoolId` | Existing identity pool ID only when required and explicitly approved. Otherwise keep `null` and omit its output mapping. Do not create a pool to fill this field. |

The `github`, `stackNames`, `csp`, `public`, `readiness`, `backend`, `backend.outputKeys` and `backend.publicOverrides` objects group related settings; they are not additional AWS resources.

**Cognito requirement:** the example's `null` overrides do not trigger output-name discovery. Both `userPoolId` and `userPoolWebClientId` need either a confirmed output mapping or a non-null approved override. A non-null Cognito override takes precedence over its mapped output. Only the identity pool is optional.

Use these read-only commands to inspect the existing configuration. Replace the placeholders with approved values; no deployment is performed.

Confirm the profile's account and caller identity:

```sh
aws sts get-caller-identity --profile <approved-dev-profile>
```

Read the known backend stack's tags and output names/values in its actual region:

```sh
aws cloudformation describe-stacks \
  --stack-name <confirmed-backend-stack-name> \
  --region <confirmed-backend-region> \
  --profile <approved-dev-profile> \
  --query 'Stacks[0].{StackName:StackName,Tags:Tags,Outputs:Outputs}'
```

For example, if an output has `OutputKey: ManagementApiUrl` and an HTTPS URL as its `OutputValue`, set `backend.outputKeys.apiBaseUrl` to `"ManagementApiUrl"`. This name is illustrative, not a guaranteed backend output. The tool reads its value automatically and does not append a stage. The backend stack must have matching `Project` and `Environment` tags for the configured backend project and `dev` environment.

Read this checkout's GitHub repository identity:

```sh
gh repo view --json name,owner
```

For Production only, retrieve the numeric ID of an already approved reviewer with `gh api users/<approved-username> --jq .id`, or an approved organisation team with `gh api orgs/<organisation>/teams/<team-slug> --jq .id`. These are read-only lookups, not approval decisions. Dev needs neither lookup.

### Local deployment principal ARN

An ARN is AWS's full resource identifier. This field identifies the **existing IAM role behind your local AWS profile**, not your login email, profile name, access key or one of the roles web setup will create. Setup uses the approved account-owner credentials to create deployment identities; subsequent Dev operations check the caller role and assume the scoped app roles. The profile also needs the account owner's approved setup permissions and permission to assume those roles; knowing its ARN alone does not grant access.

1. Run the STS identity command above using the profile you intend to use for deployment. Check that `Account` is the approved Dev account.
2. If `Arn` looks like `arn:aws:sts::000000000000:assumed-role/ExampleDevRole/session-name`, the role name is `ExampleDevRole`. This is a **temporary session ARN**, not the value to put in JSON.
3. Retrieve the actual IAM role ARN, including any path, using the read-only command below. Alternatively, use AWS Console > IAM > Roles > that role > ARN. IAM Identity Center/SSO roles can have a path such as `aws-reserved/sso.amazonaws.com/...`; preserve the entire ARN.
4. Put the returned `arn:aws:iam::...:role/...` string in `localDeploymentPrincipalArn`. Its account must match `expectedAccountId` and its role must match the profile used for Dev operations.

Look up the role found in the STS result; `--role-name` takes the name only, not its path or session name:

```sh
aws iam get-role --role-name <role-name-from-sts-result> \
  --profile <approved-dev-profile> --query 'Role.Arn' --output text
```

Or Create a role using CloudFormation Deployer Permission set `arn:aws:iam::aws:policy/service-role/AWSCodeDeployRoleForCloudFormation` and assign it to an user using **Create Inline Policy** with the necessary permission for deployment.

If IAM lookup is denied, ask the account administrator for the exact role ARN; do not guess the path or broaden permissions yourself. If STS shows an IAM user or root identity rather than an assumed role, stop and obtain an approved role-based profile. The tool requires an IAM role here; do not supply a user ARN, root ARN or borrowed backend deployment role.

### CSP mode and policy

Content Security Policy (CSP) is an HTTP response header telling the browser which scripts, styles, images and network destinations the page may use. It protects the browser page; it does not configure backend CORS, sign users in or grant AWS permissions.

- `"REPORT_ONLY"` sends `Content-Security-Policy-Report-Only`. The browser reports violations in developer tools but does not block resources because of this policy. Use this for initial Dev compatibility review. No reports are sent to a service unless a reporting destination is configured separately; none is provided by this deployment.
- `"ENFORCE"` sends `Content-Security-Policy`. The browser blocks policy violations, which can break login, styles, images or API calls if the policy is incomplete. Switch only after compatibility review and approval.

`contentSecurityPolicy` is one JSON string of semicolon-separated directives, not a URL, AWS-generated identifier or the literal example placeholder. The tool requires an explicit policy of at most 1,783 characters; it does not create a suitable policy for you.

| Common directive | What to establish from the app/export and backend inventory |
| --- | --- |
| `default-src` | Default resource sources. `'self'` means the web page's own origin, so it does not require knowing the generated CloudFront hostname in advance. |
| `script-src` | Approved script sources. The inspected export had local scripts and no inline scripts; do not add `unsafe-eval` or inline-script permission speculatively. |
| `style-src` | Approved stylesheet sources and handling for generated/inline styles. The inspected export contained an inline style block; `'self'` alone does not allow it. Review hashes and runtime React Native Web styling; any `'unsafe-inline'` choice needs explicit review because it relaxes the policy. |
| `connect-src` | Exact approved API, regional Cognito and any file endpoints used by browser network requests. Use their origins, not API route paths or signed query strings. |
| `img-src` / `font-src` | Sources actually used by images and fonts. Permit `data:` or `blob:` only where the export/runtime requires it and the choice is approved. |
| `object-src`, `base-uri`, `frame-ancestors` | Restrictions on embedded objects, document base URLs and which sites may frame the app. Agree them with the security/deployment owner. |

To obtain the policy for your Dev deployment:

1. Inventory the confirmed API URL, Cognito region/endpoint and private artifact/photo endpoints used by the app. An origin is scheme plus hostname and optional port: `https://api.dev.example.com/dev/events` has origin `https://api.dev.example.com`.
2. Ask the deployment/security owner for an approved **report-only Dev policy** based on that inventory and the clean Expo export. Do not copy a Production policy with different service origins or allow every HTTPS destination to avoid errors.
3. Put the complete approved string in JSON and keep `mode` as `"REPORT_ONLY"`. For syntax only, a directive could be `connect-src 'self' https://api.dev.example.com`; that illustrative destination is not a policy approved for this app.
4. After backend pairing and Dev publication, QA reviews browser console violations and actual login, styles and file flows. Refine the policy with the owner before enforcing it. Report-only Dev testing can proceed before enforcement acceptance, but the policy must still be explicitly supplied and reviewed.

There is no universal ready-to-paste policy in this guide: the actual service endpoints and generated/runtime styles determine the correct value. If those inputs are unknown, obtain them rather than using the placeholder or weakening protections blindly.

### API readiness URL

`readiness.apiUrl` is the full HTTPS URL of an **existing, safe-to-read management API route**, including its stage and route path where applicable. The deployment check sends OPTIONS asking to use GET with `Authorization` and `If-None-Match`, then sends a GET **without a token** to check the response's CORS headers and exposure of `ETag`. A protected route can return an authentication error; it does not need to return public tour data. The response must satisfy the CORS/header check and must not be a server error.

Obtain it from the backend owner using the confirmed API base URL and API reference. Ask for a route suitable for the conditional GET/CORS checks above, not a health endpoint chosen only because it returns HTTP 200. Illustratively, if the confirmed base were `https://api.dev.example.com/dev` and the confirmed route were `/events`, the value would be `https://api.dev.example.com/dev/events`. This is not a claim that `/events` is the actual route for your stack.

Do not use the CloudFront `SiteUrl`, a Cognito login URL, a guessed route, credentials, query parameters or fragments. The backend's OPTIONS response must not require a login. Authenticated 200/304/error verification remains a separate backend/QA responsibility; this check does not prove that login or all API operations work.

### Artifact readiness URL

`readiness.artifactUrl` identifies the **private backend artifact bucket's approved regional S3 endpoint/object URL**. It is unrelated to the web bucket containing HTML and JavaScript. The check sends OPTIONS requesting PUT with `Content-Type` for the discovered web origin. It does not obtain a presigned URL, upload a file or make the bucket public.

Ask the backend owner for the Dev artifact bucket name, actual bucket region and a suitable object URL for this preflight. They can find the bucket through confirmed backend outputs or AWS Console > S3. A common regional URL form is `https://<artifact-bucket>.s3.<bucket-region>.amazonaws.com/<approved-object-key>`; use the owner-confirmed endpoint form, not this literal placeholder. Prefer the correct regional endpoint to avoid redirects. Do not assume the bucket region is the app hosting region.

Use a URL **without** the `?X-Amz-...` signature/query from a presigned upload URL. Never paste or log signed URLs to discover the setting; ask for the unsigned endpoint instead. Successful preflight only proves the browser upload policy permits the request. Actual PUT still needs a valid presigned URL and matching signed content type, and unsigned file access must remain denied.

### When the values are needed

All required account, role, backend/public configuration and CSP inputs must be available for setup and infrastructure deployment. The two readiness URLs may be omitted or set to `null` while creating infrastructure only; do not leave angle-bracket placeholders, which fail validation. **Both URLs are required for full publication.** Populate them and reconcile GitHub settings before a workflow relies on those settings.

First create app Dev infrastructure to establish `SiteUrl`, then have the backend independently discover that output and deploy/verify API and artifact CORS, then run the full app deployment. A readiness URL is not a substitute for this backend configuration. Ordinary later app releases retain the same origin and do not require backend redeployment just to publish new content.

## Setup and deployment

Review the identity before setup:

```sh
export AWS_PROFILE="<approved-sso-profile>"
aws sts get-caller-identity
```

Populate the ignored Dev config with the account ID, owner tag, exact backend stack/output labels, local deployment role ARN and reviewed CSP. Start with `REPORT_ONLY`; it does not enforce the policy or send reports.

```sh
make web-setup ENV=dev CONFIG=tools/web-deployment.dev.json AWS_PROFILE="$AWS_PROFILE"
```

`web-setup` creates or reconciles the admin-owned bootstrap stack using the caller profile, then configures the matching GitHub Environment. Existing values that differ are not overwritten unless `GITHUB_CONFIG_REPLACE=true` is explicitly supplied. Production setup requires approved reviewer IDs, verifies a `main`-only deployment restriction, and creates the repository-scoped `WEB_PRODUCTION_ENABLED=false` readiness switch without enabling it.

```sh
make deploy-dev CONFIG=tools/web-deployment.dev.json AWS_PROFILE="$AWS_PROFILE" SOURCE_REF=main STAGE=infrastructure
make web-setup ENV=dev CONFIG=tools/web-deployment.dev.json AWS_PROFILE="$AWS_PROFILE"
make deploy-dev CONFIG=tools/web-deployment.dev.json AWS_PROFILE="$AWS_PROFILE" SOURCE_REF=main
make web-status ENV=dev CONFIG=tools/web-deployment.dev.json AWS_PROFILE="$AWS_PROFILE"
```

The infrastructure-only first run establishes `SiteUrl`; the independent backend deploy can discover that stack output and apply browser CORS before full web publication. On an initial Dev setup, the infrastructure command fills missing generated GitHub Environment values automatically when authenticated `gh` access exists. Run `web-setup` again if that access was unavailable. For Production, run `web-setup ENV=prod` once more after the approved infrastructure-only workflow creates the publisher outputs; the workflow itself never writes GitHub settings.

Existing stacks are updated in place; empty changesets are successful. Deletes, replacements, uncertain replacement conditions, wrong accounts, unowned stacks and nonterminal stack states are refused. A rejected update is not automatically deleted, recreated or rolled back; inspect `web-status` and CloudFormation events before an approved recovery.

`--stage infrastructure` reconciles hosting and publisher stacks without building or publishing. Production infrastructure creation is available through the protected-main workflow dispatch even while publication readiness is false. Production full local deployment is refused. Local Dev builds use the selected developer-trusted source and a sanitized subprocess environment, but a local subprocess is not a security sandbox against hostile source code.

## Automated release and rollback

`make deploy-dev` resolves `SOURCE_REF` to a commit once, checks it out in an isolated Git worktree, then runs `npm ci`, lint, typecheck, the required Jest release tests, Expo public-config validation and static export. The build disables dotenv loading and receives only explicit public environment values; reviewer, HMAC, debug, mock and QR development values are omitted or forced off. A validated manifest records source, trusted helper/workflow commits, environment, config fingerprint, toolchain, release ID and file checksums. Local Dev artifacts are stored under ignored `.web-releases/<env>/<release-id>/`, retaining the five newest for up to 30 days.

Production deploys automatically from relevant protected-main changes after the repository readiness switch is enabled and the `web-prod` approval succeeds. A trusted-main workflow dispatch may build a selected Dev `source_ref`; the local Dev Make target remains primary. CI branch builds receive no AWS role or GitHub administration token. AWS infrastructure reconciliation and publisher-only release use separate jobs; the full environment operation is serialized and guarded by the shared bucket lease. GitHub archives exact environment artifacts for 30 days, subject to repository limits.

Rollback uses retained bytes, never an old-source rebuild:

```sh
make web-rollback ENV=dev CONFIG=tools/web-deployment.dev.json RELEASE_ID=<exact-release-id> AWS_PROFILE="$AWS_PROFILE"
```

The CI rollback workflow accepts only a successful trusted-main deployment run from the matching environment and requires the normal `web-prod` approval for Production. Recovery verifies manifest provenance/checksums/config and uses the same lease, upload order, invalidation and HTTP checks. A changed public config does not by itself prevent an authorized same-environment rollback; the historical manifest fingerprint is still validated for shape and identity.

Dev and Actions share one conditional `.web-deploy-lock` S3 object. Release deletes it only with the observed ETag and matching owner. `web-status` reports the Dev lease owner and timestamp. After confirming the owning process/run has stopped, stale recovery requires the exact owner, a lease older than six hours, and an audit reason:

```sh
make web-lock-recover ENV=dev CONFIG=tools/web-deployment.dev.json \
  LOCK_OWNER=<exact-owner> RECOVERY_REASON="<approved recovery reason>" AWS_PROFILE="$AWS_PROFILE"
```

The corresponding protected GitHub workflow can perform the same operation for an approved environment. Recovery verifies Actions-owned leases against the exact completed run and attempt; on the same workstation it also refuses a live local owner PID. Never delete another run's lease or grant broad bucket `DeleteObject`; only the exact coordination key is in scope.

## Resources and role boundaries

SAM manages three independent stacks: `tour-mgmt-web-deploy-{env}` for bootstrap identities/boundary, the existing `tour-mgmt-web-{env}` hosting stack, and the existing `tour-mgmt-web-publisher-{env}` stack. Their templates are passed explicitly on every SAM operation; no nested stack or artifact bucket is introduced.

The bootstrap stack creates the infrastructure OIDC role, a dedicated CloudFormation execution role and the publisher permissions boundary. The infrastructure role can reconcile only the exact hosting/publisher stack names, inspect the approved backend stack, and pass only its execution role. The execution role manages the tagged app resources and only the exact publisher role with the required boundary. CloudFront create/list and IAM OIDC inventory calls that cannot be resource-scoped are explicitly enumerated; tagging and account/resource conditions constrain the remaining operations. Origin Access Control updates are restricted to this account's CloudFront OAC ARN namespace because that resource type does not expose compatible tags. Routine infrastructure code cannot update bootstrap roles, provider ownership or the boundary.

The publisher role cannot delete published site objects, change hosting resources, manage IAM/CloudFormation or modify backend resources. Its bootstrap-owned boundary allows deletion only of `.web-deploy-lock`; conditional lease creation is required, and cleanup uses the exact ETag observed for the matching owner. CloudFront is explicitly denied access to the lease key. Existing account OIDC providers are reused without modifying them; a provider created by an older publisher stack remains owned by that stack.

GitHub environment variables use generated stack outputs for role ARNs, bucket and distribution IDs, and confirmed backend outputs for public app configuration. The setup command preserves unrelated variables, refuses mismatched existing values unless explicitly approved, and does not store GitHub tokens in repository files. It refuses existing reviewer-routing, setup-HMAC, API-debug or unapproved identity-pool variables; resolve these through an approved GitHub settings change. It does not set EAS or Firebase values.

## Backend and CSP

The hosting stack exposes `SiteUrl` as an output. The integration contract is for the independent backend deployment to read that output through its own read-only stack lookup; the app command does not deploy backend resources or copy the origin into backend configuration. Verify the backend lookup implementation and API/private-bucket CORS before claiming integrated readiness:

- Management HTTP API CORS for the web origin, required browser methods/headers, and `ETag` exposure for conditional event requests.
- Artifact-bucket CORS for browser presigned `PUT` requests, including the matching `Content-Type`; do not make file buckets public.
- Photo-bucket CORS only where actual browser file operations require it.

Do not change backend templates or stacks in this repository.

Review the CSP against the actual clean web export, generated React Native Web styles, and the approved Cognito/API/file origins. The inspected static export had no inline scripts, external HTML resource origins or event-handler attributes, and one inline style block; runtime service origins come from the target environment. The template requires an explicit CSP value and defaults to `REPORT_ONLY`; this sends no reports by itself. Do not add a reporting service or broaden CSP sources speculatively. Move to `ENFORCE` only after compatibility is verified; if it requires app changes, stop and obtain approval outside this deployment phase.

## Configuration boundary

Web GitHub Environment values are separate from EAS mobile build configuration and local `.env` files. Never commit populated web config or `.env` files and do not change EAS values as part of hosting. Public `EXPO_PUBLIC_*` values are embedded in the exported JavaScript and must not contain secrets.

Backend infrastructure remains owned by [tour-data-api](https://github.com/kvijay77-in/tour-data-api). For the app's existing mobile configuration, see [configuration](configuration.md) and the [EAS build guide](eas-build-and-release.md).
