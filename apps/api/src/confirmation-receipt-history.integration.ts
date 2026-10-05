import assert from 'node:assert/strict';
import type {Pool as PgPool} from 'pg';
import {createConfirmationReceiptHistoryReader} from './confirmation-receipt-history.js';

// Synthetic, persistent fixture in a FRESH disposable loopback DB only. Never hosted.
// Replays require a new DB name; no destructive cleanup or provider operations.
const env=process.env;
if(env.CONFIRMATION_RECEIPT_HISTORY_LOCAL_TEST!=='1'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='55463'||env.PGUSER!=='postgres'
 ||!/^lumin_confirmation_receipt_history_reader_[a-z0-9_]+$/.test(env.PGDATABASE??'')
 ||['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'].some(key=>!!env[key]))throw Error('LOCAL_RECEIPT_HISTORY_GUARD');
const {Pool}=await import('pg');
const pool=new Pool({host:env.PGHOST,port:55463,user:'postgres',database:env.PGDATABASE,max:8,options:'-c timezone=America/Los_Angeles',statement_timeout:10000});
const id=(n:number)=>`68000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(3),booking=id(10);
let stage='target';
async function fingerprint(){
 const result:Record<string,unknown>={};
 for(const table of ['tenants','tenant_members','bookings','payments','capacity_holds','durable_outbox','confirmation_delivery_receipts'])result[table]=(await pool.query(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) as value from public.${table} r`)).rows[0].value;
 return result;
}
function pausedReader(){
 let reach!:()=>void,release!:()=>void;
 const reached=new Promise<void>(resolve=>{reach=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const wrapped={connect:async()=>{const client=await pool.connect();return {query:async(sql:string,args?:unknown[])=>{
  if(sql.includes('outbox_confirmation_receipt_history')){reach();await Promise.race([gate,new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(Error('LOCAL_GATE_TIMEOUT')),5000))]);}
  return client.query(sql,args);
 },release:(broken:boolean)=>client.release(broken)};}};
 return{read:createConfirmationReceiptHistoryReader(wrapped as unknown as PgPool),reached,release};
}
async function waitForLock(pid:number){
 const deadline=Date.now()+3000;
 while(Date.now()<deadline){if((await pool.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw Error('LOCAL_LOCK_PROOF_UNAVAILABLE');
}
try{
 const target=(await pool.query('select host(inet_server_addr()) as host,inet_server_port() as port,current_database() as name,current_user as actor')).rows[0];
 assert.deepEqual(target,{host:'127.0.0.1',port:55463,name:env.PGDATABASE,actor:'postgres'});
 assert.equal((await pool.query("select to_regprocedure('public.outbox_confirmation_receipt_history(uuid,uuid)') is not null as ready")).rows[0].ready,true);
 assert.equal((await pool.query('select (select count(*) from public.tenants)+(select count(*) from auth.users) as count')).rows[0].count,'0','fresh database required');
 stage='seed';
 const admin=await pool.connect();
 try{await admin.query(`begin;
 create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('68000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
 insert into auth.users(id,email) values(pg_temp.id(1),'history-owner@example.test'),(pg_temp.id(2),'history-foreign@example.test'),(pg_temp.id(6),'history-staff@example.test'),(pg_temp.id(7),'history-worker@example.test');
 insert into public.tenants(id,name,slug,timezone,currency,status) values(pg_temp.id(3),'Reader proof','history-reader-proof','UTC','USD','active'),(pg_temp.id(4),'Foreign proof','history-reader-foreign','UTC','USD','active'),(pg_temp.id(5),'Suspended proof','history-reader-suspended','UTC','USD','suspended');
 insert into public.tenant_members(tenant_id,user_id,role) values(pg_temp.id(3),pg_temp.id(1),'BUSINESS_OWNER'),(pg_temp.id(4),pg_temp.id(2),'BUSINESS_OWNER'),(pg_temp.id(5),pg_temp.id(1),'BUSINESS_OWNER'),(pg_temp.id(3),pg_temp.id(6),'BUSINESS_STAFF');
 insert into public.workers(id,tenant_id,display_name) values(pg_temp.id(20),pg_temp.id(3),'Synthetic worker');
 insert into public.worker_access(tenant_id,user_id,worker_id,active) values(pg_temp.id(3),pg_temp.id(7),pg_temp.id(20),true);
 insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values(pg_temp.id(8),pg_temp.id(3),'Simple proof','simple','USD',100,60);
 insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values
 (pg_temp.id(10),pg_temp.id(3),'HISTORY-CONFIRMED',pg_temp.id(10)::text,jsonb_build_object('serviceId',pg_temp.id(8)),'{"total":{"amount":100,"currency":"USD"}}','2035-01-01T10:00Z','2035-01-01T11:00Z'),
 (pg_temp.id(11),pg_temp.id(3),'HISTORY-EMPTY',pg_temp.id(11)::text,'{}','{}','2035-01-02T10:00Z','2035-01-02T11:00Z'),
 (pg_temp.id(12),pg_temp.id(4),'HISTORY-FOREIGN',pg_temp.id(12)::text,'{}','{}','2035-01-03T10:00Z','2035-01-03T11:00Z'),
 (pg_temp.id(13),pg_temp.id(5),'HISTORY-SUSPENDED',pg_temp.id(13)::text,'{}','{}','2035-01-04T10:00Z','2035-01-04T11:00Z');
 insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values(pg_temp.id(110),pg_temp.id(3),pg_temp.id(10),'staging_mock','history-synthetic-payment','succeeded',100,'USD');
 insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values(pg_temp.id(3),pg_temp.id(8),pg_temp.id(10),'2035-01-01T10:00Z','2035-01-01T11:00Z','history-synthetic-hold','active',clock_timestamp()+interval '5 minutes');
 select public.confirm_succeeded_payment(pg_temp.id(110));
 insert into public.confirmation_delivery_receipts(tenant_id,booking_id,channel,delivered_at) values(pg_temp.id(3),pg_temp.id(10),'email','2026-10-01T12:34:56.123456Z');
 commit;`);}catch(error){await admin.query('rollback');throw error;}finally{admin.release();}
 stage='baseline';
 const read=createConfirmationReceiptHistoryReader(pool),before=await fingerprint();
 const email={channel:'email',recordedAt:'2026-10-01T12:34:56.123456Z'};
 assert.equal((await pool.query('select state from public.bookings where id=$1',[booking])).rows[0].state,'confirmed');
 assert.deepEqual(await read(actor,tenant,booking),{schemaVersion:1,tenantId:tenant,bookingId:booking,receipts:[email]});
 assert.deepEqual((await read(actor,tenant,id(11))).receipts,[]);
 for(const user of [id(2),id(6),id(7)])await assert.rejects(read(user,tenant,booking),{code:'FORBIDDEN',message:'FORBIDDEN'});
 await assert.rejects(read(actor,id(5),id(13)),{code:'FORBIDDEN'});
 await assert.rejects(read(actor,tenant,id(12)),{code:'NOT_AVAILABLE'});
 assert.deepEqual(await fingerprint(),before,'reader must not mutate authority/queue/ledger');
 stage='snapshot';
 const snapshot=pausedReader(),pendingSnapshot=snapshot.read(actor,tenant,booking);await snapshot.reached;
 const sms={channel:'sms',recordedAt:'2026-10-02T01:02:03.654321Z'};
 await pool.query("insert into public.confirmation_delivery_receipts(tenant_id,booking_id,channel,delivered_at) values($1,$2,'sms','2026-10-02T01:02:03.654321Z')",[tenant,booking]);
 snapshot.release();assert.deepEqual((await pendingSnapshot).receipts,[email],'in-flight repeatable-read retains its original receipt snapshot');
 assert.deepEqual((await read(actor,tenant,booking)).receipts,[email,sms],'fresh explicit read sees the new stored receipt');
 stage='owner-fence';
 const fenced=pausedReader(),pendingOwner=fenced.read(actor,tenant,booking);await fenced.reached;
 const writer=await pool.connect();try{
  const pid=(await writer.query('select pg_backend_pid() as pid')).rows[0].pid;
  const removal=writer.query('delete from public.tenant_members where tenant_id=$1 and user_id=$2',[tenant,actor]);
  await waitForLock(pid);fenced.release();assert.deepEqual((await pendingOwner).receipts,[email,sms]);await removal;
 }finally{fenced.release();writer.release();}
 await assert.rejects(read(actor,tenant,booking),{code:'FORBIDDEN'});
 stage='malformed-metadata';
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 await pool.query("update public.confirmation_delivery_receipts set delivered_at='infinity' where tenant_id=$1 and booking_id=$2 and channel='sms'",[tenant,booking]);
 await assert.rejects(read(actor,tenant,booking),{code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});
 console.log('Confirmation receipt history actual local PostgreSQL proof PASS: confirmed/empty, foreign/staff/worker/suspended denials, microsecond UTC metadata, no writes, repeatable-read snapshot, owner removal lock/fresh denial, malformed metadata rejection. No provider calls.');
}catch{
 console.error('CONFIRMATION_RECEIPT_HISTORY_LOCAL_PROOF_FAILED',stage);process.exitCode=1;
}finally{await pool.end();}
