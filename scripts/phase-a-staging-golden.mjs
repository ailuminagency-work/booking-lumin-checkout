import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9._~-]{16,4096}$/;
const ISO = /^\d{4}-\d\d-\d\dT.*Z$/;
const MAX_BODY = 262_144;
const SECRET_FIELDS = /token|authorization|password|secret|private|email|phone/i;

function object(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function text(value) { return typeof value === 'string' && value.length > 0; }
function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function iso(value) { return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)); }
function apiUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('invalid API root');
  return url;
}
function originUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('invalid origin');
  return url;
}
function requiredEnv(env) {
  if (env.BOOKING_LUMIN_GOLDEN_FLOW !== '1') throw new Error('CONFIG: set BOOKING_LUMIN_GOLDEN_FLOW=1 to enable staging mutations');
  const base = apiUrl(env.BOOKING_LUMIN_API_BASE_URL);
  const token = env.BOOKING_LUMIN_GOLDEN_TOKEN;
  const tenant = env.TENANT_ID;
  const service = env.SERVICE_ID;
  const origin = env.BOOKING_LUMIN_GOLDEN_ORIGIN;
  const slotStart = env.BOOKING_LUMIN_GOLDEN_SLOT_START;
  const slotEnd = env.BOOKING_LUMIN_GOLDEN_SLOT_END;
  if (!TOKEN.test(token ?? '') || !uuid(tenant) || !uuid(service) || !origin || !slotStart || !slotEnd) throw new Error('CONFIG: token, tenant, service, origin, and explicit UTC slot are required');
  originUrl(origin);
  if (!iso(slotStart) || !iso(slotEnd) || Date.parse(slotEnd) <= Date.parse(slotStart)) throw new Error('CONFIG: slot must be an increasing UTC interval');
  return { base, token, tenant: tenant.toLowerCase(), service: service.toLowerCase(), origin, slotStart, slotEnd };
}

