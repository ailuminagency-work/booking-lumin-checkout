import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {FlowError} from './repository';
import type {
  OwnerConnectionBeginWriter,
  OwnerConnectionResolveWriter,
} from './owner-payment-connection-write';

/**
 * The HTTP surface of the step-5 write path.
 *
 * Two POST routes that decide which merchant account a later charge would land
 * on. What is tested here is the SURFACE: that an unflagged deploy cannot reach
 * either writer, that only an authenticated owner-shaped request does, that the
 * request body is strict, and that a receipt for the wrong tenant or carrying a
 * field this contract does not name never reaches the browser.
 */

const actor = 'ab100000-0000-4000-8000-000000000001';
const tenant = 'ab100000-0000-4000-8000-000000000002';
const TOKEN = 'owner-token-123456';
let server: Server;
afterEach(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

const beginReceipt = {
  schemaVersion: 1 as const,
  tenantId: tenant,
  provider: 'staging_mock',
  handoffId: 'acct_mock_0123456789abcdef01234567',
  onboardingUrl: 'https://connect.mock.test/onboard/abc',
  expiresAt: '2026-11-09T12:00:00.000Z',
  replayed: false,
};
const resolveReceipt = {
  schemaVersion: 1 as const,
  tenantId: tenant,
  provider: 'staging_mock',
  accountId: 'acct_mock_0123456789abcdef01234567',
  status: 'connected' as const,
  health: 'chargeable' as const,
  chargesEnabled: true,
  payoutsEnabled: true,
  onboardingComplete: true,
  blockedReason: null,
  replayed: false,
};
const BEGIN_BODY = {
  returnUrl: 'https://portal.example.test/connections/return',
  refreshUrl: 'https://portal.example.test/connections/refresh',
  idempotencyKey: 'owner-attempt-0000001',
};
const RESOLVE_BODY = {handoffId: 'acct_mock_0123456789abcdef01234567'};

function base(writers: {
  ownerConnectionBegin?: OwnerConnectionBeginWriter;
  ownerConnectionResolve?: OwnerConnectionResolveWriter;
}, customerOrigins: string[] = []) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ...writers,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins,
    authenticateOwner: async (token) => (token === TOKEN ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}

function post(
  path: 'begin' | 'resolve',
  body: unknown,
  opts: {token?: string; method?: string; qs?: string; origin?: string} = {},
) {
  const port = (server.address() as {port: number}).port;
  const qs = opts.qs ?? `?tenantId=${tenant}`;
  const method = opts.method ?? 'POST';
  return fetch(`http://127.0.0.1:${port}/api/payment-connections/${path}${qs}`, {
    method,
    headers: {
      origin: opts.origin ?? 'https://portal.example.test',
      authorization: `Bearer ${opts.token ?? TOKEN}`,
      'content-type': 'application/json',
    },
    // fetch refuses a body on GET/HEAD, and the route must refuse those anyway.
    ...(method === 'GET' || method === 'HEAD' ? {} : {body: JSON.stringify(body)}),
  });
}

it('both routes are UNSUPPORTED when unwired, so an unflagged deploy cannot connect an account', async () => {
  // This is what BOOKING_LUMIN_PAYMENT_CONNECTION_WRITE buys. With the flag off
  // main.ts passes no writers and neither route can bind a merchant account.
  await base({});
  expect((await post('begin', BEGIN_BODY)).status).toBe(422);
  expect((await post('resolve', RESOLVE_BODY)).status).toBe(422);
});

it('begins a handoff for an authenticated owner and passes the body through unchanged', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  await base({ownerConnectionBegin});
  const res = await post('begin', BEGIN_BODY);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.onboardingUrl).toBe(beginReceipt.onboardingUrl);
  expect(body.data.replayed).toBe(false);
  expect(ownerConnectionBegin).toHaveBeenCalledWith(actor, tenant, BEGIN_BODY);
});

