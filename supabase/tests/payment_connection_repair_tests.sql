-- Disposable loopback PostgreSQL only; NEVER run this suite against hosted databases.
-- All synthetic records and fixture allowlist rows roll back.
--
-- Pins migration 0095: the repairs to the authority RPCs of 0093, and the rules that must
-- still hold after them. Each repair has an assertion that FAILS on 0093 or on the
-- unrepaired 0095. Tenants are separate narratives: A (the bind window, an abandoned
-- onboarding, replay), B (a connected row is not demoted; older answers change nothing),
-- C (write-once, supersession, a withdrawn provider), D (the member read predicate).
-- Section 12 adds tenants E to H, the repairs of the second round: E a handoff's own account
-- (12a); F a terminal connection and a lapsed disowning (12b); G an unfinished owner and the
-- stored onboarding fact (12c); H the window's boundary and a stale answer's receipt (12d).
-- Section 12e tests the reader RPC, the helper and the columns a client role reads.
-- One Booking Lumin account belongs to exactly one business, so each tenant has its own owner.
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

-- An owner and a staff member for tenant A, and one owner for each other business. Separate
-- ids from the 0093 suite.
insert into auth.users(id,email) values
 (pg_temp.id(1),'repair-owner-a@example.test'),
 (pg_temp.id(2),'repair-staff-a@example.test'),
 (pg_temp.id(3),'repair-owner-b@example.test'),
 (pg_temp.id(4),'repair-owner-c@example.test'),
 (pg_temp.id(5),'repair-owner-d@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(10),'Repair A','payment-connection-repair-a','UTC','USD'),
 (pg_temp.id(11),'Repair B','payment-connection-repair-b','UTC','USD'),
 (pg_temp.id(12),'Repair C','payment-connection-repair-c','UTC','USD'),
 (pg_temp.id(13),'Repair D','payment-connection-repair-d','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 (pg_temp.id(10),pg_temp.id(1),'BUSINESS_OWNER'),
 (pg_temp.id(10),pg_temp.id(2),'BUSINESS_STAFF'),
 (pg_temp.id(11),pg_temp.id(3),'BUSINESS_OWNER'),
 (pg_temp.id(12),pg_temp.id(4),'BUSINESS_OWNER'),
 (pg_temp.id(13),pg_temp.id(5),'BUSINESS_OWNER');

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

-- ---- 4. A handoff already recorded cannot move the connection back ----------
-- REPAIR 5. The first handoff was recorded, and the connection has since moved to its
-- successor. Recording the first handoff again must not rebind the connection to its
-- account. On the earlier repair this rebound it and overwrote the ledger's account.
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000001'::uuid,
 '95000000-0000-4000-8000-000000000010'::uuid,'mch_repair_1','acct_repair_abandon',true,true,true,null,'2035-01-01T00:14:00Z')$$,
 '23505','PAYMENT_CONNECTION_HANDOFF_SUPERSEDED');
reset role;
select pg_temp.assert((select account_id='acct_repair_finished' and status='connected'
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_repair'),
 'a superseded handoff leaves the connection on the account it holds');
select pg_temp.assert((select account_id='acct_repair_abandon' and resolved_at is not null
  from public.payment_connection_handoffs where handoff_id='mch_repair_1'),
 'the superseded handoff keeps the account it produced in the ledger');

-- ---- 5. The window governs a NEW bind; a refresh is not refused by the clock ----
-- The handoff is now a day past its ledger expiry, so its bind window has closed.
update public.payment_connection_handoffs set expires_at='2020-01-01T00:00:00Z' where handoff_id='mch_repair_2';

-- REPAIR 1. On 0093 this refresh was refused "this handoff has expired" once the window
-- had closed, so a live merchant could never be refreshed.
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

-- The window still refuses a NEW account once its handoff has expired: a stale handoff is
-- not a bind authority for a different merchant.
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_repair',
   'repair-attempt-0004','mch_repair_4','2035-01-02T00:05:00Z')->>'replayed')='false',
 'a fourth attempt begins while the connection is revoked');