async function readJson(response) {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('non-JSON response');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY) throw new Error('response too large');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function runGolden(env, { fetchImpl = fetch, timeoutMs = 10_000, log = console.log } = {}) {
  const config = requiredEnv(env);
  const headers = { authorization: `Bearer ${config.token}`, origin: config.origin, accept: 'application/json' };
  async function request(label, path, method, body, expectedStatus, validate) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, config.base), { method, redirect: 'error', signal: controller.signal, headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.status !== expectedStatus) throw new Error(`${label}: unexpected status`);
      const value = await readJson(response);
      if (!validate(value)) throw new Error(`${label}: unexpected schema`);
      log(`PASS ${label}`);
      return value;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  const envelope = value => object(value, ['ok', 'data']) && value.ok === true;
  const profile = await request('profile', `/api/profile?tenantId=${config.tenant}`, 'GET', undefined, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'profile']) && value.data.schemaVersion === 1 && value.data.profile.id.toLowerCase() === config.tenant && value.data.profile.status === 'active');
  const query = new URLSearchParams({ tenantId: config.tenant, serviceId: config.service, from: config.slotStart, to: config.slotEnd });
  await request('availability', `/api/availability?${query}`, 'GET', undefined, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'serviceId', 'durationMinutes', 'slots']) && value.data.schemaVersion === 1 && value.data.serviceId.toLowerCase() === config.service && Number.isInteger(value.data.durationMinutes) && Array.isArray(value.data.slots));
  const idempotencyKey = env.BOOKING_LUMIN_GOLDEN_IDEMPOTENCY_KEY ?? `phase-a-golden-${crypto.randomUUID()}`;
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new Error('CONFIG: idempotency key must be 16-128 characters');
  const draftBody = { idempotencyKey, serviceId: config.service, slotStart: config.slotStart, slotEnd: config.slotEnd, selection: { serviceId: config.service }, customer: { name: env.BOOKING_LUMIN_GOLDEN_CUSTOMER_NAME ?? 'Phase A staging customer', email: env.BOOKING_LUMIN_GOLDEN_CUSTOMER_EMAIL ?? 'phase-a-staging@example.test', phone: env.BOOKING_LUMIN_GOLDEN_CUSTOMER_PHONE ?? '+12065550100' }, address: { line1: '1 Staging Way', city: 'Seattle', country: 'US' } };
  const draft = await request('draft', `/api/bookings/draft?tenantId=${config.tenant}`, 'POST', draftBody, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'bookingId', 'reference', 'state']) && value.data.schemaVersion === 1 && uuid(value.data.bookingId) && text(value.data.reference) && value.data.state === 'draft');
  const replayDraft = await request('draft replay', `/api/bookings/draft?tenantId=${config.tenant}`, 'POST', draftBody, 200, value => envelope(value) && value.data?.bookingId?.toLowerCase() === draft.data.bookingId.toLowerCase() && value.data?.reference === draft.data.reference && value.data?.state === 'draft');
  assert.equal(replayDraft.data.bookingId.toLowerCase(), draft.data.bookingId.toLowerCase());
  const holdBody = { bookingId: draft.data.bookingId };
  const hold = await request('hold', `/api/reservations/hold?tenantId=${config.tenant}`, 'POST', holdBody, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'bookingId', 'holdId', 'status', 'expiresAt']) && value.data.schemaVersion === 1 && value.data.bookingId.toLowerCase() === draft.data.bookingId.toLowerCase() && uuid(value.data.holdId) && value.data.status === 'active' && iso(value.data.expiresAt));
  const holdReplay = await request('hold replay', `/api/reservations/hold?tenantId=${config.tenant}`, 'POST', holdBody, 200, value => envelope(value) && value.data?.holdId?.toLowerCase() === hold.data.holdId.toLowerCase() && value.data?.status === 'active');
  assert.equal(holdReplay.data.holdId.toLowerCase(), hold.data.holdId.toLowerCase());
  const payment = await request('mock payment', `/api/bookings/mock-payment?tenantId=${config.tenant}`, 'POST', holdBody, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'bookingId', 'paymentId', 'state', 'replayed', 'provider', 'simulated']) && value.data.schemaVersion === 1 && value.data.bookingId.toLowerCase() === draft.data.bookingId.toLowerCase() && uuid(value.data.paymentId) && value.data.state === 'confirmed' && value.data.provider === 'staging_mock' && value.data.simulated === true);
  const paymentReplay = await request('mock payment replay', `/api/bookings/mock-payment?tenantId=${config.tenant}`, 'POST', holdBody, 200, value => envelope(value) && value.data?.paymentId?.toLowerCase() === payment.data.paymentId.toLowerCase() && value.data?.state === 'confirmed' && value.data?.provider === 'staging_mock');
  assert.equal(paymentReplay.data.paymentId.toLowerCase(), payment.data.paymentId.toLowerCase());
  await request('confirmation replay', `/api/bookings/confirm?tenantId=${config.tenant}`, 'POST', holdBody, 200, value => envelope(value) && object(value.data, ['schemaVersion', 'bookingId', 'paymentId', 'state', 'replayed']) && value.data.schemaVersion === 1 && value.data.bookingId.toLowerCase() === draft.data.bookingId.toLowerCase() && value.data.paymentId.toLowerCase() === payment.data.paymentId.toLowerCase() && value.data.state === 'confirmed');
  log('PASS staging housekeeping golden flow');
  return { bookingId: draft.data.bookingId, paymentId: payment.data.paymentId };
}

