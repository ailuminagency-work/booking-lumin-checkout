import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createMockPaymentWriter} from './mock-payment';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||!/^lumin_/.test(process.env.PGDATABASE??'')||process.env.PGHOST!=='127.0.0.1')throw Error('disposable loopback database required');
const pool=new Pool();const id=(n:number)=>`a5700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function seed(n:number){await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,slot_start,slot_end) values($1::uuid,$2::uuid,($1::uuid)::text,($1::uuid)::text,jsonb_build_object('serviceId',$3::text),'2030-01-01T10:00Z','2030-01-01T11:00Z')`,[id(n),id(2),id(3)]);await pool.query(`insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1,$2,$3,'2030-01-01T10:00Z','2030-01-01T11:00Z','mock-fixture-key','active',clock_timestamp()+interval '5 minutes')`,[id(2),id(3),id(n)]);}
try{
 await pool.query(`insert into auth.users(id,email) values($1,'mock@example.test')`,[id(1)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Mock','mock-fixture','UTC','USD'),($2,'Other','mock-other','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[id(2),id(1)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Service','simple','USD',100,60)`,[id(3),id(2)]);
 for(const n of [10,11,12])await seed(n);
 const write=createMockPaymentWriter(pool,{BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'});
 await assert.rejects(write(id(1),id(20),id(10)),{code:'FORBIDDEN'});
 const receipts=await Promise.all([write(id(1),id(2),id(10)),write(id(1),id(2),id(10))]);assert.deepEqual(receipts.map(x=>x.replayed).sort(),[false,true]);assert.equal(receipts[0].paymentId,receipts[1].paymentId);assert.equal((await write(id(1),id(2),id(10))).replayed,true);
 assert.deepEqual((await pool.query('select provider,state,amount::int,currency from public.payments')).rows,[{provider:'staging_mock',state:'succeeded',amount:100,currency:'USD'}]);
 await pool.query(`update public.bookings set pricing='{"total":{"amount":1,"currency":"USD"}}' where id=$1`,[id(11)]);await assert.rejects(write(id(1),id(2),id(11)),{code:'CONFLICT'});
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[id(12)]);await assert.rejects(write(id(1),id(2),id(12)),{code:'CONFLICT'});
 assert.deepEqual((await pool.query('select state,pricing,payment_id from public.bookings where id=$1',[id(12)])).rows[0],{state:'draft',pricing:{},payment_id:null});
 assert.equal((await pool.query('select count(*)::int n from public.payments')).rows[0].n,1);
 await pool.query('update public.services set tax_rate_bp=100 where id=$1',[id(3)]);await assert.rejects(write(id(1),id(2),id(10)),{code:'UNSUPPORTED_CONFIG'});
 console.log('PASS fake-only PostgreSQL completion: server base price, concurrent replay one payment, tenant denial, stored price tamper denial, expired hold full rollback, unsupported tax, no provider I/O');
}finally{await pool.end();}