reset role;
update public.payment_connection_handoffs set expires_at='2020-01-01T00:00:00Z' where handoff_id='mch_repair_4';
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000001'::uuid,
 '95000000-0000-4000-8000-000000000010'::uuid,'mch_repair_4','acct_repair_new_one',true,true,true,null,'2035-01-02T00:01:00Z')$$,
 '22023','this handoff has expired');
reset role;

-- ---- 6. replayed says whether THIS HANDOFF was recorded before -------------
-- REPAIR 4. 0093 reported whether the CONNECTION held an account, so a brand-new handoff
-- for the account the connection already holds read as a replay.
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
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_repair_3',
   'acct_repair_finished',true,true,true,null,'2035-02-01T00:07:00Z')->>'replayed')='true',
 'a second record of the same handoff is a replay');
reset role;

-- ---- 7. The ledger records the account each handoff produced ----------------
select pg_temp.assert((select account_id='acct_repair_finished' and resolved_at is not null
  from public.payment_connection_handoffs where handoff_id='mch_repair_2'),
 'the ledger records the account the handoff produced, and that it was resolved');

-- ---- 8. Tenant B: a connected row is not demoted, and older answers change nothing ----
-- REPAIR 6. A connected tenant starts no new handoff. Before this repair begin created
-- an account at the provider for every new key, and record refused it afterwards.
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(3),pg_temp.id(11),'conn_repair',
   'repair-attempt-b-0001','mch_repair_b1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant B begins its first handoff');
select pg_temp.assert(
 (select (r->>'status')='connected' from (select public.record_payment_connection(pg_temp.id(3),pg_temp.id(11),
   'mch_repair_b1','acct_b_live',true,true,true,null,'2035-01-01T00:10:00Z') as r) s),
 'tenant B connects');
select pg_temp.reject($$select public.begin_payment_connection('95000000-0000-4000-8000-000000000003'::uuid,
 '95000000-0000-4000-8000-000000000011'::uuid,'conn_repair','repair-attempt-b-0002','mch_repair_b2','2035-01-01T00:05:00Z')$$,
 '23505','PAYMENT_CONNECTION_ALREADY_CONNECTED');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(3),pg_temp.id(11),'conn_repair',
   'repair-attempt-b-0001','mch_repair_b1','2035-01-01T00:05:00Z')->>'replayed')='true',
 'a connected tenant still has its existing begin replayed');

-- REPAIR 3 (the derivation). An unfinished onboarding report does not demote a connected
-- row. On 0093 it moved the row to not_connected, which kept the account bound.
select pg_temp.assert(
 (select (o->>'status')='connected' and (o->>'statusChanged')='false'
    from (select public.observe_payment_connection(pg_temp.id(11),'acct_b_live',false,false,false,
      'onboarding_incomplete','2035-01-01T00:20:00Z') as o) s),
 'an unfinished onboarding report does not demote a connected row');

-- REPAIR 4 (the order). An older answer changes nothing, from automation or from the owner.
select pg_temp.assert(
 (select (o->>'statusChanged')='false'
    from (select public.observe_payment_connection(pg_temp.id(11),'acct_b_live',true,true,true,null,
      '2035-01-01T00:15:00Z') as o) s),
 'an older observation changes nothing');
-- The status did not change, so the facts are checked too: an older report must not
-- overwrite the charges, the reason or the time of the newer one.
reset role;
select pg_temp.assert((select not charges_enabled and last_observed_at='2035-01-01T00:20:00Z'::timestamptz
  from public.payment_connections where tenant_id=pg_temp.id(11) and provider='conn_repair'),
 'an older observation leaves the stored facts as they were');
