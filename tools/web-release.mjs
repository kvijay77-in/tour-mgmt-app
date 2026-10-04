import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createBuildEnvironment({ config, backendValues, environment = process.env, home }) {
  const values = {
    PATH: environment.PATH ?? '',
    HOME: home,
    CI: 'true',
    EXPO_NO_DOTENV: '1',
    APP_VARIANT: config.environment === 'dev' ? 'test' : 'production',
    EXPO_PUBLIC_ENVIRONMENT: config.environment === 'dev' ? 'development' : 'production',
    EXPO_PUBLIC_AWS_REGION: config.backendRegion,
    EXPO_PUBLIC_AWS_USER_POOL_ID: backendValues.userPoolId,
    EXPO_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID: backendValues.userPoolWebClientId,
    EXPO_PUBLIC_TOUR_DATA_API_BASE_URL: backendValues.apiBaseUrl,
    EXPO_PUBLIC_USE_MOCK_DATA: 'false',
    EXPO_PUBLIC_QR_DEV_FORMAT: 'false',
    EXPO_PUBLIC_LOG_LEVEL: config.public.logLevel,
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_CACHE: path.join(home, '.npm'),
  };
  if (backendValues.identityPoolId) values.EXPO_PUBLIC_AWS_IDENTITY_POOL_ID = backendValues.identityPoolId;
  return values;
}

export function createLockOwner({ env = process.env, host = hostname(), processId = process.pid, id = randomUUID() } = {}) {
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT) {
    return `actions:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}`;
  }
  return `local:${host}:${processId}:${id}`;
}

export function assertProductionWorkflowJob(environment, env, allowed) {
  if (environment !== 'prod') return;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' || !allowed.some(({ workflow, job }) => env.GITHUB_WORKFLOW === workflow && env.GITHUB_JOB === job)) {
    throw new Error('Production AWS operations are restricted to the approved main deployment, rollback, or lock-recovery workflow job');
  }
}

export function assertActionsLeaseRunInactive(owner, run) {
  const match = owner?.match(/^actions:(\d+):(\d+)$/);
  if (!match) throw new Error('Actions lease owner must include its exact run ID and attempt');
  if (!run || run.status !== 'completed' || Number(run.run_attempt) !== Number(match[2])) {
    throw new Error(`Actions run ${match[1]} attempt ${match[2]} is missing, active, or has a different current attempt`);
  }
}

export async function acquireDeploymentLock(adapter, { bucket, owner, sourceSha, now = new Date() }) {
  if (!bucket || !owner || !sourceSha) throw new Error('Lock bucket, owner, and source SHA are required');
  const lease = { schemaVersion: 1, owner, sourceSha, acquiredAt: now.toISOString() };
  try {
    await adapter.putLock(bucket, JSON.stringify(lease));
  } catch (error) {
    throw new Error(`Could not acquire deployment lock for ${bucket}; another deployment may hold it. Inspect the exact lock object and use audited stale-lock recovery only after confirming its owner (${error.message})`);
  }
  return lease;
}

export async function releaseDeploymentLock(adapter, { bucket, owner }) {
  const current = await adapter.getLock(bucket);
  if (!current) throw new Error('Deployment lock disappeared before release; refusing to delete or claim ownership');
  const body = typeof current === 'string' ? current : current.body;
  let lease;
  try { lease = JSON.parse(body); } catch { throw new Error('Deployment lock is malformed; refusing to delete it'); }
  if (lease.owner !== owner) throw new Error(`Deployment lock belongs to '${lease.owner ?? 'unknown'}', not this run; refusing deletion`);
  if (typeof current === 'string' || !current.etag) throw new Error('Deployment lock has no ETag; refusing unconditional deletion');
  await adapter.deleteLock(bucket, current.etag);
}

