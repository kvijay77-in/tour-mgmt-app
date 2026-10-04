import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishRelease } from './web-release.mjs';
import {
  acquireDeploymentLock,
  assertActionsLeaseRunInactive,
  assertProductionWorkflowJob,
  assertReadinessResponse,
  createBuildEnvironment,
  publicationOrder,
  recoverStaleDeploymentLock,
  releaseDeploymentLock,
  verifyBackendReadiness,
} from './web-release.mjs';

const config = { environment: 'dev', backendRegion: 'ap-south-1', public: { logLevel: 'info' } };
const backendValues = { apiBaseUrl: 'https://api.example.test/prod', userPoolId: 'pool', userPoolWebClientId: 'client' };

test('build environment contains only explicit public values and no deployment credentials', () => {
  const env = createBuildEnvironment({ config, backendValues, home: '/tmp/build-home', environment: {
    PATH: '/usr/bin', AWS_ACCESS_KEY_ID: 'secret', AWS_SESSION_TOKEN: 'secret', GH_TOKEN: 'secret', EXPO_PUBLIC_REVIEW_ENABLED: 'true', EXPO_PUBLIC_SETUP_HMAC_KEY: 'secret', EXPO_PUBLIC_API_DEBUG_GET: 'true',
  } });
  assert.equal(env.EXPO_NO_DOTENV, '1');
  assert.equal(env.APP_VARIANT, 'test');
  assert.equal(env.EXPO_PUBLIC_USE_MOCK_DATA, 'false');
  assert.equal(env.EXPO_PUBLIC_QR_DEV_FORMAT, 'false');
  for (const forbidden of ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN', 'GH_TOKEN', 'EXPO_PUBLIC_REVIEW_ENABLED', 'EXPO_PUBLIC_SETUP_HMAC_KEY', 'EXPO_PUBLIC_API_DEBUG_GET']) {
    assert.equal(forbidden in env, false);
  }
});

