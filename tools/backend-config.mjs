#!/usr/bin/env node
// Maps the tour-data-api SSM handover values to this app's EXPO_PUBLIC_* names.
//
//   node tools/backend-config.mjs sync-eas --environment preview|production [--dry-run]
//       Make the EAS environment match the backend values. Only changed variables are written.
//   node tools/backend-config.mjs web-env --env dev|prod
//       Print KEY=VALUE lines for tools/web.sh (append to $GITHUB_ENV in CI).
//
// Inputs (environment variables):
//   DEV_PARAMS, PROD_PARAMS  JSON [[name, value], ...] from
//                            `aws ssm get-parameters-by-path --query 'Parameters[].[Name,Value]'`
//   REVIEW_USERNAME          Store reviewer login (app-owned, production only)
//   EAS_CLI                  Optional eas command, e.g. "eas" after `npm i -g eas-cli@latest`.
//                            Default: npx --yes eas-cli@latest
//
// Safety rules:
//   - preview may be written only from develop, production only from main (dry runs excepted).
//   - A variable linked to several EAS environments is first unlinked from the target
//     environment (its value in the other environments is kept), then recreated for the
//     target only. Writing a shared variable would change every environment it is linked to.
//   - Variables this script does not manage (GOOGLE_SERVICES_JSON, EXPO_PUBLIC_SETUP_HMAC_KEY,
//     ...) are never touched.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// ---- Backend contract (handover: /tour-data-api/<env>/mgmt/*) --------------------------------

const SSM_PREFIX = { dev: '/tour-data-api/dev/mgmt/', prod: '/tour-data-api/prod/mgmt/' };

/** [EAS name, SSM leaf]; all required. */
const PRIMARY = [
  ['EXPO_PUBLIC_AWS_REGION', 'region'],
  ['EXPO_PUBLIC_AWS_USER_POOL_ID', 'cognito-user-pool-id'],
  ['EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID', 'cognito-app-client-id'],
  ['EXPO_PUBLIC_TOUR_DATA_API_BASE_URL', 'api-endpoint'],
];

/** [EAS name, SSM leaf]; set when present in SSM, removed from EAS when absent. */
const OPTIONAL = [['EXPO_PUBLIC_AWS_IDENTITY_POOL_ID', 'identity-pool-id']];

const REVIEW_PREFIX = 'EXPO_PUBLIC_REVIEW_';
const toReviewName = (name) => REVIEW_PREFIX + name.slice('EXPO_PUBLIC_'.length);

const EAS_TARGETS = { preview: { branch: 'develop' }, production: { branch: 'main' } };

// ---- Helpers --------------------------------------------------------------------------------

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--environment' || arg === '--env') opts.target = rest[(i += 1)];
    else fail(`Unknown argument: ${arg}`);
  }
  return opts;
}

function cleanValue(name, raw) {
  const value = String(raw ?? '').trim();
  if (/[\r\n]/.test(value)) fail(`${name} contains a line break`);
  return value;
}

/** Read one account's SSM values into { leaf: value }. */
function readParams(envVar, backendEnv) {
  const raw = process.env[envVar];
  if (!raw) fail(`${envVar} is empty; the ${backendEnv} SSM read did not provide values`);
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    fail(`${envVar} is not valid JSON`);
  }
  if (!Array.isArray(rows)) fail(`${envVar} must be a JSON array of [name, value]`);
  const prefix = SSM_PREFIX[backendEnv];
  const values = {};
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== 'string') fail(`${envVar} has a malformed row`);
    if (!row[0].startsWith(prefix)) continue;
    const leaf = row[0].slice(prefix.length);
    values[leaf] = cleanValue(row[0], row[1]);
  }
  return values;
}

/** Map one backend environment's values to EXPO_PUBLIC_* names; null means "must be absent". */
function backendValues(backendEnv) {
  const params = readParams(backendEnv === 'dev' ? 'DEV_PARAMS' : 'PROD_PARAMS', backendEnv);
  const missing = PRIMARY.filter(([, leaf]) => !params[leaf]).map(([, leaf]) => SSM_PREFIX[backendEnv] + leaf);
  if (missing.length) fail(`Missing or empty SSM parameters: ${missing.join(', ')}`);
  const out = new Map();
  for (const [name, leaf] of PRIMARY) out.set(name, params[leaf]);
  for (const [name, leaf] of OPTIONAL) out.set(name, params[leaf] || null);
  return out;
}

