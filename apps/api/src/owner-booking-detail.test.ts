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
  payment: {provider: 'staging_mock', state: 'succeeded', amount: '12500', currency: 'USD ', createdAt: '2026-10-06T23:55:05.000Z'},
};

// Trigger-maintained trail: insert row has from_state null.
const defaultHistory = [
  {id: 1, from_state: null, to_state: 'draft', reason: 'created', at: '2026-10-06T23:54:55.932Z'},
  {id: 2, from_state: 'draft', to_state: 'pending_payment', reason: null, at: '2026-10-06T23:55:00.000Z'},
  {id: 3, from_state: 'pending_payment', to_state: 'confirmed', reason: null, at: '2026-10-06T23:55:10.000Z'},
];

function fakePool(opts: {core?: unknown[]; receipts?: unknown[]; refunds?: unknown[]; history?: unknown[]; forbid?: boolean} = {}): Pool {
  const client = {
    async query(sql: string) {
      if (sql.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (sql.startsWith('select jsonb_build_object')) return {rows: opts.core ?? [{result: core}]};
      if (sql.startsWith('select channel')) return {rows: opts.receipts ?? []};
      if (sql.startsWith('select amount')) return {rows: opts.refunds ?? []};
      if (sql.includes('booking_state_history')) return {rows: opts.history ?? defaultHistory};
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
  // Real transitions from booking_state_history, newest first.
  expect(out.activity.map((a) => a.kind)).toEqual([
    'confirmation.delivered.email',
    'booking.confirmed',
    'payment.succeeded',
    'booking.pending_payment',
    'booking.created',
  ]);
});

it('omits the state entry for drafts and handles missing payment/customer', async () => {
  const draft = {booking: {...core.booking, state: 'draft', total: null}, customer: null, payment: null};
  const out = await createOwnerBookingDetailReader(fakePool({core: [{result: draft}],
    history: [{id: 1, from_state: null, to_state: 'draft', reason: 'created', at: '2026-10-06T23:54:55.932Z'}]}))(ACTOR, TENANT, BOOKING);
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

it('reports every real transition from the trail and falls back when the trail is empty', async () => {
  const read = createOwnerBookingDetailReader(fakePool({
    history: [
      {id: 1, from_state: null, to_state: 'draft', reason: 'created', at: '2026-10-01T00:00:00.000Z'},
      {id: 2, from_state: 'confirmed', to_state: 'cancelled', reason: 'owner cancelled', at: '2026-10-22T00:00:00.000Z'},
    ],
  }));
  const out = await read(ACTOR, TENANT, BOOKING);
  expect(out.activity[0]).toMatchObject({kind: 'booking.cancelled', detail: 'owner cancelled'});
  expect(out.activity.at(-1)).toMatchObject({kind: 'booking.created'});
  // Empty trail (pre-trigger rows) still reports creation, never an approximated state entry.
  const bare = await createOwnerBookingDetailReader(fakePool({history: [], receipts: [], refunds: []}))(ACTOR, TENANT, BOOKING);
  expect(bare.activity.filter((a) => a.kind === 'booking.created')).toHaveLength(1);
  expect(bare.activity.some((a) => a.detail === 'as of last update')).toBe(false);
});

it('orders same-instant transitions causally by trail id, not by state name', async () => {
  // Real staging data: draft->pending_payment and pending_payment->confirmed commit in
  // one transaction and share an identical `at`. Alphabetical tie-breaks would invert
  // a confirmed->cancelled pair, so the monotonic trail id is the only safe order.
  const same = '2026-10-05T22:03:26.536Z';
  const out = await createOwnerBookingDetailReader(fakePool({
    // payment sits between creation and the tied pair, so the assertion isolates the tie-break
    core: [{result: {...core, booking: {...core.booking, state: 'cancelled'}, payment: {...core.payment, createdAt: '2026-10-05T22:03:10.000Z'}}}],
    receipts: [], refunds: [],
    history: [
      {id: 70, from_state: null, to_state: 'draft', reason: 'created', at: '2026-10-05T22:03:07.120Z'},
      {id: 71, from_state: 'confirmed', to_state: 'cancelled', reason: null, at: same},
      {id: 72, from_state: 'cancelled', to_state: 'refunded', reason: null, at: same},
    ],
  }))(ACTOR, TENANT, BOOKING);
  // Newest first: the later trail id wins the tie even though 'cancelled' < 'refunded'.
  expect(out.activity.map((a) => a.kind)).toEqual([
    'booking.refunded',
    'booking.cancelled',
    'payment.succeeded',
    'booking.created',
  ]);
  // seq is an internal sort key and must never reach the contract.
  for (const entry of out.activity) expect(Object.keys(entry).sort()).toEqual(['at', 'detail', 'kind']);
});
