import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function runHostedOptionSmoke(env,{fetchImpl=fetch,now=Date.now(),createId=randomUUID}={}){

// Explicit opt-in, fixed isolated staging fixture, two contenders only.
assert.equal(env.BOOKING_LUMIN_OPTION_HOSTED_TEST, '1');
const base = 'https://booking-lumin-api-staging.onrender.com';
const origin = 'https://booking-lumin-checkout-staging.netlify.app';
const installation = 'c52f77b7-dcfd-4280-b52d-1714514873c8';
const service = 'fbdff55f-86f9-4260-b525-741f876aa1de';
const expectedSha=env.BOOKING_LUMIN_OPTION_EXPECTED_RELEASE_SHA;
assert.match(expectedSha??'',/^[0-9a-f]{40}$/);
// The legacy SLOT input is now only a search-window start, never a fabricated slot.
const from=env.BOOKING_LUMIN_OPTION_WINDOW_START??env.BOOKING_LUMIN_OPTION_SLOT;
assert.match(from??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
assert.equal(new Date(from).toISOString(),from);
assert.ok(Number.isFinite(now)&&Date.parse(from)>now);
const to=new Date(Date.parse(from)+86400000).toISOString();
assert.ok(Date.parse(to)-now<30*86400000);

async function call(path, body, token, requestOrigin = origin) {
  const response = await fetchImpl(base + path, {
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

const version=await call('/version');
assert.equal(version.status,200);
assert.deepEqual(version.value,{schemaVersion:1,service:'booking-lumin-api',environment:'staging',releaseSha:expectedSha});
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
  assert.equal(session.render.submissionMode,'paid_option_request');
  assert.equal(session.render.paymentMode,'staging_mock');
  assert.equal(session.render.service.id, service);
  assert.equal(session.render.service.price.amount, 12500);
  assert.equal(session.render.service.price.currency, 'USD');
  assert.equal(session.render.simulated, true);
  assert.equal(session.render.service.durationMinutes,60);
  assert.ok(typeof session.expiresAt==='string'&&Date.parse(session.expiresAt)>now);
  assert.ok(typeof session.sessionToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.sessionToken), 'Invalid session capability format');
  sessions.push(session);
}
const availabilityPath='/api/flow-sessions/availability?'+new URLSearchParams({from,to});
const availability=[];
for(const session of sessions){
 const value=receipt(await call(availabilityPath,undefined,session.sessionToken),['schemaVersion','serviceId','durationMinutes','slots']);
 assert.equal(value.schemaVersion,1);assert.equal(value.serviceId,service);assert.equal(value.durationMinutes,60);
 assert.ok(Array.isArray(value.slots)&&value.slots.length<=10080);
 const seen=new Set();
 for(const slot of value.slots){
  assert.deepEqual(Object.keys(slot).sort(),['end','remainingCapacity','start']);
  assert.ok(typeof slot.start==='string'&&typeof slot.end==='string');
  const a=Date.parse(slot.start),b=Date.parse(slot.end);
  assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&a>=Date.parse(from)&&a<=Date.parse(to)&&b-a===3600000);
  assert.ok(Number.isSafeInteger(slot.remainingCapacity)&&slot.remainingCapacity>0);
  const canonical=new Date(a).toISOString();assert.ok(!seen.has(canonical));seen.add(canonical);
 }
 availability.push(value.slots);
}
// A single-capacity common slot is required by this existing two-contender test.
// Availability does not reserve it; a later race may still reject the test safely.
const candidates=availability[0].filter(slot=>Date.parse(slot.start)<Date.parse(to)&&slot.remainingCapacity===1&&availability[1].some(other=>Date.parse(other.start)===Date.parse(slot.start)&&Date.parse(other.end)===Date.parse(slot.end)&&other.remainingCapacity===1)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
assert.ok(candidates.length>0,'No verified common single-capacity slot was returned');
const start=new Date(candidates[0].start).toISOString();
const bodies = sessions.map((_, i) => ({idempotencyKey: createId(), answers: {access: {choiceIds: ['key']}}, customer: {name: `Staging option concurrency ${i + 1}`, email: `option-race-${i + 1}@example.test`}, requestedStart: start}));
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
return {environment: 'isolated Booking Lumin staging', installation, service, start, references: requests, foreignOrigin: foreign.status, missingBearer: 401, invalidOption: invalid.status, changedAnswerReplay: changed.status, holdStatuses: holds.map(result => result.status), winner, bookingId, paymentId: payment.paymentId, paymentReplay: 'same payment and booking', result: 'PASS', releaseSha:expectedSha, ownerAcceptance:false, frontendAcceptance:false, portalVisibility:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runHostedOptionSmoke(process.env).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error('FAIL controlled hosted HOUSEKEEPING verification; inspect the current release, fixture and availability before any further attempt.');process.exitCode=1;});
}
