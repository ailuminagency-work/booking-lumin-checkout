-- Disposable loopback PostgreSQL only; NEVER run this suite against hosted databases.
-- All synthetic records and fixture allowlist rows roll back.
--
-- Pins migration 0095: the four repairs to the authority RPCs of 0093, and the rules
-- that must still hold after them. Each repair has an assertion that FAILS on 0093.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reject(statement text,expected text,fragment text default null) returns void language plpgsql as $$
declare detail_text text;
begin
 begin execute statement;
 exception when others then
  if sqlstate<>expected then
   raise exception 'FAIL wrong sqlstate for %: got % (%)',statement,sqlstate,sqlerrm;
  end if;
  -- Pin WHICH guard fired: the DETAIL is searched too, so a refusal that passed on
  -- the wrong guard asserts nothing.
  get stacked diagnostics detail_text = pg_exception_detail;
  if fragment is not null
     and position(fragment in coalesce(sqlerrm,'')||' '||coalesce(detail_text,''))=0 then
   raise exception 'FAIL wrong guard for %: expected %, got % / %',statement,fragment,sqlerrm,detail_text;
  end if;
  return;
 end;
 raise exception 'FAIL accepted forbidden operation: %',statement;
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('95000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;

-- One business with an owner and a staff member. Separate ids from the 0093 suite.
insert into auth.users(id,email) values
 (pg_temp.id(1),'repair-owner-a@example.test'),
 (pg_temp.id(2),'repair-staff-a@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(10),'Repair A','payment-connection-repair-a','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 (pg_temp.id(10),pg_temp.id(1),'BUSINESS_OWNER'),
 (pg_temp.id(10),pg_temp.id(2),'BUSINESS_STAFF');

-- A fixture-scoped confirmable provider, so the suite does not depend on which labels
-- 0088 or 0094 seeded on this database.
insert into public.confirmable_payment_providers(provider,note)
 values('conn_repair','fixture-scoped payment connection provider; rolls back');

-- ---- 1. The bind window has ONE definition ----------------------------------
select pg_temp.assert(lumin.payment_handoff_bind_deadline('2035-01-01T00:05:00Z'::timestamptz)
  = '2035-01-01T01:05:00Z'::timestamptz,
 'the bind window is one hour past the ledger expiry');
select pg_temp.assert(not bool_or(has_function_privilege(r,'lumin.payment_handoff_bind_deadline(timestamptz)','execute')),
 'the bind-window helper is callable by no granted role')
 from unnest(array['anon','authenticated','service_role']) r;

-- ---- 2. begin states the deadline that record enforces ----------------------
set local role service_role;
-- REPAIR 3. 0093 returned no deadline at all, so the receipt stated the ledger expiry
-- and the enforced window was one hour longer.
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_repair',
   'repair-attempt-0001','mch_repair_1','2035-01-01T00:05:00Z')->>'bindDeadline')::timestamptz
   = '2035-01-01T01:05:00Z'::timestamptz,
 'a fresh handoff states the deadline the bind is enforced against');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_repair',
   'repair-attempt-0001','mch_repair_1x','2035-01-01T00:05:00Z')->>'bindDeadline')::timestamptz
   = '2035-01-01T01:05:00Z'::timestamptz,
 'a replayed handoff states the same deadline, from the ledger');
reset role;

-- ---- 3. An abandoned onboarding does not lock the tenant -------------------
-- REPAIR 2. On 0093 the second attempt below was refused PAYMENT_CONNECTION_ALREADY_BOUND
-- for ever: the first attempt left its account bound on a not_connected row.
set local role service_role;
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_1',
   'acct_repair_abandon',false,false,false,'onboarding_incomplete','2035-01-01T00:02:00Z')->>'status')='not_connected',
 'an unfinished onboarding is recorded as not connected');
reset role;
select pg_temp.assert((select status='not_connected' and account_id='acct_repair_abandon' and not charges_enabled
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_repair'),
 'the abandoned row holds the account it started with, and cannot charge');

set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_repair',
   'repair-attempt-0002','mch_repair_2','2035-01-01T00:10:00Z')->>'replayed')='false',
 'the owner starts a second attempt, which is a second handoff');
