import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertExpectedAccount,
  assertStableStackStatus,
  assertGithubPublicConfigSafe,
  configFromEnvironment,
  defaultStackNames,
  deployStack,
  planGithubVariableActions,
  productionEnvironmentSettings,
  publicBackendValuesFromEnvironment,
  resolveBackendValues,
  selectOidcProvider,
  validateConfig,
  withExpectedAccount,
} from './web-deploy.mjs';

const baseConfig = {
  schemaVersion: 1,
  environment: 'dev',
  expectedAccountId: '123456789012',
  hostingRegion: 'ap-south-1',
  backendRegion: 'ap-south-1',
  backendProject: 'tour-data-api',
  backendStackName: 'tour-data-api-dev',
  project: 'tour-mgmt-app',
  owner: 'management-team',
  localDeploymentPrincipalArn: 'arn:aws:iam::123456789012:role/web-deployment-owner',
  github: { owner: 'example-org', repository: 'tour-mgmt-app', productionReviewers: [{ type: 'User', id: 42 }] },
  csp: { mode: 'REPORT_ONLY', contentSecurityPolicy: "default-src 'self'; object-src 'none'" },
  public: { logLevel: 'info' },
  backend: {
    outputKeys: { apiBaseUrl: 'ConfirmedApiBaseUrl', userPoolId: 'ConfirmedPoolId', userPoolWebClientId: 'ConfirmedClientId' },
    publicOverrides: {},
  },
};

function config(environment = 'dev') {
  return validateConfig({ ...baseConfig, environment }, environment);
}

function mockedAdapter({ result = { kind: 'unchanged' }, changes = [] } = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      async createChangeSet() { calls.push('create'); return result; },
      async describeChangeSet() { calls.push('describe'); return { Changes: changes }; },
      async deleteChangeSet() { calls.push('delete'); },
      async executeChangeSet() { calls.push('execute'); },
      async waitForStack(_name, operation) { calls.push(`wait:${operation}`); },
      async enableTerminationProtection() { calls.push('protect'); },
    },
  };
}

test('stable stack defaults are isolated by environment', () => {
  assert.deepEqual(defaultStackNames('tour-mgmt-app', 'dev'), {
    hosting: 'tour-mgmt-web-dev',
    publisher: 'tour-mgmt-web-publisher-dev',
    bootstrap: 'tour-mgmt-web-deploy-dev',
  });
  assert.notEqual(defaultStackNames('tour-mgmt-app', 'dev').hosting, defaultStackNames('tour-mgmt-app', 'prod').hosting);
});

test('config rejects wrong environment, invalid accounts, and unconfirmed backend keys', () => {
  assert.throws(() => validateConfig(baseConfig, 'prod'), /environment must be prod/);
  assert.throws(() => validateConfig({ ...baseConfig, expectedAccountId: '123' }, 'dev'), /12-digit account ID/);
  assert.throws(() => validateConfig({ ...baseConfig, backend: { outputKeys: { apiBaseUrl: '<confirm>' } } }, 'dev'), /placeholder/);
});

test('GitHub Environment reconstructs approved config and rejects mismatched release flags', () => {
  const values = {
    AWS_EXPECTED_ACCOUNT_ID: '123456789012',
    AWS_REGION: 'ap-south-1',
    AWS_BACKEND_PROJECT: 'tour-data-api',
    AWS_BACKEND_STACK_NAME: 'tour-data-api-dev',
    AWS_BACKEND_REGION: 'ap-south-1',
    AWS_BACKEND_API_OUTPUT_KEY: 'ConfirmedApiBaseUrl',
    AWS_BOOTSTRAP_STACK_NAME: 'tour-mgmt-web-deploy-dev',
    AWS_HOSTING_STACK_NAME: 'tour-mgmt-web-dev',
    AWS_PUBLISHER_STACK_NAME: 'tour-mgmt-web-publisher-dev',
    AWS_PROJECT: 'tour-mgmt-app',
    AWS_OWNER: 'management-team',
    AWS_LOCAL_DEPLOYMENT_PRINCIPAL_ARN: 'arn:aws:iam::123456789012:role/web-deployment-owner',
    WEB_GITHUB_OWNER: 'example-org',
    WEB_GITHUB_REPOSITORY: 'tour-mgmt-app',
    WEB_CSP_MODE: 'REPORT_ONLY',
    WEB_CONTENT_SECURITY_POLICY: "default-src 'self'",
    WEB_PRODUCTION_REVIEWERS: '[]',
    EXPO_PUBLIC_LOG_LEVEL: 'info',
    APP_VARIANT: 'test',
    EXPO_PUBLIC_ENVIRONMENT: 'development',
    EXPO_PUBLIC_AWS_REGION: 'ap-south-1',
    EXPO_PUBLIC_AWS_USER_POOL_ID: 'ap-south-1_pool',
    EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID: 'client',
    EXPO_PUBLIC_TOUR_DATA_API_BASE_URL: 'https://api.example.test/prod',
    EXPO_PUBLIC_USE_MOCK_DATA: 'false',
    EXPO_PUBLIC_QR_DEV_FORMAT: 'false',
  };
  const environmentConfig = configFromEnvironment('dev', values);
  assert.equal(environmentConfig.stackNames.publisher, baseConfig.stackNames?.publisher ?? 'tour-mgmt-web-publisher-dev');
  assert.equal(publicBackendValuesFromEnvironment(environmentConfig, values).apiBaseUrl, values.EXPO_PUBLIC_TOUR_DATA_API_BASE_URL);
  assert.throws(() => publicBackendValuesFromEnvironment(environmentConfig, { ...values, APP_VARIANT: 'production' }), /variant/);
  assert.throws(() => publicBackendValuesFromEnvironment(environmentConfig, { ...values, EXPO_PUBLIC_USE_MOCK_DATA: 'true' }), /explicitly false/);
});

