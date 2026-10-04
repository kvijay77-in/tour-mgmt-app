#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFingerprint, createManifest, verifyManifest } from './web-export-check.mjs';
import {
  acquireDeploymentLock,
  assertActionsLeaseRunInactive,
  assertProductionWorkflowJob,
  createBuildEnvironment,
  createLockOwner,
  makeReleaseId,
  publishRelease,
  recoverStaleDeploymentLock,
  releaseDeploymentLock,
  verifyBackendReadiness,
} from './web-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const regionPattern = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/;
const placeholderPattern = /^(?:<.+>|CHANGE_ME|REPLACE_ME)$/i;
const appOutputFields = ['apiBaseUrl', 'userPoolId', 'userPoolWebClientId', 'identityPoolId'];

export function defaultStackNames(project, environment) {
  const stackPrefix = project === 'tour-mgmt-app' ? 'tour-mgmt' : project;
  return {
    hosting: `${stackPrefix}-web-${environment}`,
    publisher: `${stackPrefix}-web-publisher-${environment}`,
    bootstrap: `${stackPrefix}-web-deploy-${environment}`,
  };
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim() || placeholderPattern.test(value.trim())) {
    throw new Error(`${name} must be a populated string, not a placeholder`);
  }
  return value.trim();
}

export function validateConfig(config, expectedEnvironment) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configuration must be a JSON object');
  if (config.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const environment = requiredString(config.environment, 'environment');
  if (!['dev', 'prod'].includes(environment) || environment !== expectedEnvironment) {
    throw new Error(`environment must be ${expectedEnvironment}`);
  }
  const project = requiredString(config.project, 'project');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(project)) throw new Error('project must be a lowercase AWS-safe name');
  const expectedAccountId = requiredString(config.expectedAccountId, 'expectedAccountId');
  if (!/^\d{12}$/.test(expectedAccountId)) throw new Error('expectedAccountId must be a 12-digit account ID');
  const hostingRegion = requiredString(config.hostingRegion, 'hostingRegion');
  if (hostingRegion !== 'ap-south-1') throw new Error('hostingRegion must be ap-south-1');
  const backendRegion = requiredString(config.backendRegion, 'backendRegion');
  if (!regionPattern.test(backendRegion)) throw new Error('backendRegion must be an AWS region name');
  const backendProject = requiredString(config.backendProject, 'backendProject');
  const owner = requiredString(config.owner, 'owner');
  const githubOwner = requiredString(config.github?.owner, 'github.owner');
  const githubRepository = requiredString(config.github?.repository, 'github.repository');
  if (!/^[A-Za-z0-9_.-]+$/.test(githubOwner) || !/^[A-Za-z0-9_.-]+$/.test(githubRepository)) {
    throw new Error('github.owner and github.repository must be simple repository identifiers');
  }
  const localPrincipal = requiredString(config.localDeploymentPrincipalArn, 'localDeploymentPrincipalArn');
  if (!new RegExp(`^arn:[^:]+:iam::${expectedAccountId}:role/.+$`).test(localPrincipal)) {
    throw new Error('localDeploymentPrincipalArn must be an IAM role in expectedAccountId');
  }
  const csp = config.csp;
  if (!csp || !['REPORT_ONLY', 'ENFORCE'].includes(csp.mode) || typeof csp.contentSecurityPolicy !== 'string' ||
      !csp.contentSecurityPolicy.trim() || csp.contentSecurityPolicy.length > 1783) {
    throw new Error('csp must include REPORT_ONLY or ENFORCE and a reviewed policy up to 1783 characters');
  }
  const backendStackName = requiredString(config.backendStackName, 'backendStackName');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(backendStackName)) throw new Error('backendStackName is not a valid CloudFormation stack name');
  const outputKeys = config.backend?.outputKeys;
  if (!outputKeys || typeof outputKeys !== 'object' || Array.isArray(outputKeys)) {
    throw new Error('backend.outputKeys must map public values to confirmed CloudFormation output names');
  }
  requiredString(outputKeys.apiBaseUrl, 'backend.outputKeys.apiBaseUrl');
  for (const field of appOutputFields.slice(1)) {
    if (outputKeys[field] != null) requiredString(outputKeys[field], `backend.outputKeys.${field}`);
  }
  const overrides = config.backend?.publicOverrides ?? {};
  for (const field of ['userPoolId', 'userPoolWebClientId', 'identityPoolId']) {
    if (overrides[field] != null) requiredString(overrides[field], `backend.publicOverrides.${field}`);
  }
  const stackNames = { ...defaultStackNames(project, environment), ...(config.stackNames ?? {}) };
  const stackPrefix = stackNames.hosting.match(/^([a-z][a-z0-9-]*)-web-(dev|prod)$/)?.[1];
  if (!stackPrefix || !stackNames.hosting.endsWith(`-${environment}`) ||
      stackNames.publisher !== `${stackPrefix}-web-publisher-${environment}` ||
      stackNames.bootstrap !== `${stackPrefix}-web-deploy-${environment}`) {
    throw new Error('stackNames must preserve one stable <prefix>-web[-publisher|-deploy]-<environment> naming family');
  }
  for (const name of ['hosting', 'publisher', 'bootstrap']) {
    requiredString(stackNames[name], `stackNames.${name}`);
    if (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(stackNames[name])) throw new Error(`stackNames.${name} is not a valid CloudFormation stack name`);
  }
  const reviewers = config.github?.productionReviewers ?? [];
  if (!Array.isArray(reviewers) || reviewers.some((entry) => !['User', 'Team'].includes(entry?.type) || !Number.isInteger(entry.id) || entry.id < 1)) {
    throw new Error('github.productionReviewers must contain approved {type: User|Team, id: number} entries');
  }
  if (environment === 'prod' && reviewers.length === 0) throw new Error('Production setup requires explicitly approved GitHub reviewer IDs');
  const logLevel = requiredString(config.public?.logLevel, 'public.logLevel');
  if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) throw new Error('public.logLevel must be error, warn, info, or debug');
  const readiness = config.readiness ?? {};
  for (const field of ['apiUrl', 'artifactUrl']) {
    if (readiness[field] != null) {
      let url;
      try { url = new URL(requiredString(readiness[field], `readiness.${field}`)); } catch { throw new Error(`readiness.${field} must be a complete HTTPS URL`); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`readiness.${field} must be HTTPS without credentials, query parameters, or fragments`);
    }
  }
  return { ...config, environment, project, expectedAccountId, hostingRegion, backendRegion, backendProject, owner, github: { ...config.github, owner: githubOwner, repository: githubRepository, productionReviewers: reviewers }, localDeploymentPrincipalArn: localPrincipal, backendStackName, stackNames, readiness };
}

export function configFromEnvironment(environment, env = process.env) {
  const required = (name) => requiredString(env[name], name);
  let reviewers = [];
  if (env.WEB_PRODUCTION_REVIEWERS) {
    try { reviewers = JSON.parse(env.WEB_PRODUCTION_REVIEWERS); } catch { throw new Error('WEB_PRODUCTION_REVIEWERS must be a JSON array'); }
  }
  const outputKeys = { apiBaseUrl: required('AWS_BACKEND_API_OUTPUT_KEY') };
  for (const [field, variable] of [['userPoolId', 'AWS_BACKEND_USER_POOL_OUTPUT_KEY'], ['userPoolWebClientId', 'AWS_BACKEND_USER_POOL_CLIENT_OUTPUT_KEY'], ['identityPoolId', 'AWS_BACKEND_IDENTITY_POOL_OUTPUT_KEY']]) {
    if (env[variable]) outputKeys[field] = env[variable];
  }
  const config = {
    schemaVersion: 1,
    environment,
    expectedAccountId: required('AWS_EXPECTED_ACCOUNT_ID'),
    hostingRegion: required('AWS_REGION'),
    backendRegion: required('AWS_BACKEND_REGION'),
    backendProject: required('AWS_BACKEND_PROJECT'),
    backendStackName: required('AWS_BACKEND_STACK_NAME'),
    project: required('AWS_PROJECT'),
    owner: required('AWS_OWNER'),
    localDeploymentPrincipalArn: required('AWS_LOCAL_DEPLOYMENT_PRINCIPAL_ARN'),
    github: { owner: required('WEB_GITHUB_OWNER'), repository: required('WEB_GITHUB_REPOSITORY'), productionReviewers: reviewers },
    stackNames: {
      bootstrap: required('AWS_BOOTSTRAP_STACK_NAME'),
      hosting: required('AWS_HOSTING_STACK_NAME'),
      publisher: required('AWS_PUBLISHER_STACK_NAME'),
    },
    csp: { mode: required('WEB_CSP_MODE'), contentSecurityPolicy: required('WEB_CONTENT_SECURITY_POLICY') },
    public: { logLevel: required('EXPO_PUBLIC_LOG_LEVEL') },
    backend: { outputKeys, publicOverrides: {} },
    readiness: { apiUrl: env.WEB_READINESS_API_URL, artifactUrl: env.WEB_READINESS_ARTIFACT_URL },
  };
  return validateConfig(config, environment);
}

function releaseConfigFingerprint(config, publicValues) {
  const normalized = JSON.parse(JSON.stringify(config));
  normalized.backend.publicOverrides = {};
  return configFingerprint({ config: normalized, publicValues });
}

export function resolveBackendValues(outputs, config) {
  const keys = config.backend.outputKeys;
  const overrides = config.backend.publicOverrides ?? {};
  const values = {};
  for (const field of appOutputFields) {
    const key = keys[field];
    const outputValue = key ? outputs[key] : undefined;
    const value = field !== 'apiBaseUrl' && overrides[field] ? overrides[field] : outputValue;
    if (field === 'identityPoolId' && value == null) continue;
    if (typeof value !== 'string' || !value.trim() || placeholderPattern.test(value.trim())) {
      throw new Error(`Required backend value '${field}' is missing; confirm its output key or provide an approved Cognito override`);
    }
    values[field] = value.trim();
  }
  let apiUrl;
  try {
    apiUrl = new URL(values.apiBaseUrl);
  } catch {
    throw new Error('Backend apiBaseUrl must be a complete HTTPS URL output including its API stage path');
  }
  if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error('Backend apiBaseUrl must be HTTPS without credentials, query parameters, or fragments');
  }
  return values;
}

