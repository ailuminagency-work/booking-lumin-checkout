import {it, expect} from 'vitest';
import type {Pool} from 'pg';
import {createOwnerBookingsListReader, createOwnerBookingDetailReader} from './owner-bookings';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id, reference: 'LMN-' + id.slice(0, 4), state: 'confirmed',
    slot_start: '2026-10-20T10:00:00.000Z', slot_end: '2026-10-20T11:00:00.000Z',
    customer_name: 'Jane Doe', total: {amount: 12500, currency: 'USD'},
    payment_state: 'succeeded', payment_provider: 'staging_mock',
    created_at: '2026-10-18T09:00:00.000Z', ...over,
  };
}

// Fake pool: records queries; LIST query returns `rows`; flow_actor can be forced to raise.
function fakePool(opts: {rows?: unknown[]; forbid?: boolean} = {}): {pool: Pool; queries: string[]} {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (sql.startsWith('select b.id')) return {rows: opts.rows ?? []};
      return {rows: []};
    },
    release() {},
  };
  const pool = {async connect() {return client;}} as unknown as Pool;
  return {pool, queries};
}

it('authorizes via flow_actor then lists tenant bookings, mapping fields', async () => {
  const {pool, queries} = fakePool({rows: [row(B1), row(B2, {state: 'pending_payment', payment_state: null, payment_provider: null, total: null})]});
  const read = createOwnerBookingsListReader(pool);
  const out = await read(ACTOR, TENANT, {limit: 2, before: null});
  expect(queries.some((q) => q.includes('set local role service_role'))).toBe(true);
  expect(queries.some((q) => q.includes('flow_actor'))).toBe(true);
  expect(out.tenantId).toBe(TENANT);
  expect(out.bookings).toHaveLength(2);
  expect(out.bookings[0]).toMatchObject({id: B1, state: 'confirmed', total: {amount: 12500, currency: 'USD'}, paymentState: 'succeeded'});
  expect(out.bookings[1]).toMatchObject({state: 'pending_payment', total: null, paymentState: null, paymentProvider: null});
  // Full page -> cursor advertised.
  expect(out.nextBefore).toBe('2026-10-18T09:00:00.000Z');
});

it('returns null cursor when the page is not full', async () => {
  const {pool} = fakePool({rows: [row(B1)]});
  const out = await createOwnerBookingsListReader(pool)(ACTOR, TENANT, {limit: 25, before: null});
  expect(out.bookings).toHaveLength(1);
  expect(out.nextBefore).toBeNull();
});

it('maps a membership denial (42501) to FORBIDDEN', async () => {
  const {pool} = fakePool({forbid: true});
  await expect(createOwnerBookingsListReader(pool)(ACTOR, TENANT, {limit: 25, before: null}))
    .rejects.toMatchObject({code: 'FORBIDDEN'});
});

it('rejects invalid input before connecting', async () => {
  const read = createOwnerBookingsListReader({async connect() {throw new Error('must not connect');}} as unknown as Pool);
  await expect(read('not-a-uuid', TENANT, {limit: 25, before: null})).rejects.toBeInstanceOf(FlowError);
  await expect(read(ACTOR, TENANT, {limit: 0, before: null})).rejects.toMatchObject({code: 'INVALID_REQUEST'});
  await expect(read(ACTOR, TENANT, {limit: 101, before: null})).rejects.toMatchObject({code: 'INVALID_REQUEST'});
  await expect(read(ACTOR, TENANT, {limit: 25, before: 'not-a-date'})).rejects.toMatchObject({code: 'INVALID_REQUEST'});
});

it('opens a write-capable snapshot, because flow_actor takes FOR SHARE locks', async () => {
  // REGRESSION PIN. Both readers once opened `repeatable read read only`. The
  // authorization predicate lumin.flow_actor takes FOR SHARE locks on
  // public.tenants and public.tenant_members, and a share lock cannot be acquired
  // in a read-only transaction: Postgres raises 25006 and every request 403s. The
  // fake pool below cannot reproduce that (it answers any flow_actor SQL), which is
  // exactly why this asserts on the transaction mode itself. See migration 0091 and
  // supabase/tests/owner_booking_authorization_tests.sql, which pin it against a
  // real database.
  const list = fakePool({rows: []});
  await createOwnerBookingsListReader(list.pool)(ACTOR, TENANT, {limit: 1, before: null});
  const listBegin = list.queries.find((q) => q.startsWith('begin'))!;
  expect(listBegin).toContain('repeatable read');
  expect(listBegin).not.toContain('read only');

  // The detail reader shares the pattern. It rejects an empty core row with
  // NOT_AVAILABLE, which is fine: the begin has already been recorded by then.
  const detail = fakePool({rows: []});
  await expect(createOwnerBookingDetailReader(detail.pool)(ACTOR, TENANT, B1)).rejects.toBeInstanceOf(FlowError);
  const detailBegin = detail.queries.find((q) => q.startsWith('begin'))!;
  expect(detailBegin).toContain('repeatable read');
  expect(detailBegin).not.toContain('read only');
});
