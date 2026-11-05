-- Disposable loopback PostgreSQL only; NEVER run this attack fixture against hosted databases.
-- All synthetic records and fixture allowlist rows roll back.
--
-- Pins migration 0093 and the line it draws: automation may RECORD what a payment
-- provider said, and may never DECIDE that a merchant's payments stop. The
-- assertions below are organised around the ways that line could be crossed.
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
  -- Pin WHICH guard fired. Several distinct refusals share both an sqlstate AND a
  -- message (two raises of CONNECTION_UNVERIFIED), so the DETAIL is searched too:
  -- a rejection that passed on the wrong guard would assert nothing.
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
 select ('93000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;

-- Tenant A with an owner and a staff member; tenant B with its own owner. Separate
-- accounts per business, because 0092 forbids one account holding two.
insert into auth.users(id,email) values
 (pg_temp.id(1),'conn-owner-a@example.test'),
 (pg_temp.id(2),'conn-staff-a@example.test'),
 (pg_temp.id(3),'conn-owner-b@example.test');
insert into public.tenants(id,name,slug,timezone,currency) values
 (pg_temp.id(10),'Conn A','payment-connection-a','UTC','USD'),
 (pg_temp.id(11),'Conn B','payment-connection-b','UTC','USD');
insert into public.tenant_members(tenant_id,user_id,role) values
 (pg_temp.id(10),pg_temp.id(1),'BUSINESS_OWNER'),
 (pg_temp.id(10),pg_temp.id(2),'BUSINESS_STAFF'),
 (pg_temp.id(11),pg_temp.id(3),'BUSINESS_OWNER');

-- A fixture-scoped confirmable provider, so the suite does not depend on which
-- simulated labels 0088 seeded on this particular database.
insert into public.confirmable_payment_providers(provider,note)
 values('conn_suite','fixture-scoped payment connection provider; rolls back');

-- ---- 1. The ledger and the table are server-authoritative -------------------
select pg_temp.assert((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='public.payment_connection_handoffs'::regclass),
 'payment_connection_handoffs RLS enabled and FORCED');
select pg_temp.assert(count(*)=0,'payment_connection_handoffs has no policies')
 from pg_policy where polrelid='public.payment_connection_handoffs'::regclass;
select pg_temp.assert(not bool_or(has_table_privilege(r,'public.payment_connection_handoffs',v)),
  'no client role holds any handoff-ledger verb')
 from unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) v;
-- The trusted runtime may READ the ledger and may not write it: forging a handoff
-- and then presenting an account id against it is the diversion the ledger exists
-- to prevent, so even service_role goes through the RPCs.
select pg_temp.assert(
  has_table_privilege('service_role','public.payment_connection_handoffs','select')
  and not bool_or(has_table_privilege('service_role','public.payment_connection_handoffs',v)),
 'service_role reads the ledger and never writes it')
 from unnest(array['insert','update','delete']) v;

-- 0089 took the write verbs away from clients; 0093 takes them from the runtime
-- too, so the ONLY path that changes a connection row is a function whose body
-- constrains what may change.
select pg_temp.assert(not bool_or(has_table_privilege(r,'public.payment_connections',v)),
  'no role holds a DIRECT write verb on payment_connections')
 from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete']) v;
select pg_temp.assert(count(*)=0,'payment_connections still has no write policy')
 from pg_policy where polrelid='public.payment_connections'::regclass and polcmd<>'r';

-- The four RPCs: reachable by the runtime, by nobody else.
select pg_temp.assert(count(*)=4,'all four RPCs were checked') from unnest(array[
  'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)',
  'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)',
  'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)',
  'public.payment_connection_facts(uuid,uuid)']) f;
select pg_temp.assert(
  has_function_privilege('service_role',f,'execute')
  and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('authenticated',f,'execute'),
 'RPC reachable only by service_role: '||f)
 from unnest(array[
  'public.begin_payment_connection(uuid,uuid,text,text,text,timestamptz)',
  'public.record_payment_connection(uuid,uuid,text,text,boolean,boolean,boolean,text,timestamptz)',
  'public.observe_payment_connection(uuid,text,boolean,boolean,boolean,text,timestamptz)',
  'public.payment_connection_facts(uuid,uuid)']) f;