/** Desired state of every variable this script manages in the given EAS environment. */
function desiredFor(target) {
  if (target === 'preview') {
    // Dev package: dev values only; reviewer routing is never set.
    return backendValues('dev');
  }
  // Production package: prod values, plus dev values for store-reviewer routing.
  const desired = backendValues('prod');
  for (const [name, value] of backendValues('dev')) desired.set(toReviewName(name), value);
  const reviewer = cleanValue('REVIEW_USERNAME', process.env.REVIEW_USERNAME);
  if (!reviewer) fail('REVIEW_USERNAME is required for the production EAS environment');
  desired.set(`${REVIEW_PREFIX}USERNAME`, reviewer);
  return desired;
}

// ---- eas-cli --------------------------------------------------------------------------------

const easCommand = (process.env.EAS_CLI || 'npx --yes eas-cli@latest').split(/\s+/).filter(Boolean);

function eas(args) {
  const [bin, ...pre] = easCommand;
  const res = spawnSync(bin, [...pre, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (res.error) fail(`Could not run eas-cli: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = `${res.stderr ?? ''}\n${res.stdout ?? ''}`.trim().split('\n').slice(-15).join('\n');
    fail(`eas ${args[0]} failed:\n${detail}`);
  }
  return res.stdout;
}

const LABEL_LINE = /^(ID|Name|Value|Scope|Visibility|Environments|type)\s{2,}(.*)$/;

/** Parse `eas env:list <env> --format long`. Fails loudly if the output format changes. */
function listVariables(target) {
  const out = eas(['env:list', target, '--format', 'long', '--include-sensitive', '--scope', 'project'])
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '');
  if (!out.includes(`Environment: ${target}`)) fail('Unexpected eas env:list output (no environment header)');
  if (out.includes('No variables found for this environment.')) return [];
  if (!out.includes('Variables for this project:')) fail('Unexpected eas env:list output (no variables header)');

  const vars = [];
  for (const block of out.split(/\n\s*———\s*\n/)) {
    const fields = {};
    for (const line of block.split('\n')) {
      const m = LABEL_LINE.exec(line);
      if (m && !(m[1] in fields)) fields[m[1]] = m[2].trim();
    }
    if (!fields.Name) continue;
    for (const key of ['ID', 'Scope', 'Visibility', 'Environments', 'type']) {
      if (!fields[key]) fail(`Unexpected eas env:list output: ${fields.Name} has no ${key}`);
    }
    vars.push({
      id: fields.ID,
      name: fields.Name,
      value: fields.Value ?? '',
      scope: fields.Scope,
      visibility: fields.Visibility,
      type: fields.type,
      environments: fields.Environments.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    });
  }
  if (!vars.length) fail('Unexpected eas env:list output (no variables parsed)');
  const project = vars.filter((v) => v.scope === 'PROJECT');
  const seen = new Set();
  for (const v of project) {
    if (seen.has(v.name)) fail(`Duplicate variable ${v.name} in ${target}; resolve it in the EAS dashboard`);
    seen.add(v.name);
  }
  return project;
}

// ---- sync-eas -------------------------------------------------------------------------------

function currentBranchRef() {
  if (process.env.GITHUB_ACTIONS === 'true') return process.env.GITHUB_REF ?? '';
  const res = spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : '';
}

function syncEas(target, dryRun) {
  if (!EAS_TARGETS[target]) fail('--environment must be preview or production');
  const required = `refs/heads/${EAS_TARGETS[target].branch}`;
  const ref = currentBranchRef();
  if (ref !== required) {
    if (!dryRun) fail(`EAS environment ${target} may only be written from ${required} (current: ${ref || 'detached'})`);
    console.log(`Dry run on ${ref || 'detached HEAD'}; writes to ${target} are only allowed from ${required}`);
  }

  const desired = desiredFor(target);
  const existing = new Map(listVariables(target).map((v) => [v.name, v]));

  // Dev package: drop every reviewer-routing variable, known or not.
  if (target === 'preview') {
    for (const name of existing.keys()) if (name.startsWith(REVIEW_PREFIX)) desired.set(name, null);
  }

  const plan = [];
  for (const [name, value] of desired) {
    const cur = existing.get(name);
    const shared = cur ? cur.environments.filter((e) => e !== target) : [];
    if (cur && cur.type !== 'string') fail(`${name} in ${target} is a ${cur.type} variable; expected a string`);
    if (value === null) {
      if (!cur) continue;
      plan.push({ name, action: shared.length ? 'unlink' : 'delete', shared });
    } else if (!cur) {
      plan.push({ name, action: 'create', value });
    } else if (shared.length) {
      plan.push({ name, action: 'split', value, shared });
    } else if (cur.value !== value || cur.visibility !== 'PUBLIC') {
      plan.push({ name, action: 'update', value });
    } else {
      plan.push({ name, action: 'unchanged' });
    }
  }

  const changes = plan.filter((p) => p.action !== 'unchanged');
  for (const p of plan) {
    const note = p.shared?.length ? ` (keeps its value in ${p.shared.join(', ')})` : '';
    console.log(`${dryRun ? '[dry-run] ' : ''}${p.action.padEnd(9)} ${p.name}${note}`);
  }

  if (!dryRun) {
    for (const p of changes) {
      if (p.action === 'unlink' || p.action === 'split') unlink(p.name, target, p.shared);
      if (p.action === 'delete') {
        eas(['env:delete', '--variable-name', p.name, '--variable-environment', target, '--scope', 'project', '--non-interactive']);
      }
      if (p.action === 'create' || p.action === 'update' || p.action === 'split') {
        eas([
          'env:set', '--environment', target, '--name', p.name, `--value=${p.value}`,
          '--type', 'string', '--visibility', 'plaintext', '--scope', 'project', '--non-interactive',
        ]);
      }
    }
    verify(target, desired);
  }

  const summary = `${changes.length} change(s), ${plan.length - changes.length} unchanged`;
  console.log(`${dryRun ? 'Dry run: ' : ''}EAS ${target}: ${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = plan.map((p) => `| \`${p.name}\` | ${p.action} |`).join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### EAS environment \`${target}\`\n\n${summary}\n\n| Variable | Action |\n|---|---|\n${rows}\n\n`);
  }
}

/** Remove `target` from a shared variable's environments; its value elsewhere is untouched. */
function unlink(name, target, others) {
  // env:update is deprecated but is the only non-interactive way to change a variable's environments.
  eas([
    'env:update', '--variable-name', name, '--variable-environment', target,
    ...others.flatMap((e) => ['--environment', e]), '--scope', 'project', '--non-interactive',
  ]);
  if (listVariables(target).some((v) => v.name === name)) {
    fail(`${name} is still linked to ${target} after unlinking; stopping before any value is written`);
  }
}

function verify(target, desired) {
  const after = new Map(listVariables(target).map((v) => [v.name, v]));
  const problems = [];
  for (const [name, value] of desired) {
    const cur = after.get(name);
    if (value === null) {
      if (cur) problems.push(`${name} should be absent`);
    } else if (!cur || cur.value !== value) {
      problems.push(`${name} does not have the expected value`);
    } else if (cur.environments.length !== 1) {
      problems.push(`${name} is linked to ${cur.environments.join(', ')}`);
    }
  }
  if (problems.length) fail(`EAS ${target} verification failed: ${problems.join('; ')}`);
}

// ---- web-env --------------------------------------------------------------------------------

function webEnv(target) {
  if (target !== 'dev' && target !== 'prod') fail('--env must be dev or prod');
  const lines = [];
  for (const [name, value] of backendValues(target)) if (value !== null) lines.push(`${name}=${value}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---- main -----------------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
if (opts.command === 'sync-eas') syncEas(opts.target, opts.dryRun);
else if (opts.command === 'web-env') webEnv(opts.target);
else fail('Usage: backend-config.mjs sync-eas --environment preview|production [--dry-run] | web-env --env dev|prod');
