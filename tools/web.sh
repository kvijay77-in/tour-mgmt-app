#!/usr/bin/env bash
# Web hosting infra deploy and publish. Usage: tools/web.sh infra|publish --env dev|prod [--dry-run]
set -euo pipefail

CMD="${1:-}"; shift || true
ENV_NAME=""; DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$CMD" == "infra" || "$CMD" == "publish" ]] || { echo "Usage: $0 infra|publish --env dev|prod [--dry-run]" >&2; exit 2; }
[[ "$ENV_NAME" == "dev" || "$ENV_NAME" == "prod" ]] || { echo "--env must be dev or prod" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IN_CI="${GITHUB_ACTIONS:-false}"

# Allow-listed keys only; the env file is parsed, never sourced.
INFRA_KEYS=(WEB_AWS_ACCOUNT_ID WEB_AWS_REGION WEB_STACK_NAME WEB_OWNER WEB_CSP WEB_CSP_MODE WEB_GITHUB_OIDC_PROVIDER_ARN WEB_GITHUB_OIDC_SUBJECT)
BUILD_KEYS=(APP_VARIANT EXPO_PUBLIC_ENVIRONMENT EXPO_PUBLIC_LOG_LEVEL EXPO_PUBLIC_AWS_REGION EXPO_PUBLIC_AWS_USER_POOL_ID EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID EXPO_PUBLIC_AWS_IDENTITY_POOL_ID EXPO_PUBLIC_TOUR_DATA_API_BASE_URL EXPO_PUBLIC_USE_MOCK_DATA EXPO_PUBLIC_QR_DEV_FORMAT)
ALLOWED=("${INFRA_KEYS[@]}" "${BUILD_KEYS[@]}")

declare -A CFG
ENV_FILE=".env.web.${ENV_NAME}.local"
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" =~ ^([A-Z0-9_]+)=(.*)$ ]] || { echo "Invalid line in $ENV_FILE (expected KEY=VALUE)" >&2; exit 1; }
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    for k in "${ALLOWED[@]}"; do [[ "$k" == "$key" ]] && CFG[$key]="$val"; done
  done < "$ENV_FILE"
else
  for k in "${ALLOWED[@]}"; do [[ -n "${!k+x}" ]] && CFG[$k]="${!k}"; done
fi
cfg() { echo "${CFG[$1]:-${2:-}}"; }

DEFAULT_VARIANT=test; [[ "$ENV_NAME" == "prod" ]] && DEFAULT_VARIANT=production
REGION="$(cfg WEB_AWS_REGION ap-south-1)"
STACK="$(cfg WEB_STACK_NAME "tour-mgmt-web-${ENV_NAME}")"
EXPECTED_ACCOUNT="$(cfg WEB_AWS_ACCOUNT_ID)"
[[ -n "$EXPECTED_ACCOUNT" ]] || { echo "WEB_AWS_ACCOUNT_ID is required" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }; }
need aws; need node; need npm
[[ "$(aws --version 2>&1)" == aws-cli/2* ]] || { echo "AWS CLI v2 is required" >&2; exit 1; }
[[ "$CMD" == "infra" ]] && need sam
if [[ "$IN_CI" != "true" && -z "${AWS_PROFILE:-}" ]]; then echo "AWS_PROFILE must be set" >&2; exit 1; fi
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT" == "$EXPECTED_ACCOUNT" ]] || { echo "Wrong AWS account: got $ACCOUNT, expected $EXPECTED_ACCOUNT" >&2; exit 1; }

if [[ "$CMD" == "infra" ]]; then
  [[ "$IN_CI" != "true" ]] || { echo "infra is not allowed in CI" >&2; exit 1; }
  CSP_MODE="$(cfg WEB_CSP_MODE REPORT_ONLY)"
  sam deploy --config-env "$ENV_NAME" --stack-name "$STACK" --parameter-overrides \
    "Environment=\"${ENV_NAME}\"" \
    "Owner=\"$(cfg WEB_OWNER)\"" \
    "ContentSecurityPolicy=\"$(cfg WEB_CSP)\"" \
    "CspMode=\"${CSP_MODE}\"" \
    "GitHubOidcProviderArn=\"$(cfg WEB_GITHUB_OIDC_PROVIDER_ARN)\"" \
    "GitHubOidcSubject=\"$(cfg WEB_GITHUB_OIDC_SUBJECT)\""
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
  exit 0
