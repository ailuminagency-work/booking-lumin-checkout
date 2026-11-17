import assert from "node:assert/strict";
import {Pool} from "pg";

if(process.env.FLOW_TEST_DISPOSABLE!=="1"||process.env.PGHOST!=="127.0.0.1"||!/lumin_/.test(process.env.PGDATABASE??""))throw Error("disposable loopback database required");
const pool=new Pool({max:8});
const id=(n:number)=>`a2400000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const tenant=id(1),service=id(2),resource=id(3),foreignTenant=id(4),simpleService=id(5),extraResource=id(6),foreignResource=id(7);
const slotStart="2035-01-01T10:00:00Z",slotEnd="2035-01-01T13:00:00Z";

async function call(payment:string){
 const c=await pool.connect();
 try{await c.query("begin");await c.query("set local statement_timeout='5s'");await c.query("set local role service_role");const r=await c.query("select public.confirm_succeeded_payment($1::uuid) result",[payment]);await c.query("commit");return r.rows[0].result;}
 catch(error){await c.query("rollback").catch(()=>{});throw error;}finally{c.release();}
}
async function seed(n:number,amount=350){
 const booking=id(n),payment=id(n+100);
 // Each rejection scenario owns a distinct slot so exclusive holds do not collide.
 const slotStart=new Date(Date.parse('2035-01-01T10:00:00Z')+n*86_400_000).toISOString();
 const slotEnd=new Date(Date.parse(slotStart)+3*3_600_000).toISOString();
 await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values($1,$2,$3,$3,jsonb_build_object('serviceId',$4::text,'itemQuantities','{}'::jsonb,'addonIds','[]'::jsonb,'answers','{}'::jsonb,'rentalPeriods',3),jsonb_build_object('total',jsonb_build_object('amount',300,'currency','USD'),'deposit',jsonb_build_object('amount',50,'currency','USD')),$5,$6)`,[booking,tenant,booking,service,slotStart,slotEnd]);
 await pool.query(`insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'fixture',$1::text,'succeeded',$4,'USD')`,[payment,tenant,booking,amount]);
 await pool.query(`insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity) values($1,$2,$3::uuid,$4,$5,$3::text,'held',clock_timestamp()+interval '5 minutes',1)`,[tenant,resource,booking,slotStart,slotEnd]);
 return{booking,payment};
}
try{
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Rental Confirmation','rental-confirmation-fixture','UTC','USD'),($2,'Foreign','rental-confirmation-foreign','UTC','USD')`,[tenant,foreignTenant]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes,tax_rate_bp,rental) values($1,$2,'Fixture rental','rental','USD',0,60,0,'{"periodMinutes":60,"pricePerPeriod":100,"minPeriods":1,"maxPeriods":8,"depositAmount":50}'),($3,$2,'Fixture simple','simple','USD',100,60,0,null)`,[service,tenant,simpleService]);
 await pool.query(`insert into public.resources(id,tenant_id,name,kind,capacity,active) values($1,$2,'Fixture vehicle','vehicle',1,true),($3,$2,'Extra vehicle','vehicle',1,true),($4,$5,'Foreign vehicle','vehicle',1,true)`,[resource,tenant,extraResource,foreignResource,foreignTenant]);
 await pool.query(`insert into public.service_resources(tenant_id,service_id,resource_id,quantity_required) values($1,$2,$3,1)`,[tenant,service,resource]);

 const first=await seed(10);const results=await Promise.all([call(first.payment),call(first.payment)]);assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);
 const state=(await pool.query(`select b.state,b.payment_id,rr.status from public.bookings b join public.resource_reservations rr on rr.booking_id=b.id where b.id=$1`,[first.booking])).rows[0];assert.deepEqual(state,{state:"confirmed",payment_id:first.payment,status:"consumed"});assert.equal((await call(first.payment)).replayed,true);

 const expired=await seed(11);await pool.query("update public.resource_reservations set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[expired.booking]);await assert.rejects(call(expired.payment),{code:"40001"});
 const mismatch=await seed(12,349);await assert.rejects(call(mismatch.payment),{code:"22023"});assert.deepEqual((await pool.query("select state,payment_id from public.bookings where id=$1",[mismatch.booking])).rows[0],{state:"draft",payment_id:null});

 const wrongResource=await seed(13);await pool.query("update public.resource_reservations set resource_id=$1 where booking_id=$2",[extraResource,wrongResource.booking]);await assert.rejects(call(wrongResource.payment),{code:"40001"});
 const wrongSlot=await seed(14);await pool.query("update public.resource_reservations set slot_end=slot_end+interval '1 minute' where booking_id=$1",[wrongSlot.booking]);await assert.rejects(call(wrongSlot.payment),{code:"40001"});
 const wrongQuantity=await seed(15);await pool.query("update public.resource_reservations set quantity=2 where booking_id=$1",[wrongQuantity.booking]);await assert.rejects(call(wrongQuantity.payment),{code:"40001"});
 const wrongCapacity=await seed(16);await pool.query("update public.service_resources set quantity_required=2 where tenant_id=$1 and service_id=$2 and resource_id=$3",[tenant,service,resource]);await assert.rejects(call(wrongCapacity.payment),{code:"40001"});await pool.query("update public.service_resources set quantity_required=1 where tenant_id=$1 and service_id=$2 and resource_id=$3",[tenant,service,resource]);

 const consumeFailure=await seed(17);await pool.query(`create function public.fixture_rental_consume_failure() returns trigger language plpgsql as $$begin if new.booking_id='${consumeFailure.booking}'::uuid and new.status='consumed' then raise exception 'fixture consume failure' using errcode='23514';end if;return new;end$$;create trigger zz_fixture_rental_consume_failure before update on public.resource_reservations for each row execute function public.fixture_rental_consume_failure()`);await assert.rejects(call(consumeFailure.payment),{code:"23514"});await pool.query("drop trigger zz_fixture_rental_consume_failure on public.resource_reservations;drop function public.fixture_rental_consume_failure()");assert.deepEqual((await pool.query("select b.state,b.payment_id,rr.status from public.bookings b join public.resource_reservations rr on rr.booking_id=b.id where b.id=$1",[consumeFailure.booking])).rows[0],{state:"draft",payment_id:null,status:"held"});

 const refund=await seed(18);await pool.query("insert into public.refunds(tenant_id,booking_id,payment_id,amount,currency) values($1,$2,$3,1,'USD')",[tenant,refund.booking,refund.payment]);await assert.rejects(call(refund.payment),{code:"22023"});
 const tenantMismatch=await seed(19);await pool.query("update public.payments set tenant_id=$1 where id=$2",[foreignTenant,tenantMismatch.payment]);await assert.rejects(call(tenantMismatch.payment),{code:"22023"});
 await assert.rejects(pool.query("insert into public.resource_reservations(tenant_id,resource_id,booking_id,slot_start,slot_end,hold_key,status,expires_at,quantity) values($1,$2,$3,$4,$5,'foreign','held',clock_timestamp()+interval '5 minutes',1)",[foreignTenant,foreignResource,tenantMismatch.booking,slotStart,slotEnd]),{code:"23503"});

 // Keep the legacy simple path covered: its service-capacity advisory lock and
 // active capacity hold still confirm exactly once under concurrent replay.
 const simpleBooking=id(20),simplePayment=id(120);await pool.query(`insert into public.bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end) values($1::uuid,$2,$1::text,$1::text,jsonb_build_object('serviceId',$3::text),jsonb_build_object('total',jsonb_build_object('amount',100,'currency','USD')),$4,$5)`,[simpleBooking,tenant,simpleService,slotStart,slotEnd]);await pool.query(`insert into public.payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'fixture',$1::text,'succeeded',100,'USD')`,[simplePayment,tenant,simpleBooking]);await pool.query(`insert into public.capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1,$2,$3::uuid,$4,$5,$3::text,'active',clock_timestamp()+interval '5 minutes')`,[tenant,simpleService,simpleBooking,slotStart,slotEnd]);const simpleResults=await Promise.all([call(simplePayment),call(simplePayment)]);assert.deepEqual(simpleResults.map(x=>x.replayed).sort(),[false,true]);
 console.log("PASS rental confirmation: persisted charge, serialized hold consumption, consumed replay, expiry/amount/refund/tenant/foreign-resource/slot/quantity/capacity rejection, consume rollback, and legacy simple advisory-lock path");
}finally{await pool.end();}
