import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createBookingConfirmation} from './confirmation';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool();const id=(n:number)=>`a4200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await pool.query(`insert into auth.users(id,email) values($1,'confirmation@example.test')`,[id(1)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Confirmation','confirmation-test','UTC','USD'),($2,'Other','confirmation-other','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[id(2),id(1)]);
 await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end) values($1::uuid,$2::uuid,($1::uuid)::text,($1::uuid)::text,'{}',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour')`,[id(3),id(2)]);
 const snapshot=async()=> (await pool.query(`select (select jsonb_agg(to_jsonb(b)) from public.bookings b) bookings,(select count(*) from public.payments) payments,(select count(*) from public.capacity_holds) holds,(select count(*) from public.booking_state_history) history`)).rows[0];
 const before=await snapshot();const confirm=createBookingConfirmation(pool);
 await assert.rejects(confirm(id(1),id(2),id(3)),{code:'UNSUPPORTED_CONFIG'});
 await assert.rejects(confirm(id(1),id(20),id(3)),{code:'FORBIDDEN'});
 await assert.rejects(confirm(id(1),id(2),id(99)),{code:'NOT_AVAILABLE'});
 const attempts=await Promise.allSettled(Array.from({length:4},()=>confirm(id(1),id(2),id(3))));
 assert.ok(attempts.every(x=>x.status==='rejected'&&x.reason.code==='UNSUPPORTED_CONFIG'));
 assert.deepEqual(await snapshot(),before,'confirmation attempts cause no booking, payment, hold or history mutation');
 console.log('PASS real PostgreSQL confirmation denial, tenant/booking isolation, concurrent denial and zero mutations');
}finally{await pool.end();}
