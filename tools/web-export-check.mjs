#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /(?:^|[^A-Za-z0-9_$])(?:aws_secret_access_key|client_secret|setup_hmac_key)\s*[:=]\s*["']([^"']{16,})["']/i,
  /(?:^|[^A-Za-z0-9_$])password\s*[:=]\s*["']([^"']{8,})["']/i,
];
const immutableHashPattern = /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function configFingerprint(config) {
  return sha256(canonicalJson(config));
}

export async function readDeploymentConfig(filePath, environment) {
  let config;
  try {
    config = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read valid JSON config: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.schemaVersion !== 1) {
    throw new Error('Deployment config must be a schemaVersion 1 JSON object');
  }
  if (config.environment !== environment || !['dev', 'prod'].includes(environment)) {
    throw new Error(`Deployment config environment must be ${environment}`);
  }
  if (!/^\d{12}$/.test(config.expectedAccountId ?? '')) throw new Error('expectedAccountId must be a 12-digit account ID');
  if (config.hostingRegion !== 'ap-south-1') throw new Error('hostingRegion must be ap-south-1');
  if (typeof config.project !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(config.project)) throw new Error('project must be a lowercase AWS-safe name');
  if (typeof config.owner !== 'string' || !config.owner.trim()) throw new Error('owner is required');
  if (!config.backend || !config.backend.outputKeys || !config.backend.outputKeys.apiBaseUrl) throw new Error('backend.outputKeys.apiBaseUrl is required');
  return { config, fingerprint: configFingerprint(config) };
}