export function assertExpectedAccount(identity, expectedAccountId) {
  if (identity?.Account !== expectedAccountId) {
    throw new Error(`AWS account mismatch: expected ${expectedAccountId}, received ${identity?.Account ?? 'unknown'}; no writes were made`);
  }
}

export function assertStableStackStatus(stackName, status) {
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(status)) {
    throw new Error(`Stack '${stackName}' is ${status}; resolve it manually before deployment`);
  }
}

export async function withExpectedAccount(identity, expectedAccountId, operation) {
  assertExpectedAccount(identity, expectedAccountId);
  return operation();
}

export function productionEnvironmentSettings(prior, approvedReviewers) {
  const oldRules = prior?.protection_rules ?? [];
  if (oldRules.some((rule) => !['required_reviewers', 'wait_timer'].includes(rule.type))) {
    throw new Error('Existing GitHub Environment has an unsupported protection rule; preserve it through an approved manual review');
  }
  const reviewerRule = oldRules.find((rule) => rule.type === 'required_reviewers');
  return {
    wait_timer: prior?.wait_timer ?? 0,
    reviewers: normalizeReviewers(reviewerRule?.reviewers ?? [], approvedReviewers),
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };
}

export function planGithubVariableActions(currentVariables, desiredVariables, { allowCreate = false, replaceExisting = false } = {}) {
  const actions = [];
  for (const [name, value] of Object.entries(desiredVariables)) {
    if (value == null) continue;
    const previous = currentVariables.get(name);
    if (previous === value) continue;
    if (previous == null) {
      if (!allowCreate) throw new Error(`GitHub variable ${name} is missing; run web-setup with approved gh access`);
      actions.push({ operation: 'create', name, value });
    } else {
      if (!replaceExisting) throw new Error(`GitHub variable ${name} differs; review the change and rerun web-setup with --replace-github-vars`);
      actions.push({ operation: 'update', name, value });
    }
  }
  return actions;
}

export function assertGithubPublicConfigSafe(currentVariables, desiredVariables) {
  const forbidden = [...currentVariables.keys()].filter((name) =>
    name.startsWith('EXPO_PUBLIC_REVIEW_') ||
    ['EXPO_PUBLIC_SETUP_HMAC_KEY', 'EXPO_PUBLIC_API_DEBUG_GET'].includes(name));
  if (forbidden.length) throw new Error(`Remove prohibited web build variables through an approved GitHub settings change: ${forbidden.join(', ')}`);
  if (!desiredVariables.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID && currentVariables.has('EXPO_PUBLIC_AWS_IDENTITY_POOL_ID')) {
    throw new Error('An identity-pool variable exists but is not present in the approved config; resolve it explicitly before setup');
  }
  for (const name of ['WEB_READINESS_API_URL', 'WEB_READINESS_ARTIFACT_URL']) {
    if (!desiredVariables[name] && currentVariables.has(name)) {
      throw new Error(`${name} exists but is not present in the approved config; resolve it explicitly before setup`);
    }
  }
}

export function selectOidcProvider({ bootstrapOwner, bootstrapArn, publisherArn, providers }) {
  const githubProviders = providers.filter((provider) =>
    provider.Url?.replace(/^https:\/\//, '') === 'token.actions.githubusercontent.com');
  const verified = githubProviders.filter((provider) => provider.ClientIDList?.includes('sts.amazonaws.com'));
  if (githubProviders.length !== verified.length) throw new Error('GitHub OIDC provider is missing the sts.amazonaws.com audience');
  if (verified.length > 1) throw new Error('Multiple GitHub OIDC providers found; resolve account ownership before setup');
  if (bootstrapOwner) {
    if (!['BOOTSTRAP', 'EXTERNAL', 'PUBLISHER'].includes(bootstrapOwner) || !bootstrapArn) throw new Error('Existing bootstrap OIDC ownership is incomplete');
    if (bootstrapOwner === 'PUBLISHER' && publisherArn !== bootstrapArn) throw new Error('Publisher-owned OIDC provider identity changed; refusing ownership migration');
    if (bootstrapOwner !== 'PUBLISHER' && publisherArn) throw new Error('Conflicting publisher-owned OIDC provider; refusing ambiguous ownership');
    if (!verified.some((item) => item.Arn === bootstrapArn)) throw new Error('Bootstrap OIDC provider is no longer verifiable');
    return { owner: bootstrapOwner, arn: bootstrapArn };
  }
  if (publisherArn) {
    if (!verified.some((item) => item.Arn === publisherArn)) throw new Error('Publisher-owned OIDC provider URL/audience is invalid');
    return { owner: 'PUBLISHER', arn: publisherArn };
  }
  if (verified.length === 1) return { owner: 'EXTERNAL', arn: verified[0].Arn };
  return { owner: 'BOOTSTRAP', arn: '' };
}

export function assertSafeChangeSet(changeSet) {
  for (const change of changeSet.Changes ?? []) {
    const resource = change.ResourceChange ?? {};
    if (!['Add', 'Modify'].includes(resource.Action) ||
        (resource.Action === 'Modify' && resource.Replacement !== 'False') ||
        (resource.Action === 'Add' && resource.Replacement === true)) {
      throw new Error(`Refusing destructive or unknown change: ${resource.Action ?? 'unknown'} ${resource.LogicalResourceId ?? 'resource'} (${resource.Replacement ?? 'replacement unknown'})`);
    }
  }
}

export async function deployStack({ adapter, stackName, existed, executionRoleArn }) {
  const result = await adapter.createChangeSet();
  if (result.kind === 'unchanged') return { status: 'unchanged' };
  if (result.kind !== 'changeset' || !result.arn) throw new Error('SAM did not report a verifiable change set; refusing execution');
  const changeSet = await adapter.describeChangeSet(result.arn);
  try {
    assertSafeChangeSet(changeSet);
  } catch (error) {
    await adapter.deleteChangeSet?.(result.arn);
    throw error;
  }
  try {
    await adapter.executeChangeSet(result.arn);
    await adapter.waitForStack(stackName, existed ? 'update' : 'create');
    await adapter.enableTerminationProtection(stackName);
  } catch (error) {
    const events = await adapter.stackEvents?.(stackName).catch(() => null);
    if (events?.length) process.stderr.write(`Recent stack failures:\n${events.join('\n')}\n`);
    throw new Error(`Stack '${stackName}' did not complete; inspect the stack events before retrying (${error.message})`);
  }
  return { status: existed ? 'updated' : 'created', executionRoleArn };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { command, stage: 'all', replaceGithubVars: false, configEnvVars: false };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === '--replace-github-vars') options.replaceGithubVars = true;
    else if (item === '--config-env-vars') options.configEnvVars = true;
    else if (item === '--allow-prior-config') options.allowPriorConfig = true;
    else if (item.startsWith('--')) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${item} requires a value`);
      options[key] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${item}`);
  }
  if (!['setup', 'deploy', 'status', 'build', 'verify-artifact', 'lock-acquire', 'lock-release', 'publish', 'rollback', 'recover-lock'].includes(command)) {
    throw new Error('Command must be setup, deploy, status, build, verify-artifact, lock-acquire, lock-release, publish, rollback, or recover-lock');
  }
  if (!['all', 'infrastructure'].includes(options.stage)) throw new Error('--stage must be all or infrastructure');
  if (!options.config && !options.configEnvVars) throw new Error('--config must name a local JSON file or --config-env-vars must be selected');
  return options;
}

async function commandResult(command, args, { env = process.env, input, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function invoke(command, args, options = {}) {
  const result = await commandResult(command, args, options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.code !== 0) throw new Error(`${command} failed with exit code ${result.code}`);
  return result.stdout;
}

function awsArgs(args, region) {
  return [...args, '--region', region, '--output', 'json'];
}

async function awsJson(args, region, env) {
  const result = await commandResult('aws', awsArgs(args, region), { env });
  if (result.code !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`aws ${args[0]} ${args[1] ?? ''} failed with exit code ${result.code}`);
  }
  try { return JSON.parse(result.stdout); } catch { throw new Error(`aws ${args[0]} ${args[1] ?? ''} returned invalid JSON`); }
}

async function getStack(stackName, region, env, allowNonComplete = false) {
  const result = await commandResult('aws', awsArgs(['cloudformation', 'describe-stacks', '--stack-name', stackName], region), { env });
  if (result.code !== 0) {
    if (/does not exist|not exist/i.test(`${result.stdout}\n${result.stderr}`)) return null;
    process.stderr.write(result.stderr);
    throw new Error(`Could not inspect CloudFormation stack '${stackName}'`);
  }
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error(`Invalid stack response for '${stackName}'`); }
  const stack = data.Stacks?.[0];
  if (!stack) throw new Error(`Stack '${stackName}' returned no stack record`);
  if (!allowNonComplete) assertStableStackStatus(stackName, stack.StackStatus);
  return stack;
}

function outputMap(stack) {
  return Object.fromEntries((stack?.Outputs ?? []).map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
}

function parameterMap(stack) {
  return Object.fromEntries((stack?.Parameters ?? []).map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]));
}

function assertOwnedStack(stack, config) {
  const tags = Object.fromEntries((stack.Tags ?? []).map(({ Key, Value }) => [Key, Value]));
  if (tags.Project !== config.project || tags.Environment !== config.environment) {
    throw new Error(`Existing stack '${stack.StackName}' is not tagged for ${config.project}/${config.environment}; refusing adoption`);
  }
}

