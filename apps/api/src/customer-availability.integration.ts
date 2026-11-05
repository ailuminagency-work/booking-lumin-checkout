import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createCustomerAvailabilityReader} from './customer-availability';
// Only a disposable loopback database; never accepts DATABASE_URL/remote overrides.
assert.equal(process.env.CUSTOMER_SCOPE_LOCAL_TEST,'1');
assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));
assert.match(process.env.PGDATABASE??'',/^lumin_[a-z0-9_]+$/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:3}),a=await pool.connect(),b=await pool.connect();
const hash='a'.repeat(64),origin='https://checkout.example.test';
try {
 const fixture=(await readFile(new URL('../../../supabase/tests/customer_session_availability_tests.sql',import.meta.url),'utf8')).split('select pg_temp.assert(not has_function_privilege')[0]!.replace(/^\\set.*$/gm,'');
 await a.query(fixture);await a.query('commit');
 await a.query('begin');await a.query('select public.customer_flow_availability_scope($1,$2)',[hash,origin]);
 for(const mutation of ["update public.flow_sessions set revoked=true where token_hash=$1","update public.flow_installations set allowed_origins='[\"https://foreign.example.test\"]' where id='34000000-0000-4000-8000-000000000006'"]){
  await b.query('begin');await b.query("set local lock_timeout='100ms'");
  await assert.rejects(b.query(mutation,mutation.includes('$1')?[hash]:[]),{code:'55P03'});await b.query('rollback');
 }
 await a.query('rollback');
 // Expiry while waiting on active-tenant authority must withhold the read.
 const warm=await pool.connect();warm.release();
 await a.query("update public.flow_sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1",[hash]);
 await a.query('begin');await a.query("select id from public.tenants where id='34000000-0000-4000-8000-000000000002' for update");
 const result=createCustomerAvailabilityReader(pool)(hash,origin,'2030-01-01T00:00:00Z','2030-01-02T00:00:00Z').then(()=>null,e=>e);
 let waiting=false;const deadline=Date.now()+1200;
 while(Date.now()<deadline){
  waiting=(await b.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select public.customer_flow_availability_scope%') waiting")).rows[0]?.waiting===true;
  if(waiting)break;await new Promise(r=>setTimeout(r,10));
 }
 assert.ok(waiting,'reader must actually wait on the locked tenant before expiry');
 const remaining=Number((await b.query('select greatest(0,extract(epoch from expires_at-clock_timestamp())*1000) remaining from public.flow_sessions where token_hash=$1',[hash])).rows[0]?.remaining);
 assert.ok(Number.isFinite(remaining));await new Promise(r=>setTimeout(r,remaining+30));await a.query('rollback');
 assert.equal((await result)?.code,'FORBIDDEN');
 console.log('PASS customer capability row locks and expiry during blocked read');
} finally {await a.query('rollback').catch(()=>{});await b.query('rollback').catch(()=>{});a.release();b.release();await pool.end();}
