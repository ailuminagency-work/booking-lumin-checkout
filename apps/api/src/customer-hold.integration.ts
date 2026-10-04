import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createCustomerHoldWriter} from './customer-hold';
import {createReservationWriter} from './reservation';
assert.equal(process.env.CUSTOMER_HOLD_LOCAL_TEST,'1');
if(process.env.CI==='true'){
 assert.equal(process.env.PGHOST,'localhost');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_phase_a_hold_ci');
}else{
 assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_hold_/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8});const hash='a'.repeat(64),origin='https://checkout.example.test',tenant='34000000-0000-4000-8000-000000000002',service='34000000-0000-4000-8000-000000000003';
try{
 const fixture=(await readFile(new URL('../../../supabase/tests/customer_session_hold_tests.sql',import.meta.url),'utf8')).split('select pg_temp.assert(not has_function_privilege')[0]!.replace(/^\\set.*$/gm,'');
 await pool.query(fixture+'commit;');
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[tenant,service]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n`,[tenant,service]);
 const hold=createCustomerHoldWriter(pool);
 await assert.rejects(hold('b'.repeat(64),origin),{code:'FORBIDDEN'});await assert.rejects(hold(hash,'https://foreign.example'),{code:'FORBIDDEN'});
 const first=await hold(hash,origin);assert.deepEqual(await hold(hash,origin),first);
 await assert.rejects(createReservationWriter(pool)('34000000-0000-4000-8000-000000000099',tenant,first.bookingId),{code:'FORBIDDEN'});
 // Independently issued session creates a separate request competing for the same capacity.
 await pool.query(`select public.issue_flow_session('34000000-0000-4000-8000-000000000006',$1,$2)`,['c'.repeat(64),origin]);
 await pool.query(`select public.submit_flow_request($1,$2,'hold-request-00002','{"count":{"quantity":1}}','{"name":"Other","email":"other@example.test"}',date_trunc('day',clock_timestamp())+interval '1 day 10 hours')`,['c'.repeat(64),origin]);
 await assert.rejects(hold('c'.repeat(64),origin),{code:'CONFLICT'});
 assert.equal(Number((await pool.query('select count(*) n from public.capacity_holds')).rows[0].n),1);
 // Provenance mismatch cannot reserve a different service.
 await pool.query(`update public.bookings set selection='{"serviceId":"34000000-0000-4000-8000-000000000099"}' where id=$1`,[first.bookingId]);
 await assert.rejects(hold(hash,origin),{code:'FORBIDDEN'});
 await pool.query(`update public.bookings set selection=jsonb_build_object('serviceId',$2::text) where id=$1`,[first.bookingId,service]);
 // Capability target locks revocation, installation edits, provenance, and policy/resource inserts.
 const locked=await pool.connect(),attacker=await pool.connect();try{await locked.query('begin');await locked.query('select public.customer_flow_hold_target($1,$2)',[hash,origin]);
 for(const sql of [
  `update public.flow_sessions set revoked=true where token_hash='${hash}'`,
  `update public.flow_installations set allowed_origins='["https://foreign.example.test"]' where id='34000000-0000-4000-8000-000000000006'`,
  `delete from public.flow_requests where booking_id='${first.bookingId}'`,
  `lock table public.service_resources in row exclusive mode`,
  `lock table public.allocation_policies in row exclusive mode`
 ]){await attacker.query('begin');await attacker.query("set local lock_timeout='100ms'");await assert.rejects(attacker.query(sql),{code:'55P03'});await attacker.query('rollback');}
 }finally{await locked.query('rollback');await attacker.query('rollback');locked.release();attacker.release();}
 // Distinct sessions serialize at the existing capacity authority; exactly one wins.
 await pool.query('delete from public.capacity_holds');
 const contention=await pool.connect();await contention.query('begin');await contention.query(`select pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||$1::text||':'||$2::text,0))`,[tenant,service]);
 const outcomesPromise=Promise.allSettled([hold(hash,origin),hold('c'.repeat(64),origin)]);let bothWaiting=false;
 for(let i=0;i<100;i++){bothWaiting=Number((await pool.query(`select count(*) n from pg_stat_activity where datname=current_database() and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0`)).rows[0].n)>=2;if(bothWaiting)break;await new Promise(r=>setTimeout(r,10));}
 await contention.query('rollback');contention.release();assert.ok(bothWaiting,'both customer transactions waited at capacity authority');
 const outcomes=await outcomesPromise;assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal((outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'CONFLICT');
 // Hold transaction blocks at capacity authority until after session expiry: it rolls back.
 await pool.query('delete from public.capacity_holds');
 await pool.query(`update public.flow_sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1`,[hash]);
 const blocker=await pool.connect();await blocker.query('begin');await blocker.query(`select pg_advisory_xact_lock(hashtextextended('lumin:service-capacity:'||$1::text||':'||$2::text,0))`,[tenant,service]);
 const pending=hold(hash,origin).then(()=>null,e=>e);let waiting=false;
 for(let i=0;i<100;i++){waiting=Number((await pool.query(`select count(*) n from pg_stat_activity where datname=current_database() and wait_event='advisory' and cardinality(pg_blocking_pids(pid))>0`)).rows[0].n)>0;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(waiting,'hold must actually wait on reserve_capacity advisory lock');
 await new Promise(r=>setTimeout(r,2100));await blocker.query('rollback');blocker.release();assert.equal((await pending)?.code,'FORBIDDEN');
 assert.equal(Number((await pool.query('select count(*) n from public.capacity_holds')).rows[0].n),0);
 assert.equal(Number((await pool.query("select count(*) n from public.bookings where state<>'draft'")).rows[0].n),0);
 assert.equal(Number((await pool.query('select count(*) n from public.payments')).rows[0].n),0);
 console.log('PASS customer provenance, exact retry, owner denial, capacity conflict, mismatch denial, authority locks, concurrent final-capacity serialization, expiry during blocked reservation rollback, draft/no-payment invariants');
}finally{await pool.end();}
