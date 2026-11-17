-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records and fixture allowlist rows roll back.
--
-- Pins migration 0090 and the invariant it exists to protect: Booking Lumin never
-- issues a refund automatically. A captured payment that cannot be confirmed is
-- PARKED for a human, and the park must be a decision point -- not a dead end and
-- not something a later automatic path can confirm.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'FAIL accepted forbidden operation: %',statement;
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values(pg_temp.id(1),'park-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values(pg_temp.id(3),'Park','payment-review-park-test','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,rental) values
 (pg_temp.id(5),pg_temp.id(3),'Simple','simple','USD',100,60,null);

-- ---- The review queue is server-authoritative -------------------------------
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'payment_reviews RLS enabled and FORCED')
 from pg_class where oid='public.payment_reviews'::regclass;
select pg_temp.assert(count(*)=0,'payment_reviews has no policies') from pg_policy where polrelid='public.payment_reviews'::regclass;
select pg_temp.assert(not bool_or(has_table_privilege(r,'public.payment_reviews',v)),
  'no client role holds any payment_reviews verb')
 from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) v;
-- A tenant must never be able to mark its own payment resolved, and nothing should
-- be able to erase the record of a money decision.
select pg_temp.assert(
  has_table_privilege('service_role','public.payment_reviews','select')
  and has_table_privilege('service_role','public.payment_reviews','insert')
  and has_table_privilege('service_role','public.payment_reviews','update')
  and not has_table_privilege('service_role','public.payment_reviews','delete'),
 'service_role may record and resolve a review but never delete one');

-- ---- The park state is not confirmable --------------------------------------
-- This is the load-bearing property. 'processing' was chosen precisely because
-- confirm_succeeded_payment requires 'succeeded', so no later automatic path can
-- turn parked money into a booking.
insert into public.confirmable_payment_providers(provider,note) values('park_suite','fixture-scoped; rolls back');
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end)
 values(pg_temp.id(10),pg_temp.id(3),pg_temp.id(10)::text,pg_temp.id(10)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-01T10:00Z','2035-05-01T11:00Z');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(110),pg_temp.id(3),pg_temp.id(10),'park_suite',pg_temp.id(110)::text,'processing',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(10),'2035-05-01T10:00Z','2035-05-01T11:00Z',pg_temp.id(10)::text,'active',clock_timestamp()+interval '5 minutes');
set local role service_role;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(110))','22023');
reset role;
select pg_temp.assert((select state='draft' from public.bookings where id=pg_temp.id(10)),'a parked payment leaves the booking untouched');

-- A review row records the evidence a person needs.
insert into public.payment_reviews(payment_id,tenant_id,booking_id,reason,provider,provider_intent_id,expected_amount,observed_amount,currency)
 values(pg_temp.id(110),pg_temp.id(3),pg_temp.id(10),'amount_mismatch','stripe','pi_park_suite',100,99,'USD');
select pg_temp.assert((select status='open' and resolved_at is null from public.payment_reviews where payment_id=pg_temp.id(110)),'a new review is open and unresolved');
-- The webhook upserts on payment_id, so a Stripe retry must not duplicate a review.
insert into public.payment_reviews(payment_id,tenant_id,booking_id,reason,provider,provider_intent_id,expected_amount,currency)
 values(pg_temp.id(110),pg_temp.id(3),pg_temp.id(10),'capacity_oversold','stripe','pi_park_suite',100,'USD')
 on conflict (payment_id) do nothing;
select pg_temp.assert((select count(*)=1 from public.payment_reviews where payment_id=pg_temp.id(110)),'a replayed webhook does not duplicate the review');
-- Resolution coherence: a resolved review must carry when, an open one must not.
select pg_temp.reject($q$update public.payment_reviews set status='resolved_refunded' where payment_id=pg_temp.id(110)$q$,'23514');
update public.payment_reviews set status='resolved_refunded',resolved_at=now() where payment_id=pg_temp.id(110);
select pg_temp.assert((select status='resolved_refunded' from public.payment_reviews where payment_id=pg_temp.id(110)),'a review resolves with a timestamp');

-- ---- Failure webhook ordering is compare-and-set and park-safe ---------------
-- A parked processing payment is a human decision point. A delayed failure must
-- not close its review, fail its booking, or release an already-released/active
-- hold.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(30),pg_temp.id(3),pg_temp.id(30)::text,pg_temp.id(30)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{}'::jsonb,
  '2035-05-03T10:00Z','2035-05-03T11:00Z','pending_payment');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(130),pg_temp.id(3),pg_temp.id(30),'stripe','pi_parked_failure','processing',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(30),'2035-05-03T10:00Z','2035-05-03T11:00Z',pg_temp.id(30)::text,'active',clock_timestamp()+interval '5 minutes');
insert into public.payment_reviews(payment_id,tenant_id,booking_id,reason,provider,provider_intent_id,expected_amount,currency)
 values(pg_temp.id(130),pg_temp.id(3),pg_temp.id(30),'amount_mismatch','stripe','pi_parked_failure',100,'USD');