fi

# ---- publish ----
SHA="$(git rev-parse HEAD)"
if [[ "$ENV_NAME" == "prod" ]]; then
  [[ "$IN_CI" != "true" ]] || { echo "Prod publish from CI is not allowed" >&2; exit 1; }
  [[ -z "$(git status --porcelain)" ]] || { echo "Prod publish requires a clean worktree" >&2; exit 1; }
  git fetch origin main
  git merge-base --is-ancestor HEAD origin/main || { echo "HEAD must be an ancestor of origin/main" >&2; exit 1; }
fi

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text; }
BUCKET="$(out BucketName)"; DIST_ID="$(out DistributionId)"; SITE_URL="$(out SiteUrl)"
for v in "$BUCKET" "$DIST_ID" "$SITE_URL"; do
  [[ -n "$v" && "$v" != "None" ]] || { echo "Missing stack outputs (BucketName, DistributionId, SiteUrl) on $STACK" >&2; exit 1; }
done

npm ci
npm run lint
npm run typecheck
npm test

OUT_DIR="dist/web-${ENV_NAME}"
rm -rf "$OUT_DIR"
BUILD_ENV=("PATH=$PATH" "HOME=$HOME" "EXPO_NO_DOTENV=1" "CI=1" "APP_VARIANT=$(cfg APP_VARIANT "$DEFAULT_VARIANT")" "EXPO_PUBLIC_ENVIRONMENT=$(cfg EXPO_PUBLIC_ENVIRONMENT "$ENV_NAME")" "EXPO_PUBLIC_USE_MOCK_DATA=false" "EXPO_PUBLIC_QR_DEV_FORMAT=false")
for k in "${BUILD_KEYS[@]}"; do
  case "$k" in APP_VARIANT|EXPO_PUBLIC_ENVIRONMENT|EXPO_PUBLIC_USE_MOCK_DATA|EXPO_PUBLIC_QR_DEV_FORMAT) continue ;; esac
  [[ -n "$(cfg "$k")" ]] && BUILD_ENV+=("$k=$(cfg "$k")")
done
for v in TMPDIR XDG_CACHE_HOME npm_config_cache; do [[ -n "${!v:-}" ]] && BUILD_ENV+=("$v=${!v}"); done
env -i "${BUILD_ENV[@]}" npx expo export --clear --platform web --output-dir "$OUT_DIR"

[[ "$(find "$OUT_DIR" -maxdepth 1 -name index.html | wc -l)" -eq 1 ]] || { echo "Export must contain exactly one root index.html" >&2; exit 1; }
[[ -z "$(find "$OUT_DIR" -name '*.map' -print -quit)" ]] || { echo "Export contains source maps" >&2; exit 1; }

DRY=(); $DRY_RUN && DRY=(--dryrun)
S3="s3://${BUCKET}"
# Content-hashed output lives under _expo/static and assets.
aws s3 sync "$OUT_DIR/_expo/static" "$S3/_expo/static" "${DRY[@]}" --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$OUT_DIR/assets" "$S3/assets" "${DRY[@]}" --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$OUT_DIR" "$S3" "${DRY[@]}" --exclude "_expo/static/*" --exclude "assets/*" --exclude "index.html" --cache-control "no-cache"
if $DRY_RUN; then
  echo "Dry run: skipping index.html upload and invalidation"
else
  aws s3 cp "$OUT_DIR/index.html" "$S3/index.html" --cache-control "no-cache" --content-type "text/html" --metadata "source-sha=${SHA}"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
  ok=false
  for _ in $(seq 1 24); do
    hdrs="$(curl -sI "${SITE_URL}/" || true)"
    if grep -qE '^HTTP/[0-9.]+ 200' <<<"$hdrs" && grep -qi "^x-amz-meta-source-sha: ${SHA}" <<<"$hdrs"; then ok=true; break; fi
    sleep 5
  done
  $ok || { echo "Smoke check failed: ${SITE_URL}/ did not serve sha ${SHA} within ~2 min" >&2; exit 1; }
fi
echo "env=${ENV_NAME} account=${ACCOUNT} site=${SITE_URL} sha=${SHA}"
