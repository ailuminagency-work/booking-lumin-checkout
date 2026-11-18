// Actual PostgreSQL catalog mutation tests. Synthetic transport, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createMigrationAttestationReader,MIGRATION_ATTESTATION_HEAD} from './migration-attestation.ts';
import {runHostedReadiness} from '../../../scripts/phase-a-hosted-readiness.mjs';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:2});
const read=createMigrationAttestationReader(pool);
const migration=fs.readFileSync(new URL('../../../supabase/migrations/0129_late_success_resource_attestation.sql',import.meta.url),'utf8');
const guard=migration.match(/do \$check\$[\s\S]*?end \$check\$;/)[0];
const changes=[
 ["attention missing", "drop table payment_internal.payment_attention"],
 ["attention immutable trigger disabled", "alter table payment_internal.payment_attention disable trigger payment_attention_immutable"],
 ["attention service column select", "grant select(reason) on payment_internal.payment_attention to service_role"],
 ["attention client read", "grant select on payment_internal.payment_attention to authenticated"],
 ["attention RLS disabled", "alter table payment_internal.payment_attention disable row level security"],
 ["attention check removed", "alter table payment_internal.payment_attention drop constraint payment_attention_reason_check"],
 ["attention reader PUBLIC", "grant execute on function payment_internal.read_payment_attention(uuid,uuid) to public"],
 ["attention reader invoker", "alter function payment_internal.read_payment_attention(uuid,uuid) security invoker"],
 ["resource release helper changed", "create or replace function lumin.release_resource_holds(p_booking_id uuid) returns integer language plpgsql security definer set search_path='' as $$begin return 0;end$$"],
 ["resource admission invoker", "alter function lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer) security invoker"],
 ["resource admission service revoked", "revoke execute on function lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer) from service_role"],
 ["resource admission public grant", "grant execute on function lumin.reserve_resource_quantity(uuid,uuid,timestamptz,timestamptz,uuid,interval,integer) to public"],

 ["payment_internal.confirm_scoped_payment(uuid) service grant", "grant execute on function payment_internal.confirm_scoped_payment(uuid) to service_role"],
 ["payment_internal.confirm_scoped_payment(uuid) PUBLIC grant", "grant execute on function payment_internal.confirm_scoped_payment(uuid) to public"],
 ["payment_internal.confirm_scoped_payment(uuid) definer", "alter function payment_internal.confirm_scoped_payment(uuid) security definer"],
 ["payment_internal.confirm_scoped_payment(uuid) missing", "drop function payment_internal.confirm_scoped_payment(uuid)"],
 ["payment_internal.confirm_scoped_payment(uuid) arbitrary grant", "create role synthetic_success_core_reader; grant execute on function payment_internal.confirm_scoped_payment(uuid) to synthetic_success_core_reader"],
 ["payment_internal.apply_payment_success(uuid,bigint) service grant", "grant execute on function payment_internal.apply_payment_success(uuid,bigint) to service_role"],
 ["payment_internal.apply_payment_success(uuid,bigint) PUBLIC grant", "grant execute on function payment_internal.apply_payment_success(uuid,bigint) to public"],
 ["payment_internal.apply_payment_success(uuid,bigint) definer", "alter function payment_internal.apply_payment_success(uuid,bigint) security definer"],
 ["payment_internal.apply_payment_success(uuid,bigint) missing", "drop function payment_internal.apply_payment_success(uuid,bigint)"],
 ["payment_internal.apply_payment_success(uuid,bigint) arbitrary grant", "create role synthetic_success_core_reader; grant execute on function payment_internal.apply_payment_success(uuid,bigint) to synthetic_success_core_reader"],
 ["payment_internal.park_scoped_payment(uuid,text,bigint) service grant", "grant execute on function payment_internal.park_scoped_payment(uuid,text,bigint) to service_role"],
 ["payment_internal.park_scoped_payment(uuid,text,bigint) PUBLIC grant", "grant execute on function payment_internal.park_scoped_payment(uuid,text,bigint) to public"],
 ["payment_internal.park_scoped_payment(uuid,text,bigint) definer", "alter function payment_internal.park_scoped_payment(uuid,text,bigint) security definer"],
 ["payment_internal.park_scoped_payment(uuid,text,bigint) missing", "drop function payment_internal.park_scoped_payment(uuid,text,bigint)"],
 ["payment_internal.park_scoped_payment(uuid,text,bigint) arbitrary grant", "create role synthetic_success_core_reader; grant execute on function payment_internal.park_scoped_payment(uuid,text,bigint) to synthetic_success_core_reader"],
 ["success processor missing", "drop function payment_internal.process_scoped_success_receipt(uuid)"],
 ["success processor PUBLIC", "grant execute on function payment_internal.process_scoped_success_receipt(uuid) to public"],
 ["success processor invoker", "alter function payment_internal.process_scoped_success_receipt(uuid) security invoker"],
 ["success processor path", "alter function payment_internal.process_scoped_success_receipt(uuid) set search_path=public"],

 ['v2 closed version/facts removed','alter table payment_internal.event_receipts drop constraint event_receipts_version_facts_check'],
 ['v2 received default inferred','alter table payment_internal.event_receipts alter column amount_received set default 0'],
 ['v2 status service column read','grant select(intent_status) on payment_internal.event_receipts to service_role'],
 ['v2 received service column write','grant update(amount_received) on payment_internal.event_receipts to service_role'],
 ['core arbitrary nonowner grant','create role synthetic_failure_core_reader; grant execute on function payment_internal.apply_payment_failure(uuid) to synthetic_failure_core_reader'],
 ["private failure core missing", "drop function payment_internal.apply_payment_failure(uuid)"],
 ["private failure core PUBLIC execute", "grant execute on function payment_internal.apply_payment_failure(uuid) to public"],
 ["private failure core path", "alter function payment_internal.apply_payment_failure(uuid) set search_path=public"],
 ["private failure core stable", "alter function payment_internal.apply_payment_failure(uuid) stable"],
 ["scoped failure processor missing", "drop function payment_internal.process_scoped_failure_receipt(uuid)"],
 ["scoped failure processor PUBLIC execute", "grant execute on function payment_internal.process_scoped_failure_receipt(uuid) to public"],
 ["scoped failure processor path", "alter function payment_internal.process_scoped_failure_receipt(uuid) set search_path=public"],
 ["scoped failure processor stable", "alter function payment_internal.process_scoped_failure_receipt(uuid) stable"],
 ["core service execute", "grant execute on function payment_internal.apply_payment_failure(uuid) to service_role"],
 ["core definer", "alter function payment_internal.apply_payment_failure(uuid) security definer"],
 ["processor invoker", "alter function payment_internal.process_scoped_failure_receipt(uuid) security invoker"],
 ["processor service revoked", "revoke execute on function payment_internal.process_scoped_failure_receipt(uuid) from service_role"],
 ["confirmation absent", "drop function public.confirm_succeeded_payment(uuid)"],
 ["confirmation client grant", "grant execute on function public.confirm_succeeded_payment(uuid) to anon"],
 ["confirmation service revoked", "revoke execute on function public.confirm_succeeded_payment(uuid) from service_role"],
 ["confirmation invoker", "alter function public.confirm_succeeded_payment(uuid) security invoker"],
 ["confirmation path", "alter function public.confirm_succeeded_payment(uuid) set search_path=public"],
 ["confirmation stable", "alter function public.confirm_succeeded_payment(uuid) stable"],
 ["admission absent", "drop function payment_internal.admit_payment_identity(text,boolean) cascade"],
 ["admission client grant", "grant execute on function payment_internal.admit_payment_identity(text,boolean) to anon"],
 ["admission service grant", "grant execute on function payment_internal.admit_payment_identity(text,boolean) to service_role"],
 ["admission invoker", "alter function payment_internal.admit_payment_identity(text,boolean) security invoker"],
 ["admission path", "alter function payment_internal.admit_payment_identity(text,boolean) set search_path=public"],
 ["admission stable", "alter function payment_internal.admit_payment_identity(text,boolean) stable"],
 ["identity guard absent", "drop function lumin.guard_payment_identity_admission() cascade"],
 ["identity guard client grant", "grant execute on function lumin.guard_payment_identity_admission() to anon"],
 ["identity guard service grant", "grant execute on function lumin.guard_payment_identity_admission() to service_role"],
 ["identity guard invoker", "alter function lumin.guard_payment_identity_admission() security invoker"],
 ["identity guard path", "alter function lumin.guard_payment_identity_admission() set search_path=public"],
 ["identity guard stable", "alter function lumin.guard_payment_identity_admission() stable"],
 ["identity trigger disabled", "alter table payments disable trigger payment_identity_admission_guard"],
 ["scoped partial unique removed", "drop index payments_scoped_intent_unique"],
 ["legacy index invalid", "update pg_index set indisvalid=false where indexrelid='payments_legacy_intent_unique'::regclass"],
 ["scoped index notready", "update pg_index set indisready=false where indexrelid='payments_scoped_intent_unique'::regclass"],
 ["legacy predicate altered", "drop index payments_legacy_intent_unique;create unique index payments_legacy_intent_unique on payments(provider,provider_intent_id) where source_scope_id is null"],
 ["scoped predicate altered", "drop index payments_scoped_intent_unique;create unique index payments_scoped_intent_unique on payments(provider,source_scope_id,provider_intent_id) where source_scope_id is not null"],
 ["legacy webhook absent", "drop function public.process_legacy_payment_webhook(text,text,bigint,text,boolean)"],
 ["legacy webhook client grant", "grant execute on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) to anon"],
 ["legacy webhook service revoked", "revoke execute on function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) from service_role"],
 ["legacy webhook invoker", "alter function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) security invoker"],
 ["legacy webhook path", "alter function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) set search_path=public"],
 ["legacy webhook stable", "alter function public.process_legacy_payment_webhook(text,text,bigint,text,boolean) stable"],
 ["refund dependency absent", "drop function public.record_refund_webhook(uuid,text,bigint,boolean,boolean)"],
 ["refund dependency client grant", "grant execute on function public.record_refund_webhook(uuid,text,bigint,boolean,boolean) to anon"],
 ["refund dependency service revoked", "revoke execute on function public.record_refund_webhook(uuid,text,bigint,boolean,boolean) from service_role"],
 ["refund dependency invoker", "alter function public.record_refund_webhook(uuid,text,bigint,boolean,boolean) security invoker"],
 ["refund dependency path", "alter function public.record_refund_webhook(uuid,text,bigint,boolean,boolean) set search_path=public"],
 ["refund dependency stable", "alter function public.record_refund_webhook(uuid,text,bigint,boolean,boolean) stable"],
 ["scoped writer missing", "drop function payment_internal.record_scoped_payment_observation(uuid,text) cascade"],
 ["scoped writer client grant", "grant execute on function payment_internal.record_scoped_payment_observation(uuid,text) to anon"],
 ["scoped writer invoker", "alter function payment_internal.record_scoped_payment_observation(uuid,text) security invoker"],
 ["scoped writer path", "alter function payment_internal.record_scoped_payment_observation(uuid,text) set search_path=public"],
 ["receipt resolver missing", "drop function payment_internal.resolve_quarantined_payment_receipt(uuid) cascade"],
 ["receipt resolver client grant", "grant execute on function payment_internal.resolve_quarantined_payment_receipt(uuid) to anon"],
 ["receipt resolver invoker", "alter function payment_internal.resolve_quarantined_payment_receipt(uuid) security invoker"],
 ["receipt resolver path", "alter function payment_internal.resolve_quarantined_payment_receipt(uuid) set search_path=public"],
 ["provenance guard missing", "drop function lumin.guard_payment_provenance() cascade"],
 ["provenance guard client grant", "grant execute on function lumin.guard_payment_provenance() to anon"],
 ["provenance guard invoker", "alter function lumin.guard_payment_provenance() security invoker"],
 ["provenance guard path", "alter function lumin.guard_payment_provenance() set search_path=public"],
 ["provenance trigger disabled", "alter table payments disable trigger payment_provenance_guard"],
 ["provenance pairing removed", "alter table payments drop constraint payments_provenance_pair"],
 ["provenance attempt unique removed", "alter table payments drop constraint payments_attempt_unique"],
 ["provenance source FK removed", "alter table payments drop constraint payments_source_scope_id_fkey"],
 ["provenance intent FK removed", "alter table payments drop constraint payments_attempt_id_fkey"],
 ["provenance default drift", "alter table payments alter column source_scope_id set default gen_random_uuid()"],
 ["resolver volatile", "alter function payment_internal.resolve_quarantined_payment_receipt(uuid) volatile"],
 ["scoped writer service revoked", "revoke execute on function payment_internal.record_scoped_payment_observation(uuid,text) from service_role"],
 ['legacy recording RPC missing','drop function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text)'],
 ['legacy RPC client grant','grant execute on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) to anon'],
 ['legacy RPC service revoked','revoke execute on function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) from service_role'],
 ['legacy RPC invoker','alter function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) security invoker'],
 ['legacy RPC path','alter function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) set search_path=public'],
 ['legacy RPC stable','alter function public.record_legacy_payment_observation(uuid,uuid,text,text,bigint,text) stable'],
 ['legacy partial uniqueness removed','drop index public.payments_legacy_intent_unique'],
 ['receipt event identifier constraint removed','alter table payment_internal.event_receipts drop constraint event_receipts_event_id_check'],
 ['receipt intent identifier constraint removed','alter table payment_internal.event_receipts drop constraint event_receipts_intent_id_check'],
 ['receipt supported type constraint removed','alter table payment_internal.event_receipts drop constraint event_receipts_event_type_check'],
 ['receipt RPC absent','drop function payment_internal.record_quarantined_event(jsonb)'],
 ['receipt RPC client execute','grant execute on function payment_internal.record_quarantined_event(jsonb) to authenticated'],
 ['receipt RPC service revoked','revoke execute on function payment_internal.record_quarantined_event(jsonb) from service_role'],
 ['receipt RPC invoker','alter function payment_internal.record_quarantined_event(jsonb) security invoker'],
 ['receipt RPC path','alter function payment_internal.record_quarantined_event(jsonb) set search_path=public'],
 ['receipt RPC stability','alter function payment_internal.record_quarantined_event(jsonb) stable'],
 ['receipt service column read','grant select(intent_amount) on payment_internal.event_receipts to service_role'],
 ['receipt service column write','grant update(intent_amount) on payment_internal.event_receipts to service_role'],
 ['conflict service insert','grant insert(receipt_id) on payment_internal.event_receipt_conflicts to service_role'],
 ['receipt RLS disabled','alter table payment_internal.event_receipts disable row level security'],
 ['conflict FORCE disabled','alter table payment_internal.event_receipt_conflicts no force row level security'],
 ['receipt trigger disabled','alter table payment_internal.event_receipts disable trigger event_receipts_immutable'],
 ['conflict trigger disabled','alter table payment_internal.event_receipt_conflicts disable trigger event_receipt_conflicts_immutable'],
 ['receipt default drift',"alter table payment_internal.event_receipts alter column quarantine_state set default 'handled'"],
 ['conflict timestamp default drift','alter table payment_internal.event_receipt_conflicts alter column first_seen_at drop default'],
 ['envelope RPC absent','drop function public.snapshot_payment_request_envelope(uuid,uuid,text)'],
 ['private materializer absent','drop function payment_internal.materialize_payment_request_envelope(uuid,uuid)'],
 ['private materializer client execute','grant execute on function payment_internal.materialize_payment_request_envelope(uuid,uuid) to authenticated'],
 ['private schema client usage','grant usage on schema payment_internal to anon'],
 ['private schema PUBLIC usage','grant usage on schema payment_internal to public'],
 ['private schema service create','grant create on schema payment_internal to service_role'],
 ['private schema service usage revoked','revoke usage on schema payment_internal from service_role'],
 ['materializer volatile','alter function payment_internal.materialize_payment_request_envelope(uuid,uuid) volatile'],
 ['materializer invoker','alter function payment_internal.materialize_payment_request_envelope(uuid,uuid) security invoker'],
 ['envelope service column read','grant select(api_version) on public.payment_request_envelopes to service_role'],
 ['envelope service column write','grant update(api_version) on public.payment_request_envelopes to service_role'],
 ['envelope client column read','grant select(api_version) on public.payment_request_envelopes to anon'],
 ['envelope RLS disabled','alter table public.payment_request_envelopes disable row level security'],
 ['envelope trigger disabled','alter table public.payment_request_envelopes disable trigger payment_request_envelopes_immutable'],
 ['envelope default drift','alter table public.payment_request_envelopes alter column serializer_version set default 2'],
 ['restart RPC absent','drop function public.read_payment_attempt_restart(uuid,uuid)'],
 ['restart body drift',"create or replace function public.read_payment_attempt_restart(p_tenant_id uuid,p_booking_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin return null;end$$"],
 ['restart volatile','alter function public.read_payment_attempt_restart(uuid,uuid) volatile'],
 ['restart invoker','alter function public.read_payment_attempt_restart(uuid,uuid) security invoker'],
 ['restart path','alter function public.read_payment_attempt_restart(uuid,uuid) set search_path=public'],
 ['restart client grant','grant execute on function public.read_payment_attempt_restart(uuid,uuid) to authenticated'],
 ['restart PUBLIC grant','grant execute on function public.read_payment_attempt_restart(uuid,uuid) to public'],
 ['restart service revoked','revoke execute on function public.read_payment_attempt_restart(uuid,uuid) from service_role'],
 ['request table absent','alter table public.payment_attempt_requests rename to synthetic_missing_request'],
 ['intent table absent','alter table public.payment_attempt_intents rename to synthetic_missing_intent'],
 ['request RPC missing','drop function public.snapshot_payment_attempt_request(uuid,uuid,bigint,text)'],
 ['intent RPC missing','drop function public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text)'],
 ['request body replaced',"create or replace function public.snapshot_payment_attempt_request(p_tenant_id uuid,p_attempt_id uuid,p_amount bigint,p_currency text) returns public.payment_attempt_requests language plpgsql security definer set search_path='' as $$begin return null;end$$"],
 ['intent invoker drift','alter function public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text) security invoker'],
 ['request path drift','alter function public.snapshot_payment_attempt_request(uuid,uuid,bigint,text) set search_path=public'],
 ['request client execute','grant execute on function public.snapshot_payment_attempt_request(uuid,uuid,bigint,text) to anon'],
 ['intent client execute','grant execute on function public.associate_payment_attempt_intent(uuid,uuid,text,text,text,boolean,bigint,text) to authenticated'],
 ['request RLS disabled','alter table public.payment_attempt_requests disable row level security'],
 ['intent FORCE disabled','alter table public.payment_attempt_intents no force row level security'],
 ['request policy added','create policy synthetic_request_policy on public.payment_attempt_requests for select to authenticated using(true)'],
 ['request trigger disabled','alter table public.payment_attempt_requests disable trigger payment_attempt_requests_immutable'],
 ['intent trigger missing','drop trigger payment_attempt_intents_immutable on public.payment_attempt_intents'],
 ['intent scope uniqueness removed','alter table public.payment_attempt_intents drop constraint payment_attempt_intents_source_scope_id_provider_intent_id_key'],
 ['request amount nullable','alter table public.payment_attempt_requests alter column amount drop not null'],
 ['request version default drift','alter table public.payment_attempt_requests alter column schema_version set default 2'],
 ['intent timestamp default drift','alter table public.payment_attempt_intents alter column created_at drop default'],
 ['request service table read','grant select on public.payment_attempt_requests to service_role'],
 ['intent service column read','grant select(provider_intent_id) on public.payment_attempt_intents to service_role'],
 ['request service column read','grant select(amount) on public.payment_attempt_requests to service_role'],
 ['request PUBLIC column read','grant select(amount) on public.payment_attempt_requests to public'],
 ['intent client column read','grant select(provider_intent_id) on public.payment_attempt_intents to authenticated'],
 ['request service column write','grant update(amount) on public.payment_attempt_requests to service_role'],
 ['intent service column insert','grant insert(attempt_id) on public.payment_attempt_intents to service_role'],
 ['review guard disabled','alter table public.payment_reviews disable trigger payment_review_writer_guard'],
 ['review guard missing','drop trigger payment_review_writer_guard on public.payment_reviews'],
 ['success body replaced',"create or replace function public.succeed_payment_webhook(p_payment_id uuid,p_observed_amount bigint) returns jsonb language sql as $$select '{}'::jsonb$$"],
 ['success made strict','alter function public.succeed_payment_webhook(uuid,bigint) strict'],
 ['failure security removed','alter function public.fail_payment_webhook(uuid) security invoker'],
 ['park search path changed','alter function public.park_payment_webhook(uuid,text,bigint) set search_path=public'],
 ['RPC client execute granted','grant execute on function public.succeed_payment_webhook(uuid,bigint) to authenticated'],
 ['source RLS disabled','alter table public.payment_source_scopes disable row level security'],
 ['source FORCE removed','alter table public.booking_payment_attempt_sources no force row level security'],
 ['source mutation granted','grant update on public.payment_source_scopes to service_role'],
 ['source column insert granted','grant insert(tenant_id,connection_id,platform_account_id,connected_account_id,livemode) on public.payment_source_scopes to service_role'],
 ['attempt column update granted','grant update(source_scope_id) on public.booking_payment_attempt_sources to service_role'],
 ['source column references granted','grant references(id) on public.payment_source_scopes to service_role'],
 ['review column references granted','grant references(payment_id) on public.payment_reviews to service_role'],
 ['client column select granted','grant select(connected_account_id) on public.payment_source_scopes to authenticated'],
 ['client column insert granted','grant insert(reason) on public.payment_reviews to anon'],
 ['client column update granted','grant update(status) on public.payment_reviews to authenticated'],
 ['client column references granted','grant references(id) on public.booking_payment_attempt_sources to anon'],
 ['review erase granted','grant delete on public.payment_reviews to service_role'],
 ['source client policy added','create policy synthetic_bypass on public.payment_source_scopes for select to authenticated using(true)'],
 ['immutable trigger disabled','alter table public.payment_source_scopes disable trigger payment_source_scopes_immutable'],
 ['immutable trigger wrong function','drop trigger payment_source_scopes_immutable on public.payment_source_scopes; create trigger payment_source_scopes_immutable before update or delete on public.payment_source_scopes for each row execute function lumin.guard_payment_review_writer()'],
 ['attempt immutable trigger disabled','alter table public.booking_payment_attempt_sources disable trigger booking_payment_attempt_sources_immutable'],
 ['source binding function missing','drop function public.bind_booking_payment_source(uuid,uuid,uuid)'],
 ['source registration definition changed',"alter function public.register_payment_source_scope(uuid,text,boolean) set search_path=public"],
 ['table column nullable','alter table public.payment_source_scopes alter column livemode drop not null'],
 ['source identity uniqueness removed','alter table public.booking_payment_attempt_sources drop constraint booking_payment_attempt_sources_booking_id_provider_key'],
 ['source table absent','alter table public.booking_payment_attempt_sources rename to synthetic_missing_source_table'],
 ['review identity body altered',"create or replace function lumin.guard_payment_review_writer() returns trigger language plpgsql security definer set search_path='' as $$begin return NEW;end$$"],
];
const denialMigration=fs.readFileSync(new URL('../../../supabase/migrations/0120_reject_scoped_legacy_financial_rpcs.sql',import.meta.url),'utf8').replace(/\r/g,'');
for(const name of ['confirm_succeeded_payment','succeed_payment_webhook','fail_payment_webhook','park_payment_webhook','record_refund_webhook']){
 const definition=denialMigration.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$fn\\$;'))[0];
 const stripped=definition.replace(/\n  -- Legacy authority only: reject BEFORE terminal no-op, dedupe or effects\.\n  if (?:p|v_payment)\.source_scope_id is not null or (?:p|v_payment)\.attempt_id is not null then\n    raise exception 'SCOPED_PAYMENT_PROCESSING_DISABLED' using errcode='42501';\n  end if;/,'');
 assert.notEqual(stripped,definition);changes.push([name+' scoped denial removed',stripped]);
}

