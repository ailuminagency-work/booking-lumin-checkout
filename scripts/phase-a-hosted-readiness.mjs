import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const MIGRATION = /^0\d+_[a-z0-9][a-z0-9_]*$/;
const EDGE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BEARER_TOKEN = /^[A-Za-z0-9._~-]{16,4096}$/;
const MAX_BODY = 65_536;
const DEFAULT_EDGE_FUNCTIONS = ['stripe-webhook', 'create-payment-intent'];
const MIGRATION_ATTESTATION_EVIDENCE = 'core_schema_contract';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rootUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`CONFIG: ${label} must be a valid URL`); }
  const local = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !local.has(url.hostname))) {
    throw new Error(`CONFIG: ${label} must be an HTTPS origin (HTTP only on loopback)`);
  }
  return url;
}

function safeMigration(value, label = 'migration head') {
  if (typeof value !== 'string' || !MIGRATION.test(value)) throw new Error(`CONFIG: invalid ${label}`);
  return value;
}

function edgeFunctions(env) {
  const raw = env.BOOKING_LUMIN_EDGE_FUNCTIONS ?? '';
  const additional = raw.split(',').map(value => value.trim()).filter(Boolean);
  if (additional.some(name => !EDGE_NAME.test(name))) throw new Error('CONFIG: invalid Edge Function list');
  return [...new Set([...DEFAULT_EDGE_FUNCTIONS, ...additional])];
}

async function activeMigrationHead(rootDir) {
  const dir = resolve(rootDir, 'supabase', 'migrations');
  const names = (await readdir(dir)).filter(name => /^0\d+_.+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('CONFIG: no active migrations found');
  return safeMigration(names.at(-1).replace(/\.sql$/, ''), 'checked-in migration head');
}

async function responseJson(response, label) {
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error(`FAIL ${label}: expected HTTP 200 JSON`);
  }
  if (!response.body) throw new Error(`FAIL ${label}: empty response`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY) throw new Error(`FAIL ${label}: response too large`);
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new Error(`FAIL ${label}: invalid JSON`); }
}

async function request(fetchImpl, url, label, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, method: options.method ?? 'GET', redirect: 'error', signal: controller.signal });
  } catch {
    throw new Error(`FAIL ${label}: network or timeout`);
  } finally { clearTimeout(timer); }
}