async function walk(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in the export: ${path.relative(base, fullPath)}`);
    if (entry.isDirectory()) files.push(...await walk(fullPath, base));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function assertSafePath(reference, source) {
  const cleanReference = reference.split(/[?#]/, 1)[0].replaceAll('\\', '/');
  if (!cleanReference || cleanReference.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(cleanReference)) return null;
  let decoded;
  try { decoded = decodeURIComponent(cleanReference); } catch { throw new Error(`Invalid encoded reference in ${source}: ${reference}`); }
  if (decoded.split('/').includes('..')) throw new Error(`Traversing reference in ${source}: ${reference}`);
  return decoded.replace(/^\/+/, '');
}

function referencesFor(file, content) {
  const references = [];
  const add = (value) => { if (value) references.push(value); };
  if (/\.html?$/i.test(file)) {
    for (const match of content.matchAll(/\b(?:src|href|poster|action)\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
    for (const match of content.matchAll(/<link\b[^>]*\bimagesrcset\s*=\s*["']([^"']+)["']/gi)) add(match[1].split(',')[0].trim().split(/\s+/)[0]);
  }
  if (/\.css$/i.test(file)) {
    for (const match of content.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1].trim());
    for (const match of content.matchAll(/@import\s+["']([^"']+)["']/gi)) add(match[1]);
  }
  return references;
}

function contentType(file) {
  return ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4' })[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export async function createManifest({ outputDir, environment, sourceSha, helperSha, workflowSha = helperSha, configFingerprint, toolchain, releaseId }) {
  if (!['dev', 'prod'].includes(environment)) throw new Error('environment must be dev or prod');
  for (const [name, value] of Object.entries({ sourceSha, helperSha, workflowSha, configFingerprint, releaseId })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  }
  for (const [name, value] of Object.entries({ sourceSha, helperSha, workflowSha })) {
    if (!/^[a-f0-9]{40,64}$/i.test(value)) throw new Error(`${name} must be a Git commit SHA`);
  }
  if (!/^[a-f0-9]{64}$/i.test(configFingerprint)) throw new Error('configFingerprint must be a SHA-256 digest');
  const absoluteRoot = path.resolve(outputDir);
  const files = await walk(absoluteRoot);
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file));
  if (htmlFiles.length !== 1 || path.basename(htmlFiles[0]) !== 'index.html') throw new Error('Export must contain exactly one root index.html file');
  const manifestFiles = [];
  const knownFiles = new Set(files.map((file) => path.relative(absoluteRoot, file).split(path.sep).join('/')));
  for (const fullPath of files) {
    const relativePath = path.relative(absoluteRoot, fullPath).split(path.sep).join('/');
    if (/\.map$/i.test(relativePath) || /(^|\/)\.env(?:\.|$)/i.test(relativePath)) throw new Error(`Forbidden export file: ${relativePath}`);
    const bytes = await readFile(fullPath);
    const content = bytes.toString('utf8');
    if (/\.(?:html?|css|js|mjs|json|xml|txt|svg)$/i.test(relativePath) && secretPatterns.some((pattern) => pattern.test(content))) {
      throw new Error(`Potential secret in export: ${relativePath}`);
    }
    for (const reference of referencesFor(relativePath, content)) {
      const safeReference = assertSafePath(reference, relativePath);
      if (safeReference == null) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), safeReference));
      if (!knownFiles.has(target)) throw new Error(`Unresolved export reference in ${relativePath}: ${reference}`);
    }
    const immutable = immutableHashPattern.test(path.posix.basename(relativePath));
    manifestFiles.push({
      path: relativePath,
      sha256: sha256(bytes),
      size: bytes.length,
      contentType: contentType(relativePath),
      cacheControl: immutable ? 'public,max-age=31536000,immutable' : 'no-cache',
    });
  }
  return {
    schemaVersion: 1,
    environment,
    appVariant: environment === 'dev' ? 'test' : 'production',
    sourceSha,
    helperSha,
    workflowSha,
    configFingerprint,
    toolchain,
    releaseId,
    files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function verifyManifest({ outputDir, manifest, environment, configFingerprint, expectedWorkflowSha, allowPriorConfig = false }) {
  const expectedVariant = environment === 'dev' ? 'test' : 'production';
  if (!manifest || manifest.schemaVersion !== 1 || manifest.environment !== environment || manifest.appVariant !== expectedVariant) {
    throw new Error('Artifact manifest has an invalid schema, environment, or app variant');
  }
  for (const name of ['sourceSha', 'helperSha', 'workflowSha']) {
    if (!/^[a-f0-9]{40,64}$/i.test(manifest[name] ?? '')) throw new Error(`Artifact manifest ${name} provenance is invalid`);
  }
  if (typeof manifest.releaseId !== 'string' || !manifest.releaseId || !/^[a-f0-9]{64}$/i.test(manifest.configFingerprint ?? '')) {
    throw new Error('Artifact manifest release identity or config fingerprint is invalid');
  }
  if (expectedWorkflowSha && (manifest.workflowSha !== expectedWorkflowSha || manifest.helperSha !== expectedWorkflowSha)) {
    throw new Error('Artifact was not produced by the trusted workflow and helper commit');
  }
  if (!allowPriorConfig && manifest.configFingerprint !== configFingerprint) throw new Error('Artifact config fingerprint does not match the approved environment');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Artifact manifest contains no file checksums');
  const absoluteRoot = path.resolve(outputDir);
  const actualFiles = (await walk(absoluteRoot)).map((file) => path.relative(absoluteRoot, file).split(path.sep).join('/')).sort();
  const expectedFiles = manifest.files.map((file) => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('Artifact files do not match the manifest');
  for (const entry of manifest.files) {
    const fullPath = path.resolve(absoluteRoot, entry.path);
    if (!fullPath.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error(`Manifest path escapes artifact root: ${entry.path}`);
    const bytes = await readFile(fullPath);
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.size) throw new Error(`Artifact checksum mismatch: ${entry.path}`);
    const immutable = immutableHashPattern.test(path.posix.basename(entry.path));
    if (entry.cacheControl !== (immutable ? 'public,max-age=31536000,immutable' : 'no-cache')) throw new Error(`Invalid cache classification: ${entry.path}`);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write('Import this module from the trusted deployment command to validate exports.\n');
  process.exitCode = 2;
}