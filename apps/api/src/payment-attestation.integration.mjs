// Actual PostgreSQL catalog mutation tests. Synthetic transport, no provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {createMigrationAttestationReader,MIGRATION_ATTESTATION_HEAD} from './migration-attestation.ts';
import {runHostedReadiness} from '../../../scripts/phase-a-hosted-readiness.mjs';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:2});
const read=createMigrationAttestationReader(pool);
const migration=fs.readFileSync(new URL('../../../supabase/migrations/0103_payment_readiness_attestation.sql',import.meta.url),'utf8');
const guard=migration.match(/do \$check\$[\s\S]*?end \$check\$;/)[0];
const changes=[
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
try{
 const witness=await read();assert.equal(witness.migrationHead,MIGRATION_ATTESTATION_HEAD);
 const env={BOOKING_LUMIN_READINESS:'1',BOOKING_LUMIN_API_BASE_URL:'https://api.example.test',BOOKING_LUMIN_SUPABASE_URL:'https://project.example.test',BOOKING_LUMIN_MIGRATION_ATTESTATION_TOKEN:'test-only-fixture-token-no-credentials'};
 const result=await runHostedReadiness(env,{log:()=>{},fetchImpl:async url=>url.pathname==='/version'?Response.json({schemaVersion:1,service:'booking-lumin-api',environment:'staging',releaseSha:'0123456789abcdef0123456789abcdef01234567',migrationHead:MIGRATION_ATTESTATION_HEAD}):url.pathname==='/api/staging/readiness/migration'?Response.json(await read()):new Response('',{status:405})});
 assert.equal(result.migrationAttestation.migrationHead,MIGRATION_ATTESTATION_HEAD);console.log('PASS actual DB reader through synthetic readiness transport');
 for(const [label,sql] of changes){
  const c=await pool.connect();try{
   await c.query('begin');await c.query(sql);
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
 const witnessChanges=[
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