set local role service_role;
select pg_temp.assert(
 (select (r->>'replayed')='true' and (r->>'status')='connected'
    from (select public.record_payment_connection(pg_temp.id(3),pg_temp.id(11),'mch_repair_b1','acct_b_live',true,true,true,
      null,'2035-01-01T00:12:00Z') as r) s),
 'an older record of the held account changes nothing, and reports the stored state');
reset role;
select pg_temp.assert((select status='connected' and not charges_enabled and blocked_reason='onboarding_incomplete'
  and last_observed_at='2035-01-01T00:20:00Z'::timestamptz
  from public.payment_connections where tenant_id=pg_temp.id(11) and provider='conn_repair'),
 'the stored report is the later one: connected, not charging, blocked by onboarding');

-- A disowning, then an older healthy answer arriving late, is not a revival. On the earlier
-- repair the owner's record reset the row and the older answer reconnected it.
set local role service_role;
select pg_temp.assert(
 (select (o->>'status')='revoked'
    from (select public.observe_payment_connection(pg_temp.id(11),'acct_b_live',false,false,false,
      'credentials_invalid','2035-01-01T00:30:00Z') as o) s),
 'a disowning revokes the connection');
select pg_temp.assert(
 (select (r->>'status')='revoked'
    from (select public.record_payment_connection(pg_temp.id(3),pg_temp.id(11),'mch_repair_b1','acct_b_live',true,true,true,
      null,'2035-01-01T00:25:00Z') as r) s),
 'a late healthy answer, older than the disowning, does not revive the connection');
reset role;
select pg_temp.assert((select status='revoked' and not charges_enabled and blocked_reason='credentials_invalid'
  and last_observed_at='2035-01-01T00:30:00Z'::timestamptz
  from public.payment_connections where tenant_id=pg_temp.id(11) and provider='conn_repair'),
 'the disowning is the stored state');

-- ---- 9. Tenant C: write-once, supersession, and a withdrawn provider ----------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(4),pg_temp.id(12),'conn_repair',
   'repair-attempt-c-0001','mch_repair_cy','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant C begins a first handoff while unconnected');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(4),pg_temp.id(12),'conn_repair',
   'repair-attempt-c-0002','mch_repair_cz','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant C begins a second handoff while still unconnected');
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(4),pg_temp.id(12),'mch_repair_cy','acct_c_y',false,false,false,
   'onboarding_incomplete','2035-01-01T00:02:00Z')->>'status')='not_connected',
 'the first account is recorded as not connected');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(4),pg_temp.id(12),'conn_repair',
   'repair-attempt-c-0003','mch_repair_cx','2035-01-01T00:08:00Z')->>'replayed')='false',
 'tenant C begins a third handoff');
select pg_temp.assert(
 (select (r->>'status')='connected' and (r->>'replayed')='false'
    from (select public.record_payment_connection(pg_temp.id(4),pg_temp.id(12),'mch_repair_cx','acct_c_x',true,true,true,
      null,'2035-01-01T00:10:00Z') as r) s),
 'the third account binds over the unconnected first one');

-- REPAIR 7. mch_repair_cz was begun while the tenant was unconnected, and is still unrecorded.
-- Recording it now would bind a second account over a connected one.
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000004'::uuid,
 '95000000-0000-4000-8000-000000000012'::uuid,'mch_repair_cz','acct_c_z',true,true,true,null,'2035-01-01T00:11:00Z')$$,
 '23505','PAYMENT_CONNECTION_ALREADY_BOUND');
-- The superseded handoff of section 4's rule, on another tenant.
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000004'::uuid,
 '95000000-0000-4000-8000-000000000012'::uuid,'mch_repair_cy','acct_c_y',true,true,true,null,'2035-01-01T00:12:00Z')$$,
 '23505','PAYMENT_CONNECTION_HANDOFF_SUPERSEDED');
reset role;
select pg_temp.assert((select account_id='acct_c_x' and status='connected' from public.payment_connections
  where tenant_id=pg_temp.id(12) and provider='conn_repair'),
 'the connection still holds the account it was connected to');