set local role service_role;
select pg_temp.assert((public.fail_payment_webhook(pg_temp.id(130))->>'result')='IGNORED',
 'a parked processing payment ignores delayed failure');
reset role;
select pg_temp.assert((select state='processing' from public.payments where id=pg_temp.id(130)),
 'parked payment state is preserved');
select pg_temp.assert((select state='pending_payment' from public.bookings where id=pg_temp.id(30)),
 'parked booking remains non-terminal');
select pg_temp.assert((select status='active' from public.capacity_holds where booking_id=pg_temp.id(30)),
 'ignored parked failure does not release the hold');
select pg_temp.assert((select status='open' from public.payment_reviews where payment_id=pg_temp.id(130)),
 'ignored parked failure preserves the open review');

-- An unresolved requires_payment row can be failed exactly once. The second
-- delivery sees the compare-and-set miss and has no side effects.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(40),pg_temp.id(3),pg_temp.id(40)::text,pg_temp.id(40)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{}'::jsonb,
  '2035-05-04T10:00Z','2035-05-04T11:00Z','pending_payment');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(140),pg_temp.id(3),pg_temp.id(40),'stripe','pi_failure_once','requires_payment',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(40),'2035-05-04T10:00Z','2035-05-04T11:00Z',pg_temp.id(40)::text,'active',clock_timestamp()+interval '5 minutes');
set local role service_role;
select pg_temp.assert((public.fail_payment_webhook(pg_temp.id(140))->>'result')='FAILED',
 'first unresolved failure changes payment and booking');
select pg_temp.assert((public.fail_payment_webhook(pg_temp.id(140))->>'result')='IGNORED',
 'duplicate failure has no second effect');
reset role;
select pg_temp.assert((select state='failed' from public.payments where id=pg_temp.id(140)),
 'failed payment remains failed after replay');
select pg_temp.assert((select state='failed' from public.bookings where id=pg_temp.id(40)),
 'failed booking remains failed after replay');
select pg_temp.assert((select status='released' from public.capacity_holds where booking_id=pg_temp.id(40)),
 'hold is released once on first failure and unchanged on replay');

-- A succeeded payment is terminal; a stale failure cannot regress it or its
-- confirmed booking.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(50),pg_temp.id(3),pg_temp.id(50)::text,pg_temp.id(50)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{}'::jsonb,
  '2035-05-05T10:00Z','2035-05-05T11:00Z','confirmed');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(150),pg_temp.id(3),pg_temp.id(50),'stripe','pi_success_then_failure','succeeded',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(50),'2035-05-05T10:00Z','2035-05-05T11:00Z',pg_temp.id(50)::text,'consumed',clock_timestamp()+interval '5 minutes');
set local role service_role;
select pg_temp.assert((public.fail_payment_webhook(pg_temp.id(150))->>'result')='IGNORED',
 'stale failure cannot regress a succeeded payment');
reset role;
select pg_temp.assert((select state='succeeded' from public.payments where id=pg_temp.id(150)),
 'succeeded payment remains succeeded');
select pg_temp.assert((select state='confirmed' from public.bookings where id=pg_temp.id(50)),
 'confirmed booking remains confirmed');

-- ---- Refund and success deliveries serialize on the payment row ------------
-- Refund first: confirmation must reject the refunded payment and leave the
-- booking non-terminal. The provider label matches migration 0088's allowlist.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(60),pg_temp.id(3),pg_temp.id(60)::text,pg_temp.id(60)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-06T10:00Z','2035-05-06T11:00Z','pending_payment');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(160),pg_temp.id(3),pg_temp.id(60),'stripe_connect','pi_refund_before_confirm','succeeded',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(60),'2035-05-06T10:00Z','2035-05-06T11:00Z',pg_temp.id(60)::text,'active',clock_timestamp()+interval '5 minutes');
set local role service_role;
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(160),'re_before',100,true,true)->>'result')='RECORDED',
 'refund-before-confirm is recorded');
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(160))','22023');
reset role;
select pg_temp.assert((select state='refunded' from public.payments where id=pg_temp.id(160)),
 'refund-before-confirm leaves payment refunded');
select pg_temp.assert((select state='pending_payment' from public.bookings where id=pg_temp.id(60)),
 'refund-before-confirm leaves booking non-terminal');

-- Success first: the existing atomic confirmation RPC wins the payment lock,
-- then a refund reconciles against the confirmed booking. The final pair is
-- refunded/refunded, never refunded/confirmed, and a replay is deduped.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(70),pg_temp.id(3),pg_temp.id(70)::text,pg_temp.id(70)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-07T10:00Z','2035-05-07T11:00Z','pending_payment');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(170),pg_temp.id(3),pg_temp.id(70),'stripe_connect','pi_confirm_before_refund','succeeded',100,'USD');
insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(70),'2035-05-07T10:00Z','2035-05-07T11:00Z',pg_temp.id(70)::text,'active',clock_timestamp()+interval '5 minutes');
set local role service_role;
select pg_temp.assert((public.confirm_succeeded_payment(pg_temp.id(170))->>'state')='confirmed',
 'success-before-refund confirms atomically');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(170),'re_after',100,true,true)->>'result')='RECORDED',
 'refund-after-confirm is recorded');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(170),'re_after',100,true,true)->>'result')='IGNORED',
 'refund replay remains idempotent');