function cfnParameters(config, extra = {}) {
  return {
    Environment: config.environment,
    Owner: config.owner,
    Project: config.project,
    ...extra,
  };
}

function samDeployArgs({ config, templateFile, stackName, parameters, executionRoleArn }) {
  const args = [
    'deploy', '--template-file', templateFile, '--config-file', path.join(root, 'samconfig.toml'),
    '--config-env', config.environment, '--stack-name', stackName, '--region', config.hostingRegion,
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-confirm-changeset', '--no-fail-on-empty-changeset',
    '--no-execute-changeset', '--parameter-overrides',
    ...Object.entries(parameters).map(([key, value]) => `${key}=${value}`),
    '--tags', `Project=${config.project}`, `Environment=${config.environment}`, `Owner=${config.owner}`, 'ManagedBy=CloudFormation',
  ];
  if (executionRoleArn) args.push('--role-arn', executionRoleArn);
  return args;
}

function samChangeSetAdapter({ config, templateFile, stackName, parameters, executionRoleArn, env }) {
  return {
    async createChangeSet() {
      const result = await commandResult('sam', samDeployArgs({ config, templateFile, stackName, parameters, executionRoleArn }), { env });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.code !== 0) throw new Error(`SAM failed with exit code ${result.code}`);
      if (/no changes to deploy|no changeset created/i.test(`${result.stdout}\n${result.stderr}`)) return { kind: 'unchanged' };
      const match = `${result.stdout}\n${result.stderr}`.match(/arn:[^\s'"`]+:changeSet\/[^\s'"`]+/i);
      if (!match) throw new Error('SAM completed without a no-op result or a change-set ARN; refusing execution');
      return { kind: 'changeset', arn: match[0].replace(/[),.]$/, '') };
    },
    describeChangeSet(arn) { return awsJson(['cloudformation', 'describe-change-set', '--change-set-name', arn], config.hostingRegion, env); },
    executeChangeSet(arn) { return awsJson(['cloudformation', 'execute-change-set', '--change-set-name', arn], config.hostingRegion, env); },
    deleteChangeSet(arn) { return awsJson(['cloudformation', 'delete-change-set', '--change-set-name', arn], config.hostingRegion, env); },
    async stackEvents(name) {
      const response = await awsJson(['cloudformation', 'describe-stack-events', '--stack-name', name], config.hostingRegion, env);
      return (response.StackEvents ?? []).filter((event) => /_FAILED$/.test(event.ResourceStatus ?? '')).slice(0, 12).map((event) => `${event.LogicalResourceId}: ${event.ResourceStatusReason ?? event.ResourceStatus}`);
    },
    waitForStack(name, operation) { return invoke('aws', ['cloudformation', 'wait', `stack-${operation}-complete`, '--stack-name', name, '--region', config.hostingRegion], { env }); },
    enableTerminationProtection(name) { return invoke('aws', ['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', name, '--region', config.hostingRegion], { env }); },
  };
}

async function reconcileStack({ config, templateFile, stack, parameters, executionRoleArn, env }) {
  const result = await deployStack({
    adapter: samChangeSetAdapter({ config, templateFile, stackName: stack.StackName, parameters, executionRoleArn, env }),
    stackName: stack.StackName,
    existed: Boolean(stack),
    executionRoleArn,
  });
  if (result.status !== 'unchanged') {
    const waiter = result.status === 'created' ? 'stack-create-complete' : 'stack-update-complete';
    await invoke('aws', ['cloudformation', 'wait', waiter, '--stack-name', stack.StackName, '--region', config.hostingRegion], { env });
    await invoke('aws', ['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', stack.StackName, '--region', config.hostingRegion], { env });
  } else if (stack?.EnableTerminationProtection !== true) {
    await invoke('aws', ['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', stack.StackName, '--region', config.hostingRegion], { env });
  }
  return result;
}

async function checkedReconcileStack(options) {
  const { config, stack, stackName, ...rest } = options;
  const targetStackName = stack?.StackName ?? stackName;
  if (!targetStackName) throw new Error('A stable stack name is required');
  const result = await deployStack({
    adapter: samChangeSetAdapter({ config, stackName: targetStackName, ...rest }),
    stackName: targetStackName,
    existed: Boolean(stack),
    executionRoleArn: rest.executionRoleArn,
  });
  if (result.status === 'unchanged' && stack && !stack.EnableTerminationProtection) {
    await invoke('aws', ['cloudformation', 'update-termination-protection', '--enable-termination-protection', '--stack-name', targetStackName, '--region', config.hostingRegion], { env: rest.env });
  }
  return result;
}

async function describeResources(stackName, region, env) {
  const response = await awsJson(['cloudformation', 'list-stack-resources', '--stack-name', stackName], region, env);
  return new Map((response.StackResourceSummaries ?? []).map((resource) => [resource.LogicalResourceId, resource.PhysicalResourceId]));
}

async function inspectOwnedStack(stackName, region, config, env, allowNonComplete = false) {
  const stack = await getStack(stackName, region, env, allowNonComplete);
  if (stack) assertOwnedStack(stack, config);
  return stack;
}

async function resolvePublisherProvider(publisherStack, publisherResources, outputs) {
  if (!publisherStack) return { arn: '', owner: '' };
  const publisherArn = outputs.OidcProviderArn ?? '';
  if (publisherResources.has('GitHubActionsOidcProvider')) {
    const physicalArn = publisherResources.get('GitHubActionsOidcProvider');
    if (publisherArn !== physicalArn) throw new Error('Publisher stack OIDC output/resource disagree; refusing migration');
    return { arn: physicalArn, owner: 'PUBLISHER' };
  }
  const parameterArn = parameterMap(publisherStack).ExistingOidcProviderArn ?? '';
  if (publisherArn && publisherArn !== parameterArn) throw new Error('Publisher stack OIDC output/parameter disagree; refusing migration');
  return { arn: publisherArn || parameterArn, owner: publisherArn || parameterArn ? 'EXTERNAL' : '' };
}

async function listOidcProviders(env, region) {
  const list = await awsJson(['iam', 'list-open-id-connect-providers'], region, env);
  const providers = [];
  for (const entry of list.OpenIDConnectProviderList ?? []) {
    const arn = entry.Arn;
    const details = await awsJson(['iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', arn], region, env);
    providers.push({ Arn: arn, Url: details.Url, ClientIDList: details.ClientIDList ?? [] });
  }
  return providers;
}

async function verifyStackResources(stack, expected, region, env) {
  if (!stack) return;
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)) return new Map();
  const resources = await describeResources(stack.StackName, region, env);
  for (const logicalId of expected) {
    if (!resources.has(logicalId)) throw new Error(`Stack '${stack.StackName}' lacks expected logical resource ${logicalId}; refusing replacement or adoption`);
  }
  return resources;
}

function bucketNameFor(config) {
  return `${config.project}-web-${config.environment}-${config.expectedAccountId}`;
}

function bootstrapParameters(config, provider, bucketName) {
  return cfnParameters(config, {
    GitHubOwner: config.github.owner,
    GitHubRepository: config.github.repository,
    HostingStackName: config.stackNames.hosting,
    PublisherStackName: config.stackNames.publisher,
    BackendStackName: config.backendStackName,
    BackendRegion: config.backendRegion,
    WebBucketName: bucketName,
    LocalDeploymentPrincipalArn: config.localDeploymentPrincipalArn,
    ExistingOidcProviderArn: provider.owner === 'BOOTSTRAP' ? '' : provider.arn,
    OidcProviderOwner: provider.owner,
  });
}

async function getPublicBackendValues(config, env) {
  const backendStack = await getStack(config.backendStackName, config.backendRegion, env);
  if (!backendStack) throw new Error(`Required backend stack '${config.backendStackName}' was not found in ${config.backendRegion}`);
  assertOwnedStack(backendStack, { ...config, project: config.backendProject });
  return resolveBackendValues(outputMap(backendStack), config);
}

function buildGithubVariables(config, backendValues, bootstrapOutputs, hostingOutputs, publisherOutputs) {
  const variables = {
    AWS_EXPECTED_ACCOUNT_ID: config.expectedAccountId,
    AWS_REGION: config.hostingRegion,
    AWS_BACKEND_PROJECT: config.backendProject,
    AWS_INFRA_ROLE_ARN: bootstrapOutputs.InfrastructureRoleArn,
    AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: bootstrapOutputs.CloudFormationExecutionRoleArn,
    AWS_LOCAL_DEPLOYMENT_PRINCIPAL_ARN: config.localDeploymentPrincipalArn,
    AWS_BACKEND_STACK_NAME: config.backendStackName,
    AWS_BACKEND_REGION: config.backendRegion,
    AWS_BACKEND_API_OUTPUT_KEY: config.backend.outputKeys.apiBaseUrl,
    AWS_BOOTSTRAP_STACK_NAME: config.stackNames.bootstrap,
    AWS_HOSTING_STACK_NAME: config.stackNames.hosting,
    AWS_PUBLISHER_STACK_NAME: config.stackNames.publisher,
    AWS_PROJECT: config.project,
    AWS_OWNER: config.owner,
    WEB_GITHUB_OWNER: config.github.owner,
    WEB_GITHUB_REPOSITORY: config.github.repository,
    APP_VARIANT: config.environment === 'dev' ? 'test' : 'production',
    EXPO_PUBLIC_ENVIRONMENT: config.environment === 'dev' ? 'development' : 'production',
    EXPO_PUBLIC_AWS_REGION: config.backendRegion,
    EXPO_PUBLIC_AWS_USER_POOL_ID: backendValues.userPoolId,
    EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID: backendValues.userPoolWebClientId,
    EXPO_PUBLIC_TOUR_DATA_API_BASE_URL: backendValues.apiBaseUrl,
    EXPO_PUBLIC_USE_MOCK_DATA: 'false',
    EXPO_PUBLIC_QR_DEV_FORMAT: 'false',
    EXPO_PUBLIC_LOG_LEVEL: config.public.logLevel,
    WEB_CSP_MODE: config.csp.mode,
    WEB_CONTENT_SECURITY_POLICY: config.csp.contentSecurityPolicy,
    WEB_PRODUCTION_REVIEWERS: JSON.stringify(config.github.productionReviewers),
  };
  if (config.backend.outputKeys.userPoolId) variables.AWS_BACKEND_USER_POOL_OUTPUT_KEY = config.backend.outputKeys.userPoolId;
  if (config.backend.outputKeys.userPoolWebClientId) variables.AWS_BACKEND_USER_POOL_CLIENT_OUTPUT_KEY = config.backend.outputKeys.userPoolWebClientId;
  if (config.backend.outputKeys.identityPoolId) variables.AWS_BACKEND_IDENTITY_POOL_OUTPUT_KEY = config.backend.outputKeys.identityPoolId;
  if (config.readiness.apiUrl) variables.WEB_READINESS_API_URL = config.readiness.apiUrl;
  if (config.readiness.artifactUrl) variables.WEB_READINESS_ARTIFACT_URL = config.readiness.artifactUrl;
  if (backendValues.identityPoolId) variables.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID = backendValues.identityPoolId;
  if (hostingOutputs.BucketName) variables.AWS_S3_BUCKET = hostingOutputs.BucketName;
  if (hostingOutputs.DistributionId) variables.AWS_CLOUDFRONT_DISTRIBUTION_ID = hostingOutputs.DistributionId;
  if (hostingOutputs.SiteUrl) variables.AWS_SITE_URL = hostingOutputs.SiteUrl;
  if (publisherOutputs.PublisherRoleArn) variables.AWS_PUBLISHER_ROLE_ARN = publisherOutputs.PublisherRoleArn;
  return variables;
}