export async function recoverStaleDeploymentLock(adapter, { bucket, expectedOwner, reason, now = new Date(), maxAgeMs = 6 * 60 * 60 * 1000 }) {
  if (typeof reason !== 'string' || reason.trim().length < 20) throw new Error('Stale-lock recovery requires an audit reason of at least 20 characters');
  const current = await adapter.getLock(bucket);
  if (!current) throw new Error('No deployment lock exists');
  const body = typeof current === 'string' ? current : current.body;
  let lease;
  try { lease = JSON.parse(body); } catch { throw new Error('Deployment lock is malformed; inspect it manually before recovery'); }
  if (!expectedOwner || lease.owner !== expectedOwner) throw new Error(`Deployment lock owner does not match the explicitly confirmed owner '${expectedOwner ?? ''}'`);
  const acquiredAt = Date.parse(lease.acquiredAt);
  if (!Number.isFinite(acquiredAt) || now.getTime() - acquiredAt < maxAgeMs) throw new Error('Deployment lock is not older than the six-hour recovery threshold');
  if (typeof current === 'string' || !current.etag) throw new Error('Deployment lock has no ETag; refusing unconditional recovery');
  await adapter.deleteLock(bucket, current.etag);
  return { recoveredOwner: lease.owner, reason: reason.trim() };
}

