import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createManifest, readDeploymentConfig, verifyManifest } from './web-export-check.mjs';

const validProvenance = { sourceSha: 'a'.repeat(40), helperSha: 'b'.repeat(40), workflowSha: 'b'.repeat(40), configFingerprint: 'c'.repeat(64) };

async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'web-export-check-'));
}

async function sampleExport(directory) {
  await mkdir(path.join(directory, 'assets'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><script src="/assets/app-0123456789abcdef.js"></script>');
  await writeFile(path.join(directory, 'assets/app-0123456789abcdef.js'), 'window.release = true;');
}

test('config parser rejects malformed JSON, environment mismatch, and invalid account', async () => {
  const directory = await temporaryDirectory();
  const file = path.join(directory, 'config.json');
  try {
    await writeFile(file, '{');
    await assert.rejects(readDeploymentConfig(file, 'dev'), /valid JSON/);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, environment: 'prod', expectedAccountId: '123456789012', hostingRegion: 'ap-south-1', project: 'tour-mgmt-app', owner: 'team', backend: { outputKeys: { apiBaseUrl: 'Api' } } }));
    await assert.rejects(readDeploymentConfig(file, 'dev'), /environment/);
    await writeFile(file, JSON.stringify({ schemaVersion: 1, environment: 'dev', expectedAccountId: '123', hostingRegion: 'ap-south-1', project: 'tour-mgmt-app', owner: 'team', backend: { outputKeys: { apiBaseUrl: 'Api' } } }));
    await assert.rejects(readDeploymentConfig(file, 'dev'), /12-digit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('export manifest records hashes and correct immutable cache classification', async () => {
  const directory = await temporaryDirectory();
  try {
    const outputDir = path.join(directory, 'dist');
    await mkdir(outputDir);
    await sampleExport(outputDir);
    const manifest = await createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: { node: '24.21.0' }, releaseId: 'run-1' });
    assert.equal(manifest.files.find(({ path: name }) => name.endsWith('.js')).cacheControl, 'public,max-age=31536000,immutable');
    assert.equal(manifest.files.find(({ path: name }) => name === 'index.html').cacheControl, 'no-cache');
    await verifyManifest({ outputDir, manifest, environment: 'dev', configFingerprint: 'c'.repeat(64) });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('export rejects missing/multiple HTML, unresolved and traversing references, maps and likely secrets', async () => {
  const directory = await temporaryDirectory();
  try {
    const outputDir = path.join(directory, 'dist');
    await mkdir(outputDir);
    await writeFile(path.join(outputDir, 'index.html'), '<script src="missing.js"></script>');
    await assert.rejects(createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' }), /Unresolved/);
    await writeFile(path.join(outputDir, 'index.html'), '<script src="../outside.js"></script>');
    await assert.rejects(createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' }), /Traversing/);
    await writeFile(path.join(outputDir, 'index.html'), 'clean');
    await writeFile(path.join(outputDir, 'extra.html'), 'extra');
    await assert.rejects(createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' }), /exactly one/);
    await rm(path.join(outputDir, 'extra.html'));
    await writeFile(path.join(outputDir, 'app.js.map'), '{}');
    await assert.rejects(createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' }), /Forbidden/);
    await rm(path.join(outputDir, 'app.js.map'));
    await writeFile(path.join(outputDir, 'app.js'), 'const password="not-for-publication";');
    await assert.rejects(createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' }), /Potential secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('manifest verification rejects wrong environment, config, tampering and unhashed immutable classification', async () => {
  const directory = await temporaryDirectory();
  try {
    const outputDir = path.join(directory, 'dist');
    await mkdir(outputDir);
    await sampleExport(outputDir);
    const manifest = await createManifest({ outputDir, environment: 'dev', ...validProvenance, toolchain: {}, releaseId: 'r' });
    await assert.rejects(verifyManifest({ outputDir, manifest, environment: 'prod', configFingerprint: 'c' }), /environment/);
    await assert.rejects(verifyManifest({ outputDir, manifest, environment: 'dev', configFingerprint: 'e'.repeat(64) }), /fingerprint/);
    await assert.doesNotReject(verifyManifest({ outputDir, manifest, environment: 'dev', configFingerprint: 'e'.repeat(64), allowPriorConfig: true, expectedWorkflowSha: 'b'.repeat(40) }));
    await assert.rejects(verifyManifest({ outputDir, manifest, environment: 'dev', configFingerprint: 'c'.repeat(64), expectedWorkflowSha: 'd'.repeat(40) }), /trusted workflow/);
    const script = path.join(outputDir, 'assets/app-0123456789abcdef.js');
    await writeFile(script, 'tampered');
    await assert.rejects(verifyManifest({ outputDir, manifest, environment: 'dev', configFingerprint: 'c'.repeat(64) }), /checksum/);
    const invalid = structuredClone(manifest);
    invalid.files.find(({ path: name }) => name.endsWith('.js')).cacheControl = 'public,max-age=31536000,immutable';
    invalid.files.find(({ path: name }) => name === 'index.html').cacheControl = 'public,max-age=31536000,immutable';
    await writeFile(script, 'window.release = true;');
    await assert.rejects(verifyManifest({ outputDir, manifest: invalid, environment: 'dev', configFingerprint: 'c'.repeat(64) }), /cache classification/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});