import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createReservationWriter} from './reservation';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool({max:6});const id=(n:number)=>`a4100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pool.query(`insert into auth.users(id,email) values($1,'hold-fixture@example.test');`,[id(1)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Hold fixture','hold-fixture','UTC','USD'),($2,'Foreign','hold-foreign','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[id(2),id(1)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Service','simple','USD',0,60)`,[id(4),id(2)]);
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[id(2),id(4)]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n`,[id(2),id(4)]);
 for(const n of [3,5])await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end) values($1::uuid,$2::uuid,($1::uuid)::text,($1::uuid)::text,jsonb_build_object('serviceId',$3::text),(date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day 10 hours'+$4::interval) at time zone 'UTC',(date_trunc('day',clock_timestamp() at time zone 'UTC')+interval '1 day 11 hours'+$4::interval) at time zone 'UTC')`,[id(n),id(2),id(4),n===3?'0 minutes':'30 minutes']);
 const reserve=createReservationWriter(pool);
 await assert.rejects(reserve(id(1),id(20),id(3)),{code:'FORBIDDEN'});
 await assert.rejects(reserve(id(99),id(2),id(3)),{code:'FORBIDDEN'});
  const blocker=await pool.connect();
 await blocker.query('begin');
 await blocker.query(`select pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||$1::text||':'||$2::text,0))`,[id(2),id(4)]);
 const pending=Promise.allSettled([reserve(id(1),id(2),id(3)),reserve(id(1),id(2),id(5))]);
 let observed=false;
 try{for(let attempt=0;attempt<100;attempt++){
  const waiting=(await pool.query(`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0`)).rows[0].n;
  if(waiting>=2){observed=true;break;}await new Promise(r=>setTimeout(r,20));
 }}finally{await blocker.query('commit');blocker.release();}
 const outcomes=await pending;
 assert.ok(observed,'both real reservation transactions observed waiting for the capacity advisory lock');
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1,JSON.stringify(outcomes));
 const failure=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'CONFLICT');
 const success=(outcomes.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>>).value;
 assert.deepEqual(await reserve(id(1),id(2),success.bookingId),success,'same booking retry retains hold and expiry');
 assert.equal((await pool.query(`select count(*)::int n from public.capacity_holds where status='active'`)).rows[0].n,1);
 assert.equal((await pool.query(`select count(*)::int n from public.bookings where state='draft'`)).rows[0].n,2);
 assert.equal((await pool.query(`select count(*)::int n from public.payments`)).rows[0].n,0);
 console.log('PASS real PostgreSQL tenant denial, overlapping final-capacity contention, exact retry, draft/no-payment invariants');
}finally{await pool.end();}
