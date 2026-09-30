import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createBookingConfirmation} from './confirmation';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool();const id=(n:number)=>`a4200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function seed(n:number,hold='active'){
 await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values($1::uuid,$2::uuid,($1::uuid)::text,($1::uuid)::text,jsonb_build_object('serviceId',$3::text),'{"total":{"amount":100,"currency":"USD"}}','2030-01-01T10:00Z','2030-01-01T11:00Z')`,[id(n),id(2),id(4)]);
 await pool.query(`insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2::uuid,$3::uuid,'fixture',($1::uuid)::text,'succeeded',100,'USD')`,[id(n+100),id(2),id(n)]);
 await pool.query('update public.bookings set payment_id=$1 where id=$2',[id(n+100),id(n)]);
 await pool.query(`insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1,$2,$3,'2030-01-01T10:00Z','2030-01-01T11:00Z','fixture-key',$4,clock_timestamp()+interval '5 minutes')`,[id(2),id(4),id(n),hold]);
}
try{
 await pool.query(`insert into auth.users(id,email) values($1,'confirmation@example.test')`,[id(1)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Confirmation','confirmation-test','UTC','USD'),($2,'Other','confirmation-other','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[id(2),id(1)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Service','simple','USD',100,60)`,[id(4),id(2)]);
 for(const n of [10,11,12,13,14,15])await seed(n,n===11?'consumed':'active');
 const confirm=createBookingConfirmation(pool);
 await assert.rejects(confirm(id(1),id(20),id(10)),{code:'FORBIDDEN'});
 await assert.rejects(confirm(id(1),id(2),id(99)),{code:'NOT_AVAILABLE'});
 const browser=await pool.connect();try{await browser.query('begin');await browser.query('set local role authenticated');await assert.rejects(browser.query('select public.confirm_succeeded_payment($1)',[id(110)]),{code:'42501'});}finally{await browser.query('rollback');browser.release();}
 const results=await Promise.all([confirm(id(1),id(2),id(10).toUpperCase()),confirm(id(1),id(2),id(10))]);assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
 assert.equal((await confirm(id(1),id(2),id(10))).replayed,true);
 assert.equal((await confirm(id(1),id(2),id(11))).state,'confirmed');
 await pool.query('update public.bookings set payment_id=null where id=$1',[id(12)]);await assert.rejects(confirm(id(1),id(2),id(12)),{code:'UNSUPPORTED_CONFIG'});
 await pool.query("update public.payments set state='processing' where id=$1",[id(113)]);await assert.rejects(confirm(id(1),id(2),id(13)),{code:'CONFLICT'});
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[id(14)]);await assert.rejects(confirm(id(1),id(2),id(14)),{code:'CONFLICT'});
 await pool.query('update public.payments set tenant_id=$1 where id=$2',[id(20),id(115)]);await assert.rejects(confirm(id(1),id(2),id(15)),{code:'CONFLICT'});
 assert.equal((await pool.query("select count(*)::int n from public.booking_state_history where booking_id=$1 and to_state='confirmed'",[id(10)])).rows[0].n,1);
 assert.equal((await pool.query("select count(*)::int n from public.bookings where id=any($1::uuid[]) and state='draft'",[[12,13,14,15].map(id)])).rows[0].n,4);
 await pool.query('alter function public.confirm_succeeded_payment(uuid) rename to fixture_hidden_confirmation');try{await assert.rejects(confirm(id(1),id(2),id(10)),{code:'UNSUPPORTED_CONFIG'});}finally{await pool.query('alter function public.fixture_hidden_confirmation(uuid) rename to confirm_succeeded_payment');}
 console.log('PASS real PostgreSQL adapter: persisted payment/active and consumed holds, concurrent once-only confirmation and replay, browser denial, tenant isolation, unsupported missing payment/RPC, invalid payment/expired hold rollback');
}finally{await pool.end();}