reset role;
select pg_temp.assert((select count(*)=1 from public.refunds where payment_id=pg_temp.id(170)),
 'refund replay does not duplicate the refund row');
select pg_temp.assert((select state='refunded' from public.payments where id=pg_temp.id(170)),
 'refund-after-confirm marks payment refunded');
select pg_temp.assert((select state='refunded' from public.bookings where id=pg_temp.id(70)),
 'refund-after-confirm transitions the confirmed booking to refunded');
select pg_temp.assert((select status='consumed' from public.capacity_holds where booking_id=pg_temp.id(70)),
 'refund-after-confirm does not release a consumed hold');

-- Cumulative partial->full reconciliation stores deltas, remains monotonic,
-- and ignores an out-of-order older partial event after the full refund.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(80),pg_temp.id(3),pg_temp.id(80)::text,pg_temp.id(80)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-08T10:00Z','2035-05-08T11:00Z','confirmed');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(180),pg_temp.id(3),pg_temp.id(80),'stripe_connect','pi_partial_then_full','succeeded',100,'USD');
set local role service_role;
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(180),'re_partial',30,false,true)->>'result')='RECORDED',
 'partial refund is recorded');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(180),'re_full',100,true,true)->>'result')='RECORDED',
 'full cumulative refund records only the remaining delta');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(180),'re_old',30,false,true)->>'result')='IGNORED',
 'out-of-order older cumulative refund is ignored');
reset role;
select pg_temp.assert((select sum(amount)=100 and count(*)=2 from public.refunds where payment_id=pg_temp.id(180)),
 'partial and full refund rows sum to the payment exactly');
select pg_temp.assert((select state='refunded' from public.payments where id=pg_temp.id(180)),
 'full cumulative refund remains terminal after an older event');
select pg_temp.assert((select state='refunded' from public.bookings where id=pg_temp.id(80)),
 'full cumulative refund transitions the confirmed booking once');

-- Bare Refund objects carry individual amounts, not amount_refunded totals.
-- Deliver them out of the usual order (70 then 30): the authority must add
-- both deltas, derive the final full state, and dedupe a replay by provider id.
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(90),pg_temp.id(3),pg_temp.id(90)::text,pg_temp.id(90)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-09T10:00Z','2035-05-09T11:00Z','confirmed');
insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(190),pg_temp.id(3),pg_temp.id(90),'stripe_connect','pi_bare_refunds','succeeded',100,'USD');
set local role service_role;
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(190),'re_bare_70',70,false,false)->>'result')='RECORDED',
 'first bare Refund records its individual delta');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(190),'re_bare_30',30,false,false)->>'result')='RECORDED',
 'second bare Refund completes the accumulated total');
select pg_temp.assert((public.record_refund_webhook(pg_temp.id(190),'re_bare_70',70,false,false)->>'result')='IGNORED',
 'bare Refund replay is deduped by provider refund id');
reset role;
select pg_temp.assert((select sum(amount)=100 and count(*)=2 from public.refunds where payment_id=pg_temp.id(190)),
 'bare Refund deltas sum to the payment exactly');
select pg_temp.assert((select state='refunded' from public.payments where id=pg_temp.id(190)),
 'bare Refund deltas derive the terminal payment state');
select pg_temp.assert((select state='refunded' from public.bookings where id=pg_temp.id(90)),
 'bare Refund deltas transition the confirmed booking once');

-- ---- The park must remain a DECISION POINT, not a dead end ------------------
-- 0090 deliberately leaves the booking non-terminal. Pin the two facts that make
-- that correct, so a later change to the transition table cannot silently turn a
-- parked booking into stranded money.
create function pg_temp.transition(from_state text,to_state text) returns boolean language plpgsql as $$
declare ok boolean;
begin
 begin
  execute format('update public.bookings set state=%L where id=%L',to_state,pg_temp.id(20));
  ok := true;
 exception when others then ok := false;
 end;
 return ok;
end$$;
insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state)
 values(pg_temp.id(20),pg_temp.id(3),pg_temp.id(20)::text,pg_temp.id(20)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  '2035-05-02T10:00Z','2035-05-02T11:00Z','pending_payment');
savepoint before_honour;
select pg_temp.assert(pg_temp.transition('pending_payment','confirmed'),'a reviewer can still HONOUR a parked booking (pending_payment -> confirmed)');
rollback to savepoint before_honour;
savepoint before_fail;
select pg_temp.assert(pg_temp.transition('pending_payment','failed'),'a reviewer can still FAIL a parked booking (pending_payment -> failed)');
-- ...and once failed it is terminal, which is exactly why 0090 does not move the
-- booking itself: doing so with the money still captured would strand it.
select pg_temp.assert(not pg_temp.transition('failed','confirmed'),'failed is terminal, so the park must not pre-empt the decision');
rollback to savepoint before_fail;

rollback;
\echo 'payment review park PASS (fixtures and fixture allowlist rows rolled back)'
