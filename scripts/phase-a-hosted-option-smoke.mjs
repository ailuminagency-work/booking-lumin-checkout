import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Explicit opt-in, fixed isolated staging fixture, two contenders only.
assert.equal(process.env.BOOKING_LUMIN_OPTION_HOSTED_TEST, '1');
const base = 'https://booking-lumin-api-staging.onrender.com';
const origin = 'https://booking-lumin-checkout-staging.netlify.app';
const installation = 'c52f77b7-dcfd-4280-b52d-1714514873c8';
const service = 'fbdff55f-86f9-4260-b525-741f876aa1de';
const start = process.env.BOOKING_LUMIN_OPTION_SLOT;
assert.match(start ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
assert.ok(Date.parse(start) > Date.now());
assert.ok(Date.parse(start) - Date.now() < 30 * 86400000);

async function call(path, body, token, requestOrigin = origin) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: {origin: requestOrigin, ...(body === undefined ? {} : {'content-type': 'application/json'}), ...(token ? {authorization: `Bearer ${token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    signal: AbortSignal.timeout(30000),
  });
  return {status: response.status, value: await response.json()};
}

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function receipt(result, keys) {
  assert.equal(result.status, 200);
  assert.equal(result.value.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['data', 'ok']);
  assert.ok(result.value.data && typeof result.value.data === 'object' && !Array.isArray(result.value.data));
  assert.deepEqual(Object.keys(result.value.data).sort(), [...keys].sort());
  return result.value.data;
}
function bookingFromReference(reference) {
  assert.ok(typeof reference === 'string' && /^LMN-[0-9A-F]{32}$/.test(reference), 'Invalid booking reference');
  const hex = reference.slice(4).toLowerCase();
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

assert.equal((await call('/health')).status, 200);
assert.equal((await call('/ready')).status, 200);
const foreign = await call(`/api/installations/${installation}/sessions`, {}, undefined, 'https://foreign.example.test');
assert.equal(foreign.status, 403);
const sessions = [];
for (let i = 0; i < 2; i++) {
  const result = await call(`/api/installations/${installation}/sessions`, {});
  assert.equal(result.status, 200);
  const session = result.value.data;
  assert.equal(session.render.renderSchemaVersion, 4);
  assert.equal(session.render.service.id, service);
  assert.equal(session.render.service.price.amount, 12500);
  assert.equal(session.render.service.price.currency, 'USD');
  assert.equal(session.render.simulated, true);
  assert.ok(typeof session.sessionToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.sessionToken), 'Invalid session capability format');
  sessions.push(session);
}
const bodies = sessions.map((_, i) => ({idempotencyKey: randomUUID(), answers: {access: {choiceIds: ['key']}}, customer: {name: `Staging option concurrency ${i + 1}`, email: `option-race-${i + 1}@example.test`}, requestedStart: start}));
assert.equal((await call('/api/flow-sessions/request', bodies[0])).status, 401);
const invalid = await call('/api/flow-sessions/request', {...bodies[0], answers: {access: {choiceIds: ['forged']}}}, sessions[0].sessionToken);
assert.equal(invalid.status, 400);
const requests = [];
for (let i = 0; i < 2; i++) {
  const result = await call('/api/flow-sessions/request', bodies[i], sessions[i].sessionToken);
  const saved = receipt(result, ['reference', 'state', 'confirmed']);
  assert.equal(saved.state, 'draft'); assert.equal(saved.confirmed, false);
  bookingFromReference(saved.reference);
  requests.push(saved.reference);
}
const changed = await call('/api/flow-sessions/request', {...bodies[0], answers: {access: {choiceIds: ['present']}}}, sessions[0].sessionToken);
assert.equal(changed.status, 409);
const holds = await Promise.all(sessions.map(session => call('/api/flow-sessions/hold', {}, session.sessionToken)));
assert.deepEqual(holds.map(result => result.status).sort(), [200, 409]);
const winner = holds.findIndex(result => result.status === 200);
const bookingId = bookingFromReference(requests[winner]);
const held = receipt(holds[winner], ['schemaVersion', 'bookingId', 'holdId', 'status', 'expiresAt']);
assert.equal(held.schemaVersion, 1); assert.equal(held.status, 'active');
assert.equal(held.bookingId, bookingId); assert.ok(uuid(held.holdId));
assert.ok(typeof held.expiresAt === 'string' && Date.parse(held.expiresAt) > Date.now());
const paid = await call('/api/flow-sessions/mock-payment', {}, sessions[winner].sessionToken);
const paymentKeys = ['schemaVersion', 'bookingId', 'paymentId', 'state', 'replayed', 'provider', 'simulated'];
const payment = receipt(paid, paymentKeys);
assert.equal(payment.schemaVersion, 1); assert.equal(payment.bookingId, bookingId);
assert.ok(uuid(payment.paymentId)); assert.equal(payment.replayed, false);
assert.equal(payment.state, 'confirmed');
assert.equal(payment.provider, 'staging_mock');
assert.equal(payment.simulated, true);
const replay = await call('/api/flow-sessions/mock-payment', {}, sessions[winner].sessionToken);
const repeated = receipt(replay, paymentKeys);
assert.equal(repeated.schemaVersion, 1); assert.equal(repeated.state, 'confirmed');
assert.equal(repeated.provider, 'staging_mock'); assert.equal(repeated.simulated, true);
assert.equal(repeated.replayed, true); assert.equal(repeated.paymentId, payment.paymentId);
assert.equal(repeated.bookingId, bookingId);
console.log(JSON.stringify({environment: 'isolated Booking Lumin staging', installation, service, start, references: requests, foreignOrigin: foreign.status, missingBearer: 401, invalidOption: invalid.status, changedAnswerReplay: changed.status, holdStatuses: holds.map(result => result.status), winner, bookingId, paymentId: payment.paymentId, paymentReplay: 'same payment and booking', result: 'PASS'}));