async function ghApi(config, endpoint, { method = 'GET', body } = {}) {
  const args = ['api', '--method', method, `repos/${config.github.owner}/${config.github.repository}/${endpoint}`];
  if (body !== undefined) args.push('--input', '-');
  const result = await commandResult('gh', args, { input: body === undefined ? undefined : JSON.stringify(body) });
  if (result.code !== 0) {
    if (/HTTP 404|Not Found/i.test(result.stderr) && method === 'GET') return null;
    process.stderr.write(result.stderr);
    throw new Error(`GitHub API ${method} ${endpoint} failed`);
  }
  if (!result.stdout.trim()) return {};
  try { return JSON.parse(result.stdout); } catch { throw new Error(`GitHub API returned invalid JSON for ${endpoint}`); }
}

function normalizeReviewers(existing, approved) {
  const map = new Map();
  for (const reviewer of [...existing, ...approved]) map.set(`${reviewer.type}:${reviewer.id}`, reviewer);
  const values = [...map.values()];
  if (values.length > 6) throw new Error('GitHub supports at most six required reviewers; resolve the approved reviewer set');
  return values;
}

async function configureGithub(config, variables, replaceExisting, { explicitSetup = false, initializeIfMissing = false } = {}) {
  const repository = await ghApi(config, '', {});
  if (repository.full_name?.toLowerCase() !== `${config.github.owner}/${config.github.repository}`.toLowerCase()) {
    throw new Error('Authenticated GitHub repository does not match the approved owner/repository');
  }
  if (config.environment === 'prod' && repository.default_branch !== 'main') throw new Error('Production repository default branch must be main');
  const environmentName = config.environment === 'dev' ? 'web-dev' : 'web-prod';
  const prior = await ghApi(config, `environments/${environmentName}`);
  if (!prior && !initializeIfMissing && !explicitSetup) throw new Error(`GitHub Environment ${environmentName} is missing; run web-setup with approved gh access`);
  const existingReviewers = prior?.protection_rules?.find((rule) => rule.type === 'required_reviewers')?.reviewers ?? [];
  const reviewers = config.environment === 'prod'
    ? normalizeReviewers(existingReviewers, config.github.productionReviewers)
    : existingReviewers;
  const body = config.environment === 'prod'
    ? productionEnvironmentSettings(prior, config.github.productionReviewers)
    : { wait_timer: prior?.wait_timer ?? 0, reviewers, ...(prior?.deployment_branch_policy ? { deployment_branch_policy: prior.deployment_branch_policy } : {}) };
  if (explicitSetup || !prior) await ghApi(config, `environments/${environmentName}`, { method: 'PUT', body });
  if (config.environment === 'prod' && (explicitSetup || !prior)) {
    const policyPath = `environments/${environmentName}/deployment-branch-policies`;
    const policies = await ghApi(config, policyPath);
    const existingPolicies = policies?.branch_policies ?? [];
    if (!existingPolicies.some((entry) => entry.name === 'main')) {
      await ghApi(config, policyPath, { method: 'POST', body: { name: 'main' } });
    }
    for (const policy of existingPolicies) {
      if (policy.name !== 'main') await ghApi(config, `${policyPath}/${policy.id}`, { method: 'DELETE' });
    }
    const verified = await ghApi(config, `environments/${environmentName}`);
    const verifiedReviewers = verified?.protection_rules?.find((rule) => rule.type === 'required_reviewers')?.reviewers ?? [];
    const reviewerIds = new Set(verifiedReviewers.map((reviewer) => `${reviewer.type}:${reviewer.id}`));
    if (!reviewers.every((reviewer) => reviewerIds.has(`${reviewer.type}:${reviewer.id}`))) throw new Error('GitHub did not retain all approved Production reviewers; refusing setup');
    if (verified?.deployment_branch_policy?.protected_branches !== false || verified?.deployment_branch_policy?.custom_branch_policies !== true) {
      throw new Error('GitHub did not retain the Production main-only deployment policy; refusing setup');
    }
    const finalPolicies = (await ghApi(config, policyPath))?.branch_policies ?? [];
    if (finalPolicies.length !== 1 || finalPolicies[0].name !== 'main') throw new Error('GitHub Production branch allowlist is not exactly main');
  } else if (config.environment === 'prod') {
    const reviewerIds = new Set((existingReviewers ?? []).map((reviewer) => `${reviewer.type}:${reviewer.id}`));
    if (!config.github.productionReviewers.every((reviewer) => reviewerIds.has(`${reviewer.type}:${reviewer.id}`)) ||
        prior?.deployment_branch_policy?.protected_branches !== false || prior?.deployment_branch_policy?.custom_branch_policies !== true) {
      throw new Error('Production GitHub protections are missing or changed; run web-setup for an approved repair');
    }
    const policies = (await ghApi(config, `environments/${environmentName}/deployment-branch-policies`))?.branch_policies ?? [];
    if (policies.length !== 1 || policies[0].name !== 'main') throw new Error('Production GitHub branch allowlist is not exactly main');
  }
  const varEndpoint = `environments/${environmentName}/variables`;
  const current = (await ghApi(config, varEndpoint))?.variables ?? [];
  const currentValues = new Map(current.map(({ name, value }) => [name, value]));
  assertGithubPublicConfigSafe(currentValues, variables);
  if (config.environment === 'prod' && currentValues.has('WEB_PRODUCTION_ENABLED')) {
    throw new Error('WEB_PRODUCTION_ENABLED must be repository-scoped; remove the conflicting Production Environment variable through an approved settings change');
  }
  const variableActions = planGithubVariableActions(currentValues, variables, {
    allowCreate: explicitSetup || initializeIfMissing,
    replaceExisting,
  });
  for (const action of variableActions) {
    if (action.operation === 'create') await ghApi(config, varEndpoint, { method: 'POST', body: { name: action.name, value: action.value } });
    else await ghApi(config, `${varEndpoint}/${encodeURIComponent(action.name)}`, { method: 'PATCH', body: { name: action.name, value: action.value } });
  }
  if (config.environment === 'prod' && explicitSetup) {
    const readinessEndpoint = 'actions/variables/WEB_PRODUCTION_ENABLED';
    const readiness = await ghApi(config, readinessEndpoint);
    if (!readiness) await ghApi(config, 'actions/variables', { method: 'POST', body: { name: 'WEB_PRODUCTION_ENABLED', value: 'false' } });
  }
}

function roleNameFromArn(arn) {
  const match = arn?.match(/:assumed-role\/([^/]+)\//);
  return match?.[1];
}

async function assumeInfrastructureRole(config, bootstrapOutputs, identity, env) {
  const targetArn = bootstrapOutputs.InfrastructureRoleArn;
  if (!targetArn) throw new Error('Bootstrap stack has no InfrastructureRoleArn output');
  const currentRoleName = roleNameFromArn(identity.Arn);
  const infraRoleName = roleNameFromArn(targetArn);
  if (currentRoleName === infraRoleName) return env;
  const approvedRoleName = config.localDeploymentPrincipalArn.split('/').at(-1);
  if (currentRoleName !== approvedRoleName) throw new Error('AWS_PROFILE is not the approved local deployment principal for this environment');
  const response = await awsJson(['sts', 'assume-role', '--role-arn', targetArn, '--role-session-name', `web-${config.environment}-${Date.now()}`, '--duration-seconds', '3600'], config.hostingRegion, env);
  const credentials = response.Credentials;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) throw new Error('STS returned no complete short-lived role credentials');
  const assumed = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey, AWS_SESSION_TOKEN: credentials.SessionToken };
  delete assumed.AWS_PROFILE;
  return assumed;
}