-- The derivation itself is internal: no role calls it directly, so no caller can
-- interrogate or lean on it outside the RPCs that own the writes.
select pg_temp.assert(not bool_or(has_function_privilege(r,'lumin.payment_connection_status(text,boolean,text)','execute')),
  'the status derivation is not callable by any granted role')
 from unnest(array['anon','authenticated','service_role']) r;

-- ---- 2. The derivation, over its whole cross product ------------------------
-- 0093 proves this at apply time; repeating it here catches a LATER migration
-- redefining the function, which the apply-time guard cannot.
create temporary table pg_temp_pcs as
 select c.s current_status,e.b charges_enabled,r.r blocked_reason,
        lumin.payment_connection_status(c.s,e.b,r.r) derived
   from unnest(array['not_connected','connected','error','revoked']) c(s),
        unnest(array[false,true]) e(b),
        unnest(array['onboarding_incomplete','charges_disabled','payouts_disabled',
                     'requirements_past_due','credentials_invalid','account_rejected',null]) r(r);
select pg_temp.assert(count(*)=56,'the derivation guard is a 4 x 2 x 7 cross product') from pg_temp_pcs;
select pg_temp.assert(count(*)=0,'the derivation is total and never NULL') from pg_temp_pcs
 where derived is null or derived not in ('not_connected','connected','error','revoked');
-- THE assertion of this migration: automation cannot decide a merchant is broken.
select pg_temp.assert(count(*)=0,'automation can never CREATE the error status') from pg_temp_pcs
 where derived='error' and current_status<>'error';
select pg_temp.assert(count(*)=0,'error and revoked are terminal for automation') from pg_temp_pcs
 where current_status in ('error','revoked') and derived<>current_status;
-- Revoking is only ever the provider's own word, never an inference.
select pg_temp.assert(count(*)=0,'revoked is reached only when the provider disowns the account') from pg_temp_pcs
 where current_status not in ('error','revoked')
   and ((blocked_reason in ('credentials_invalid','account_rejected'))<>(derived='revoked'));
-- A restricted merchant stays CONNECTED; the restriction is a health verdict.
select pg_temp.assert((select count(*)=1 and bool_and(derived='connected') from pg_temp_pcs
  where current_status='connected' and not charges_enabled and blocked_reason='requirements_past_due'),
 'a restricted merchant stays connected');

-- ---- 3. Beginning a handoff is an OWNER action ------------------------------
set local role service_role;
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_suite',
   'connect-attempt-a-0001','mch_conn_suite_a1','2035-01-01T00:05:00Z')->>'replayed')='false',
 'the owner begins a handoff');
-- A double-click must not begin a second handoff.
select pg_temp.assert(
 (select public.begin_payment_connection(pg_temp.id(1),pg_temp.id(10),'conn_suite',
   'connect-attempt-a-0001','mch_conn_suite_a2','2035-01-01T00:05:00Z')->>'replayed')='true',
 'the same idempotency key replays rather than beginning a second handoff');
reset role;
select pg_temp.assert(count(*)=1,'one handoff row for one owner attempt')
 from public.payment_connection_handoffs where tenant_id=pg_temp.id(10);
