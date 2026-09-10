/** Disposable local PG fixtures; never deployed, never create fixture groups. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client,Pool,type PoolConfig} from 'pg';
export function config():PoolConfig{
 assert.equal(process.env.LOCAL_HARNESS,'1');assert.equal(process.env.FLOW_TEST_DISPOSABLE,'1');assert.equal(process.env.ALLOCATOR_TRANSPORT_TEST_DISPOSABLE,'1');
 assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST??''));assert.match(process.env.PGDATABASE??'',/^lumin_allocator_transport_[a-z0-9_]+$/);
 return {host:process.env.PGHOST,port:Number(process.env.PGPORT??5432),user:process.env.PGUSER,database:process.env.PGDATABASE,password:process.env.PGPASSWORD,pipeline:false,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:5000,statement_timeout:5000,lock_timeout:5000,idle_in_transaction_session_timeout:1000,query_timeout:0};
}
export const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export async function observe(check:()=>Promise<boolean>,label:string,ms=8000){const end=performance.now()+ms;do{if(await check())return;await pause(20);}while(performance.now()<end);throw Error('Observation failed: '+label);}
export async function observer(){const c=new Client({...config(),statement_timeout:3000,idle_in_transaction_session_timeout:0});c.on('error',()=>{});await c.connect();assert.equal((await c.query("select to_regprocedure('public.allocate_planning_group(uuid,uuid,uuid,uuid,bigint)') is not null ok")).rows[0].ok,true);const layout=process.env.ALLOCATOR_TRANSPORT_CRYPTO_LAYOUT;assert.ok(layout==='public'||layout==='extensions');assert.equal((await c.query("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'")).rows[0].nspname,layout);await c.query(await readFile(new URL('../../../supabase/tests/group_lifecycle_fixture.sql',import.meta.url),'utf8'));return c;}
export type Fixture=ReturnType<typeof identities>;
function identities(){return {actor:randomUUID(),tenant:randomUUID(),booking:randomUUID(),service:randomUUID(),crew:randomUUID(),worker:randomUUID(),resource:randomUUID()};}
export async function seed(c:Client){const f=identities();await c.query('begin');try{
 await c.query('select pg_temp.fixture_parents($1,$2,$3,$4,$5,$6,$7)',[f.actor,f.tenant,f.booking,f.service,f.crew,f.worker,f.resource]);
 await c.query("update public.bookings set slot_start=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '10 hours',slot_end=((clock_timestamp() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'+interval '11 hours' where id=$1",[f.booking]);
 await c.query('insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)',[f.tenant,f.service]);
 await c.query("insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,extract(dow from slot_start at time zone 'UTC'),0,1440,2 from public.bookings where id=$3",[f.tenant,f.service,f.booking]);
 await c.query("insert into public.worker_shifts(id,tenant_id,worker_id,kind,starts_at,ends_at,source_time_zone,active) select $1,$2,$3,'available',slot_start-interval '10 hours',slot_end+interval '13 hours','UTC',true from public.bookings where id=$4",[randomUUID(),f.tenant,f.worker,f.booking]);await c.query('commit');return f;
 }catch(e){await c.query('rollback');throw e;}}
export const actor=(f:Fixture)=>({mode:'local_synthetic' as const,userId:f.actor});
export const request=(f:Fixture)=>({tenantId:f.tenant,bookingId:f.booking,crewId:f.crew,targetGeneration:1});
export async function state(c:Client,f:Fixture){return (await c.query(`select jsonb_build_object(
 'heads',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.allocation_group_heads x where tenant_id=$1),
 'groups',(select coalesce(jsonb_agg(to_jsonb(x) order by id,generation),'[]') from public.allocation_groups x where tenant_id=$1),
 'capacity',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.capacity_holds x where tenant_id=$1),
 'resources',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.resource_reservations x where tenant_id=$1),
 'booking',(select to_jsonb(x) from public.bookings x where id=$2),
 'workerManifest',(select coalesce(jsonb_agg(to_jsonb(x) order by group_id,generation,worker_id),'[]') from public.allocation_group_workers x where tenant_id=$1),
 'resourceManifest',(select coalesce(jsonb_agg(to_jsonb(x) order by group_id,generation,resource_id),'[]') from public.allocation_group_resources x where tenant_id=$1),
 'workers',(select coalesce(jsonb_agg(to_jsonb(x) order by worker_id,generation),'[]') from public.worker_interval_holds x where tenant_id=$1)) value`,[f.tenant,f.booking])).rows[0].value;}
export async function blocker(){const c=new Client({...config(),statement_timeout:15000,lock_timeout:15000,idle_in_transaction_session_timeout:0});c.on('error',()=>{});await c.connect();await c.query('begin');return c;}
export async function blocked(c:Client,pid:number,holder:number){await observe(async()=> (await c.query("select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and $2=any(pg_blocking_pids(pid))) ok",[pid,holder])).rows[0].ok,'actual blocked PID');}
export async function gone(c:Client,pid:number){await observe(async()=>!(await c.query('select exists(select 1 from pg_stat_activity where pid=$1) ok',[pid])).rows[0].ok,'eventual backend disappearance',9000);}
export function pool(){return new Pool(config());}

/** Driver backend key identity used only for independently observed test PIDs. */
export function backendPid(client:Client){const n=(client as unknown as {processID:unknown}).processID;assert.ok(typeof n==='number'&&Number.isInteger(n)&&n>0);return n;}
/** Permanent test-only FK tables are required: PostgreSQL forbids temp-to-permanent FKs. */
export async function commitFixture(c:Client){const name='transport_probe_'+randomUUID().replaceAll('-','');const parent=randomUUID();
 await c.query(`create schema ${name}`);await c.query(`create table ${name}.parent(id uuid primary key)`);await c.query(`create table ${name}.child(id uuid, constraint commit_fk foreign key(id) references ${name}.parent(id) deferrable initially deferred)`);await c.query(`insert into ${name}.parent values($1)`,[parent]);
 return {name,parent,defer:`set constraints ${name}.commit_fk deferred`,insert:`insert into ${name}.child values($1)`,lock:`select id from ${name}.parent where id=$1 for update`,cleanup:()=>c.query(`drop schema ${name} cascade`)};
}