-- REPAIR 8. A provider withdrawn from the allowlist refuses a record, even for a handoff
-- begun while it was declared. The record names the account the connection already holds,
-- so write-once cannot refuse it first: the declared check is what is being pinned.
delete from public.confirmable_payment_providers where provider='conn_repair';
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000004'::uuid,
 '95000000-0000-4000-8000-000000000012'::uuid,'mch_repair_cz','acct_c_x',true,true,true,null,'2035-01-01T00:13:00Z')$$,
 '22023','PAYMENT_PROVIDER_NOT_CONFIRMABLE');
reset role;
select pg_temp.assert((select account_id='acct_c_x' and status='connected' from public.payment_connections
  where tenant_id=pg_temp.id(12) and provider='conn_repair'),
 'a withdrawn provider leaves the connection row unchanged');
insert into public.confirmable_payment_providers(provider,note)
 values('conn_repair','fixture-scoped payment connection provider; rolls back');

-- ---- 10. Tenant D: a member reads a connection only for an active tenant and a declared provider
-- REPAIR 9. The member read policy names this predicate. On 0007 a member read every row of
-- the tenant, including the rows of a suspended tenant and a label no longer declared.
update public.tenants set status='suspended' where id=pg_temp.id(13);
-- The helper answers for a MEMBER only (round 2): the probe runs as the owner of tenant A.
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert(lumin.payment_connection_readable(pg_temp.id(10),'conn_repair'),
 'a member reads its own declared connection');
select set_config('request.jwt.claims','',true);
select pg_temp.assert(not lumin.payment_connection_readable(pg_temp.id(10),'conn_not_declared'),
 'an undeclared provider is not readable by a member');
select pg_temp.assert(not lumin.payment_connection_readable(pg_temp.id(13),'conn_repair'),
 'a suspended tenant is not readable by a member');
select pg_temp.assert(
 (select qual like '%payment_connection_readable%' from pg_policies
   where schemaname='public' and tablename='payment_connections' and policyname='member_or_admin_select'),
 'the member read policy names the readable predicate');

-- ---- 11. The derivation, pinned directly -----------------------------------
-- REPAIR 3 again, on the function itself: connected stays connected, never-connected stays
-- not connected, and automation's terminal states do not change.
select pg_temp.assert(lumin.payment_connection_status('connected',false,'onboarding_incomplete')='connected',
 'a connected row stays connected on an unfinished onboarding report');
select pg_temp.assert(lumin.payment_connection_status('not_connected',false,'onboarding_incomplete')='not_connected',
 'a never-connected row is not connected');
select pg_temp.assert(lumin.payment_connection_status('error',true,null)='error',
 'error is terminal for automation');
select pg_temp.assert(lumin.payment_connection_status('connected',false,'credentials_invalid')='revoked',
 'a disowning reason revokes a connected row');


-- ---- 12. Tenants E to H: the repairs of the second repair round ----------------------------------------
-- Each business has its own owner: one Booking Lumin account belongs to exactly one business.
insert into auth.users(id,email) values
 (pg_temp.id(6),'repair-owner-e@example.test'),
 (pg_temp.id(7),'repair-owner-f@example.test'),
 (pg_temp.id(8),'repair-owner-g@example.test'),
 (pg_temp.id(9),'repair-owner-h@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(14),'Repair E','payment-connection-repair-e','UTC','USD'),
 (pg_temp.id(15),'Repair F','payment-connection-repair-f','UTC','USD'),
 (pg_temp.id(16),'Repair G','payment-connection-repair-g','UTC','USD'),
 (pg_temp.id(17),'Repair H','payment-connection-repair-h','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 (pg_temp.id(14),pg_temp.id(6),'BUSINESS_OWNER'),
 (pg_temp.id(15),pg_temp.id(7),'BUSINESS_OWNER'),
 (pg_temp.id(16),pg_temp.id(8),'BUSINESS_OWNER'),
 (pg_temp.id(17),pg_temp.id(9),'BUSINESS_OWNER');

-- ---- 12a. A recorded handoff names its OWN account (E) ----------------------------------------------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(6),pg_temp.id(14),'conn_repair',
   'repair-attempt-e-0001','mch_repair_e1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant E begins a first handoff');
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(6),pg_temp.id(14),'mch_repair_e1','acct_repair_ea',
   false,false,false,'onboarding_incomplete','2035-01-01T00:02:00Z')->>'status')='not_connected',
 'tenant E is recorded not connected on its first account');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(6),pg_temp.id(14),'conn_repair',
   'repair-attempt-e-0002','mch_repair_e2','2035-01-01T00:08:00Z')->>'replayed')='false',
 'tenant E begins a second handoff');