it('resolves a handoff and reports the status the database derived', async () => {
  const ownerConnectionResolve = vi.fn(async () => resolveReceipt);
  await base({ownerConnectionResolve});
  const res = await post('resolve', RESOLVE_BODY);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.status).toBe('connected');
  expect(body.data.health).toBe('chargeable');
  expect(ownerConnectionResolve).toHaveBeenCalledWith(actor, tenant, RESOLVE_BODY);
});

it('refuses an unauthenticated caller and never calls either writer', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  const ownerConnectionResolve = vi.fn(async () => resolveReceipt);
  await base({ownerConnectionBegin, ownerConnectionResolve});
  expect((await post('begin', BEGIN_BODY, {token: 'wrong-token-123456'})).status).toBe(401);
  expect((await post('resolve', RESOLVE_BODY, {token: 'wrong-token-123456'})).status).toBe(401);
  expect(ownerConnectionBegin).not.toHaveBeenCalled();
  expect(ownerConnectionResolve).not.toHaveBeenCalled();
});

it('is POST only — no other method may reach a writer', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  const ownerConnectionResolve = vi.fn(async () => resolveReceipt);
  await base({ownerConnectionBegin, ownerConnectionResolve});
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    expect((await post('begin', BEGIN_BODY, {method})).status, method).toBe(404);
    expect((await post('resolve', RESOLVE_BODY, {method})).status, method).toBe(404);
  }
  expect(ownerConnectionBegin).not.toHaveBeenCalled();
  expect(ownerConnectionResolve).not.toHaveBeenCalled();
});

it('refuses a begin body that is not exactly the contract', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  await base({ownerConnectionBegin});
  const bad: Array<[string, unknown]> = [
    ['no idempotency key', {returnUrl: BEGIN_BODY.returnUrl, refreshUrl: BEGIN_BODY.refreshUrl}],
    // A short key is a weak retry guard: two clicks would mint two accounts.
    ['short idempotency key', {...BEGIN_BODY, idempotencyKey: 'short'}],
    ['no return url', {refreshUrl: BEGIN_BODY.refreshUrl, idempotencyKey: BEGIN_BODY.idempotencyKey}],
    // The caller does not get to name the account, the provider, or the status.
    ['an account id', {...BEGIN_BODY, accountId: 'acct_someone_elses_0001'}],
    ['a provider', {...BEGIN_BODY, provider: 'stripe_connect'}],
    ['a status', {...BEGIN_BODY, status: 'connected'}],
    ['chargesEnabled', {...BEGIN_BODY, chargesEnabled: true}],
    ['a secret key', {...BEGIN_BODY, secretKey: 'sk_test_x'}],
    ['not an object', 'begin'],
    ['null', null],
  ];
  for (const [label, body] of bad) {
    expect((await post('begin', body)).status, label).toBe(400);
  }
  expect(ownerConnectionBegin).not.toHaveBeenCalled();
});

it('refuses a resolve body that is not exactly the contract', async () => {
  const ownerConnectionResolve = vi.fn(async () => resolveReceipt);
  await base({ownerConnectionResolve});
  const bad: Array<[string, unknown]> = [
    ['empty', {}],
    ['short handoff id', {handoffId: 'mch_x'}],
    // Resolve reports what the PROVIDER says. A caller asserting the outcome
    // would be asserting that a merchant account is chargeable.
    ['an asserted status', {...RESOLVE_BODY, status: 'connected'}],
    ['asserted charges', {...RESOLVE_BODY, chargesEnabled: true}],
    ['an account id', {...RESOLVE_BODY, accountId: 'acct_someone_elses_0001'}],
    ['a crlf handoff id', {handoffId: 'acct_mock_000\r\nX-Injected: 1'}],
  ];
  for (const [label, body] of bad) {
    expect((await post('resolve', body)).status, label).toBe(400);
  }
  expect(ownerConnectionResolve).not.toHaveBeenCalled();
});