function parseHeaderList(value) {
  return (value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

export function assertReadinessResponse(response, { origin, methods, headers, label }) {
  if (response.status < 200 || response.status >= 300) throw new Error(`${label} preflight returned HTTP ${response.status}`);
  if (response.headers.get('access-control-allow-origin') !== origin) throw new Error(`${label} CORS origin does not exactly match ${origin}`);
  const allowedMethods = parseHeaderList(response.headers.get('access-control-allow-methods'));
  if (!methods.every((method) => allowedMethods.includes(method.toLowerCase()))) throw new Error(`${label} CORS methods do not include ${methods.join(', ')}`);
  const allowedHeaders = parseHeaderList(response.headers.get('access-control-allow-headers'));
  if (!headers.every((header) => allowedHeaders.includes(header.toLowerCase()))) throw new Error(`${label} CORS headers do not include ${headers.join(', ')}`);
}

export async function verifyBackendReadiness({ siteUrl, apiUrl, artifactUrl, fetchImpl = fetch }) {
  const origin = new URL(siteUrl).origin;
  if (!apiUrl || !artifactUrl) throw new Error('Backend readiness requires owner-confirmed API and artifact preflight URLs');
  for (const [label, target] of [['API', apiUrl], ['artifact bucket', artifactUrl]]) {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${label} readiness URL must be a complete HTTPS URL without credentials, query parameters, or fragments`);
  }
  const apiPreflight = await fetchImpl(apiUrl, { method: 'OPTIONS', headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization,if-none-match',
  } });
  assertReadinessResponse(apiPreflight, { origin, methods: ['GET'], headers: ['authorization', 'if-none-match'], label: 'API' });
  const apiResponse = await fetchImpl(apiUrl, { headers: { Origin: origin } });
  if (apiResponse.status >= 500 || apiResponse.headers.get('access-control-allow-origin') !== origin) {
    throw new Error(`API response CORS check failed (HTTP ${apiResponse.status})`);
  }
  if (!parseHeaderList(apiResponse.headers.get('access-control-expose-headers')).includes('etag')) {
    throw new Error('API response does not expose ETag for conditional requests');
  }
  const artifactPreflight = await fetchImpl(artifactUrl, { method: 'OPTIONS', headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type',
  } });
  assertReadinessResponse(artifactPreflight, { origin, methods: ['PUT'], headers: ['content-type'], label: 'Artifact bucket' });
  return { origin, apiStatus: apiResponse.status, apiPreflightStatus: apiPreflight.status, artifactPreflightStatus: artifactPreflight.status };
}

export function publicationOrder(files) {
  const index = files.find((file) => file.path === 'index.html');
  if (!index) throw new Error('Publication manifest is missing index.html');
  return [
    ...files.filter((file) => file.path !== 'index.html' && file.cacheControl === 'public,max-age=31536000,immutable'),
    ...files.filter((file) => file.path !== 'index.html' && file.cacheControl !== 'public,max-age=31536000,immutable'),
    index,
  ];
}

function assetUrl(siteUrl, filePath) {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  return new URL(encodedPath, `${siteUrl.replace(/\/$/, '')}/`).toString();
}

function normalizedMime(value) {
  const mime = value?.split(';', 1)[0].trim().toLowerCase();
  return mime === 'application/javascript' ? 'text/javascript' : mime;
}

export async function publishRelease({ adapter, artifactDir, manifest, siteUrl, bucketName, bucketRegion, distributionId, environment, configFingerprint, cspMode, contentSecurityPolicy, fetchImpl = fetch }) {
  const origin = new URL(siteUrl);
  if (origin.protocol !== 'https:') throw new Error('Published SiteUrl must use HTTPS');
  if (!bucketName || !bucketRegion) throw new Error('Exact hosting bucket name and region are required for the S3 privacy check');
  if (manifest.environment !== environment || manifest.configFingerprint !== configFingerprint) throw new Error('Release manifest does not match the target environment/configuration');
  const orderedFiles = publicationOrder(manifest.files);
  for (const entry of orderedFiles) {
    const bytes = await readFile(path.join(artifactDir, entry.path));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.size) throw new Error(`Release checksum mismatch before upload: ${entry.path}`);
    await adapter.putObject({ key: entry.path, filePath: path.join(artifactDir, entry.path), contentType: entry.contentType, cacheControl: entry.cacheControl });
  }
  const invalidation = await adapter.createInvalidation(distributionId, '/*');
  await adapter.waitForInvalidation(distributionId, invalidation);
  for (const entry of orderedFiles) {
    const response = await fetchImpl(assetUrl(siteUrl, entry.path), { redirect: 'manual' });
    if (response.status !== 200) throw new Error(`Published file ${entry.path} returned HTTP ${response.status}`);
    if (normalizedMime(response.headers.get('content-type')) !== normalizedMime(entry.contentType)) throw new Error(`Published file ${entry.path} has unexpected content type ${response.headers.get('content-type') ?? 'missing'}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (sha256(body) !== entry.sha256) throw new Error(`Published file checksum mismatch: ${entry.path}`);
    if (response.headers.get('cache-control')?.trim().toLowerCase() !== entry.cacheControl.toLowerCase()) {
      throw new Error(`Published file ${entry.path} has an unexpected Cache-Control header`);
    }
    if (entry.path === 'index.html') {
      if (!body.toString('utf8').includes(`<!-- web-release:${manifest.releaseId} -->`)) throw new Error('Published HTML does not identify the validated release');
      if (!response.headers.get('strict-transport-security')?.toLowerCase().includes('max-age=')) throw new Error('Site response is missing HSTS');
      if (response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') throw new Error('Site response is missing X-Content-Type-Options: nosniff');
      if (response.headers.get('x-frame-options')?.toLowerCase() !== 'deny') throw new Error('Site response is missing X-Frame-Options: DENY');
      if (!response.headers.get('referrer-policy')) throw new Error('Site response is missing Referrer-Policy');
      const cspHeader = cspMode === 'ENFORCE' ? 'content-security-policy' : 'content-security-policy-report-only';
      if (!response.headers.get(cspHeader)?.includes(contentSecurityPolicy)) throw new Error(`Site response is missing the configured ${cspMode} CSP`);
    }
  }
  const httpUrl = new URL(siteUrl);
  httpUrl.protocol = 'http:';
  const redirect = await fetchImpl(httpUrl, { redirect: 'manual' });
  if (![301, 302, 307, 308].includes(redirect.status) || !redirect.headers.get('location')?.startsWith('https://')) {
    throw new Error('HTTP site requests must redirect to HTTPS');
  }
  const missing = await fetchImpl(assetUrl(siteUrl, `__missing_${manifest.releaseId}.js`), { redirect: 'manual' });
  if (![403, 404].includes(missing.status)) throw new Error(`Missing-file request returned HTTP ${missing.status}; expected 403 or 404 without HTML fallback`);
  const originObject = await fetchImpl(`https://${bucketName}.s3.${bucketRegion}.amazonaws.com/index.html`, { redirect: 'manual' });
  if (originObject.status !== 403) throw new Error(`Anonymous S3 origin request returned HTTP ${originObject.status}; expected private-bucket denial`);
  return { releaseId: manifest.releaseId, files: orderedFiles.length, invalidation };
}

export function makeReleaseId({ environment, sourceSha, runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT, now = Date.now() }) {
  const prefix = runId && attempt ? `${runId}-${attempt}` : `${now}`;
  return `${environment}-${prefix}-${sourceSha.slice(0, 12)}`;
}