select pg_temp.assert(
 (select (r->>'status')='connected' from (select public.record_payment_connection(pg_temp.id(6),pg_temp.id(14),
   'mch_repair_e2','acct_repair_eb',true,true,true,null,'2035-01-01T00:10:00Z') as r) s),
 'the second account binds over the unconnected first one');
-- REPAIR 11. The first handoff produced acct_repair_ea. Recording it again with the connection's CURRENT
-- account (acct_repair_eb) must be refused: on the earlier repair the check compared only the connection's
-- account, the ledger row was overwritten, and the replay read as a success.
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000006'::uuid,
 '95000000-0000-4000-8000-000000000014'::uuid,'mch_repair_e1','acct_repair_eb',true,true,true,null,'2035-01-01T00:11:00Z')$$,
 '23505','PAYMENT_CONNECTION_HANDOFF_SUPERSEDED');
reset role;
select pg_temp.assert((select account_id='acct_repair_ea' from public.payment_connection_handoffs where handoff_id='mch_repair_e1'),
 'the ledger keeps the account the first handoff produced');

-- ---- 12b. A terminal connection is not changed by automation; a lapsed handoff cannot revive it (F) -------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(7),pg_temp.id(15),'conn_repair',
   'repair-attempt-f-0001','mch_repair_f1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant F begins a handoff');
select pg_temp.assert(
 (select (r->>'status')='connected' from (select public.record_payment_connection(pg_temp.id(7),pg_temp.id(15),
   'mch_repair_f1','acct_repair_fa',true,true,true,null,'2035-01-01T00:10:00Z') as r) s),
 'tenant F connects');
select pg_temp.assert(
 (select (o->>'status')='revoked' from (select public.observe_payment_connection(pg_temp.id(15),'acct_repair_fa',
   false,false,false,'credentials_invalid','2035-01-01T00:20:00Z') as o) s),
 'the provider disowns the account, and the connection is revoked');
-- REPAIR 12. A healthy answer after the disowning changes nothing: the facts that revoked the connection stay.
-- On the earlier repair the observation wrote charges_enabled true and erased the blocked reason.
select pg_temp.assert(
 (select (o->>'statusChanged')='false' and (o->>'status')='revoked'
    from (select public.observe_payment_connection(pg_temp.id(15),'acct_repair_fa',true,true,true,null,
      '2035-01-01T00:30:00Z') as o) s),
 'a healthy answer does not change a revoked connection');
reset role;
select pg_temp.assert((select status='revoked' and not charges_enabled and blocked_reason='credentials_invalid'
  and last_observed_at='2035-01-01T00:20:00Z'::timestamptz
  from public.payment_connections where tenant_id=pg_temp.id(15) and provider='conn_repair'),
 'the stored facts are the ones that revoked the connection');
-- REPAIR 13. The handoff has LAPSED. A healthy record for the account it bound may not revive the revoked
-- connection (the earlier repair skipped the window for a bound account); a disowning is still recorded.
update public.payment_connection_handoffs set expires_at='2020-01-01T00:00:00Z' where handoff_id='mch_repair_f1';
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000007'::uuid,
 '95000000-0000-4000-8000-000000000015'::uuid,'mch_repair_f1','acct_repair_fa',true,true,true,null,'2035-01-02T00:00:00Z')$$,
 '22023','this handoff has expired');
