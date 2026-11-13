-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records and the fixture's own allowlist rows roll back.
--
-- Pins migration 0088: public.confirm_succeeded_payment -- the SOLE writer that
-- commits a booking against a payment -- refuses any provider this deployment has
-- not declared confirmable in public.confirmable_payment_providers, and the
-- allowlist itself is unreachable from every client role.
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
 select ('88000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values(pg_temp.id(1),'provenance-owner@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values(pg_temp.id(3),'Provenance','payment-provenance-test','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER');
insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,rental) values
 (pg_temp.id(5),pg_temp.id(3),'Simple','simple','USD',100,60,null);

-- ---- Posture: the money gate is not editable or even readable by a client ----
select pg_temp.assert(relrowsecurity and relforcerowsecurity,'allowlist RLS enabled and FORCED')
 from pg_class where oid='public.confirmable_payment_providers'::regclass;
select pg_temp.assert(count(*)=0,'allowlist has no policies') from pg_policy where polrelid='public.confirmable_payment_providers'::regclass;
select pg_temp.assert(
  has_table_privilege('service_role','public.confirmable_payment_providers','select')
  and not has_table_privilege('service_role','public.confirmable_payment_providers','insert')
  and not has_table_privilege('service_role','public.confirmable_payment_providers','update')
  and not has_table_privilege('service_role','public.confirmable_payment_providers','delete'),
 'service_role reads the allowlist and can never write it');
select pg_temp.assert(not bool_or(has_table_privilege(r,'public.confirmable_payment_providers',v)),
  'no client role holds any allowlist verb')
 from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) v;
-- Even a granted role without BYPASSRLS reads nothing: forced RLS with no policies.
do $$begin if not exists(select 1 from pg_roles where rolname='provenance_rls_probe') then create role provenance_rls_probe nologin; end if; end$$;
grant select on public.confirmable_payment_providers to provenance_rls_probe;
set local role provenance_rls_probe;
select pg_temp.assert(count(*)=0,'a granted non-BYPASSRLS role reads no allowlist row') from public.confirmable_payment_providers;
reset role;

-- The app-side half of the gate (apps/api/src/simulated-payment-readiness.ts)
-- asks this exact question as service_role, which holds BYPASSRLS, and refuses
-- to serve outside staging when it comes back non-empty. Pin that service_role
-- really reads through forced RLS with no policies: if it silently read nothing,
-- the readiness guard would report a clean bill of health forever.
-- The array below must match SIMULATED_PROVIDERS in that module exactly.
set local role service_role;
select pg_temp.assert(
  (select coalesce(string_agg(provider,',' order by provider),'')
     from public.confirmable_payment_providers where provider = any(array['staging_mock','fixture']::text[]))
   = (case when current_database() ~ '^lumin_' then 'fixture,staging_mock' else '' end),
 'service_role sees the simulated-provider rows the readiness guard asks about');
reset role;

-- The real provider is seeded in every deployment; simulated evidence is
-- confirmable ONLY where the database name marks it disposable.
select pg_temp.assert(exists(select 1 from public.confirmable_payment_providers where provider='stripe_connect'),'stripe_connect seeded everywhere');
-- The WHOLE allowlist is pinned, not just one row, so a provider added to the
-- seed in either direction has to be declared here too. Two simulated labels
-- exist: 'staging_mock' (the app's mock-payment writers and most suites) and
-- 'fixture' (hand-seeded rows in the confirmation integration harnesses). The
-- test-mode Stripe label (0094) is confirmable on a disposable database only.
select pg_temp.assert(
  (select string_agg(provider,',' order by provider) from public.confirmable_payment_providers)
   = (case when current_database() ~ '^lumin_' then 'fixture,staging_mock,stripe_connect,stripe_connect_test' else 'stripe_connect' end),
 'simulated providers are confirmable exactly on a disposable lumin_* database, and nothing else is seeded');
-- A TEST-MODE connection is recorded under its own label, and a hosted database
-- refuses it: declaring it is the disposable-database act, and nothing else.
select pg_temp.assert(
  exists(select 1 from public.confirmable_payment_providers where provider='stripe_connect_test') = (current_database() ~ '^lumin_'),
 'the test-mode Stripe label is confirmable exactly on a disposable lumin_* database');

-- ---- Behaviour: the writer refuses an undeclared provider --------------------
create function pg_temp.whole_rows() returns jsonb language sql as $$
 select jsonb_build_object(
 'bookings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.bookings t),
 'payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.payments t),
 'holds',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.capacity_holds t),
 'history',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.booking_state_history t),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.durable_outbox t))
