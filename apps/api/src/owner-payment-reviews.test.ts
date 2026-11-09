import {it, expect} from 'vitest';
import type {Pool} from 'pg';
import {createOwnerPaymentReviewsReader} from './owner-payment-reviews';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const BK = '33333333-3333-4333-8333-333333333333';

function row(paymentId: string, over: Record<string, unknown> = {}) {
  return {
    payment_id: paymentId, booking_id: BK, booking_reference: 'LMN-3F8K2Q',
    reason: 'amount_mismatch', provider: 'stripe_connect', provider_intent_id: 'pi_test_1',
    // bigint arrives from pg as a string.
    expected_amount: '12500', observed_amount: '12000',
    currency: 'USD', status: 'open', resolution_note: null,
    created_at: '2026-11-04T09:00:00.000Z', resolved_at: null, ...over,
  };
}

function fakePool(opts: {rows?: unknown[]; forbid?: boolean} = {}): {pool: Pool; queries: string[]; params: unknown[][]} {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (values) params.push(values);
      if (sql.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (sql.startsWith('select r.payment_id')) return {rows: opts.rows ?? []};
      return {rows: []};
    },
    release() {},
  };
  return {pool: {async connect() {return client;}} as unknown as Pool, queries, params};
}

it('authorizes via flow_actor, then lists the tenant\'s parked payments', async () => {
  const {pool, queries, params} = fakePool({rows: [row(P1), row(P2, {reason: 'capacity_oversold', observed_amount: null})]});
  const out = await createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 2, before: null, openOnly: true});
  expect(queries.some((q) => q.includes('set local role service_role'))).toBe(true);
  expect(queries.some((q) => q.includes('flow_actor'))).toBe(true);
  expect(out.tenantId).toBe(TENANT);
  expect(out.reviews).toHaveLength(2);
  expect(out.reviews[0]).toMatchObject({
    paymentId: P1, bookingId: BK, bookingReference: 'LMN-3F8K2Q', reason: 'amount_mismatch',
    provider: 'stripe_connect', providerIntentId: 'pi_test_1',
    expectedAmount: 12500, observedAmount: 12000, currency: 'USD', status: 'open',
  });
  // A capacity_oversold park has no observed amount to report.
  expect(out.reviews[1]!.observedAmount).toBeNull();
  // Full page -> a cursor; the cursor is the last row's created_at.
  expect(out.nextBefore).toBe('2026-11-04T09:00:00.000Z');
  // The tenant is always the SERVER's, never a row's.
  expect(params.some((p) => p[0] === TENANT)).toBe(true);
});

it('is read-only: it issues no INSERT, UPDATE, DELETE or refund of any kind', async () => {
  const {pool, queries} = fakePool({rows: [row(P1)]});
  await createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 10, before: null, openOnly: true});
  const sql = queries.join('\n').toLowerCase();
  for (const forbidden of ['insert', 'update ', 'delete', 'refund']) {
    expect(sql, `reader must not ${forbidden}`).not.toContain(forbidden);
  }
  expect(queries.some((q) => q === 'commit')).toBe(true);
});

it('opens repeatable read but NOT read only, because flow_actor takes FOR SHARE locks', async () => {
  // Regression pin for migration 0091: a `read only` transaction cannot take a
  // share lock and fails with 25006, which made the owner readers 403 from the
  // day they shipped.
  const {pool, queries} = fakePool();
  await createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 5, before: null, openOnly: true});
  const begin = queries.find((q) => q.startsWith('begin'));
  expect(begin).toContain('repeatable read');
  expect(begin).not.toContain('read only');
});

it('maps a flow_actor refusal to FORBIDDEN and rolls back', async () => {
  const {pool, queries} = fakePool({forbid: true});
  await expect(createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 5, before: null, openOnly: true}))
    .rejects.toMatchObject({code: 'FORBIDDEN'});
  expect(queries.some((q) => q === 'rollback')).toBe(true);
});

it('filters to the open queue by default and widens only when asked', async () => {
  const open = fakePool();
  await createOwnerPaymentReviewsReader(open.pool)(ACTOR, TENANT, {limit: 5, before: null, openOnly: true});
  expect(open.params.at(-1)).toEqual([TENANT, null, 5, true]);
  const all = fakePool();
  await createOwnerPaymentReviewsReader(all.pool)(ACTOR, TENANT, {limit: 5, before: null, openOnly: false});
  expect(all.params.at(-1)).toEqual([TENANT, null, 5, false]);
});

it('refuses malformed input before touching the database', async () => {
  const {pool, queries} = fakePool();
  const read = createOwnerPaymentReviewsReader(pool);
  for (const bad of [
    () => read('not-a-uuid', TENANT, {limit: 5, before: null, openOnly: true}),
    () => read(ACTOR, 'not-a-uuid', {limit: 5, before: null, openOnly: true}),
    () => read(ACTOR, TENANT, {limit: 0, before: null, openOnly: true}),
    () => read(ACTOR, TENANT, {limit: 101, before: null, openOnly: true}),
    () => read(ACTOR, TENANT, {limit: 5, before: 'tomorrow', openOnly: true}),
    () => read(ACTOR, TENANT, {limit: 5, before: null, openOnly: 'yes' as unknown as boolean}),
  ]) {
    await expect(bad()).rejects.toBeInstanceOf(FlowError);
  }
  expect(queries).toHaveLength(0);
});

it('refuses an amount that would lose precision rather than reporting a wrong one', async () => {
  // expected_amount is bigint. A value past Number.MAX_SAFE_INTEGER must not be
  // silently rounded into a money figure a person then acts on.
  const {pool} = fakePool({rows: [row(P1, {expected_amount: '9007199254740993'})]});
  await expect(createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 5, before: null, openOnly: true}))
    .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
});

it('advertises no cursor on a short page', async () => {
  const {pool} = fakePool({rows: [row(P1)]});
  const out = await createOwnerPaymentReviewsReader(pool)(ACTOR, TENANT, {limit: 25, before: null, openOnly: true});
  expect(out.nextBefore).toBeNull();
});