select pg_temp.assert(
 (select (r->>'status')='revoked' from (select public.record_payment_connection(pg_temp.id(7),pg_temp.id(15),
   'mch_repair_f1','acct_repair_fa',false,false,false,'credentials_invalid','2035-01-02T00:05:00Z') as r) s),
 'a lapsed handoff still records a disowning');
reset role;
select pg_temp.assert((select status='revoked' from public.payment_connections where tenant_id=pg_temp.id(15) and provider='conn_repair'),
 'the lapsed handoff did not revive the connection');

-- ---- 12c. Derivation, the declared label, and the onboarding fact (G) ----------------------------------------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(8),pg_temp.id(16),'conn_repair',
   'repair-attempt-g-0001','mch_repair_g1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant G begins a handoff');
-- REPAIR 14. A never-connected owner whose provider says charges are enabled, with onboarding unfinished, is
-- not connected. On the earlier repair the charges flag won and the row became connected.
select pg_temp.assert(
 (select (r->>'status')='not_connected' from (select public.record_payment_connection(pg_temp.id(8),pg_temp.id(16),
   'mch_repair_g1','acct_repair_ga',true,true,true,'onboarding_incomplete','2035-01-01T00:06:00Z') as r) s),
 'an unfinished owner with charges enabled is not connected');
-- The label is withdrawn by the owner of the allowlist (the service role reads it, and cannot write it):
-- automation is then refused for the bound account, as record and begin already are.
reset role;
delete from public.confirmable_payment_providers where provider='conn_repair';
set local role service_role;
select pg_temp.reject($$select public.observe_payment_connection('95000000-0000-4000-8000-000000000016'::uuid,
 'acct_repair_ga',true,true,true,null,'2035-01-01T00:07:00Z')$$,'22023','PAYMENT_PROVIDER_NOT_CONFIRMABLE');
reset role;
insert into public.confirmable_payment_providers(provider,note)
 values('conn_repair','fixture-scoped payment connection provider; rolls back');
set local role service_role;
select pg_temp.assert(
 (select (r->>'status')='connected' from (select public.record_payment_connection(pg_temp.id(8),pg_temp.id(16),
   'mch_repair_g1','acct_repair_ga',true,true,true,null,'2035-01-01T00:08:00Z') as r) s),
 'the same owner finishes onboarding and is connected');
-- REPAIR 15. A disowning writes no onboarding fact: Stripe reported none. The stored true stays.
select pg_temp.assert(
 (select (o->>'status')='revoked' from (select public.observe_payment_connection(pg_temp.id(16),'acct_repair_ga',
   false,false,false,'credentials_invalid','2035-01-01T00:09:00Z') as o) s),
 'the disowned account is revoked');
reset role;
select pg_temp.assert((select status='revoked' and onboarding_complete from public.payment_connections
  where tenant_id=pg_temp.id(16) and provider='conn_repair'),
 'a disowning keeps the stored onboarding fact');
select pg_temp.assert(lumin.payment_connection_status('not_connected',true,'onboarding_incomplete')='not_connected',
 'the derivation pins the unfinished-owner cell');

-- ---- 12d. The bind window at its boundary (H) ------------------------------------------------------------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(9),pg_temp.id(17),'conn_repair',
   'repair-attempt-h-0001','mch_repair_h1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant H begins a first handoff');
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(9),pg_temp.id(17),'conn_repair',
   'repair-attempt-h-0002','mch_repair_h2','2035-01-01T00:05:00Z')->>'replayed')='false',
 'tenant H begins a second handoff');
