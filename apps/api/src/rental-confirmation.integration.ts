import assert from "node:assert/strict";
import {Pool} from "pg";

if(process.env.FLOW_TEST_DISPOSABLE!=="1"||process.env.PGHOST!=="127.0.0.1"||!/lumin_/.test(process.env.PGDATABASE??""))throw Error("disposable loopback database required");
const pool=new Pool({max:8});
const id=(n:number)=>`a2400000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const tenant=id(1),service=id(2),resource=id(3);
const slotStart="2035-01-01T10:00:00Z",slotEnd="2035-01-01T13:00:00Z";

async function call(payment:string){
 const c=await pool.connect();
 try{await c.query("begin");await c.query("set local statement_timeout='5s'");await c.query("set local role service_role");const r=await c.query("select public.confirm_succeeded_payment($1::uuid) result",[payment]);await c.query("commit");return r.rows[0].result;}
 catch(error){await c.query("rollback").catch(()=>{});throw error;}finally{c.release();}
}
async function seed(n:number,amount=350){
 const booking=id(n),payment=id(n+100);
 await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values($1,$2,$3,$3,jsonb_build_object('serviceId',$4::text,'itemQuantities','{}'::jsonb,'addonIds','[]'::jsonb,'answers','{}'::jsonb,'rentalPeriods',3),jsonb_build_object('total',jsonb_build_object('amount',300,'currency','USD'),'deposit',jsonb_build_object('amount',50,'currency','USD')),$5,$6)`,[booking,tenant,booking,service,slotStart,slotEnd]);
 await pool.query(`insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1,$2,$3,'fixture',$1,'succeeded',$4,'USD')`,[payment,tenant,booking,amount]);
 await pool.query(`insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity) values($1,$2,$3,$4,$5,$3,'held',clock_timestamp()+interval '5 minutes',1)`,[tenant,resource,booking,slotStart,slotEnd]);
 return{booking,payment};
}
try{
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Rental Confirmation','rental-confirmation-fixture','UTC','USD')`,[tenant]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,tax_rate_bp,rental) values($1,$2,'Fixture rental','rental','USD',0,60,0,'{"periodMinutes":60,"pricePerPeriod":100,"minPeriods":1,"maxPeriods":8,"depositAmount":50}')`,[service,tenant]);
 await pool.query(`insert into public.resources(id,tenant_id,name,kind,capacity,active) values($1,$2,'Fixture vehicle','vehicle',1,true)`,[resource,tenant]);
 await pool.query(`insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values($1,$2,$3,1)`,[tenant,service,resource]);
 const first=await seed(10);const results=await Promise.all([call(first.payment),call(first.payment)]);assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
 const state=(await pool.query(`select b.state,b.payment_id,rr.status from public.bookings b join public.resource_reservations rr on rr.booking_id=b.id where b.id=$1`,[first.booking])).rows[0];assert.deepEqual(state,{state:"confirmed",payment_id:first.payment,status:"consumed"});
 assert.equal((await call(first.payment)).replayed,true);
 const expired=await seed(11);await pool.query("update public.resource_reservations set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[expired.booking]);await assert.rejects(call(expired.payment),{code:"40001"});
 const mismatch=await seed(12,349);await assert.rejects(call(mismatch.payment),{code:"22023"});
 const unchanged=(await pool.query("select state,payment_id from public.bookings where id=$1",[mismatch.booking])).rows[0];assert.deepEqual(unchanged,{state:"draft",payment_id:null});
 console.log("PASS rental confirmation: server-derived persisted total+deposit amount, serialized exactly-once hold consumption, consumed replay, expired-hold rejection, amount mismatch and rollback");
}finally{await pool.end();}
