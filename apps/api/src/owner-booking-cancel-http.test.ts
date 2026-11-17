import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {OwnerBookingCancelWriter} from './owner-booking-cancel';

const actor = 'a5700000-0000-4000-8000-000000000001';
const tenant = 'a5700000-0000-4000-8000-000000000002';
const booking = 'a5700000-0000-4000-8000-000000000003';
let server: Server;
afterEach(async () => {server?.closeAllConnections(); if (server) await new Promise<void>((r) => server.close(() => r()));});

const receipt = {tenantId: tenant, bookingId: booking, state: 'cancelled' as const, cancelledAt: '2026-10-22T12:00:00.000Z', paymentState: 'succeeded', refundIssued: false as const, replayed: false};

function base(ownerBookingCancel?: OwnerBookingCancelWriter) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerBookingCancel,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: [],
    authenticateOwner: async (t) => (t === 'owner-token-123456' ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}
function post(body: unknown, token = 'owner-token-123456') {
  return fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/bookings/cancel?tenantId=${tenant}`, {
    method: 'POST', headers: {origin: 'https://portal.example.test', authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
}

it('is unsupported when the writer is not wired', async () => {
  await base();
  expect((await post({bookingId: booking, expectedState: 'confirmed'})).status).toBe(422);
});

it('authenticates and rejects caller-supplied money, state targets and extra fields', async () => {
  const write = vi.fn<OwnerBookingCancelWriter>();
  await base(write);
  expect((await post({bookingId: booking, expectedState: 'confirmed'}, 'bad-token-1234567')).status).toBe(401);
  for (const extra of [{refund: true}, {refundIssued: true}, {amount: 1}, {state: 'cancelled'}, {tenantId: tenant}, {paymentState: 'refunded'}]) {
    expect((await post({bookingId: booking, expectedState: 'confirmed', ...extra})).status).toBe(400);
  }
  expect((await post({bookingId: booking})).status).toBe(400);
  expect((await post({bookingId: booking, expectedState: 'not_a_state'})).status).toBe(400);
  expect((await post({expectedState: 'confirmed'})).status).toBe(400);
  expect(write).not.toHaveBeenCalled();
});

it('returns the receipt and refuses a writer that claims a refund was issued', async () => {
  const write = vi.fn<OwnerBookingCancelWriter>(async () => receipt);
  await base(write);
  const res = await post({bookingId: booking.toUpperCase(), expectedState: 'confirmed'});
  expect(res.status).toBe(200);
  const data = (await res.json()).data;
  expect(data).toMatchObject({state: 'cancelled', refundIssued: false, schemaVersion: 1});
  expect(write).toHaveBeenCalledWith(actor, tenant, booking, 'confirmed');
  // A writer returning refundIssued:true is a contract violation, not a success.
  await new Promise<void>((r) => server.close(() => r()));
  await base(vi.fn<OwnerBookingCancelWriter>(async () => ({...receipt, refundIssued: true as unknown as false})));
  expect((await post({bookingId: booking, expectedState: 'confirmed'})).status).toBe(500);
});

it('rejects non-POST', async () => {
  await base(vi.fn<OwnerBookingCancelWriter>(async () => receipt));
  const port = (server.address() as {port: number}).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/bookings/cancel?tenantId=${tenant}`, {
    method: 'GET', headers: {origin: 'https://portal.example.test', authorization: 'Bearer owner-token-123456'},
  });
  expect(res.status).toBe(404);
});
