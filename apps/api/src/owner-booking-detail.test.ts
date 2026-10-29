import {it, expect} from 'vitest';
import type {Pool} from 'pg';
import {createOwnerBookingDetailReader} from './owner-bookings';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOOKING = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';

const core = {
  booking: {
    id: BOOKING, reference: 'LMN-1111', state: 'confirmed',
    slotStart: '2026-10-20T10:00:00.000Z', slotEnd: '2026-10-20T11:00:00.000Z',
    total: {amount: 12500, currency: 'USD'}, notes: null,
    createdAt: '2026-10-06T23:54:55.932Z', updatedAt: '2026-10-06T23:55:13.170Z',
  },
  customer: {id: CUSTOMER, name: 'Jane Doe', email: 'jane@example.test', phone: null},
  // bigint comes back from pg as a string; currency as padded char — the reader must normalize both.
  payment: {provider: 'staging_mock', state: 'succeeded', amount: '12500', currency: 'USD ', createdAt: '2026-10-06T23:55:00.000Z'},
};

function fakePool(opts: {core?: unknown[]; receipts?: unknown[]; refunds?: unknown[]; forbid?: boolean} = {}): Pool {
  const client = {
    async query(sql: string) {
      if (sql.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (sql.startsWith('select jsonb_build_object')) return {rows: opts.core ?? [{result: core}]};
      if (sql.startsWith('select channel')) return {rows: opts.receipts ?? []};
      if (sql.startsWith('select amount')) return {rows: opts.refunds ?? []};
      return {rows: []};
    },
    release() {},
  };
  return {async connect() {return client;}} as unknown as Pool;
}

it('returns booking core, customer, normalized payment, and a persisted-fact activity timeline (newest first)', async () => {
  const pool = fakePool({receipts: [{channel: 'email', delivered_at: '2026-10-17T00:12:00.000Z'}]});
  const out = await createOwnerBookingDetailReader(pool)(ACTOR, TENANT, BOOKING);
  expect(out.tenantId).toBe(TENANT);
  expect(out.bookingId).toBe(BOOKING);
  expect(out.booking).toMatchObject({state: 'confirmed', total: {amount: 12500, currency: 'USD'}});
  expect(out.customer).toMatchObject({name: 'Jane Doe', phone: null});
  expect(out.payment).toMatchObject({provider: 'staging_mock', state: 'succeeded', amount: 12500, currency: 'USD'});
  expect(out.refunds).toEqual([]);
  expect(out.activity.map((a) => a.kind)).toEqual([
    'confirmation.delivered.email',
    'booking.state.confirmed',
    'payment.succeeded',
    'booking.created',
  ]);
});

it('omits the state entry for drafts and handles missing payment/customer', async () => {
  const draft = {booking: {...core.booking, state: 'draft', total: null}, customer: null, payment: null};
  const out = await createOwnerBookingDetailReader(fakePool({core: [{result: draft}]}))(ACTOR, TENANT, BOOKING);
  expect(out.customer).toBeNull();
  expect(out.payment).toBeNull();
  expect(out.activity.map((a) => a.kind)).toEqual(['booking.created']);
});

it('includes refunds as display-only activity', async () => {
  const pool = fakePool({refunds: [{amount: '500', currency: 'USD', reason: 'manual goodwill', provider: null, created_at: '2026-10-21T00:00:00.000Z'}]});
  const out = await createOwnerBookingDetailReader(pool)(ACTOR, TENANT, BOOKING);
  expect(out.refunds[0]).toMatchObject({amount: 500, reason: 'manual goodwill'});
  expect(out.activity[0]).toMatchObject({kind: 'refund.recorded', detail: 'manual goodwill'});
});

it('maps not-found to NOT_AVAILABLE and membership denial to FORBIDDEN', async () => {
  await expect(createOwnerBookingDetailReader(fakePool({core: []}))(ACTOR, TENANT, BOOKING))
    .rejects.toMatchObject({code: 'NOT_AVAILABLE'});
  await expect(createOwnerBookingDetailReader(fakePool({forbid: true}))(ACTOR, TENANT, BOOKING))
    .rejects.toMatchObject({code: 'FORBIDDEN'});
});

it('rejects invalid identities before connecting', async () => {
  const read = createOwnerBookingDetailReader({async connect() {throw new Error('must not connect');}} as unknown as Pool);
  await expect(read('nope', TENANT, BOOKING)).rejects.toBeInstanceOf(FlowError);
  await expect(read(ACTOR, TENANT, 'nope')).rejects.toMatchObject({code: 'INVALID_REQUEST'});
});