async function selfTest() {
  const tenant = 'a5500000-0000-4000-8000-000000000001';
  const service = 'a5500000-0000-4000-8000-000000000002';
  const booking = 'a5500000-0000-4000-8000-000000000003';
  const hold = 'a5500000-0000-4000-8000-000000000004';
  const payment = 'a5500000-0000-4000-8000-000000000005';
  const env = { BOOKING_LUMIN_GOLDEN_FLOW: '1', BOOKING_LUMIN_API_BASE_URL: 'https://api.example.test', BOOKING_LUMIN_GOLDEN_TOKEN: 'synthetic-golden-token-1234', BOOKING_LUMIN_GOLDEN_ORIGIN: 'https://booking.example.test', TENANT_ID: tenant, SERVICE_ID: service, BOOKING_LUMIN_GOLDEN_SLOT_START: '2030-01-02T10:00:00.000Z', BOOKING_LUMIN_GOLDEN_SLOT_END: '2030-01-02T11:00:00.000Z', BOOKING_LUMIN_GOLDEN_IDEMPOTENCY_KEY: 'phase-a-golden-idempotency-key' };
  let phase = 0; const seen = []; const logs = [];
  const responses = [
    { ok: true, data: { schemaVersion: 1, profile: { id: tenant, name: 'Staging', slug: 'staging', timezone: 'UTC', currency: 'USD', status: 'active' } } },
    { ok: true, data: { schemaVersion: 1, serviceId: service, durationMinutes: 60, slots: [] } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, reference: 'BL-STAGING-1', state: 'draft' } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, reference: 'BL-STAGING-1', state: 'draft' } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, holdId: hold, status: 'active', expiresAt: '2030-01-02T10:05:00.000Z' } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, holdId: hold, status: 'active', expiresAt: '2030-01-02T10:05:00.000Z' } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, paymentId: payment, state: 'confirmed', replayed: false, provider: 'staging_mock', simulated: true } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, paymentId: payment, state: 'confirmed', replayed: true, provider: 'staging_mock', simulated: true } },
    { ok: true, data: { schemaVersion: 1, bookingId: booking, paymentId: payment, state: 'confirmed', replayed: true } },
  ];
  const fetchImpl = async (url, options) => { seen.push({ path: url.pathname, method: options.method, headers: options.headers }); const value = responses[phase++]; if (!value) throw new Error('unexpected extra request'); return Response.json(value, { headers: { 'content-type': 'application/json' } }); };
  await runGolden(env, { fetchImpl, log: value => logs.push(value) });
  assert.equal(phase, responses.length); assert.equal(seen[0].path, '/api/profile'); assert.equal(seen.at(-1).path, '/api/bookings/confirm'); assert.ok(seen.every(item => item.method === 'GET' || item.method === 'POST')); assert.ok(seen.every(item => item.headers.authorization === `Bearer ${env.BOOKING_LUMIN_GOLDEN_TOKEN}`)); assert.ok(!logs.join('\n').includes(env.BOOKING_LUMIN_GOLDEN_TOKEN)); assert.ok(!logs.join('\n').match(SECRET_FIELDS));
  await assert.rejects(runGolden({ ...env, BOOKING_LUMIN_GOLDEN_FLOW: undefined }, { fetchImpl: () => { throw new Error('must not fetch'); }, log: () => {} }), /CONFIG/);
  await assert.rejects(runGolden({ ...env, BOOKING_LUMIN_API_BASE_URL: 'https://user:secret@api.example.test' }, { fetchImpl: () => { throw new Error('must not fetch'); }, log: () => {} }), /invalid API root/);
  console.log('PASS offline staging golden-flow self-test: opt-in, bounded JSON, strict schemas, replay, redaction, no-default-network');
}

const help = `Usage: npm run golden:phase-a -- [--help|--self-test]
Requires BOOKING_LUMIN_GOLDEN_FLOW=1 plus API root, bearer token, tenant/service IDs,
origin, and explicit UTC slot bounds. This harness performs staging-only mutations;
it never enables itself by default and never prints credentials or customer fields.`;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else if (args.length === 1 && args[0] === '--self-test') await selfTest();
    else if (args.length) throw new Error('CONFIG: unsupported arguments; use --help');
    else await runGolden(process.env);
  } catch (error) { console.error(error instanceof Error ? error.message : 'golden flow failed'); process.exitCode = 1; }
}