test('Production workflow guard rejects a different main workflow, job, or ref', () => {
  const allowed = [{ workflow: 'Deploy web', job: 'publish' }];
  assert.doesNotThrow(() => assertProductionWorkflowJob('prod', { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'Deploy web', GITHUB_JOB: 'publish' }, allowed));
  assert.throws(() => assertProductionWorkflowJob('prod', { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW: 'Other workflow', GITHUB_JOB: 'publish' }, allowed), /restricted/);
  assert.throws(() => assertProductionWorkflowJob('prod', { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/feature', GITHUB_WORKFLOW: 'Deploy web', GITHUB_JOB: 'publish' }, allowed), /restricted/);
  assert.doesNotThrow(() => assertProductionWorkflowJob('dev', {}, allowed));
});

test('stale Actions lease recovery requires the exact completed run attempt', () => {
  assert.doesNotThrow(() => assertActionsLeaseRunInactive('actions:12345:2', { status: 'completed', run_attempt: 2 }));
  assert.throws(() => assertActionsLeaseRunInactive('actions:12345:2', { status: 'in_progress', run_attempt: 2 }), /active/);
  assert.throws(() => assertActionsLeaseRunInactive('actions:12345:2', { status: 'completed', run_attempt: 1 }), /different current attempt/);
});

test('deployment lock is conditional, owner-verified on release, and stale recovery requires an exact old owner', async () => {
  let lease;
  let deleted = 0;
  const adapter = {
    async putLock(_bucket, body) { if (lease) throw new Error('PreconditionFailed'); lease = { body, etag: `etag-${deleted + 1}` }; },
    async getLock() { return lease; },
    async deleteLock(_bucket, etag) { assert.equal(etag, lease.etag); deleted += 1; lease = undefined; },
  };
  const acquired = await acquireDeploymentLock(adapter, { bucket: 'site', owner: 'actions:1:1', sourceSha: 'abc', now: new Date('2026-10-04T00:00:00Z') });
  assert.equal(acquired.owner, 'actions:1:1');
  await assert.rejects(acquireDeploymentLock(adapter, { bucket: 'site', owner: 'actions:2:1', sourceSha: 'def' }), /Could not acquire/);
  await assert.rejects(releaseDeploymentLock(adapter, { bucket: 'site', owner: 'wrong' }), /refusing deletion/);
  await releaseDeploymentLock(adapter, { bucket: 'site', owner: 'actions:1:1' });
  assert.equal(deleted, 1);
  lease = { body: JSON.stringify({ owner: 'missing-etag' }) };
  await assert.rejects(releaseDeploymentLock(adapter, { bucket: 'site', owner: 'missing-etag' }), /no ETag/);
  assert.equal(deleted, 1);
  lease = { body: JSON.stringify({ owner: 'stale-run', acquiredAt: '2026-10-03T00:00:00.000Z' }), etag: 'etag-stale' };
  await assert.rejects(recoverStaleDeploymentLock(adapter, { bucket: 'site', expectedOwner: 'someone-else', reason: 'Confirmed failed job and owner contact', now: new Date('2026-10-04T00:00:00Z') }), /does not match/);
  const result = await recoverStaleDeploymentLock(adapter, { bucket: 'site', expectedOwner: 'stale-run', reason: 'Confirmed failed job and owner contact', now: new Date('2026-10-04T00:00:00Z') });
  assert.equal(result.recoveredOwner, 'stale-run');
  const replacedLease = {
    async getLock() { return { body: JSON.stringify({ owner: 'same-owner' }), etag: 'observed-etag' }; },
    async deleteLock(_bucket, etag) { assert.equal(etag, 'observed-etag'); throw new Error('PreconditionFailed'); },
  };
  await assert.rejects(releaseDeploymentLock(replacedLease, { bucket: 'site', owner: 'same-owner' }), /PreconditionFailed/);
});

test('CORS readiness requires exact origin, requested methods, and headers', () => {
  const response = { status: 204, headers: new Headers({
    'access-control-allow-origin': 'https://site.example.test',
    'access-control-allow-methods': 'GET, PUT',
    'access-control-allow-headers': 'Authorization, If-None-Match, Content-Type',
  }) };
  assert.doesNotThrow(() => assertReadinessResponse(response, { origin: 'https://site.example.test', methods: ['GET'], headers: ['authorization', 'if-none-match'], label: 'API' }));
  assert.throws(() => assertReadinessResponse(response, { origin: 'https://other.example.test', methods: ['GET'], headers: ['authorization'], label: 'API' }), /origin/);
  assert.throws(() => assertReadinessResponse(response, { origin: 'https://site.example.test', methods: ['DELETE'], headers: ['authorization'], label: 'API' }), /methods/);
});

test('backend readiness fails closed on missing artifact CORS and verifies API ETag exposure', async () => {
  const calls = [];
  const fetchImpl = async (_url, options = {}) => {
    calls.push(options.method ?? 'GET');
    const isArtifact = calls.at(-1) === 'OPTIONS' && options.headers['Access-Control-Request-Method'] === 'PUT';
    const headers = isArtifact ? new Headers({
      'access-control-allow-origin': 'https://site.example.test',
      'access-control-allow-methods': 'PUT',
      'access-control-allow-headers': 'content-type',
    }) : new Headers({
      'access-control-allow-origin': 'https://site.example.test',
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': 'authorization,if-none-match',
      'access-control-expose-headers': 'ETag',
    });
    return { status: 204, headers };
  };
  const result = await verifyBackendReadiness({ siteUrl: 'https://site.example.test', apiUrl: 'https://api.example.test/prod/events', artifactUrl: 'https://files.example.test/object', fetchImpl });
  assert.equal(result.origin, 'https://site.example.test');
  const missingArtifact = async (url, options = {}) => {
    const response = await fetchImpl(url, options);
    if (options.headers?.['Access-Control-Request-Method'] === 'PUT') response.headers.delete('access-control-allow-origin');
    return response;
  };
  await assert.rejects(verifyBackendReadiness({ siteUrl: 'https://site.example.test', apiUrl: 'https://api.example.test/prod/events', artifactUrl: 'https://files.example.test/object', fetchImpl: missingArtifact }), /Artifact bucket CORS origin/);
});

test('publication ordering keeps immutable dependencies first and index.html last', () => {
  const files = [
    { path: 'index.html', cacheControl: 'no-cache' },
    { path: 'runtime.js', cacheControl: 'no-cache' },
    { path: 'chunk-0123456789abcdef.js', cacheControl: 'public,max-age=31536000,immutable' },
  ];
  assert.deepEqual(publicationOrder(files).map(({ path: name }) => name), ['chunk-0123456789abcdef.js', 'runtime.js', 'index.html']);
  assert.throws(() => publicationOrder(files.slice(1)), /index.html/);
});

test('publication uploads verified bytes in order and verifies response identity, headers, redirects, and missing paths', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'web-release-test-'));
  try {
    const artifactDir = path.join(directory, 'site');
    await mkdir(path.join(artifactDir, 'assets'), { recursive: true });
    const releaseId = 'dev-run-1';
    const html = Buffer.from(`<!doctype html><head><!-- web-release:${releaseId} --></head>`);
    const script = Buffer.from('window.release = "run-1";');
    await writeFile(path.join(artifactDir, 'index.html'), html);
    await writeFile(path.join(artifactDir, 'assets/app-0123456789abcdef.js'), script);
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      schemaVersion: 1,
      environment: 'dev',
      releaseId,
      configFingerprint: 'c'.repeat(64),
      files: [
        { path: 'index.html', sha256: digest(html), size: html.length, contentType: 'text/html', cacheControl: 'no-cache' },
        { path: 'assets/app-0123456789abcdef.js', sha256: digest(script), size: script.length, contentType: 'text/javascript', cacheControl: 'public,max-age=31536000,immutable' },
      ],
    };
    const operations = [];
    const adapter = {
      async putObject(entry) { operations.push(`put:${entry.key}`); },
      async createInvalidation(_distribution, pattern) { operations.push(`invalidate:${pattern}`); return 'invalidation-1'; },
      async waitForInvalidation() { operations.push('wait'); },
    };
    const securityHeaders = {
      'content-type': 'text/html',
      'cache-control': 'no-cache',
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy-report-only': "default-src 'self'",
    };
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:') return new Response(null, { status: 301, headers: { location: String(url).replace(/^http:/, 'https:') } });
      if (parsed.hostname.includes('.s3.')) return new Response('<Error>AccessDenied</Error>', { status: 403 });
      if (parsed.pathname.includes('__missing_')) return new Response('<Error/>', { status: 403, headers: { 'content-type': 'text/html' } });
      if (parsed.pathname.endsWith('index.html')) return new Response(html, { status: 200, headers: securityHeaders });
      operations.push(`get:${parsed.pathname}`);
      return new Response(script, { status: 200, headers: { 'content-type': 'application/javascript', 'cache-control': 'public,max-age=31536000,immutable' } });
    };
    const result = await publishRelease({ adapter, artifactDir, manifest, siteUrl: 'https://site.example.test', bucketName: 'tour-mgmt-web-dev-123456789012', bucketRegion: 'ap-south-1', distributionId: 'D123', environment: 'dev', configFingerprint: 'c'.repeat(64), cspMode: 'REPORT_ONLY', contentSecurityPolicy: "default-src 'self'", fetchImpl });
    assert.equal(result.releaseId, releaseId);
    assert.deepEqual(operations.slice(0, 4), [
      'put:assets/app-0123456789abcdef.js',
      'put:index.html',
      'invalidate:/*',
      'wait',
    ]);
      const exposedS3Fetch = async (url, options) => {
        if (String(url).includes('.s3.ap-south-1.amazonaws.com')) return new Response('public', { status: 200 });
        return fetchImpl(url, options);
      };
      await assert.rejects(publishRelease({ adapter, artifactDir, manifest, siteUrl: 'https://site.example.test', bucketName: 'tour-mgmt-web-dev-123456789012', bucketRegion: 'ap-south-1', distributionId: 'D123', environment: 'dev', configFingerprint: 'c'.repeat(64), cspMode: 'REPORT_ONLY', contentSecurityPolicy: "default-src 'self'", fetchImpl: exposedS3Fetch }), /private-bucket denial/);
    const deceptiveFetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:') return new Response(null, { status: 301, headers: { location: String(url).replace(/^http:/, 'https:') } });
      if (parsed.pathname.endsWith('.js')) return new Response('<html>not javascript</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (parsed.pathname.endsWith('index.html')) return new Response(html, { status: 200, headers: securityHeaders });
      return new Response('', { status: 404 });
    };
    await assert.rejects(publishRelease({ adapter, artifactDir, manifest, siteUrl: 'https://site.example.test', bucketName: 'tour-mgmt-web-dev-123456789012', bucketRegion: 'ap-south-1', distributionId: 'D123', environment: 'dev', configFingerprint: 'c'.repeat(64), cspMode: 'REPORT_ONLY', contentSecurityPolicy: "default-src 'self'", fetchImpl: deceptiveFetch }), /unexpected content type/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});