select pg_temp.assert(
 (select (r->>'status')='connected' and (r->>'replayed')='false'
    from (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_2',
      'acct_repair_finished',true,true,true,null,'2035-01-01T00:12:00Z') as r) s),
 'a finished second attempt binds its own account over an abandoned one, and is not a replay');
reset role;
select pg_temp.assert((select status='connected' and account_id='acct_repair_finished' and charges_enabled
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_repair'),
 'the tenant is connected to the second account, and the first is no longer bound');

-- ---- 4. A LIVE connection is still write-once -------------------------------
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000001'::uuid,
 '95000000-0000-4000-8000-000000000010'::uuid,'mch_repair_2','acct_repair_other',true,true,true,null,'2035-01-01T00:14:00Z')$$,
 '42501','PAYMENT_CONNECTION_ALREADY_BOUND');
reset role;

-- ---- 5. The window refuses a NEW bind; it does not refuse the bound account -----
-- The handoff is now a day past its ledger expiry, so its bind window has closed.
update public.payment_connection_handoffs set expires_at='2020-01-01T00:00:00Z' where handoff_id='mch_repair_2';

-- REPAIR 1. On 0093 this refresh was refused "this handoff has expired" once the
-- window had closed, so a live merchant could never be refreshed.
set local role service_role;
select pg_temp.assert(
 (select (r->>'status')='connected' and (r->>'replayed')='true'
    from (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_2',
      'acct_repair_finished',false,true,true,'charges_disabled','2035-01-01T00:20:00Z') as r) s),
 'a refresh of the bound account is accepted after its window, and reports a replay');
reset role;
select pg_temp.assert((select status='connected' and not charges_enabled and blocked_reason='charges_disabled'
  and account_id='acct_repair_finished' from public.payment_connections
  where tenant_id=pg_temp.id(10) and provider='conn_repair'),
 'the refresh changed the facts and nothing about the binding');

-- REPAIR 1, the case that matters most: the provider has disowned the account, and the
-- disowning answer is only observed after the window. It must still be recorded.
set local role service_role;
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_2',
   'acct_repair_finished',false,false,false,'credentials_invalid','2035-01-02T00:00:00Z')->>'status')='revoked',
 'a disowned bound account is recorded as revoked after its window');
reset role;
select pg_temp.assert((select status='revoked' and account_id='acct_repair_finished' and blocked_reason='credentials_invalid'
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_repair'),
 'the disowned connection reads revoked, still bound to the account it held');

-- The window still refuses a NEW account, even though the tenant's row is dead: a
-- stale handoff is not a bind authority for a different merchant.
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000001'::uuid,
 '95000000-0000-4000-8000-000000000010'::uuid,'mch_repair_2','acct_repair_new_one',true,true,true,null,'2035-01-02T00:01:00Z')$$,
 '22023','this handoff has expired');
reset role;

-- ---- 6. replayed says whether THIS HANDOFF was recorded before -------------
-- REPAIR 4. 0093 reported whether the CONNECTION held an account, so a brand-new
-- handoff for the account the connection already holds read as a replay. The
-- handoff is new here, so the record is not a replay, and it reconnects the revoked
-- row to the account it held.
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_repair',
   'repair-attempt-0003','mch_repair_3','2035-02-01T00:05:00Z')->>'replayed')='false',
 'a third attempt begins a third handoff');
select pg_temp.assert(
 (select (r->>'replayed')='false' and (r->>'status')='connected'
    from (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_3',
      'acct_repair_finished',true,true,true,null,'2035-02-01T00:06:00Z') as r) s),
 'a new handoff for the account already held is not a replay, and reconnects the revoked row');
-- A SECOND record of that same handoff is the replay.
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_3',
   'acct_repair_finished',true,true,true,null,'2035-02-01T00:07:00Z')->>'replayed')='true',
 'a second record of the same handoff is a replay');
reset role;

-- ---- 7. The ledger records the account each handoff produced ----------------
select pg_temp.assert((select account_id='acct_repair_finished' and resolved_at is not null
  from public.payment_connection_handoffs where handoff_id='mch_repair_2'),
 'the ledger records the account the handoff produced, and that it was resolved');
select pg_temp.assert((select account_id='acct_repair_abandon' and resolved_at is not null
  from public.payment_connection_handoffs where handoff_id='mch_repair_1'),
 'the abandoned handoff is still recorded against its own account');

select 'PASS payment_connection_repair_tests' as result;
rollback;