test('backend values use explicit outputs and preserve the stage-bearing URL', () => {
  const selected = resolveBackendValues({
    ConfirmedApiBaseUrl: 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod',
    ConfirmedPoolId: 'ap-south-1_example',
    ConfirmedClientId: 'public-client-id',
  }, config());
  assert.equal(selected.apiBaseUrl, 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod');
  assert.throws(() => resolveBackendValues({
    ConfirmedApiBaseUrl: 'http://api.example.test/prod',
    ConfirmedPoolId: 'ap-south-1_example',
    ConfirmedClientId: 'public-client-id',
  }, config()), /HTTPS/);
});

test('approved external Cognito values override absent CloudFormation outputs', () => {
  const selected = resolveBackendValues({
    ConfirmedApiBaseUrl: 'https://api.example.test/prod',
  }, validateConfig({ ...baseConfig, backend: {
    outputKeys: { apiBaseUrl: 'ConfirmedApiBaseUrl' },
    publicOverrides: { userPoolId: 'ap-south-1_external', userPoolWebClientId: 'external-client' },
  } }, 'dev'));
  assert.equal(selected.userPoolId, 'ap-south-1_external');
  assert.equal(selected.userPoolWebClientId, 'external-client');
  assert.equal('identityPoolId' in selected, false);
});

test('wrong account is rejected before a guarded write callback', async () => {
  let writes = 0;
  await assert.rejects(withExpectedAccount({ Account: '999999999999' }, '123456789012', async () => { writes += 1; }), /no writes were made/);
  assert.equal(writes, 0);
  assert.throws(() => assertExpectedAccount({ Account: '999999999999' }, '123456789012'), /mismatch/);
});

test('in-progress and rollback-complete stacks require manual recovery', () => {
  assertStableStackStatus('tour-mgmt-web-dev', 'UPDATE_COMPLETE');
  assert.throws(() => assertStableStackStatus('tour-mgmt-web-dev', 'UPDATE_IN_PROGRESS'), /resolve it manually/);
  assert.throws(() => assertStableStackStatus('tour-mgmt-web-dev', 'UPDATE_ROLLBACK_COMPLETE'), /resolve it manually/);
});

test('empty SAM changeset is successful and retains existing resources', async () => {
  const mock = mockedAdapter();
  const result = await deployStack({ adapter: mock.adapter, stackName: 'tour-mgmt-app-web-dev', existed: true });
  assert.deepEqual(result, { status: 'unchanged' });
  assert.deepEqual(mock.calls, ['create']);
});

test('valid update changeset executes, waits, and protects the existing stack', async () => {
  const mock = mockedAdapter({ result: { kind: 'changeset', arn: 'arn:aws:cloudformation:ap-south-1:123456789012:changeSet/samcli/id' }, changes: [
    { ResourceChange: { Action: 'Modify', LogicalResourceId: 'WebDistribution', Replacement: 'False' } },
  ] });
  const result = await deployStack({ adapter: mock.adapter, stackName: 'tour-mgmt-app-web-dev', existed: true });
  assert.equal(result.status, 'updated');
  assert.deepEqual(mock.calls, ['create', 'describe', 'execute', 'wait:update', 'protect']);
});

test('delete and replacement changes are rejected before execution', async () => {
  for (const resource of [
    { Action: 'Remove', LogicalResourceId: 'WebBucket' },
    { Action: 'Modify', LogicalResourceId: 'WebBucket', Replacement: 'True' },
    { Action: 'Modify', LogicalResourceId: 'WebBucket', Replacement: 'Conditional' },
  ]) {
    const mock = mockedAdapter({ result: { kind: 'changeset', arn: 'arn:aws:cloudformation:ap-south-1:123456789012:changeSet/samcli/id' }, changes: [{ ResourceChange: resource }] });
    await assert.rejects(deployStack({ adapter: mock.adapter, stackName: 'tour-mgmt-app-web-dev', existed: true }), /Refusing destructive/);
    assert.deepEqual(mock.calls, ['create', 'describe', 'delete']);
  }
});

test('OIDC ownership is stable and ambiguous or changed providers fail closed', () => {
  const provider = { Arn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com', Url: 'token.actions.githubusercontent.com', ClientIDList: ['sts.amazonaws.com'] };
  const unrelated = { Arn: 'arn:aws:iam::123456789012:oidc-provider/oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE', Url: 'oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE', ClientIDList: ['sts.amazonaws.com'] };
  assert.deepEqual(selectOidcProvider({ providers: [provider] }), { owner: 'EXTERNAL', arn: provider.Arn });
  assert.deepEqual(selectOidcProvider({ providers: [unrelated] }), { owner: 'BOOTSTRAP', arn: '' });
  assert.deepEqual(selectOidcProvider({ bootstrapOwner: 'PUBLISHER', bootstrapArn: provider.Arn, publisherArn: provider.Arn, providers: [provider] }), { owner: 'PUBLISHER', arn: provider.Arn });
  assert.throws(() => selectOidcProvider({ providers: [provider, { ...provider, Arn: `${provider.Arn}-duplicate` }] }), /Multiple GitHub OIDC/);
  assert.throws(() => selectOidcProvider({ providers: [{ ...provider, ClientIDList: ['wrong-audience'] }] }), /missing the sts.amazonaws.com audience/);
  assert.throws(() => selectOidcProvider({ bootstrapOwner: 'PUBLISHER', bootstrapArn: provider.Arn, publisherArn: `${provider.Arn}-changed`, providers: [provider] }), /identity changed/);
});

test('Production environment setup preserves reviewers and timer while enforcing main-only', () => {
  const prior = {
    wait_timer: 5,
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'Team', id: 8 }] }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  };
  const settings = productionEnvironmentSettings(prior, [{ type: 'User', id: 42 }]);
  assert.equal(settings.wait_timer, 5);
  assert.deepEqual(settings.reviewers, [{ type: 'Team', id: 8 }, { type: 'User', id: 42 }]);
  assert.deepEqual(settings.deployment_branch_policy, { protected_branches: false, custom_branch_policies: true });
  assert.deepEqual(productionEnvironmentSettings(prior, [{ type: 'User', id: 42 }]), settings);
});