async function assumePublisherRole(config, publisherRoleArn, identity, env) {
  if (!publisherRoleArn) throw new Error('PublisherRoleArn is required from the approved publisher stack output');
  const activeRoleName = roleNameFromArn(identity.Arn);
  const publisherRoleName = roleNameFromArn(publisherRoleArn) ?? publisherRoleArn.split('/').at(-1);
  if (activeRoleName === publisherRoleName) return env;
  const approvedLocalName = config.localDeploymentPrincipalArn.split('/').at(-1);
  if (config.environment !== 'dev' || activeRoleName !== approvedLocalName) {
    throw new Error('Only the matching publisher role or approved local Dev deployment principal may assume the publisher role');
  }
  const response = await awsJson(['sts', 'assume-role', '--role-arn', publisherRoleArn, '--role-session-name', `web-publish-${Date.now()}`, '--duration-seconds', '3600'], config.hostingRegion, env);
  const credentials = response.Credentials;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) throw new Error('STS returned no complete short-lived publisher credentials');
  const assumed = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey, AWS_SESSION_TOKEN: credentials.SessionToken };
  delete assumed.AWS_PROFILE;
  return assumed;
}

function deploymentLockAdapter(region, env) {
  return {
    async putLock(bucket, body) {
      const file = path.join(os.tmpdir(), `web-lock-${process.pid}-${Date.now()}.json`);
      try {
        await writeFile(file, body, { flag: 'wx' });
        await awsJson(['s3api', 'put-object', '--bucket', bucket, '--key', '.web-deploy-lock', '--body', file, '--content-type', 'application/json', '--if-none-match', '*'], region, env);
      } finally { await rm(file, { force: true }); }
    },
    async getLock(bucket) {
      const file = path.join(os.tmpdir(), `web-lock-${process.pid}-${Date.now()}.json`);
      try {
        const result = await commandResult('aws', awsArgs(['s3api', 'get-object', '--bucket', bucket, '--key', '.web-deploy-lock', file], region), { env });
        if (result.code !== 0) {
          if (/NoSuchKey|Not Found|does not exist/i.test(`${result.stdout}\n${result.stderr}`)) return null;
          process.stderr.write(result.stderr);
          throw new Error('Could not read the deployment lock object');
        }
        let metadata;
        try { metadata = JSON.parse(result.stdout); } catch { throw new Error('S3 returned invalid lock metadata'); }
        if (!metadata.ETag) throw new Error('S3 returned no lock ETag; refusing an unsafe cleanup path');
        return { body: await readFile(file, 'utf8'), etag: metadata.ETag };
      } finally { await rm(file, { force: true }); }
    },
    async deleteLock(bucket, etag) {
      if (!etag) throw new Error('Conditional lock deletion requires the observed S3 ETag');
      await awsJson(['s3api', 'delete-object', '--bucket', bucket, '--key', '.web-deploy-lock', '--if-match', etag], region, env);
    },
  };
}

function awsPublicationAdapter(bucket, region, env) {
  return {
    async putObject({ key, filePath, contentType, cacheControl }) {
      await invoke('aws', ['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', filePath, '--content-type', contentType, '--cache-control', cacheControl, '--region', region], { env });
    },
    async createInvalidation(distributionId, pathPattern) {
      const response = await awsJson(['cloudfront', 'create-invalidation', '--distribution-id', distributionId, '--paths', pathPattern], region, env);
      if (!response.Invalidation?.Id) throw new Error('CloudFront returned no invalidation ID');
      return response.Invalidation.Id;
    },
    waitForInvalidation(distributionId, invalidationId) {
      return invoke('aws', ['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', distributionId, '--id', invalidationId, '--region', region], { env });
    },
  };
}

async function publishArtifact({ config, artifactDir, siteUrl, bucketName, distributionId, publisherRoleArn, lockOwner, baseEnv, identity, publicValues, releaseLock = true, allowPriorConfig = false }) {
  if (!artifactDir || !siteUrl || !bucketName || !distributionId || !lockOwner) {
    throw new Error('Artifact directory, hosting outputs, publisher role, and lock owner are required for publication');
  }
  if (config.environment === 'prod' && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main')) {
    throw new Error('Production publication is restricted to the approved main GitHub Actions workflow');
  }
  assertProductionWorkflowJob(config.environment, process.env, allowPriorConfig
    ? [{ workflow: 'Roll back web release', job: 'rollback' }]
    : [{ workflow: 'Deploy web', job: 'publish' }]);
  const publisherEnv = await assumePublisherRole(config, publisherRoleArn, identity, baseEnv);
  const locks = deploymentLockAdapter(config.hostingRegion, publisherEnv);
  const lockBody = await locks.getLock(bucketName);
  if (!lockBody) throw new Error('No deployment lock is held; refusing publication');
  let lease;
  try { lease = JSON.parse(lockBody.body); } catch { throw new Error('Deployment lock is malformed; refusing publication'); }
  if (lease.owner !== lockOwner) throw new Error(`Deployment lock belongs to '${lease.owner ?? 'unknown'}', not '${lockOwner}'`);
  try {
    const releasePath = path.resolve(artifactDir);
    const manifest = JSON.parse(await readFile(path.join(releasePath, 'manifest.json'), 'utf8'));
    const fingerprint = releaseConfigFingerprint(config, publicValues);
    await verifyManifest({ outputDir: path.join(releasePath, 'site'), manifest, environment: config.environment, configFingerprint: fingerprint, allowPriorConfig });
    if (!config.readiness.apiUrl || !config.readiness.artifactUrl) {
      throw new Error('Full publication is blocked until owner-confirmed API and artifact-bucket readiness URLs are configured');
    }
    const readiness = await verifyBackendReadiness({ siteUrl, apiUrl: config.readiness.apiUrl, artifactUrl: config.readiness.artifactUrl });
    process.stdout.write(`Backend browser preflight passed for ${readiness.origin}.\n`);
    const result = await publishRelease({
      adapter: awsPublicationAdapter(bucketName, config.hostingRegion, publisherEnv),
      artifactDir: path.join(releasePath, 'site'),
      manifest,
      siteUrl,
      bucketName,
      bucketRegion: config.hostingRegion,
      distributionId,
      environment: config.environment,
      configFingerprint: fingerprint,
      cspMode: config.csp.mode,
      contentSecurityPolicy: config.csp.contentSecurityPolicy,
    });
    process.stdout.write(`Published and verified ${result.releaseId} (${result.files} files); invalidation ${result.invalidation}.\n`);
    return result;
  } finally {
    if (releaseLock) await releaseDeploymentLock(locks, { bucket: bucketName, owner: lockOwner });
  }
}

async function loadConfiguration(file, environment, fromEnvironment = false) {
  if (fromEnvironment) return configFromEnvironment(environment, process.env);
  const filePath = path.resolve(process.cwd(), file);
  let parsed;
  try { parsed = JSON.parse(await readFile(filePath, 'utf8')); } catch (error) { throw new Error(`Cannot read valid JSON config ${filePath}: ${error.message}`); }
  return validateConfig(parsed, environment ?? parsed.environment);
}

export function publicBackendValuesFromEnvironment(config, env = process.env) {
  const expectedVariant = config.environment === 'dev' ? 'test' : 'production';
  const expectedEnvironment = config.environment === 'dev' ? 'development' : 'production';
  if (env.APP_VARIANT !== expectedVariant || env.EXPO_PUBLIC_ENVIRONMENT !== expectedEnvironment) {
    throw new Error(`GitHub public environment values do not match the ${config.environment} app variant`);
  }
  if (env.EXPO_PUBLIC_AWS_REGION !== config.backendRegion) throw new Error('EXPO_PUBLIC_AWS_REGION does not match the approved backend region');
  if (env.EXPO_PUBLIC_USE_MOCK_DATA !== 'false' || env.EXPO_PUBLIC_QR_DEV_FORMAT !== 'false') {
    throw new Error('Mock-data and QR development flags must both be explicitly false for release builds');
  }
  const values = {
    apiBaseUrl: requiredString(env.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL, 'EXPO_PUBLIC_TOUR_DATA_API_BASE_URL'),
    userPoolId: requiredString(env.EXPO_PUBLIC_AWS_USER_POOL_ID, 'EXPO_PUBLIC_AWS_USER_POOL_ID'),
    userPoolWebClientId: requiredString(env.EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID, 'EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID'),
  };
  if (env.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID) values.identityPoolId = env.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID;
  const outputKeys = { ...config.backend.outputKeys };
  const outputs = { [outputKeys.apiBaseUrl]: values.apiBaseUrl };
  for (const field of ['userPoolId', 'userPoolWebClientId', 'identityPoolId']) {
    if (values[field]) {
      outputKeys[field] ??= `environment-${field}`;
      outputs[outputKeys[field]] = values[field];
    }
  }
  return resolveBackendValues(outputs, { ...config, backend: { ...config.backend, publicOverrides: {}, outputKeys } });
}

async function resolveSourceSha(sourceRef, env, sourceRepo = root) {
  if (!sourceRef || sourceRef.startsWith('-')) throw new Error('SOURCE_REF must be an explicit Git branch, tag, or commit SHA');
  let result = await commandResult('git', ['rev-parse', '--verify', `${sourceRef}^{commit}`], { env, cwd: sourceRepo });
  if (result.code !== 0) {
    await invoke('git', ['fetch', '--no-tags', 'origin', sourceRef], { env, cwd: sourceRepo });
    result = await commandResult('git', ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { env, cwd: sourceRepo });
  }
  if (result.code !== 0) throw new Error(`Could not resolve SOURCE_REF '${sourceRef}' to a commit SHA`);
  const sha = result.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('Resolved source commit SHA has an unexpected format');
  return sha;
}