async function migrationAttestation(fetchImpl, api, token, expectedMigration, timeoutMs, log) {
  const response = await request(fetchImpl, new URL('/api/staging/readiness/migration', api), 'migration attestation', timeoutMs, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  let attestation;
  try {
    attestation = await responseJson(response, 'migration attestation');
  } catch {
    throw new Error('FAIL migration attestation: MIGRATION_ATTESTATION_UNAVAILABLE');
  }
  if (!object(attestation) || attestation.schemaVersion !== 1 || typeof attestation.migrationHead !== 'string' || attestation.evidence !== MIGRATION_ATTESTATION_EVIDENCE) {
    throw new Error('FAIL migration attestation: MIGRATION_ATTESTATION_UNAVAILABLE');
  }
  if (attestation.migrationHead !== expectedMigration) {
    throw new Error('FAIL migration attestation: MIGRATION_ATTESTATION_DRIFT');
  }
  log('PASS authenticated database migration sentinel + core schema contract (full chain replay remains separate)');
  return Object.freeze({ schemaVersion: 1, migrationHead: attestation.migrationHead, evidence: attestation.evidence });
}

/**
 * Read-only, opt-in hosted staging gate. It never sends a database password or
 * service-role credential and never mutates an API, database, or Edge Function.
 * /version migrationHead is deployment metadata only. The authenticated
 * attestation route must independently prove that the live database ran the
 * checked-in attestation migration; /ready alone only proves connectivity.
 */
export async function runHostedReadiness(env = process.env, {
  fetchImpl = fetch,
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  timeoutMs = 10_000,
  log = console.log,
} = {}) {
  if (env.BOOKING_LUMIN_READINESS !== '1') throw new Error('CONFIG: set BOOKING_LUMIN_READINESS=1 for hosted readiness checks');
  const api = rootUrl(env.BOOKING_LUMIN_API_BASE_URL, 'BOOKING_LUMIN_API_BASE_URL');
  const supabase = rootUrl(env.BOOKING_LUMIN_SUPABASE_URL ?? env.SUPABASE_URL, 'BOOKING_LUMIN_SUPABASE_URL');
  const expectedSha = env.BOOKING_LUMIN_EXPECTED_RELEASE_SHA;
  if (expectedSha !== undefined && !SHA.test(expectedSha)) throw new Error('CONFIG: invalid expected release SHA');
  const attestationToken = env.BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN;
  if (typeof attestationToken !== 'string' || !BEARER_TOKEN.test(attestationToken)) throw new Error('CONFIG: set BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN to an authenticated staging token');
  const expectedMigration = await activeMigrationHead(rootDir);
  const functions = edgeFunctions(env);
  const versionResponse = await request(fetchImpl, new URL('/version', api), 'version', timeoutMs, { headers: { accept: 'application/json' } });
  const version = await responseJson(versionResponse, 'version');
  if (!object(version) || version.schemaVersion !== 1 || version.service !== 'booking-lumin-api' || version.environment !== 'staging' || !SHA.test(version.releaseSha ?? '')) {
    throw new Error('FAIL version: unexpected release metadata');
  }
  if (expectedSha && version.releaseSha.toLowerCase() !== expectedSha.toLowerCase()) throw new Error('FAIL version: RELEASE_MISMATCH');
  if (typeof version.migrationHead !== 'string') throw new Error('FAIL version: MIGRATION_METADATA_UNAVAILABLE');
  if (version.migrationHead !== expectedMigration) throw new Error('FAIL version: MIGRATION_METADATA_DRIFT');
  log('PASS release and migration metadata');

  const attestation = await migrationAttestation(fetchImpl, api, attestationToken, expectedMigration, timeoutMs, log);

  const edgeResults = [];
  for (const name of functions) {
    const response = await request(fetchImpl, new URL(`/functions/v1/${name}`, supabase), `Edge Function ${name}`, timeoutMs, { headers: { accept: 'application/json' } });
    if (response.status === 404) throw new Error(`FAIL Edge Function ${name}: EDGE_FUNCTION_MISSING`);
    if (response.status >= 500) throw new Error(`FAIL Edge Function ${name}: provider unavailable`);
    if (response.status < 400) throw new Error(`FAIL Edge Function ${name}: EDGE_FUNCTION_UNVERIFIED`);
    edgeResults.push({ name, status: response.status });
    log(`PASS Edge Function ${name} is deployed (HTTP ${response.status})`);
    await response.body?.cancel().catch(() => undefined);
  }
  return Object.freeze({ releaseSha: version.releaseSha, migrationHead: version.migrationHead, migrationAttestation: attestation, edgeFunctions: edgeResults });
}

async function selfTest() {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const migrationHead = '0100_security_advisor_hardening';
  const evidence = MIGRATION_ATTESTATION_EVIDENCE;
  const env = {
    BOOKING_LUMIN_READINESS: '1',
    BOOKING_LUMIN_API_BASE_URL: 'https://api.example.test',
    BOOKING_LUMIN_SUPABASE_URL: 'https://project.supabase.co',
    BOOKING_LUMIN_EXPECTED_RELEASE_SHA: sha,
    BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN: 'staging-token-123456',
  };
  const seen = [];
  const fake = async (url, options) => {
    seen.push({ path: url.pathname, options });
    if (url.pathname === '/version') return Response.json({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/staging/readiness/migration') return Response.json({ schemaVersion: 1, migrationHead, evidence }, { headers: { 'content-type': 'application/json' } });
    return new Response('', { status: url.pathname.endsWith('stripe-webhook') ? 405 : 401 });
  };
  const logs = [];
  const result = await runHostedReadiness(env, { fetchImpl: fake, log: value => logs.push(value) });
  assert.equal(result.releaseSha, sha);
  assert.equal(result.migrationHead, migrationHead);
  assert.deepEqual(result.migrationAttestation, { schemaVersion: 1, migrationHead, evidence });
  assert.deepEqual(result.edgeFunctions.map(item => item.name), DEFAULT_EDGE_FUNCTIONS);
  assert.equal(seen.length, 4);
  assert.ok(logs.every(value => !String(value).includes('project.supabase.co')));

  await assert.rejects(runHostedReadiness({ ...env, BOOKING_LUMIN_READINESS: undefined }, { fetchImpl: () => { throw new Error('must not fetch'); } }), /CONFIG/);
  const fixture = (versionBody, attestationBody, edgeStatus = 405) => async url => {
    if (url.pathname === '/version') return Response.json(versionBody, { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/api/staging/readiness/migration') return attestationBody === undefined ? new Response('', { status: 503 }) : Response.json(attestationBody, { headers: { 'content-type': 'application/json' } });
    return new Response('', { status: url.pathname.endsWith('stripe-webhook') ? edgeStatus : 405 });
  };
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { schemaVersion: 1, migrationHead, evidence }, 404) }), /EDGE_FUNCTION_MISSING/);
  await assert.rejects(runHostedReadiness({ ...env, BOOKING_LUMIN_EDGE_FUNCTIONS: 'create-payment-intent' }, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { schemaVersion: 1, migrationHead, evidence }, 404) }), /EDGE_FUNCTION_MISSING/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { schemaVersion: 1, migrationHead, evidence }, 200) }), /EDGE_FUNCTION_UNVERIFIED/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha }, { schemaVersion: 1, migrationHead, evidence }) }), /MIGRATION_METADATA_UNAVAILABLE/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead: '0098_refund_event_shape_authority' }, { schemaVersion: 1, migrationHead, evidence }) }), /MIGRATION_METADATA_DRIFT/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { schemaVersion: 1, migrationHead: '0098_refund_event_shape_authority', evidence }) }), /MIGRATION_ATTESTATION_DRIFT/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, { schemaVersion: 1, migrationHead, evidence: 'full_chain' }) }), /MIGRATION_ATTESTATION_UNAVAILABLE/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: sha, migrationHead }, undefined) }), /MIGRATION_ATTESTATION_UNAVAILABLE/);
  await assert.rejects(runHostedReadiness(env, { fetchImpl: fixture({ schemaVersion: 1, service: 'booking-lumin-api', environment: 'staging', releaseSha: 'fedcba98765432100123456789abcdef01234567', migrationHead }, { schemaVersion: 1, migrationHead, evidence }) }), /RELEASE_MISMATCH/);
  await assert.rejects(runHostedReadiness({ ...env, BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN: undefined }, { fetchImpl: () => { throw new Error('must not fetch'); } }), /CONFIG/);
  console.log('PASS hosted-readiness self-test: opt-in, release binding, authenticated migration sentinel/core contract, migration drift, forged evidence, missing Edge Function, bounded responses, no secret logging');
}

const help = `Usage: npm run readiness:phase-a
Requires BOOKING_LUMIN_READINESS=1, BOOKING_LUMIN_API_BASE_URL,
BOOKING_LUMIN_SUPABASE_URL and BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN.
It is read-only and fails closed unless public release metadata and the
  authenticated database sentinel/core-schema contract match the checked-in
  migration head; this does not claim full historical-chain proof. It also
  rejects missing required staging Edge Functions. Use --self-test for
offline fixtures.`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else if (args.length === 1 && args[0] === '--self-test') await selfTest();
    else if (args.length) throw new Error('CONFIG: unsupported arguments; use --help or --self-test');
    else await runHostedReadiness();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'hosted readiness failed');
    process.exitCode = 1;
  }
}