test('GitHub variable plans are idempotent and never overwrite silently', () => {
  const desired = { AWS_REGION: 'ap-south-1', APP_VARIANT: 'test' };
  assert.deepEqual(planGithubVariableActions(new Map(Object.entries(desired)), desired), []);
  assert.deepEqual(planGithubVariableActions(new Map(), desired, { allowCreate: true }).map(({ operation }) => operation), ['create', 'create']);
  assert.throws(() => planGithubVariableActions(new Map([['AWS_REGION', 'us-east-1']]), desired), /differs/);
  assert.deepEqual(planGithubVariableActions(new Map([['AWS_REGION', 'us-east-1']]), { AWS_REGION: 'ap-south-1' }, { replaceExisting: true }), [
    { operation: 'update', name: 'AWS_REGION', value: 'ap-south-1' },
  ]);
});

test('GitHub setup refuses reviewer, HMAC, debug, and unapproved identity-pool values', () => {
  assert.throws(() => assertGithubPublicConfigSafe(new Map([['EXPO_PUBLIC_REVIEW_ENABLED', 'true']]), {}), /prohibited/);
  assert.throws(() => assertGithubPublicConfigSafe(new Map([['EXPO_PUBLIC_SETUP_HMAC_KEY', 'old-value']]), {}), /prohibited/);
  assert.throws(() => assertGithubPublicConfigSafe(new Map([['EXPO_PUBLIC_API_DEBUG_GET', 'true']]), {}), /prohibited/);
  assert.throws(() => assertGithubPublicConfigSafe(new Map([['EXPO_PUBLIC_AWS_IDENTITY_POOL_ID', 'stale-id']]), {}), /identity-pool/);
  assert.throws(() => assertGithubPublicConfigSafe(new Map([['WEB_READINESS_API_URL', 'https://old.example.test']]), {}), /not present in the approved config/);
});