async function buildRelease({ config, backendValues, sourceRef, sourceRepo = root, releaseId }) {
  const sourceSha = await resolveSourceSha(sourceRef, process.env, sourceRepo);
  const safeReleaseId = releaseId ?? makeReleaseId({ environment: config.environment, sourceSha });
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(safeReleaseId)) throw new Error('releaseId contains unsupported characters');
  const trustedSha = (await invoke('git', ['rev-parse', 'HEAD'], { env: process.env })).trim();
  const worktreeParent = await mkdtemp(path.join(os.tmpdir(), 'tour-web-build-'));
  const sourceDir = path.join(worktreeParent, 'source');
  const outputDir = path.join(worktreeParent, 'export');
  const home = path.join(worktreeParent, 'home');
  const releaseDir = path.join(root, '.web-releases', config.environment, safeReleaseId);
  const buildEnv = createBuildEnvironment({ config, backendValues, home, environment: process.env });
  await mkdir(home);
  try {
    await invoke('git', ['worktree', 'add', '--detach', sourceDir, sourceSha], { env: process.env, cwd: sourceRepo });
    await invoke('npm', ['ci', '--no-audit', '--no-fund'], { cwd: sourceDir, env: buildEnv });
    await invoke('npm', ['run', 'lint'], { cwd: sourceDir, env: buildEnv });
    await invoke('npm', ['run', 'typecheck'], { cwd: sourceDir, env: buildEnv });
    await invoke('npm', ['test', '--', '--runInBand'], { cwd: sourceDir, env: buildEnv });
    const expoConfig = await commandResult('npm', ['exec', '--', 'expo', 'config', '--type', 'public', '--json'], { cwd: sourceDir, env: buildEnv });
    if (expoConfig.code !== 0) throw new Error(`Expo config validation failed: ${expoConfig.stderr}`);
    let appConfig;
    try { appConfig = JSON.parse(expoConfig.stdout); } catch { throw new Error('Expo public config did not return valid JSON'); }
    const expectedVariant = config.environment === 'dev' ? 'test' : 'production';
    if (appConfig.extra?.appVariant !== expectedVariant) throw new Error(`Expo export selected ${appConfig.extra?.appVariant ?? 'unknown'} variant; expected ${expectedVariant}`);
    await invoke('npm', ['exec', '--', 'expo', 'export', '--platform', 'web', '--output-dir', outputDir], { cwd: sourceDir, env: buildEnv });
    const indexPath = path.join(outputDir, 'index.html');
    let html = await readFile(indexPath, 'utf8');
    html = html.replace(/<head([^>]*)>/i, `<head$1><!-- web-release:${safeReleaseId} -->`);
    await writeFile(indexPath, html);
    const toolchain = JSON.parse(await readFile(path.join(root, 'tools/web-deployment-toolchain.json'), 'utf8'));
    const fingerprint = releaseConfigFingerprint(config, backendValues);
    const helperSha = trustedSha;
    const manifest = await createManifest({
      outputDir,
      environment: config.environment,
      sourceSha,
      helperSha,
      workflowSha: process.env.GITHUB_SHA ?? trustedSha,
      configFingerprint: fingerprint,
      toolchain: { node: process.versions.node, sam: toolchain.samCliVersion, awsCliMajor: toolchain.awsCliMajorVersion },
      releaseId: safeReleaseId,
    });
    await mkdir(path.dirname(releaseDir), { recursive: true });
    await mkdir(releaseDir);
    await mkdir(path.join(releaseDir, 'site'));
    await cpDirectory(outputDir, path.join(releaseDir, 'site'));
    await writeFile(path.join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await pruneLocalReleases(config.environment);
    process.stdout.write(`Validated ${config.environment} release ${safeReleaseId} from ${sourceSha}\nArtifact: ${releaseDir}\n`);
    return { releaseDir, manifest, sourceSha, releaseId: safeReleaseId };
  } finally {
    await commandResult('git', ['worktree', 'remove', '--force', sourceDir], { env: process.env, cwd: sourceRepo }).catch(() => {});
    await rm(worktreeParent, { recursive: true, force: true });
  }
}

async function cpDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await cpDirectory(from, to);
    else if (entry.isFile()) await writeFile(to, await readFile(from), { flag: 'wx' });
    else throw new Error(`Unsupported exported filesystem entry: ${from}`);
  }
}

async function pruneLocalReleases(environment, keepCount = 5, maxAgeDays = 30) {
  const releaseRoot = path.join(root, '.web-releases', environment);
  let entries;
  try { entries = await readdir(releaseRoot, { withFileTypes: true }); } catch { return; }
  const releases = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const releasePath = path.join(releaseRoot, entry.name);
    try {
      const manifest = JSON.parse(await readFile(path.join(releasePath, 'manifest.json'), 'utf8'));
      if (manifest.environment !== environment || manifest.releaseId !== entry.name) continue;
      const info = await stat(path.join(releasePath, 'manifest.json'));
      releases.push({ path: releasePath, modifiedAt: info.mtimeMs });
    } catch { }
  }
  releases.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const expiresBefore = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const [index, release] of releases.entries()) {
    if (index >= keepCount || release.modifiedAt < expiresBefore) await rm(release.path, { recursive: true, force: true });
  }
}

async function validateToolchain(env) {
  const toolchainPath = path.join(root, 'tools/web-deployment-toolchain.json');
  const toolchain = JSON.parse(await readFile(toolchainPath, 'utf8'));
  if (process.versions.node !== toolchain.nodeVersion) {
    throw new Error(`Node ${toolchain.nodeVersion} is pinned for web deployment; found ${process.versions.node}`);
  }
  const sam = await commandResult('sam', ['--version'], { env });
  const samVersion = `${sam.stdout}\n${sam.stderr}`.match(/SAM CLI, version (\S+)/)?.[1];
  if (sam.code !== 0 || samVersion !== toolchain.samCliVersion) {
    throw new Error(`SAM CLI ${toolchain.samCliVersion} is pinned for web deployment; found ${samVersion ?? 'unavailable'}`);
  }
  const aws = await commandResult('aws', ['--version'], { env });
  const awsVersion = `${aws.stdout}\n${aws.stderr}`.match(/aws-cli\/(\d+)\./)?.[1];
  if (aws.code !== 0 || Number(awsVersion) !== toolchain.awsCliMajorVersion) {
    throw new Error(`AWS CLI major version ${toolchain.awsCliMajorVersion} is required; found ${awsVersion ?? 'unavailable'}`);
  }
  for (const template of ['infra/github-deploy.yaml', 'infra/web.yaml', 'infra/github-oidc.yaml']) {
    await invoke('sam', ['validate', '--lint', '--template-file', path.join(root, template)], { env });
  }
}

async function validateAwsCli(env) {
  const aws = await commandResult('aws', ['--version'], { env });
  const major = `${aws.stdout}\n${aws.stderr}`.match(/aws-cli\/(\d+)\./)?.[1];
  if (aws.code !== 0 || Number(major) !== 2) throw new Error(`AWS CLI major version 2 is required; found ${major ?? 'unavailable'}`);
}

function requireAwsProfile() {
  const temporaryCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_SESSION_TOKEN;
  if (!process.env.AWS_PROFILE && !temporaryCredentials) throw new Error('Set AWS_PROFILE to an approved SSO profile or provide short-lived role credentials; implicit default credentials are refused');
}

async function currentIdentity(config, env) {
  const identity = await awsJson(['sts', 'get-caller-identity'], config.hostingRegion, env);
  assertExpectedAccount(identity, config.expectedAccountId);
  return identity;
}

async function inspectStacks(config, env, allowNonComplete = false) {
  const [hosting, publisher, bootstrap] = await Promise.all([
    inspectOwnedStack(config.stackNames.hosting, config.hostingRegion, config, env, allowNonComplete),
    inspectOwnedStack(config.stackNames.publisher, config.hostingRegion, config, env, allowNonComplete),
    inspectOwnedStack(config.stackNames.bootstrap, config.hostingRegion, config, env, allowNonComplete),
  ]);
  const hostingResources = await verifyStackResources(hosting, ['WebBucket', 'WebDistribution', 'WebOriginAccessControl', 'WebCachePolicy', 'WebResponseHeadersPolicy', 'WebBucketPolicy'], config.hostingRegion, env);
  const publisherResources = await verifyStackResources(publisher, ['WebPublisherRole'], config.hostingRegion, env);
  await verifyStackResources(bootstrap, ['PublisherPermissionsBoundary', 'CloudFormationExecutionRole', 'WebInfrastructureRole'], config.hostingRegion, env);
  return { hosting, publisher, bootstrap, hostingResources, publisherResources };
}

async function resolveProvider(config, stacks, env) {
  const publisherOutput = outputMap(stacks.publisher);
  const publisherProvider = await resolvePublisherProvider(stacks.publisher, stacks.publisherResources ?? new Map(), publisherOutput);
  const bootstrapOutputs = outputMap(stacks.bootstrap);
  const bootstrapParameters = parameterMap(stacks.bootstrap);
  const accountProviders = await listOidcProviders(env, config.hostingRegion);
  const selected = selectOidcProvider({
    bootstrapOwner: bootstrapParameters.OidcProviderOwner,
    bootstrapArn: bootstrapOutputs.OidcProviderArn,
    publisherArn: publisherProvider.owner === 'PUBLISHER' ? publisherProvider.arn : '',
    providers: accountProviders,
  });
  return selected;
}

function validateBootstrapInputs(stack, config, bucketName, provider) {
  if (!stack) return;
  const params = parameterMap(stack);
  const expected = {
    Project: config.project,
    Owner: config.owner,
    GitHubOwner: config.github.owner,
    GitHubRepository: config.github.repository,
    HostingStackName: config.stackNames.hosting,
    PublisherStackName: config.stackNames.publisher,
    BackendStackName: config.backendStackName,
    BackendRegion: config.backendRegion,
    WebBucketName: bucketName,
    LocalDeploymentPrincipalArn: config.localDeploymentPrincipalArn,
    OidcProviderOwner: provider.owner,
    ExistingOidcProviderArn: provider.owner === 'BOOTSTRAP' ? '' : provider.arn,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (params[key] !== value) throw new Error(`Bootstrap setting ${key} differs; run the explicit setup command before deployment`);
  }
}

