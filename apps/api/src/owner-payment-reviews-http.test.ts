import {afterEach, it, expect, vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {OwnerPaymentReviewsReader} from './owner-payment-reviews';

const actor = 'a5800000-0000-4000-8000-000000000001';
const tenant = 'a5800000-0000-4000-8000-000000000002';
const payment = 'a5800000-0000-4000-8000-000000000003';
const booking = 'a5800000-0000-4000-8000-000000000004';
let server: Server;
afterEach(async () => {server?.closeAllConnections(); if (server) await new Promise<void>((r) => server.close(() => r()));});

const review = {
  paymentId: payment, bookingId: booking, bookingReference: 'LMN-3F8K2Q',
  reason: 'amount_mismatch' as const, provider: 'stripe_connect', providerIntentId: 'pi_test_1',
  expectedAmount: 12500, observedAmount: 12000, currency: 'USD', status: 'open' as const,
  resolutionNote: null, createdAt: '2026-11-04T09:00:00.000Z', resolvedAt: null,
};

function base(ownerPaymentReviews?: OwnerPaymentReviewsReader) {
  server = createFlowHttpServer({
    repository: {call: async () => {throw Error('unexpected');}},
    ownerPaymentReviews,
    ownerOrigins: ['https://portal.example.test'],
    customerOrigins: [],
    authenticateOwner: async (token) => (token === 'owner-token-123456' ? actor : null),
  });
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
}
function get(qs: string, token = 'owner-token-123456', method = 'GET') {
  return fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/payment-reviews${qs}`, {
    method, headers: {origin: 'https://portal.example.test', authorization: `Bearer ${token}`},
  });
}

it('is unsupported when the reader is not wired, so a production deploy cannot reach it by accident', async () => {
  await base();
  expect((await get(`?tenantId=${tenant}`)).status).toBe(422);
});

it('authenticates, and refuses a forged token before calling the reader', async () => {
  const reader = vi.fn<OwnerPaymentReviewsReader>();
  await base(reader);
  expect((await get(`?tenantId=${tenant}`, 'forged-token-123456')).status).toBe(401);
  expect(reader).not.toHaveBeenCalled();
});

it('refuses non-GET, repeated params, bad limits and an unparsable cursor', async () => {
  const reader = vi.fn<OwnerPaymentReviewsReader>();
  await base(reader);
  for (const [qs, method] of [
    [`?tenantId=${tenant}`, 'POST'],
    [`?tenantId=${tenant}&limit=1&limit=2`, 'GET'],
    [`?tenantId=${tenant}&before=a&before=b`, 'GET'],
    [`?tenantId=${tenant}&status=open&status=all`, 'GET'],
    [`?tenantId=${tenant}&limit=0`, 'GET'],
    [`?tenantId=${tenant}&limit=101`, 'GET'],
    [`?tenantId=${tenant}&limit=2.5`, 'GET'],
    [`?tenantId=${tenant}&before=tomorrow`, 'GET'],
    [`?tenantId=${tenant}&status=resolved`, 'GET'],
  ] as Array<[string, string]>) {
    const r = await get(qs, 'owner-token-123456', method);
    expect([400, 404], `${method} ${qs} -> ${r.status}`).toContain(r.status);
  }
  expect(reader).not.toHaveBeenCalled();
});

it('defaults to the open queue and passes the server tenant, never a body or row tenant', async () => {
  const reader = vi.fn<OwnerPaymentReviewsReader>()
    .mockResolvedValue({tenantId: tenant, reviews: [review], nextBefore: null});
  await base(reader);
  const r = await get(`?tenantId=${tenant}`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ok: true, data: {tenantId: tenant, reviews: [review], nextBefore: null}});
  expect(reader).toHaveBeenCalledWith(actor, tenant, {limit: 25, before: null, openOnly: true});
});

it('widens past the open queue only on an explicit status=all', async () => {
  const reader = vi.fn<OwnerPaymentReviewsReader>()
    .mockResolvedValue({tenantId: tenant, reviews: [], nextBefore: null});
  await base(reader);
  expect((await get(`?tenantId=${tenant}&status=all&limit=50`)).status).toBe(200);
  expect(reader).toHaveBeenCalledWith(actor, tenant, {limit: 50, before: null, openOnly: false});
  expect((await get(`?tenantId=${tenant}&status=open`)).status).toBe(200);
  expect(reader).toHaveBeenLastCalledWith(actor, tenant, {limit: 25, before: null, openOnly: true});
});

it('refuses a reader whose payload claims a different tenant', async () => {
  const reader = vi.fn<OwnerPaymentReviewsReader>()
    .mockResolvedValue({tenantId: 'a5800000-0000-4000-8000-0000000000ff', reviews: [], nextBefore: null});
  await base(reader);
  expect((await get(`?tenantId=${tenant}`)).status).toBe(500);
});
