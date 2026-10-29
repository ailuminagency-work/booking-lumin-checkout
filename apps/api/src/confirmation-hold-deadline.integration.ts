import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {Pool} from 'pg';
assert.equal(process.env.CONFIRMATION_HOLD_DEADLINE_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let host='127.0.0.1';
if(process.env.CI==='true'){assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_confirmation_deadline_ci');host=process.env.CONFIRMATION_HOLD_DEADLINE_CI_DATABASE_HOST??'';assert.equal(isIP(host),4);assert.match(host,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);}else{assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_confirmation_deadline_local_[a-z0-9_]+$/);}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:7,options:'-c statement_timeout=10000'}),id=(n:number)=>'88000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function snapshot(){return(await pool.query(`select jsonb_build_object('bookings',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.bookings t),'payments',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.payments t),'holds',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.capacity_holds t),'resources',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.resource_reservations t),'history',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.booking_state_history t),'outbox',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.durable_outbox t)) value`)).rows[0].value;}
async function waiting(prefix:string){for(let n=0;n<100;n++){if((await pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1) waiting",[prefix+'%'])).rows[0].waiting)return;await sleep(10);}assert.fail('expected actual lock wait');}
const setup=await pool.connect();
try{
 assert.deepEqual((await setup.query('select current_database() d,current_user u,host(inet_server_addr()) h,inet_server_port() p')).rows[0],{d:process.env.PGDATABASE,u:'postgres',h:host,p:Number(process.env.PGPORT)});
 const sql=readFileSync(new URL('../../../supabase/tests/confirmation_hold_deadline.sql',import.meta.url),'utf8');
 await setup.query(sql.slice(sql.indexOf('begin;'),sql.indexOf('create temp table expectation')).replaceAll('87000000','88000000')+'\ncommit;');
 for(const [n,rental] of [[50,false],[51,true],[52,false],[53,false]] as const)await setup.query('select pg_temp.seed($1,$2)',[n,rental]);
 for(const n of [50,51]){const results=await Promise.all([pool.query('select public.confirm_succeeded_payment($1) result',[id(n+100)]),pool.query('select public.confirm_succeeded_payment($1) result',[id(n+100)])]);assert.deepEqual(results.map(r=>r.rows[0].result.replayed).sort(),[false,true]);assert.equal(results[0]!.rows[0].result.state,'confirmed');}
 const beforeReplay=await snapshot();for(const n of [50,51])assert.equal((await pool.query('select public.confirm_succeeded_payment($1) result',[id(n+100)])).rows[0].result.replayed,true);assert.deepEqual(await snapshot(),beforeReplay);
 const blocker=await pool.connect();try{
  await pool.query("update public.capacity_holds set expires_at=clock_timestamp()+interval '1 second' where booking_id=$1",[id(52)]);const before=await snapshot();
  await blocker.query('begin');await blocker.query('select id from public.payments where id=$1 for update',[id(152)]);
  const rejected=assert.rejects(pool.query('select public.confirm_succeeded_payment($1)',[id(152)]),{code:'40001'});await waiting('select public.confirm_succeeded_payment');await sleep(1100);await blocker.query('commit');await rejected;assert.deepEqual(await snapshot(),before);
 }finally{await blocker.query('rollback');blocker.release();}
 const fence=await pool.connect();try{
  await fence.query('begin');await fence.query("select pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||$1::text||':'||$2::text,0))",[id(3),id(5)]);
  const confirm=pool.query('select public.confirm_succeeded_payment($1) result',[id(153)]);await waiting('select public.confirm_succeeded_payment');
  const reserve=pool.query("select * from public.reserve_capacity($1,$2,(select slot_start from public.bookings where id=$3),(select slot_end from public.bookings where id=$3),$3,1,interval '5 minutes')",[id(3),id(5),id(53)]);await waiting('select * from public.reserve_capacity');await fence.query('commit');
  assert.equal((await confirm).rows[0].result.replayed,false);assert.equal((await reserve).rows[0].hold_status,'consumed');
 }finally{await fence.query('rollback');fence.release();}
 assert.deepEqual((await pool.query("select (select count(*)::int from public.bookings where tenant_id=$1 and state='confirmed') confirmed,(select count(*)::int from public.durable_outbox where tenant_id=$1) outbox,(select count(*)::int from public.capacity_holds where tenant_id=$1 and status='consumed') simple_consumed,(select count(*)::int from public.resource_reservations where tenant_id=$1 and status='consumed') rental_consumed",[id(3)])).rows[0],{confirmed:3,outbox:3,simple_consumed:2,rental_consumed:1});
 console.log('PASS actual confirmation deadline: simple/rental concurrent replay, complete-row lock-wait expiry rollback, mixed capacity/confirmation ordering without deadlock');
}finally{setup.release();await pool.end();}
