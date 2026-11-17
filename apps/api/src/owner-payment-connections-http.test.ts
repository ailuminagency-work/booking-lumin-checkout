import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {OwnerPaymentConnectionsReader} from './owner-payment-connections';

const actor = 'a9900000-0000-4000-8000-000000000001';
const tenant = 'a9900000-0000-4000-8000-000000000002';
let server: Server;
afterEach(async () => {server?.closeAllConnections(); if (server) await new Promise<void>((r) => server.close(() => r()));});

const connection = {
  provider: 'stripe_connect',
  status: 'connected' as const,
  health: 'chargeable' as const,
  accountId: 'acct_1PxYzAbCdEfGhIjK',
  chargesEnabled: true,
  payoutsEnabled: true,
  onboardingComplete: true,
  blockedReason: null,
  lastObservedAt: '2026-11-08T09:00:00.000Z',
};

function base(ownerPaymentConnections?: OwnerPaymentConnectionsReader) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerPaymentConnections,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: [],
    authenticateOwner: async (token) => (token === 'owner-token-123456' ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}
function get(qs: string, token = 'owner-token-123456', method = 'GET') {
  return fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/payment-connections${qs}`, {
    method, headers: {origin: 'https://portal.example.test', authorization: `Bearer ${token}`},
  });
}

it('is UNSUPPORTED when the reader is not wired, so an unflagged deploy cannot reach it', async () => {
  // This is what the capability flag buys: with the flag off main.ts passes no
  // reader, and the route answers 422 rather than serving anything.
  await base();
  expect((await get(`?tenantId=${tenant}`)).status).toBe(422);
});

it('serves the tenant\'s connections to an authenticated member', async () => {
  const reader = vi.fn(async () => ({schemaVersion: 1 as const, tenantId: tenant, connections: [connection]}));
  await base(reader);
  const res = await get(`?tenantId=${tenant}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.connections[0].health).toBe('chargeable');
  expect(reader).toHaveBeenCalledWith(actor, tenant);
});

it('refuses an unauthenticated caller and never calls the reader', async () => {
  const reader = vi.fn(async () => ({schemaVersion: 1 as const, tenantId: tenant, connections: []}));
  await base(reader);
  expect((await get(`?tenantId=${tenant}`, 'wrong-token-123456')).status).toBe(401);
  expect(reader).not.toHaveBeenCalled();
});

it('is GET only — no method may reach the reader', async () => {
  const reader = vi.fn(async () => ({schemaVersion: 1 as const, tenantId: tenant, connections: []}));
  await base(reader);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await get(`?tenantId=${tenant}`, 'owner-token-123456', method);
    expect(res.status, method).not.toBe(200);
  }
  expect(reader).not.toHaveBeenCalled();
});

it('refuses every query parameter but tenantId', async () => {
  // The route takes tenantId alone; the global allowlist fallback must reject
  // the rest rather than silently ignoring them.
  const reader = vi.fn(async () => ({schemaVersion: 1 as const, tenantId: tenant, connections: []}));
  await base(reader);
  for (const qs of ['limit=5', 'before=2026-01-01', 'status=open', 'provider=stripe_connect', 'accountId=acct_x']) {
    const res = await get(`?tenantId=${tenant}&${qs}`);
    expect(res.status, qs).toBe(400);
  }
  expect(reader).not.toHaveBeenCalled();
});

it('refuses a reader answer for a different tenant', async () => {
  // Defence in depth against a reader returning someone else's rows.
  const other = 'a9900000-0000-4000-8000-00000000000f';
  await base(async () => ({schemaVersion: 1 as const, tenantId: other, connections: [connection]}));
  expect((await get(`?tenantId=${tenant}`)).status).toBe(500);
});

it('refuses a reader answer carrying an unknown field', async () => {
  await base(async () => ({schemaVersion: 1, tenantId: tenant, connections: [{...connection, secretKey: 'sk_live_x'}]}) as never);
  expect((await get(`?tenantId=${tenant}`)).status).toBe(500);
});

it('does not serve the route to a customer origin', async () => {
  const reader = vi.fn(async () => ({schemaVersion: 1 as const, tenantId: tenant, connections: []}));
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerPaymentConnections: reader,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: ['https://shop.example.test'],
    authenticateOwner: async (token) => (token === 'owner-token-123456' ? actor : null),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const res = await fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/payment-connections?tenantId=${tenant}`, {
    headers: {origin: 'https://shop.example.test', authorization: 'Bearer owner-token-123456'},
  });
  expect(res.status).not.toBe(200);
  expect(reader).not.toHaveBeenCalled();
});
