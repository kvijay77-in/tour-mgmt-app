#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./tools/push-eas-env.sh [--file PATH] [--dry-run] [environment...]

Reads populated EXPO_PUBLIC_* entries from a .env file and upserts them into
EAS project environments using `npx eas-cli env:set`.

Defaults:
  --file EAS.env
  environments: preview production

Notes:
  - Empty values are skipped.
  - EXPO_PUBLIC_ENVIRONMENT, EXPO_PUBLIC_USE_MOCK_DATA,
    EXPO_PUBLIC_LOG_LEVEL, and EXPO_PUBLIC_API_DEBUG_GET are skipped because
    this repo manages those per build profile in eas.json.

Examples:
  ./tools/push-eas-env.sh
  ./tools/push-eas-env.sh preview
  ./tools/push-eas-env.sh --file .env preview production
  ./tools/push-eas-env.sh --dry-run development
EOF
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

should_skip_key() {
  local key="$1"

  case "$key" in
    EXPO_PUBLIC_ENVIRONMENT|EXPO_PUBLIC_USE_MOCK_DATA|EXPO_PUBLIC_LOG_LEVEL|EXPO_PUBLIC_API_DEBUG_GET)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

env_file="EAS.env"
dry_run=0
declare -a target_envs=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --file" >&2
        exit 1
      fi
      env_file="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      target_envs+=("$1")
      shift
      ;;
  esac
done

if [[ ${#target_envs[@]} -eq 0 ]]; then
  target_envs=(preview production)
fi

if [[ ! -f "$env_file" ]]; then
  echo "Env file not found: $env_file" >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required but was not found in PATH" >&2
  exit 1
fi

if [[ $dry_run -eq 0 ]]; then
  npx eas-cli whoami >/dev/null
fi

set_count=0
skip_count=0

# Read the env file from a dedicated file descriptor so eas-cli cannot consume
# the remaining lines from the loop's input stream.
while IFS= read -r -u 3 raw_line || [[ -n "$raw_line" ]]; do
  line="${raw_line%$'\r'}"
  trimmed_line="$(trim "$line")"

  if [[ -z "$trimmed_line" || "$trimmed_line" == \#* ]]; then
    continue
  fi

  if [[ "$trimmed_line" != *=* ]]; then
    echo "Skipping malformed line: $trimmed_line" >&2
    ((skip_count+=1))
    continue
  fi

  key="${trimmed_line%%=*}"
  value="${trimmed_line#*=}"

  key="$(trim "$key")"
  key="${key#export }"
  key="$(trim "$key")"
  value="$(trim "$value")"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  if [[ "$key" != EXPO_PUBLIC_* ]]; then
    continue
  fi

  if should_skip_key "$key"; then
    echo "Skipping $key (managed in eas.json)"
    ((skip_count+=1))
    continue
  fi

  if [[ -z "$value" ]]; then
    echo "Skipping $key (empty value)"
    ((skip_count+=1))
    continue
  fi

  for environment in "${target_envs[@]}"; do
    if [[ $dry_run -eq 1 ]]; then
      echo "[dry-run] Would set $key in $environment"
    else
      npx eas-cli env:set \
        --scope project \
        --environment "$environment" \
        --name "$key" \
        --value "$value" \
        --type string \
        --visibility plaintext \
        --non-interactive </dev/null >/dev/null
      echo "Set $key in $environment"
    fi

    ((set_count+=1))
  done
done 3< "$env_file"

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run complete: $set_count pending updates, $skip_count skipped entries"
else
  echo "Sync complete: $set_count updates applied, $skip_count skipped entries"
fi