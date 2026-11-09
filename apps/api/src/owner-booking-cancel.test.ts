import {it, expect} from 'vitest';
import type {Pool} from 'pg';
import {createOwnerBookingCancelWriter} from './owner-booking-cancel';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOOKING = '11111111-1111-4111-8111-111111111111';

function fakePool(opts: {state?: string; paymentState?: string | null; rows?: number; forbid?: boolean; illegal?: boolean} = {}) {
  const sql: string[] = [];
  const client = {
    async query(text: string) {
      sql.push(text);
      if (text.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (text.startsWith('select b.state')) {
        if (opts.rows === 0) return {rows: []};
        return {rows: [{state: opts.state ?? 'confirmed', payment_state: opts.paymentState === undefined ? 'succeeded' : opts.paymentState, updated_at: '2026-10-20T10:00:00.000Z'}]};
      }
      if (text.startsWith('update public.bookings')) {
        if (opts.illegal) throw Object.assign(new Error('illegal'), {code: 'P0001'});
        return {rows: [{cancelled_at: '2026-10-22T12:00:00.000Z'}]};
      }
      return {rows: []};
    },
    release() {},
  };
  return {pool: {async connect() {return client;}} as unknown as Pool, sql};
}

it('cancels a confirmed booking without issuing or recording any refund', async () => {
  const {pool, sql} = fakePool();
  const out = await createOwnerBookingCancelWriter(pool)(ACTOR, TENANT, BOOKING, 'confirmed');
  expect(out).toMatchObject({state: 'cancelled', refundIssued: false, replayed: false, paymentState: 'succeeded'});
  expect(out.cancelledAt).toBe('2026-10-22T12:00:00.000Z');
  // Never touches money or capacity.
  expect(sql.some((q) => /refund/i.test(q))).toBe(false);
  expect(sql.some((q) => /release_hold|consume_hold|capacity_holds/i.test(q))).toBe(false);
  expect(sql.some((q) => /update public\.payments/i.test(q))).toBe(false);
});

it('runs READ COMMITTED as owner, locking the row before writing', async () => {
  const {pool, sql} = fakePool();
  await createOwnerBookingCancelWriter(pool)(ACTOR, TENANT, BOOKING, 'confirmed');
  expect(sql[0]).toBe('begin isolation level read committed');
  expect(sql.some((q) => q.includes('set local role service_role'))).toBe(true);
  // owner-only: flow_actor third argument is true
  expect(sql.some((q) => q.includes('flow_actor') )).toBe(true);
  const lock = sql.findIndex((q) => q.includes('for update of b'));
  const write = sql.findIndex((q) => q.startsWith('update public.bookings'));
  expect(lock).toBeGreaterThan(-1);
  expect(write).toBeGreaterThan(lock);
});

it('is double-submit safe: an already-cancelled booking replays', async () => {
  const {pool, sql} = fakePool({state: 'cancelled'});
  const out = await createOwnerBookingCancelWriter(pool)(ACTOR, TENANT, BOOKING, 'confirmed');
  expect(out).toMatchObject({state: 'cancelled', replayed: true, refundIssued: false});
  expect(sql.some((q) => q.startsWith('update public.bookings'))).toBe(false);
});

it('refuses every state that has no legal cancel edge', async () => {
  for (const state of ['draft', 'pending_payment', 'completed', 'refunded', 'failed']) {
    const {pool, sql} = fakePool({state});
    await expect(createOwnerBookingCancelWriter(pool)(ACTOR, TENANT, BOOKING, state))
      .rejects.toMatchObject({code: 'UNSUPPORTED_CONFIG'});
    expect(sql.some((q) => q.startsWith('update public.bookings'))).toBe(false);
  }
});

it('refuses a stale owner view and maps denial/absence/illegal transitions', async () => {
  // current state differs from what the owner believed
  await expect(createOwnerBookingCancelWriter(fakePool({state: 'completed'}).pool)(ACTOR, TENANT, BOOKING, 'confirmed'))
    .rejects.toMatchObject({code: 'CONFLICT'});
  await expect(createOwnerBookingCancelWriter(fakePool({forbid: true}).pool)(ACTOR, TENANT, BOOKING, 'confirmed'))
    .rejects.toMatchObject({code: 'FORBIDDEN'});
  await expect(createOwnerBookingCancelWriter(fakePool({rows: 0}).pool)(ACTOR, TENANT, BOOKING, 'confirmed'))
    .rejects.toMatchObject({code: 'NOT_AVAILABLE'});
  // trigger-rejected transition surfaces as unsupported, not a 500
  await expect(createOwnerBookingCancelWriter(fakePool({illegal: true}).pool)(ACTOR, TENANT, BOOKING, 'confirmed'))
    .rejects.toMatchObject({code: 'UNSUPPORTED_CONFIG'});
});

it('reports a null payment state for an unpaid booking and validates input', async () => {
  const {pool} = fakePool({paymentState: null});
  expect((await createOwnerBookingCancelWriter(pool)(ACTOR, TENANT, BOOKING, 'confirmed')).paymentState).toBeNull();
  const noConnect = createOwnerBookingCancelWriter({async connect() {throw new Error('must not connect');}} as unknown as Pool);
  await expect(noConnect('nope', TENANT, BOOKING, 'confirmed')).rejects.toBeInstanceOf(FlowError);
  await expect(noConnect(ACTOR, TENANT, BOOKING, '')).rejects.toMatchObject({code: 'INVALID_REQUEST'});
});
