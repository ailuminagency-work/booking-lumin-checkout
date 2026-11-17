/**
 * Parked payments reader, against a real disposable PostgreSQL.
 *
 * Migration 0090 parks a captured payment that cannot be confirmed, instead of
 * refunding it. Nothing could read that table until this reader, so this harness
 * exists to prove the thing a person depends on: that the queue is visible to
 * the tenant's own members, invisible to everyone else, and that the amounts
 * come back intact.
 */
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createOwnerPaymentReviewsReader} from './owner-payment-reviews';
if (process.env.FLOW_TEST_DISPOSABLE !== '1' || !/^lumin_/.test(process.env.PGDATABASE ?? '') || process.env.PGHOST !== '127.0.0.1') {
  throw Error('disposable loopback database required');
}
const pool = new Pool({max: 4});
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), staff = id(2), stranger = id(3), tenant = id(4), other = id(5), otherOwner = id(6);
try {
  await pool.query(
    "insert into auth.users(id,email) select id,'rev-'||i||'@example.test' from unnest($1::uuid[]) with ordinality t(id,i)",
    [[owner, staff, stranger, otherOwner]],
  );
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'Rev','rev-t','UTC','USD'),($2,'Other','rev-o','UTC','USD')",
    [tenant, other],
  );
  // 0092: one account, one business -- each tenant gets its own owner.
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')", [tenant, owner, staff]);
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [other, otherOwner]);
  await pool.query(
    "insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'S','simple','USD',12500,60)",
    [id(10), tenant],
  );
  // Three parks: two open in `tenant` (one per reason), one already resolved in `other`.
  for (const [t, b, p, ref, n] of [
    [tenant, id(20), id(30), 'LMN-AAA111', 0],
    [tenant, id(21), id(31), 'LMN-BBB222', 1],
    [other, id(22), id(32), 'LMN-CCC333', 2],
  ] as Array<[string, string, string, string, number]>) {
    await pool.query(
      "insert into public.bookings(id,tenant_id,reference,state,selection,pricing,slot_start,slot_end,idempotency_key) values($1,$2,$3,'confirmed','{}','{}',now()+interval '1 day',now()+interval '1 day 1 hour',$4)",
      [b, t, ref, 'parked-review-fixture-' + ref],
    );
    await pool.query(
      "insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1,$2,$3,'stripe_connect',$4,'processing',12500,'USD')",
      [p, t, b, 'pi_' + ref],
    );
    await pool.query(
      `insert into public.payment_reviews(payment_id,tenant_id,booking_id,reason,provider,provider_intent_id,expected_amount,observed_amount,currency,status,resolved_at,resolution_note)
       values($1,$2,$3,$4,'stripe_connect',$5,12500,$6,'USD',$7,$8,$9)`,
      [p, t, b, n === 1 ? 'capacity_oversold' : 'amount_mismatch', 'pi_' + ref,
        n === 1 ? null : 12000, n === 2 ? 'resolved_honoured' : 'open', n === 2 ? new Date() : null,
        n === 2 ? 'honoured by hand' : null],
    );
  }

  const read = createOwnerPaymentReviewsReader(pool);

  const open = await read(owner, tenant, {limit: 25, before: null, openOnly: true});
  assert.equal(open.tenantId, tenant);
  assert.equal(open.reviews.length, 2);
  assert.deepEqual(open.reviews.map((r) => r.bookingReference).sort(), ['LMN-AAA111', 'LMN-BBB222']);
  assert.deepEqual(open.reviews.map((r) => r.expectedAmount), [12500, 12500]);
  assert.ok(open.reviews.some((r) => r.reason === 'capacity_oversold' && r.observedAmount === null));
  assert.ok(open.reviews.some((r) => r.reason === 'amount_mismatch' && r.observedAmount === 12000));
  assert.equal(open.nextBefore, null);

  // Staff may SEE the queue. Reading is not the decision, and 0090 parks the
  // payment precisely so a person makes that decision elsewhere.
  assert.equal((await read(staff, tenant, {limit: 25, before: null, openOnly: true})).reviews.length, 2);

  // A stranger, and the owner of another business, are refused by flow_actor.
  for (const actor of [stranger, otherOwner]) {
    await assert.rejects(read(actor, tenant, {limit: 25, before: null, openOnly: true}),
      (e: unknown) => (e as {code?: string}).code === 'FORBIDDEN');
  }

  // Tenant scoping holds in both directions, and openOnly hides a resolved park.
  assert.equal((await read(owner, tenant, {limit: 25, before: null, openOnly: false})).reviews.length, 2);
  const allOther = await read(otherOwner, other, {limit: 25, before: null, openOnly: false});
  assert.equal(allOther.reviews.length, 1);
  assert.equal(allOther.reviews[0]!.status, 'resolved_honoured');
  assert.equal((await read(otherOwner, other, {limit: 25, before: null, openOnly: true})).reviews.length, 0);

  // Keyset paging: a cursor only on a full page, and it moves.
  const page = await read(owner, tenant, {limit: 1, before: null, openOnly: true});
  assert.equal(page.reviews.length, 1);
  assert.ok(page.nextBefore);
  const next = await read(owner, tenant, {limit: 1, before: page.nextBefore, openOnly: true});
  assert.equal(next.reviews.length, 1);
  assert.notEqual(next.reviews[0]!.paymentId, page.reviews[0]!.paymentId);

  // The reader wrote nothing: every park is exactly as seeded.
  assert.equal(Number((await pool.query('select count(*) n from public.payment_reviews')).rows[0].n), 3);
  assert.equal(Number((await pool.query("select count(*) n from public.payment_reviews where status='open'")).rows[0].n), 2);
  assert.equal(Number((await pool.query('select count(*) n from public.refunds')).rows[0].n), 0);

  console.log('PASS parked-payment reader on real PostgreSQL: tenant scoping both ways, owner+staff read, stranger/cross-business FORBIDDEN, open-vs-all filter, both park reasons, bigint amounts intact, keyset paging, and zero writes');
} finally {
  await pool.end();
}