it('requires exactly one tenantId and refuses every other query parameter', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  await base({ownerConnectionBegin});
  const bad = [
    '',
    '?tenantId=not-a-uuid',
    `?tenantId=${tenant}&tenantId=${tenant}`,
    `?tenantId=${tenant}&provider=stripe_connect`,
    `?tenantId=${tenant}&accountId=acct_x`,
    `?tenantId=${tenant}&status=connected`,
  ];
  for (const qs of bad) {
    expect((await post('begin', BEGIN_BODY, {qs})).status, qs || '(none)').toBe(400);
  }
  expect(ownerConnectionBegin).not.toHaveBeenCalled();
});

it('refuses a receipt for a different tenant', async () => {
  // Defence in depth: a writer that answered about someone else's business must
  // not have that answer forwarded to the browser.
  const other = 'ab100000-0000-4000-8000-00000000000f';
  await base({
    ownerConnectionBegin: async () => ({...beginReceipt, tenantId: other}),
    ownerConnectionResolve: async () => ({...resolveReceipt, tenantId: other}),
  });
  expect((await post('begin', BEGIN_BODY)).status).toBe(500);
  expect((await post('resolve', RESOLVE_BODY)).status).toBe(500);
});

it('refuses a receipt carrying a field this contract does not name', async () => {
  // The receipt is .strict() precisely so a provider secret or a raw API
  // response cannot ride out to the browser inside a success body.
  await base({
    ownerConnectionBegin: async () => ({...beginReceipt, secretKey: 'sk_test_leak'}) as never,
    ownerConnectionResolve: async () => ({...resolveReceipt, providerPayload: {secret: 'x'}}) as never,
  });
  expect((await post('begin', BEGIN_BODY)).status).toBe(500);
  expect((await post('resolve', RESOLVE_BODY)).status).toBe(500);
});

it('refuses a begin receipt whose onboarding url is not a url', async () => {
  // The owner is told to visit this. A non-url, or a javascript: payload, is a
  // broken handoff at best.
  await base({ownerConnectionBegin: async () => ({...beginReceipt, onboardingUrl: 'javascript:alert(1)'})});
  expect((await post('begin', BEGIN_BODY)).status).toBe(500);
});

it('refuses a resolve receipt whose status or reason is not in the contract', async () => {
  await base({ownerConnectionResolve: async () => ({...resolveReceipt, status: 'chargeable'}) as never});
  expect((await post('resolve', RESOLVE_BODY)).status).toBe(500);
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await base({ownerConnectionResolve: async () => ({...resolveReceipt, blockedReason: 'vibes'}) as never});
  expect((await post('resolve', RESOLVE_BODY)).status).toBe(500);
});

it('gives each writer failure its own HTTP status', async () => {
  // The status table is the user-visible half of the error mapping: an upstream
  // outage must not read as a Booking Lumin fault, and a malformed request must
  // not read as either.
  const cases: Array<[string, number]> = [
    ['INVALID_REQUEST', 400],
    ['PROVIDER_UNAVAILABLE', 503],
    ['NOT_AVAILABLE', 404],
    ['FORBIDDEN', 403],
    ['CONFLICT', 409],
    ['INTERNAL_ERROR', 500],
  ];
  for (const [code, status] of cases) {
    await base({ownerConnectionBegin: async () => {throw new FlowError(code as never);}});
    const res = await post('begin', BEGIN_BODY);
    expect(res.status, code).toBe(status);
    expect((await res.json()).code, code).toBe(code);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

it('does not serve either route to a customer origin', async () => {
  const ownerConnectionBegin = vi.fn(async () => beginReceipt);
  const ownerConnectionResolve = vi.fn(async () => resolveReceipt);
  await base({ownerConnectionBegin, ownerConnectionResolve}, ['https://shop.example.test']);
  for (const path of ['begin', 'resolve'] as const) {
    const res = await post(path, path === 'begin' ? BEGIN_BODY : RESOLVE_BODY, {origin: 'https://shop.example.test'});
    expect(res.status, path).not.toBe(200);
  }
  expect(ownerConnectionBegin).not.toHaveBeenCalled();
  expect(ownerConnectionResolve).not.toHaveBeenCalled();
});