async function prepareBootstrap(config, stacks, env, backendValues, mode) {
  const publisherResources = stacks.publisherResources ?? new Map();
  const publisherProvider = await resolvePublisherProvider(stacks.publisher, publisherResources, outputMap(stacks.publisher));
  const bucketName = outputMap(stacks.hosting).BucketName ?? bucketNameFor(config);
  const provider = await resolveProvider(config, stacks, env);
  if (mode !== 'setup') validateBootstrapInputs(stacks.bootstrap, config, bucketName, provider);
  const outputs = outputMap(stacks.bootstrap);
  if (!stacks.bootstrap || mode === 'setup') {
    await checkedReconcileStack({
      config,
      stack: stacks.bootstrap,
      stackName: config.stackNames.bootstrap,
      templateFile: path.join(root, 'infra/github-deploy.yaml'),
      parameters: bootstrapParameters(config, provider, bucketName),
      executionRoleArn: undefined,
      env,
    });
  }
  const updated = await getStack(config.stackNames.bootstrap, config.hostingRegion, env);
  const updatedOutputs = outputMap(updated);
  for (const name of ['InfrastructureRoleArn', 'CloudFormationExecutionRoleArn', 'PublisherPermissionsBoundaryArn', 'OidcProviderArn', 'OidcProviderOwner']) {
    if (!updatedOutputs[name]) throw new Error(`Bootstrap stack is missing required output '${name}'`);
  }
  return { bucketName, provider, publisherProvider, outputs: updatedOutputs, backendValues };
}

async function runHostingAndPublisher(config, stacks, prepared, adminIdentity, baseEnv) {
  const infraEnv = await assumeInfrastructureRole(config, prepared.outputs, adminIdentity, baseEnv);
  const hostingParams = cfnParameters(config, {
    ContentSecurityPolicy: config.csp.contentSecurityPolicy,
    CspMode: config.csp.mode,
  });
  if (!stacks.hosting) hostingParams.WebBucketName = prepared.bucketName;
  await checkedReconcileStack({
    config,
    stack: stacks.hosting,
    stackName: config.stackNames.hosting,
    templateFile: path.join(root, 'infra/web.yaml'),
    parameters: hostingParams,
    executionRoleArn: prepared.outputs.CloudFormationExecutionRoleArn,
    env: infraEnv,
  });
  const hostingStack = await getStack(config.stackNames.hosting, config.hostingRegion, infraEnv);
  assertOwnedStack(hostingStack, config);
  const hostingOutputs = outputMap(hostingStack);
  for (const name of ['BucketName', 'BucketArn', 'DistributionId', 'CloudFrontDomainName', 'SiteUrl']) {
    if (!hostingOutputs[name]) throw new Error(`Hosting stack is missing required output '${name}'`);
  }
  await invoke('aws', ['cloudfront', 'wait', 'distribution-deployed', '--id', hostingOutputs.DistributionId, '--region', config.hostingRegion], { env: infraEnv });
  const publisherExisting = await getStack(config.stackNames.publisher, config.hostingRegion, infraEnv);
  const publisherParameters = cfnParameters(config, {
    GitHubOwner: config.github.owner,
    GitHubRepository: config.github.repository,
    BucketName: hostingOutputs.BucketName,
    DistributionId: hostingOutputs.DistributionId,
    ExistingOidcProviderArn: prepared.publisherProvider.owner === 'PUBLISHER' ? '' : prepared.outputs.OidcProviderArn,
    PublisherPermissionsBoundaryArn: prepared.outputs.PublisherPermissionsBoundaryArn,
    LocalDeploymentPrincipalArn: config.localDeploymentPrincipalArn,
  });
  await checkedReconcileStack({
    config,
    stack: publisherExisting,
    stackName: config.stackNames.publisher,
    templateFile: path.join(root, 'infra/github-oidc.yaml'),
    parameters: publisherParameters,
    executionRoleArn: prepared.outputs.CloudFormationExecutionRoleArn,
    env: infraEnv,
  });
  const publisherStack = await getStack(config.stackNames.publisher, config.hostingRegion, infraEnv);
  assertOwnedStack(publisherStack, config);
  const publisherOutputs = outputMap(publisherStack);
  if (!publisherOutputs.PublisherRoleArn || !publisherOutputs.OidcProviderArn) throw new Error('Publisher stack is missing its required identity outputs');
  return { hostingOutputs, publisherOutputs, infraEnv };
}