$$;
create function pg_temp.seed(n integer,prov text) returns void language plpgsql as $$
declare slot timestamptz:='2035-03-01T10:00Z'::timestamptz+make_interval(days=>n);
begin
 insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end)
 values(pg_temp.id(n),pg_temp.id(3),pg_temp.id(n)::text,pg_temp.id(n)::text,
  jsonb_build_object('serviceId',pg_temp.id(5)),'{"total":{"amount":100,"currency":"USD"}}'::jsonb,
  slot,slot+interval '1 hour');
 insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency)
 values(pg_temp.id(n+100),pg_temp.id(3),pg_temp.id(n),prov,pg_temp.id(n+100)::text,'succeeded',100,'USD');
 insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at)
 values(pg_temp.id(3),pg_temp.id(5),pg_temp.id(n),slot,slot+interval '1 hour',pg_temp.id(n)::text,'active',clock_timestamp()+interval '5 minutes');
end$$;

-- A provider this fixture declares confirmable, so the positive case does not
-- depend on which providers the deployment happens to seed.
insert into public.confirmable_payment_providers(provider,note) values('provenance_suite','fixture-scoped; rolls back');

select pg_temp.seed(10,'provenance_suite'),pg_temp.seed(11,'provenance_rogue'),pg_temp.seed(12,'provenance_suite');

-- Declared provider: confirms exactly as before 0088.
set local role service_role;
select pg_temp.assert(public.confirm_succeeded_payment(pg_temp.id(110))->>'replayed'='false','declared provider still confirms');
reset role;
select pg_temp.assert((select state='confirmed' from public.bookings where id=pg_temp.id(10)),'declared provider commits the booking');

-- Undeclared provider: refused, loudly, with nothing written.
create temp table before_rogue as select pg_temp.whole_rows() value;
set local role service_role;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(111))','42501');
reset role;
select pg_temp.assert((select value from before_rogue)=pg_temp.whole_rows(),'refused provider changes no complete row');
select pg_temp.assert((select state='draft' from public.bookings where id=pg_temp.id(11)),'refused provider leaves the booking untouched');

-- The gate reads the table live: revoking the declaration refuses the very same
-- provider that confirmed a moment ago, so the allowlist is the authority.
delete from public.confirmable_payment_providers where provider='provenance_suite';
set local role service_role;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(112))','42501');
reset role;
select pg_temp.assert((select state='draft' from public.bookings where id=pg_temp.id(12)),'withdrawn declaration leaves the booking untouched');
insert into public.confirmable_payment_providers(provider,note) values('provenance_suite','fixture-scoped; rolls back');

-- ---- 0088 re-declares the function: 0087's guarantees must survive ----------
-- An already-expired capacity hold is still refused as a serialization failure,
-- which is the deadline guarantee 0087 introduced.
select pg_temp.seed(13,'provenance_suite');
update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=pg_temp.id(13);
set local role service_role;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(113))','40001');
reset role;
select pg_temp.assert((select state='draft' from public.bookings where id=pg_temp.id(13)),'expired hold leaves the booking untouched');

-- Definer posture and execute grants are the ones 0087 shipped.
select pg_temp.assert(p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=pg_catalog'],'security definer search path preserved')
 from pg_proc p where p.oid='public.confirm_succeeded_payment(uuid)'::regprocedure;
select pg_temp.assert(not has_function_privilege('anon','public.confirm_succeeded_payment(uuid)','execute')
  and not has_function_privilege('authenticated','public.confirm_succeeded_payment(uuid)','execute')
  and has_function_privilege('service_role','public.confirm_succeeded_payment(uuid)','execute'),'execute grants preserved');
set local role anon;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(110))','42501');
reset role;
set local role authenticated;
select pg_temp.reject('select public.confirm_succeeded_payment(pg_temp.id(110))','42501');
reset role;
rollback;
\echo 'payment provenance gate PASS (fixtures and fixture allowlist rows rolled back)'
