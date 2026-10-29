import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {OwnerBookingDetailReader} from './owner-bookings';

const actor = 'a5700000-0000-4000-8000-000000000001';
const tenant = 'a5700000-0000-4000-8000-000000000002';
const booking = 'a5700000-0000-4000-8000-000000000003';
let server: Server;
afterEach(async () => {server?.closeAllConnections(); if (server) await new Promise<void>((r) => server.close(() => r()));});

const valid = {
  tenantId: tenant, bookingId: booking,
  booking: {id: booking, reference: 'LMN-TEST', state: 'confirmed' as const, slotStart: '2026-10-20T10:00:00.000Z', slotEnd: '2026-10-20T11:00:00.000Z', total: null, notes: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z'},
  customer: null, payment: null, refunds: [], activity: [],
};

function base(ownerBookingDetail?: OwnerBookingDetailReader) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerBookingDetail,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: [],
    authenticateOwner: async (token) => (token === 'owner-token-123456' ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}
function get(qs: string, token = 'owner-token-123456') {
  return fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/bookings/detail${qs}`, {
    method: 'GET', headers: {origin: 'https://portal.example.test', authorization: `Bearer ${token}`},
  });
}

it('is unsupported when the reader is not wired', async () => {
  await base();
  expect((await get(`?tenantId=${tenant}&bookingId=${booking}`)).status).toBe(422);
});

it('authenticates and rejects malformed requests before dispatch', async () => {
  const read = vi.fn<OwnerBookingDetailReader>();
  await base(read);
  expect((await get(`?tenantId=${tenant}&bookingId=${booking}`, 'bad-token-1234567')).status).toBe(401);
  expect((await get(`?tenantId=${tenant}`)).status).toBe(400);
  expect((await get(`?tenantId=${tenant}&bookingId=${booking}&bookingId=${booking}`)).status).toBe(400);
  expect((await get(`?tenantId=${tenant}&bookingId=${booking}&foo=1`)).status).toBe(400);
  const port = (server.address() as {port: number}).port;
  const post = await fetch(`http://127.0.0.1:${port}/api/bookings/detail?tenantId=${tenant}&bookingId=${booking}`, {
    method: 'POST', headers: {origin: 'https://portal.example.test', authorization: 'Bearer owner-token-123456', 'content-type': 'application/json'}, body: '{}',
  });
  expect(post.status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});

it('returns the bound detail and rejects a tenant/booking mismatch from the reader', async () => {
  const read = vi.fn<OwnerBookingDetailReader>(async () => valid);
  await base(read);
  const res = await get(`?tenantId=${tenant}&bookingId=${booking.toUpperCase()}`);
  expect(res.status).toBe(200);
  expect((await res.json()).data.bookingId).toBe(booking);
  expect(read).toHaveBeenCalledWith(actor, tenant, booking);
  const mismatched = vi.fn<OwnerBookingDetailReader>(async () => ({...valid, bookingId: tenant}));
  await new Promise<void>((r) => server.close(() => r()));
  await base(mismatched);
  expect((await get(`?tenantId=${tenant}&bookingId=${booking}`)).status).toBe(500);
});