async function run(options) {
  const config = await loadConfiguration(options.config, options.env, options.configEnvVars);
  const toolchain = JSON.parse(await readFile(path.join(root, 'tools/web-deployment-toolchain.json'), 'utf8'));

  if (options.command === 'build') {
    if (process.versions.node !== toolchain.nodeVersion) throw new Error(`Node ${toolchain.nodeVersion} is pinned for web deployment; found ${process.versions.node}`);
    assertProductionWorkflowJob(config.environment, process.env, [{ workflow: 'Deploy web', job: 'build' }]);
    let backendValues;
    if (options.configEnvVars) backendValues = publicBackendValuesFromEnvironment(config);
    else {
      requireAwsProfile();
      const identity = await currentIdentity(config, process.env);
      backendValues = await withExpectedAccount(identity, config.expectedAccountId, () => getPublicBackendValues(config, process.env));
    }
    await buildRelease({ config, backendValues, sourceRef: options.sourceRef ?? process.env.GITHUB_SHA ?? 'HEAD', sourceRepo: options.sourceRepo ? path.resolve(options.sourceRepo) : root, releaseId: options.releaseId });
    return;
  }

  if (options.command === 'verify-artifact') {
    assertProductionWorkflowJob(config.environment, process.env, [{ workflow: 'Roll back web release', job: 'verify-artifact' }]);
    if (!options.artifactDir) throw new Error('verify-artifact requires --artifact-dir');
    const publicValues = publicBackendValuesFromEnvironment(config);
    const releasePath = path.resolve(options.artifactDir);
    const manifest = JSON.parse(await readFile(path.join(releasePath, 'manifest.json'), 'utf8'));
    const fingerprint = releaseConfigFingerprint(config, publicValues);
    await verifyManifest({ outputDir: path.join(releasePath, 'site'), manifest, environment: config.environment, configFingerprint: fingerprint, expectedWorkflowSha: options.workflowSha, allowPriorConfig: options.allowPriorConfig });
    process.stdout.write(`${JSON.stringify({ environment: manifest.environment, releaseId: manifest.releaseId, sourceSha: manifest.sourceSha, workflowSha: manifest.workflowSha })}\n`);
    return;
  }

  if (options.command === 'status') {
    requireAwsProfile();
    const identity = await currentIdentity(config, process.env);
    const stacks = await inspectStacks(config, process.env, true);
    const response = { accountId: identity.Account, environment: config.environment, region: config.hostingRegion, stacks: {} };
    for (const key of ['bootstrap', 'hosting', 'publisher']) response.stacks[key] = stacks[key] ? { name: stacks[key].StackName, status: stacks[key].StackStatus, terminationProtection: stacks[key].EnableTerminationProtection, outputs: outputMap(stacks[key]) } : { name: config.stackNames[key], status: 'NOT_FOUND' };
    const hostingOutputs = outputMap(stacks.hosting);
    const publisherRoleArn = outputMap(stacks.publisher).PublisherRoleArn;
    if (config.environment === 'dev' && hostingOutputs.BucketName && publisherRoleArn) {
      try {
        const publisherEnv = await assumePublisherRole(config, publisherRoleArn, identity, process.env);
        const lease = await deploymentLockAdapter(config.hostingRegion, publisherEnv).getLock(hostingOutputs.BucketName);
        if (lease) {
          const details = JSON.parse(lease.body);
          response.deploymentLock = { status: 'HELD', owner: details.owner, acquiredAt: details.acquiredAt };
        } else response.deploymentLock = { status: 'FREE' };
      } catch (error) {
        response.deploymentLock = { status: 'UNAVAILABLE', reason: error.message };
      }
    } else response.deploymentLock = { status: 'NOT_CHECKED' };
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  if (options.command === 'setup' || options.command === 'deploy') await validateToolchain(process.env);
  else await validateAwsCli(process.env);
  requireAwsProfile();
  const baseEnv = { ...process.env };
  const identity = await currentIdentity(config, baseEnv);

  if (options.command === 'lock-acquire' || options.command === 'lock-release' || options.command === 'recover-lock') {
    const allowedJobs = options.command === 'recover-lock'
      ? [{ workflow: 'Recover stale web deployment lock', job: 'recover' }]
      : options.command === 'lock-acquire'
        ? [{ workflow: 'Deploy web', job: 'acquire-lock' }, { workflow: 'Roll back web release', job: 'acquire-lock' }]
        : [{ workflow: 'Deploy web', job: 'release-lock' }, { workflow: 'Roll back web release', job: 'release-lock' }];
    assertProductionWorkflowJob(config.environment, process.env, allowedJobs);
    let bucketName = options.bucketName ?? process.env.AWS_S3_BUCKET;
    let publisherRoleArn = options.publisherRoleArn ?? process.env.AWS_PUBLISHER_ROLE_ARN;
    if (options.command === 'recover-lock' && (!bucketName || !publisherRoleArn)) {
      const stacks = await inspectStacks(config, baseEnv);
      bucketName ??= outputMap(stacks.hosting).BucketName;
      publisherRoleArn ??= outputMap(stacks.publisher).PublisherRoleArn;
    }
    if (!bucketName || !publisherRoleArn) throw new Error('The approved bucket name and publisher role ARN are required for the deployment lock');
    const publisherEnv = await assumePublisherRole(config, publisherRoleArn, identity, baseEnv);
    const locks = deploymentLockAdapter(config.hostingRegion, publisherEnv);
    if (options.command === 'lock-acquire') {
      const sourceSha = options.sourceSha ?? process.env.GITHUB_SHA;
      const owner = options.lockOwner ?? createLockOwner();
      await acquireDeploymentLock(locks, { bucket: bucketName, owner, sourceSha });
      process.stdout.write(`${JSON.stringify({ owner, bucket: bucketName })}\n`);
    } else if (options.command === 'lock-release') {
      if (!options.lockOwner) throw new Error('lock-release requires the exact lock owner');
      const current = await locks.getLock(bucketName);
      if (!current) process.stdout.write('Deployment lock is already released.\n');
      else {
        await releaseDeploymentLock(locks, { bucket: bucketName, owner: options.lockOwner });
        process.stdout.write(`Released deployment lock owned by ${options.lockOwner}.\n`);
      }
    } else {
      const current = await locks.getLock(bucketName);
      if (!current) throw new Error('No deployment lock exists');
      let currentLease;
      try { currentLease = JSON.parse(current.body); } catch { throw new Error('Deployment lock is malformed; inspect it manually before recovery'); }
      if (currentLease.owner?.startsWith('actions:')) {
        const runId = currentLease.owner.split(':')[1];
        const run = await ghApi(config, `actions/runs/${runId}`);
        assertActionsLeaseRunInactive(currentLease.owner, run);
      } else if (currentLease.owner?.startsWith(`local:${os.hostname()}:`)) {
        const processId = Number(currentLease.owner.split(':')[2]);
        if (Number.isInteger(processId) && processId > 0) {
          try {
            process.kill(processId, 0);
            throw new Error(`Local deployment process ${processId} is still active; refusing recovery`);
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
        }
      }
      const result = await recoverStaleDeploymentLock(locks, { bucket: bucketName, expectedOwner: options.expectedOwner, reason: options.reason });
      process.stdout.write(`Recovered stale deployment lock owned by ${result.recoveredOwner}; audit reason: ${result.reason}\n`);
    }
    return;
  }

  if (options.command === 'publish' || options.command === 'rollback') {
    const suppliedOutputs = options.bucketName && options.siteUrl && options.distributionId && options.publisherRoleArn;
    const stacks = suppliedOutputs ? {} : await inspectStacks(config, baseEnv);
    const hostingOutputs = outputMap(stacks.hosting);
    const publisherOutputs = outputMap(stacks.publisher);
    const bucketName = options.bucketName ?? process.env.AWS_S3_BUCKET ?? hostingOutputs.BucketName;
    const siteUrl = options.siteUrl ?? process.env.AWS_SITE_URL ?? hostingOutputs.SiteUrl;
    const distributionId = options.distributionId ?? process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID ?? hostingOutputs.DistributionId;
    const publisherRoleArn = options.publisherRoleArn ?? process.env.AWS_PUBLISHER_ROLE_ARN ?? publisherOutputs.PublisherRoleArn;
    const backendValues = options.configEnvVars ? publicBackendValuesFromEnvironment(config) : await getPublicBackendValues(config, baseEnv);
    let artifactDir = options.artifactDir;
    if (!artifactDir && options.command === 'rollback' && options.releaseId) artifactDir = path.join(root, '.web-releases', config.environment, options.releaseId);
    if (!artifactDir) throw new Error(`${options.command} requires --artifact-dir${options.command === 'rollback' ? ' or --release-id' : ''}`);
    let lockOwner = options.lockOwner;
    if (options.command === 'rollback') {
      assertProductionWorkflowJob(config.environment, process.env, [{ workflow: 'Roll back web release', job: 'rollback' }]);
      const publisherEnv = await assumePublisherRole(config, publisherRoleArn, identity, baseEnv);
      lockOwner ??= createLockOwner();
      await acquireDeploymentLock(deploymentLockAdapter(config.hostingRegion, publisherEnv), { bucket: bucketName, owner: lockOwner, sourceSha: process.env.GITHUB_SHA ?? 'rollback' });
    }
    if (!lockOwner) throw new Error('Publication requires the deployment lock owner returned by lock-acquire');
    await publishArtifact({ config, artifactDir, siteUrl, bucketName, distributionId, publisherRoleArn, lockOwner, baseEnv, identity, publicValues: backendValues, allowPriorConfig: options.command === 'rollback' || options.allowPriorConfig });
    return;
  }

  if (options.command !== 'setup' && options.command !== 'deploy') throw new Error(`Unsupported command '${options.command}'`);
  if (options.command === 'deploy' && config.environment === 'prod' && options.stage === 'all') {
    throw new Error('Production publication uses separate approved build, infrastructure, lock, and publisher jobs; full local CLI deployment is disabled');
  }
  if (options.command === 'deploy' && config.environment === 'prod' && options.stage === 'infrastructure') {
    assertProductionWorkflowJob(config.environment, process.env, [
      { workflow: 'Deploy web', job: 'infrastructure' },
      { workflow: 'Deploy web', job: 'production-infrastructure' },
    ]);
  }
  const stacks = await inspectStacks(config, baseEnv);
  const backendValues = await getPublicBackendValues(config, baseEnv);

  if (options.command === 'setup') {
    const prepared = await withExpectedAccount(identity, config.expectedAccountId,
      () => prepareBootstrap(config, stacks, baseEnv, backendValues, 'setup'));
    const variables = buildGithubVariables(config, backendValues, prepared.outputs, outputMap(stacks.hosting), outputMap(stacks.publisher));
    await withExpectedAccount(identity, config.expectedAccountId,
      () => configureGithub(config, variables, options.replaceGithubVars, { explicitSetup: true }));
    process.stdout.write(`Setup complete for ${config.environment}; environment variables and required protection settings were verified.\n`);
    return;
  }

  if (options.stage === 'infrastructure') {
    const prepared = await withExpectedAccount(identity, config.expectedAccountId,
      () => prepareBootstrap(config, stacks, baseEnv, backendValues, 'deploy'));
    const currentBucketName = outputMap(stacks.hosting).BucketName;
    const owner = currentBucketName ? createLockOwner() : null;
    const infraEnv = currentBucketName ? await assumeInfrastructureRole(config, prepared.outputs, identity, baseEnv) : null;
    const locks = currentBucketName ? deploymentLockAdapter(config.hostingRegion, infraEnv) : null;
    if (currentBucketName) await acquireDeploymentLock(locks, { bucket: currentBucketName, owner, sourceSha: process.env.GITHUB_SHA ?? 'infrastructure' });
    try {
      const deployed = await withExpectedAccount(identity, config.expectedAccountId,
        () => runHostingAndPublisher(config, stacks, prepared, identity, baseEnv));
      if (config.environment === 'dev') {
        const ghStatus = await commandResult('gh', ['auth', 'status']).catch(() => ({ code: 1 }));
        if (ghStatus.code === 0) {
          const variables = buildGithubVariables(config, backendValues, prepared.outputs, deployed.hostingOutputs, deployed.publisherOutputs);
          await withExpectedAccount(identity, config.expectedAccountId,
            () => configureGithub(config, variables, false, { initializeIfMissing: true }));
        } else {
          process.stdout.write('Dev GitHub Environment outputs were not updated because gh is unavailable; run web-setup once with approved gh access.\n');
        }
      }
      const outputs = { environment: config.environment, bucketName: deployed.hostingOutputs.BucketName, distributionId: deployed.hostingOutputs.DistributionId, siteUrl: deployed.hostingOutputs.SiteUrl, publisherRoleArn: deployed.publisherOutputs.PublisherRoleArn };
      if (options.outputsFile) {
        await mkdir(path.dirname(path.resolve(options.outputsFile)), { recursive: true });
        await writeFile(path.resolve(options.outputsFile), `${JSON.stringify(outputs, null, 2)}\n`);
      }
      process.stdout.write(`Infrastructure reconciliation complete for ${config.environment}. Backend readiness: PENDING (infrastructure-only); SiteUrl=${outputs.siteUrl}\n`);
      process.stdout.write(`${JSON.stringify(outputs)}\n`);
    } finally {
      if (currentBucketName) await releaseDeploymentLock(locks, { bucket: currentBucketName, owner });
    }
    return;
  }

  if (!stacks.bootstrap || !stacks.hosting || !stacks.publisher) {
    throw new Error('A full release requires existing bootstrap, hosting, and publisher stacks. Run deploy --stage infrastructure first; first-time hosting has no bucket lease to coordinate it.');
  }
  const build = await buildRelease({ config, backendValues, sourceRef: options.sourceRef ?? 'HEAD', releaseId: options.releaseId });
  const publisherRoleArn = outputMap(stacks.publisher).PublisherRoleArn;
  const hostingOutputs = outputMap(stacks.hosting);
  const owner = createLockOwner();
  const publisherEnv = await assumePublisherRole(config, publisherRoleArn, identity, baseEnv);
  const locks = deploymentLockAdapter(config.hostingRegion, publisherEnv);
  await acquireDeploymentLock(locks, { bucket: hostingOutputs.BucketName, owner, sourceSha: build.sourceSha });
  try {
    const prepared = await withExpectedAccount(identity, config.expectedAccountId,
      () => prepareBootstrap(config, stacks, baseEnv, backendValues, 'deploy'));
    const deployed = await withExpectedAccount(identity, config.expectedAccountId,
      () => runHostingAndPublisher(config, stacks, prepared, identity, baseEnv));
    await publishArtifact({
      config,
      artifactDir: build.releaseDir,
      siteUrl: deployed.hostingOutputs.SiteUrl,
      bucketName: deployed.hostingOutputs.BucketName,
      distributionId: deployed.hostingOutputs.DistributionId,
      publisherRoleArn: deployed.publisherOutputs.PublisherRoleArn,
      lockOwner: owner,
      baseEnv,
      identity,
      publicValues: backendValues,
      releaseLock: false,
    });
  } finally {
    await releaseDeploymentLock(locks, { bucket: hostingOutputs.BucketName, owner });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    await run(options);
  } catch (error) {
    process.stderr.write(`web-deploy: ${error.message}\n`);
    process.exitCode = 1;
  }
}