reset role;
-- REPAIR 9. 90 minutes past expiry is outside the one-hour grace; 30 minutes past is inside it. On the earlier
-- repair the window was pinned to two hours in no test, so a +2h window passed every suite.
update public.payment_connection_handoffs set expires_at = clock_timestamp() - interval '90 minutes' where handoff_id='mch_repair_h1';
update public.payment_connection_handoffs set expires_at = clock_timestamp() - interval '30 minutes' where handoff_id='mch_repair_h2';
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('95000000-0000-4000-8000-000000000009'::uuid,
 '95000000-0000-4000-8000-000000000017'::uuid,'mch_repair_h1','acct_repair_ha',true,true,true,null,'2035-01-01T00:10:00Z')$$,
 '22023','this handoff has expired');
select pg_temp.assert(
 (select (r->>'status')='connected' from (select public.record_payment_connection(pg_temp.id(9),pg_temp.id(17),
   'mch_repair_h2','acct_repair_hb',true,true,true,null,'2035-01-01T00:10:00Z') as r) s),
 'a bind 30 minutes past expiry is inside the grace');
-- REPAIR 16. A stale answer for the account the connection holds (observed before the stored one) changes nothing,
-- and its receipt states the STORED facts. The answer says charges are disabled; the store says they are enabled.
-- On the earlier repair the writer paired the stored status with the stale answer's facts.
set local role service_role;
select pg_temp.assert(
 (select (r->>'chargesEnabled')::boolean and (r->>'blockedReason') is null and (r->>'replayed')::boolean
    from (select public.record_payment_connection(pg_temp.id(9),pg_temp.id(17),
   'mch_repair_h2','acct_repair_hb',false,false,false,'charges_disabled','2035-01-01T00:04:00Z') as r) s),
 'a stale answer is receipted with the stored facts, and the handoff is a replay');
select pg_temp.assert((select charges_enabled and blocked_reason is null and last_observed_at='2035-01-01T00:10:00Z'::timestamptz
  from public.payment_connections where tenant_id=pg_temp.id(17) and provider='conn_repair'),
 'the stale answer changed no stored fact');
reset role;

-- ---- 12e. The reader, the helper and the columns a client reads (tenant A) -----------------------------
-- REPAIR 3 (reader). The reader RPC omits a connection whose label is not declared, in the database.
insert into public.payment_connections (tenant_id, provider, status) values (pg_temp.id(10), 'retired_label_probe', 'connected');
select pg_temp.assert(not exists (
   select 1 from jsonb_array_elements(public.payment_connection_facts(pg_temp.id(1), pg_temp.id(10))->'connections') e
    where e->>'provider' = 'retired_label_probe'),
 'the reader RPC omits a label this deployment does not declare');
select pg_temp.assert(exists (
   select 1 from jsonb_array_elements(public.payment_connection_facts(pg_temp.id(1), pg_temp.id(10))->'connections') e
    where e->>'provider' = 'conn_repair'),
 'the reader RPC still returns the declared connection');
-- REPAIR 4 (helper). A probe answers only for a row the member can see.
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert(not lumin.payment_connection_readable(pg_temp.id(10),'stripe_connect_test'),
 'a member probing a label its tenant does not hold learns nothing about the allowlist');
select pg_temp.assert(not lumin.payment_connection_readable(pg_temp.id(10),'retired_label_probe'),
 'an undeclared label is not readable');
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.assert(not lumin.payment_connection_readable(pg_temp.id(10),'conn_repair'),
 'a non-member probing another business learns nothing');
select set_config('request.jwt.claims','',true);
-- REPAIR 6 (columns). A client role reads the closed reason and the facts, never the free text or the configuration.
select pg_temp.assert(not has_column_privilege('authenticated','public.payment_connections','last_error','select'),
 'a client role cannot read last_error');
select pg_temp.assert(not has_column_privilege('authenticated','public.payment_connections','config','select'),
 'a client role cannot read config');
select pg_temp.assert(has_column_privilege('authenticated','public.payment_connections','blocked_reason','select'),
 'a client role reads the closed blocked reason');

select 'PASS payment_connection_repair_tests' as result;
rollback;