-- Beginning grants NOTHING: the connection exists so the portal can show
-- "connecting", and it cannot take money.
select pg_temp.assert((select status='not_connected' and account_id is null and not charges_enabled
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_suite'),
 'beginning a handoff grants no payment capability');

set local role service_role;
-- Staff are members, not owners. Connecting a merchant account is owner authority.
select pg_temp.reject($$select public.begin_payment_connection('93000000-0000-4000-8000-000000000002'::uuid,
 '93000000-0000-4000-8000-000000000010'::uuid,'conn_suite','connect-attempt-staff-01','mch_staff','2035-01-01T00:05:00Z')$$,'42501','FORBIDDEN');
-- Another business's owner has no authority here, whatever tenant id they pass.
select pg_temp.reject($$select public.begin_payment_connection('93000000-0000-4000-8000-000000000003'::uuid,
 '93000000-0000-4000-8000-000000000010'::uuid,'conn_suite','connect-attempt-foreign-1','mch_foreign','2035-01-01T00:05:00Z')$$,'42501','FORBIDDEN');
-- A provider this deployment has not declared confirmable cannot be connected at
-- all: 0088's allowlist is the connect-time gate, not a second list.
select pg_temp.reject($$select public.begin_payment_connection('93000000-0000-4000-8000-000000000001'::uuid,
 '93000000-0000-4000-8000-000000000010'::uuid,'not_a_listed_provider','connect-attempt-a-0002','mch_unlisted','2035-01-01T00:05:00Z')$$,'22023','PAYMENT_PROVIDER_NOT_CONFIRMABLE');
reset role;

-- ---- 4. Binding an account is write-once -----------------------------------
set local role service_role;
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_conn_suite_a1',
   'acct_conn_suite_a1',true,true,true,null,'2035-01-01T00:02:00Z')->>'status')='connected',
 'a finished handoff binds a chargeable account');
-- Replay of the SAME account is harmless.
select pg_temp.assert(
 (select public.record_payment_connection(pg_temp.id(1),pg_temp.id(10),'mch_conn_suite_a1',
   'acct_conn_suite_a1',true,true,true,null,'2035-01-01T00:03:00Z')->>'replayed')='true',
 'rebinding the same account is a harmless replay');
-- Repointing is refused. Rebinding to a DIFFERENT account would silently move a
-- tenant's money to somewhere else.
select pg_temp.reject($$select public.record_payment_connection('93000000-0000-4000-8000-000000000001'::uuid,
 '93000000-0000-4000-8000-000000000010'::uuid,'mch_conn_suite_a1','acct_somewhere_else',true,true,true,null,'2035-01-01T00:04:00Z')$$,'42501','PAYMENT_CONNECTION_ALREADY_BOUND');
-- Tenant B begins its own handoff FIRST, so that the cross-tenant attempt below
-- can only be refused by the handoff's tenant scoping -- not by B happening to
-- have no connection row yet, which would make the assertion say nothing.
select public.begin_payment_connection(pg_temp.id(3),pg_temp.id(11),'conn_suite',
 'connect-attempt-b-0001','mch_conn_suite_b1','2035-01-01T00:05:00Z');
-- An account id is not a bearer of binding authority: it may only be presented
-- against a handoff THIS tenant's owner began.
select pg_temp.reject($$select public.record_payment_connection('93000000-0000-4000-8000-000000000003'::uuid,
 '93000000-0000-4000-8000-000000000011'::uuid,'mch_conn_suite_a1','acct_conn_suite_b1',true,true,true,null,'2035-01-01T00:04:00Z')$$,'22023','no handoff of this tenant matches');
