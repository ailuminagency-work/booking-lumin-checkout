import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {OwnerBookingsListReader} from './owner-bookings';

const actor = 'a5700000-0000-4000-8000-000000000001';
const tenant = 'a5700000-0000-4000-8000-000000000002';
let server: Server;
afterEach(async () => {server?.closeAllConnections(); if (server) await new Promise<void>((r) => server.close(() => r()));});

function base(ownerBookings?: OwnerBookingsListReader) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerBookings,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: [],
    authenticateOwner: async (token) => (token === 'owner-token-123456' ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}
function get(qs: string, token = 'owner-token-123456') {
  return fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/bookings${qs}`, {
    method: 'GET', headers: {origin: 'https://portal.example.test', authorization: `Bearer ${token}`},
  });
}

it('is unsupported when the reader is not wired', async () => {
  await base();
  expect((await get(`?tenantId=${tenant}`)).status).toBe(422);
});

it('authenticates, and rejects disallowed params, bad values, and non-GET', async () => {
  const read = vi.fn<OwnerBookingsListReader>();
  await base(read);
  expect((await get(`?tenantId=${tenant}`, 'bad-token-1234567')).status).toBe(401);
  expect((await get(`?tenantId=${tenant}&foo=bar`)).status).toBe(400);
  expect((await get(`?tenantId=${tenant}&limit=0`)).status).toBe(400);
  expect((await get(`?tenantId=${tenant}&limit=101`)).status).toBe(400);
  expect((await get(`?tenantId=${tenant}&before=nope`)).status).toBe(400);
  const port = (server.address() as {port: number}).port;
  const post = await fetch(`http://127.0.0.1:${port}/api/bookings?tenantId=${tenant}`, {
    method: 'POST', headers: {origin: 'https://portal.example.test', authorization: 'Bearer owner-token-123456', 'content-type': 'application/json'}, body: '{}',
  });
  expect(post.status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});

it('returns the reader result, applying default and explicit pagination', async () => {
  const data = {tenantId: tenant, bookings: [], nextBefore: null};
  const read = vi.fn<OwnerBookingsListReader>(async () => data);
  await base(read);
  const res = await get(`?tenantId=${tenant}`);
  expect(res.status).toBe(200);
  expect((await res.json()).data).toEqual(data);
  expect(read).toHaveBeenCalledWith(actor, tenant, {limit: 25, before: null});
  await get(`?tenantId=${tenant}&limit=10&before=2026-10-18T09:00:00.000Z`);
  expect(read).toHaveBeenLastCalledWith(actor, tenant, {limit: 10, before: '2026-10-18T09:00:00.000Z'});
});
