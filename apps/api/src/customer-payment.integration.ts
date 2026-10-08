import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createCustomerHoldWriter} from './customer-hold';
import {createCustomerConfirmation,createCustomerMockPayment} from './customer-payment';
assert.equal(process.env.CUSTOMER_PAYMENT_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.equal(process.env.PGHOST,'localhost');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_phase_a_payment_ci');}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_payment_/);}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),hash='a'.repeat(64),origin='https://checkout.example.test',tenant='34000000-0000-4000-8000-000000000002',service='34000000-0000-4000-8000-000000000003';
try{
 const fixture=(await readFile(new URL('../../../supabase/tests/customer_session_hold_tests.sql',import.meta.url),'utf8')).split('select pg_temp.assert(not has_function_privilege')[0]!.replace(/^\\set.*$/gm,'');await pool.query(fixture+'commit;');
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[tenant,service]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n`,[tenant,service]);
 const hold=await createCustomerHoldWriter(pool)(hash,origin),confirm=createCustomerConfirmation(pool),mock=createCustomerMockPayment(pool,{BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'});
 await assert.rejects(confirm('b'.repeat(64),origin),{code:'FORBIDDEN'});await assert.rejects(confirm(hash,'https://foreign.example'),{code:'FORBIDDEN'});
 await assert.rejects(confirm(hash,origin),{code:'UNSUPPORTED_CONFIG'});
 await assert.rejects(mock(hash,origin),{code:'UNSUPPORTED_CONFIG'});assert.equal(Number((await pool.query('select count(*) n from public.payments')).rows[0].n),0);
 // Legacy published requests carry answers and zero-price questions: even catalog repricing cannot bypass the existing mock contract.
 await pool.query('update public.services set base_price=12500 where id=$1',[service]);await assert.rejects(mock(hash,origin),{code:'UNSUPPORTED_CONFIG'});
 assert.equal(Number((await pool.query('select count(*) n from public.payments')).rows[0].n),0);
 // Controlled persisted provider evidence only, injected by the disposable fixture. This is not proof of a priced published request or provider completion.
 const payment=(await pool.query(`insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1,$2,'staging_mock','customer-confirmation-fixture','succeeded',12500,'USD') returning id`,[tenant,hold.bookingId])).rows[0].id;
 await pool.query(`update public.bookings set payment_id=$2,pricing='{"total":{"amount":12500,"currency":"USD"}}' where id=$1`,[hold.bookingId,payment]);
 await pool.query(`update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1`,[hold.bookingId]);await assert.rejects(confirm(hash,origin),{code:'CONFLICT'});
 await pool.query(`update public.capacity_holds set expires_at=clock_timestamp()+interval '5 minutes' where booking_id=$1`,[hold.bookingId]);
 // Recheck session expiry after waiting inside the existing payment-first authority.
 await pool.query(`update public.flow_sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=$1`,[hash]);
 const blocker=await pool.connect();try{
 await blocker.query('begin');await blocker.query('select id from public.payments where id=$1 for update',[payment]);const pending=confirm(hash,origin).then(()=>null,e=>e);let waiting=false;
 for(let i=0;i<100;i++){waiting=(await pool.query(`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select public.confirm_succeeded_payment%') waiting`)).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(waiting,'customer confirmation actually waited at payment-first authority');await new Promise(r=>setTimeout(r,2100));await blocker.query('rollback');assert.equal((await pending)?.code,'FORBIDDEN');
 }finally{await blocker.query('rollback');blocker.release();}
 assert.equal((await pool.query('select state from public.bookings where id=$1',[hold.bookingId])).rows[0].state,'draft');assert.equal((await pool.query('select status from public.capacity_holds where booking_id=$1',[hold.bookingId])).rows[0].status,'active');
 await pool.query(`update public.flow_sessions set expires_at=clock_timestamp()+interval '15 minutes' where token_hash=$1`,[hash]);
 const receipts=await Promise.all([confirm(hash,origin),confirm(hash,origin)]);assert.deepEqual(receipts.map(r=>r.replayed).sort(),[false,true]);assert.equal(receipts[0].paymentId,payment);assert.equal((await confirm(hash,origin)).replayed,true);
 await pool.query('update public.flow_sessions set revoked=true where token_hash=$1',[hash]);await assert.rejects(confirm(hash,origin),{code:'FORBIDDEN'});
 console.log('PASS legacy customer mock remains unsupported with zero payment writes, persisted-evidence confirmation, expired hold denial, payment-first concurrent replay, session expiry full rollback, revoked replay denial');
}finally{await pool.end();}