reset role;
select pg_temp.assert((select account_id='acct_conn_suite_a1' and status='connected' and charges_enabled
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_suite'),
 'the bound connection is unchanged by the refused writes');
select pg_temp.assert((select account_id='acct_conn_suite_a1' and resolved_at is not null
  from public.payment_connection_handoffs where handoff_id='mch_conn_suite_a1'),
 'the ledger records which account the handoff produced');

-- Two tenants must not bind the same connected account.
set local role service_role;
select pg_temp.reject($$select public.record_payment_connection('93000000-0000-4000-8000-000000000003'::uuid,
 '93000000-0000-4000-8000-000000000011'::uuid,'mch_conn_suite_b1','acct_conn_suite_a1',true,true,true,null,'2035-01-01T00:06:00Z')$$,'23505','payment_connections_provider_account_key');
reset role;

-- ---- 5. Observation records, it does not decide -----------------------------
set local role service_role;
-- A merchant becoming restricted: charges off, a reason, and the status STAYS
-- connected. The restriction surfaces as a health verdict, not as a status.
select pg_temp.assert(
 (select public.observe_payment_connection(pg_temp.id(10),'acct_conn_suite_a1',
   false,true,true,'requirements_past_due','2035-01-02T00:00:00Z')->>'status')='connected',
 'a restricted merchant is recorded without being disconnected');
-- Payouts failing: still charging, still connected, and the fact is recorded so a
-- person can be told the money will strand.
select pg_temp.assert(
 (select public.observe_payment_connection(pg_temp.id(10),'acct_conn_suite_a1',
   true,false,true,'payouts_disabled','2035-01-03T00:00:00Z')->>'status')='connected',
 'payouts failing does not disconnect a merchant that still charges');
-- An unknown account is not silently created.
select pg_temp.reject($$select public.observe_payment_connection('93000000-0000-4000-8000-000000000010'::uuid,
 'acct_never_bound_here',true,true,true,null,'2035-01-04T00:00:00Z')$$,'22023','CONNECTION_UNVERIFIED');
-- A header-unsafe reference cannot even be looked up, let alone recorded.
select pg_temp.reject($$select public.observe_payment_connection('93000000-0000-4000-8000-000000000010'::uuid,
 E'acct_conn_suite_a1\r\nAuthorization: Bearer stolen',true,true,true,null,'2035-01-04T00:00:00Z')$$,'22023','CONNECTION_UNVERIFIED');
reset role;
select pg_temp.assert((select account_id='acct_conn_suite_a1' and payouts_enabled=false and blocked_reason='payouts_disabled'
  from public.payment_connections where tenant_id=pg_temp.id(10) and provider='conn_suite'),
 'observation records the provider facts and never the account it was given');

-- The provider disowning the account is the one automatic route to revoked -- and
-- it is one-way. This pair is the whole safety argument in two statements.
set local role service_role;
select pg_temp.assert(
 (select public.observe_payment_connection(pg_temp.id(10),'acct_conn_suite_a1',
   false,false,true,'credentials_invalid','2035-01-05T00:00:00Z')->>'status')='revoked',
 'a provider disowning the account is recorded as revoked');
select pg_temp.assert(
 (select public.observe_payment_connection(pg_temp.id(10),'acct_conn_suite_a1',
   true,true,true,null,'2035-01-06T00:00:00Z')->>'status')='revoked',
 'automation can NEVER bring a revoked connection back');
reset role;
select pg_temp.assert((select status='revoked' from public.payment_connections
  where tenant_id=pg_temp.id(10) and provider='conn_suite'),
 'the row stays revoked after a healthy observation');

-- ---- 6. The read is member-level and returns facts, not a verdict -----------
set local role service_role;
select pg_temp.assert(
 (select jsonb_array_length(public.payment_connection_facts(pg_temp.id(2),pg_temp.id(10))->'connections'))=1,
 'staff may see that payments are degraded');
select pg_temp.assert(
 (select public.payment_connection_facts(pg_temp.id(1),pg_temp.id(10))->'connections'->0->>'status')='revoked',
 'the reader reports the stored status');
-- No verdict is computed here: health is derived in exactly one place, in
-- packages/contracts, where a 112-combination test guards it.
select pg_temp.assert(
 not ((select public.payment_connection_facts(pg_temp.id(1),pg_temp.id(10))->'connections'->0) ? 'health'),
 'the reader does not derive a second health verdict');
select pg_temp.reject($$select public.payment_connection_facts('93000000-0000-4000-8000-000000000003'::uuid,
 '93000000-0000-4000-8000-000000000010'::uuid)$$,'42501','FORBIDDEN');
reset role;

-- ---- 7. Column constraints ---------------------------------------------------
-- A reference that could splice a request header is refused at the column, not at
-- the point of use.
select pg_temp.reject($$update public.payment_connections set account_id=E'acct_evil\r\nX: 1'
 where tenant_id='93000000-0000-4000-8000-000000000011'::uuid$$,'23514','payment_connections_account_id_header_safe');
select pg_temp.reject($$update public.payment_connections set account_id='short'
 where tenant_id='93000000-0000-4000-8000-000000000011'::uuid$$,'23514','payment_connections_account_id_header_safe');
-- Provider prose can never land in the member-visible reason column.
select pg_temp.reject($$update public.payment_connections set blocked_reason='Stripe said: account_invalid (req_abc)'
 where tenant_id='93000000-0000-4000-8000-000000000011'::uuid$$,'23514','payment_connections_blocked_reason_known');
-- A BOUND connection that cannot charge must say why.
select pg_temp.reject($$update public.payment_connections
 set account_id='acct_conn_suite_b9',charges_enabled=false,blocked_reason=null
 where tenant_id='93000000-0000-4000-8000-000000000011'::uuid$$,'23514','payment_connections_blocked_reason_present');
-- An UNBOUND row is exempt: there is nothing to explain, which is why the existing
-- rows and the RLS attack fixture stay legal without the suite being edited.
update public.payment_connections set charges_enabled=false,blocked_reason=null
 where tenant_id=pg_temp.id(11) and account_id is null;
select pg_temp.assert(count(*)=1,'an unbound connection needs no reason')
 from public.payment_connections where tenant_id=pg_temp.id(11) and account_id is null;

-- ---- 8. The pre-existing tenant-mismatch hole, now closed -------------------
-- 0006 bound payment_connection_secrets.tenant_id to public.tenants and
-- .connection_id to public.payment_connections, but never the two to each other:
-- a secrets row naming tenant B against tenant A's connection satisfied every
-- foreign key in the schema. (Payments store no credential at all under the
-- Connect design, so this table stays empty for them -- the hole is closed anyway,
-- because an empty table is not an argument.)
select pg_temp.reject($$insert into public.payment_connection_secrets(connection_id,tenant_id,credentials_encrypted)
 select id,'93000000-0000-4000-8000-000000000011'::uuid,'\x00'::bytea from public.payment_connections
  where tenant_id='93000000-0000-4000-8000-000000000010'::uuid and provider='conn_suite'$$,'23503','payment_connection_secrets_connection_tenant_fkey');
insert into public.payment_connection_secrets(connection_id,tenant_id,credentials_encrypted)
 select id,tenant_id,'\x00'::bytea from public.payment_connections
  where tenant_id=pg_temp.id(10) and provider='conn_suite';
select pg_temp.assert(count(*)=1,'a correctly-tenanted secrets row is still accepted')
 from public.payment_connection_secrets s join public.payment_connections c on c.id=s.connection_id
 where c.tenant_id=pg_temp.id(10);

-- ---- 9. The ledger's own coherence ------------------------------------------
select pg_temp.reject($$insert into public.payment_connection_handoffs(handoff_id,tenant_id,provider,idempotency_key,expires_at,resolved_at)
 values('mch_incoherent','93000000-0000-4000-8000-000000000010'::uuid,'conn_suite','coherence-key-000001','2035-01-01T00:00:00Z','2035-01-01T00:00:00Z')$$,'23514','payment_connection_handoffs_resolved_coherent');
select pg_temp.reject($$insert into public.payment_connection_handoffs(handoff_id,tenant_id,provider,idempotency_key,expires_at)
 values('short','93000000-0000-4000-8000-000000000010'::uuid,'conn_suite','coherence-key-000002','2035-01-01T00:00:00Z')$$,'23514','payment_connection_handoffs_handoff_id_check');
select pg_temp.reject($$insert into public.payment_connection_handoffs(handoff_id,tenant_id,provider,idempotency_key,expires_at)
 values('mch_shortkey','93000000-0000-4000-8000-000000000010'::uuid,'conn_suite','tooshort','2035-01-01T00:00:00Z')$$,'23514','payment_connection_handoffs_idempotency_key_check');

select 'PASS payment_connection_authority_tests' as result;
rollback;
