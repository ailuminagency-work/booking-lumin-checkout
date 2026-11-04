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