try{
 const witness=await read();assert.equal(witness.migrationHead,MIGRATION_ATTESTATION_HEAD);
 const env={BOOKING_LUMIN_READINESS:'1',BOOKING_LUMIN_API_BASE_URL:'https://api.example.test',BOOKING_LUMIN_SUPABASE_URL:'https://project.example.test',BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN:'test-only-fixture-token-no-credentials'};
 const result=await runHostedReadiness(env,{log:()=>{},fetchImpl:async url=>url.pathname==='/version'?Response.json({schemaVersion:1,service:'booking-lumin-api',environment:'staging',releaseSha:'0123456789abcdef0123456789abcdef01234567',migrationHead:MIGRATION_ATTESTATION_HEAD}):url.pathname==='/api/staging/readiness/migration'?Response.json(await read()):new Response('',{status:405})});
 assert.equal(result.migrationAttestation.migrationHead,MIGRATION_ATTESTATION_HEAD);console.log('PASS actual DB reader through synthetic readiness transport');
 for(const [label,sql] of changes){
  const c=await pool.connect();try{
   await c.query('begin');await c.query(sql);
   if(label==='source column insert granted'){
    const tenant=randomUUID(),connection=randomUUID();
    await c.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'ACL fixture',$1::uuid::text,'UTC','USD')",[tenant]);
    await c.query("insert into public.payment_connections(id,tenant_id,provider,status,account_id,charges_enabled) values($1,$2,'stripe_connect','connected','acct_expectedAAA',true)",[connection,tenant]);
    assert.equal((await c.query("select has_table_privilege('service_role','public.payment_source_scopes','INSERT') allowed")).rows[0].allowed,false);
    await c.query('set local role service_role');
    // This intentionally demonstrates the bypass created by the privileged
    // column grant. The attestation must detect it, not pretend table ACLs deny it.
    await c.query("insert into public.payment_source_scopes(tenant_id,connection_id,platform_account_id,connected_account_id,livemode) values($1,$2,'acct_platformAAA','acct_WRONGaccount',false)",[tenant,connection]);
    await c.query('reset role');
    const row=(await c.query('select s.connected_account_id,c.account_id from public.payment_source_scopes s join public.payment_connections c on c.id=s.connection_id where s.tenant_id=$1',[tenant])).rows[0];
    assert.notEqual(row.connected_account_id,row.account_id);
   }
   assert.equal((await c.query('select lumin.payment_readiness_contract() ok')).rows[0].ok,false,label);
   // Map only transaction boundaries to savepoints, so the production reader's
   // real SQL and SET ROLE observe rollback-only catalog corruption safely.
   const scoped={connect:async()=>({release:()=>{},query:async(q,...args)=>{
    if(q==='begin')return c.query('savepoint reader');
    if(q==='commit')return c.query('release savepoint reader');
    if(q==='rollback'){await c.query('rollback to savepoint reader');return c.query('release savepoint reader');}
    return c.query(q,...args);
   }})};
   await assert.rejects(createMigrationAttestationReader(scoped)(),/MIGRATION_ATTESTATION_SCHEMA_MISMATCH/);
   await c.query('savepoint guard');await assert.rejects(c.query(guard),/MIGRATION_ATTESTATION_PAYMENT_CONTRACT_MISMATCH/);await c.query('rollback to savepoint guard');
   assert.equal((await c.query('select migration_head from public.booking_lumin_schema_attestation')).rows[0].migration_head,MIGRATION_ATTESTATION_HEAD);
   console.log('PASS rejects mutated contract:',label);
  }finally{await c.query('rollback');c.release();}
  assert.equal((await read()).migrationHead,MIGRATION_ATTESTATION_HEAD);
 }
 const predecessor=await pool.connect();
 try{
  await predecessor.query('begin');
  await assert.rejects(predecessor.query(guard),/MIGRATION_ATTESTATION_PREDECESSOR_MISMATCH/);
 }finally{await predecessor.query('rollback');predecessor.release();}
 assert.equal((await read()).migrationHead,MIGRATION_ATTESTATION_HEAD);
 console.log('PASS healthy contract cannot blindly advance from wrong predecessor');
 const witnessChanges=[
  ['unexpanded 0123 witness',"alter table public.booking_lumin_schema_attestation drop constraint booking_lumin_schema_attestation_migration_head_check; update public.booking_lumin_schema_attestation set migration_head='0123_scoped_failure_receipt_attestation'"],
  ['missing witness','delete from public.booking_lumin_schema_attestation'],
  ['stale witness',"alter table public.booking_lumin_schema_attestation drop constraint booking_lumin_schema_attestation_migration_head_check; update public.booking_lumin_schema_attestation set migration_head='0100_security_advisor_hardening'"],
  ['forged evidence',"alter table public.booking_lumin_schema_attestation drop constraint booking_lumin_schema_attestation_evidence_check; update public.booking_lumin_schema_attestation set evidence='full_chain'"],
 ];
 for(const [label,sql] of witnessChanges){
  const c=await pool.connect();try{
   await c.query('begin');await c.query(sql);
   const scoped={connect:async()=>({release:()=>{},query:async(q,...args)=>{
    if(q==='begin')return c.query('savepoint reader');
    if(q==='commit')return c.query('release savepoint reader');
    if(q==='rollback'){await c.query('rollback to savepoint reader');return c.query('release savepoint reader');}
    return c.query(q,...args);
   }})};
   await assert.rejects(createMigrationAttestationReader(scoped)(),/MIGRATION_ATTESTATION_MISMATCH/);
   console.log('PASS actual reader rejects',label);
  }finally{await c.query('rollback');c.release();}
 }
 console.log(`${changes.length} negative catalog mutations rejected by actual reader AND migration guard`);
}finally{await pool.end();}
