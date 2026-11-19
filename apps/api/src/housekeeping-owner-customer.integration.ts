/** Test-only canonical HTTP composition. No payment/confirmation writer is installed. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createBusinessApi} from './business';
import {createSimpleOfferCreator} from './owner-catalog';
import {createOfferSchedulingCreator} from './owner-scheduling';
import {createPaidJourneyAvailabilityReader} from './paid-journey-availability';
import {createPaidJourneyHoldWriter} from './paid-journey-hold';
import {createPaidJourneyHoldReader} from './paid-journey-hold-read';
import {createOwnerBookingsListReader,createOwnerBookingDetailReader} from './owner-bookings';

assert.equal(process.env.HOUSEKEEPING_NO_PAYMENT_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.match(process.env.PGPORT??'',/^\d{4,5}$/);
assert.match(process.env.PGDATABASE??'',/^lumin_housekeeping_proof_[a-z0-9_]+$/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
let stage='isolation';
const pool=new Pool({max:4}),owner=randomUUID(),other=randomUUID(),flow=randomUUID();
const origin='https://owner.example.test',customer='https://customer.example.test';
// Synthetic identity boundary only; not hosted OAuth or signature verification evidence.
const tokens=new Map([['synthetic-owner-token',owner],['synthetic-foreign-token',other]]);
const business=createBusinessApi(pool);
const server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:async token=>tokens.get(token)??null,
 ownerOrigins:[origin],customerOrigins:[customer],businessOnboarding:true,businessCreate:business.create,
 catalogAuthoring:true,simpleOfferCreate:createSimpleOfferCreator(pool),schedulingAuthoring:true,offerSchedulingCreate:createOfferSchedulingCreator(pool),
 paidJourneyDrafts:true,paidJourneyPublication:true,paidJourneySessions:true,
 paidJourneyAvailability:createPaidJourneyAvailabilityReader(pool),paidJourneyHold:createPaidJourneyHoldWriter(pool),paidJourneyHoldRead:createPaidJourneyHoldReader(pool),
 ownerBookings:createOwnerBookingsListReader(pool),ownerBookingDetail:createOwnerBookingDetailReader(pool)});
let base='';
async function req(path:string,body?:unknown,token='synthetic-owner-token',requestOrigin=origin){
 assert.ok(path.startsWith('/api/'));assert.ok(!/payment|confirm/.test(path),'payment operations forbidden by this proof');
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{origin:requestOrigin,...(token?{authorization:`Bearer ${token}`} : {}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return{status:r.status,json:await r.json()};
}
async function ok(path:string,body?:unknown,token?:string,o?:string){const r=await req(path,body,token,o);assert.equal(r.status,200,stage);assert.equal(r.json.ok,true,stage);return r.json.data;}
const pass=(s:string)=>{console.log('PASS HOUSEKEEPING_'+s);};
try{
 const actual=(await pool.query('select current_database() db,current_user actor,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.deepEqual(actual,{db:process.env.PGDATABASE,actor:'postgres',host:'127.0.0.1',port:Number(process.env.PGPORT)});
 for(const table of ['tenants','bookings','payments','durable_outbox'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0,'fresh disposable database required');
 await pool.query("insert into auth.users(id,email) values($1,'proof-owner@example.test'),($2,'proof-other@example.test')",[owner,other]);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 stage='owner_business';
 const setup=(suffix:string)=>({name:'Synthetic Housekeeping '+suffix,slug:'proof-housekeeping-'+suffix,timezone:'UTC',currency:'USD',businessType:'HOUSEKEEPING',idempotencyKey:'proof-business-'+suffix+'-0001'});
 const tenant=(await ok('/api/businesses',setup('owner'))).tenantId;
 const foreign=(await ok('/api/businesses',setup('foreign'),'synthetic-foreign-token')).tenantId;
 stage='owner_catalog';
 const offer={name:'Central cleaning visit',description:'Synthetic acceptance service',price:{amount:12500,currency:'USD'},durationMinutes:60,idempotencyKey:'proof-service-attempt-0001'};
 const service=(await ok('/api/catalog/simple-offers?tenantId='+tenant,offer)).service.id;
 assert.equal((await req('/api/catalog/simple-offers?tenantId='+tenant,offer,'synthetic-foreign-token')).status,403);
 stage='owner_scheduling';
 await ok(`/api/catalog/simple-offers/${service}/scheduling?tenantId=${tenant}`,{timezone:'UTC',windows:Array.from({length:7},(_,weekday)=>({weekday,startMinute:540,endMinute:1020,capacity:1})),policy:{leadTimeMinutes:0,horizonDays:30,slotIntervalMinutes:30},idempotencyKey:'proof-schedule-attempt-0001'});pass('OWNER_CATALOG_SCHEDULING');
 stage='publication';
 const journey={schemaVersion:1,stages:['service','options','schedule','information','review_payment','confirmation'].map(kind=>({id:kind,kind,label:kind,enabled:kind!=='options'}))};
 const draft={schemaVersion:1,expectedRevision:0,serviceId:service,name:'Central form',presentation:{accentColor:'#4f46e5',layout:'stacked'},journey};
 const draftPath=`/api/paid-journey-flows/${flow}/draft?tenantId=${tenant}`;
 await ok(draftPath,draft);
 const publish=(revision:number)=>ok(`/api/paid-journey-flows/${flow}/publish-draft?tenantId=${tenant}`,{schemaVersion:1,expectedDraftRevision:revision,allowedOrigins:[customer]});
 const first=await publish(1);
 const render=(id:string)=>ok(`/api/paid-journey-installations/${id}/render`,undefined,'',customer);
 const initial=await render(first.installationId);
 assert.deepEqual(initial.form.journey,journey);assert.deepEqual(initial.service.price,offer.price);assert.equal(initial.service.id,service);
 const revised={...journey,stages:journey.stages.map(s=>({...s,label:s.kind==='information'?'Your cleaning details':s.label}))};
 await ok(draftPath,{...draft,expectedRevision:1,journey:revised});
 assert.deepEqual(await render(first.installationId),initial,'unpublished edits must not rewrite published embed');
 const publication=await publish(2);assert.deepEqual((await render(publication.installationId)).form.journey,revised);
 assert.equal((await req(`/api/paid-journey-installations/${first.installationId}/render`,undefined,'',customer)).status,404);pass('IMMUTABLE_PUBLICATION');
 stage='customer_session_availability';
 const session=await ok(`/api/paid-journey-installations/${publication.installationId}/sessions`,{},'',customer);
 const day=new Date(Date.now()+86400000);day.setUTCHours(0,0,0,0);
 const availabilityPath='/api/paid-journey-flow-sessions/availability?'+new URLSearchParams({from:day.toISOString(),to:new Date(day.getTime()+86400000).toISOString()});
 const slots=await ok(availabilityPath,undefined,session.sessionToken,customer);assert.equal(slots.serviceId,service);assert.ok(slots.slots.length>0);assert.equal(new Date(slots.slots[0].start).getUTCHours(),9);
 assert.equal((await req(availabilityPath,undefined,'synthetic-owner-token',customer)).status,401);pass('CUSTOMER_SESSION_AVAILABILITY');
 stage='customer_hold';
 const input={schemaVersion:1,idempotencyKey:'proof-customer-attempt-0001',requestedStart:slots.slots[0].start,customer:{name:'Synthetic Customer',email:'proof-customer@example.test'},answers:{}};
 const held=await ok('/api/paid-journey-flow-sessions/hold',input,session.sessionToken,customer);
 assert.equal(held.state,'draft');assert.equal(held.confirmed,false);assert.equal(held.paymentMode,'unavailable');
 assert.equal((await ok('/api/paid-journey-flow-sessions/hold',input,session.sessionToken,customer)).bookingId,held.bookingId);
 const after=await ok(availabilityPath,undefined,session.sessionToken,customer);assert.ok(!after.slots.some((s:{start:string})=>s.start===input.requestedStart));pass('CUSTOMER_HOLD_REPLAY_CAPACITY');
 stage='owner_visibility';
 const listed=await ok('/api/bookings?tenantId='+tenant);assert.equal(listed.bookings.length,1);assert.equal(listed.bookings[0].id,held.bookingId);assert.equal(listed.bookings[0].state,'draft');assert.equal(listed.bookings[0].paymentState,null);
 const detail=await ok(`/api/bookings/detail?tenantId=${tenant}&bookingId=${held.bookingId}`);assert.equal(detail.bookingId,held.bookingId);
 assert.equal((await req('/api/bookings?tenantId='+tenant,undefined,'synthetic-foreign-token')).status,403);
 assert.equal((await ok('/api/bookings?tenantId='+foreign,undefined,'synthetic-foreign-token')).bookings.length,0);pass('OWNER_VISIBILITY_ISOLATION');
 stage='no_financial_effects';
 for(const table of ['payments','refunds','durable_outbox'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 assert.deepEqual((await pool.query('select state,payment_id from public.bookings')).rows,[{state:'draft',payment_id:null}]);pass('NO_PAYMENT_OR_CONFIRMATION');
}catch(error){const e=error as {code?:unknown;operator?:unknown;actual?:unknown;expected?:unknown};const scalar=(v:unknown)=>typeof v==='number'||typeof v==='boolean'||v===null?v:undefined;console.error(JSON.stringify({failure:'HOUSEKEEPING_'+stage,code:typeof e.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:'UNCLASSIFIED',operator:typeof e.operator==='string'&&/^[A-Za-z]{1,30}$/.test(e.operator)?e.operator:undefined,actual:scalar(e.actual),expected:scalar(e.expected)}));process.exitCode=1;}
finally{server.closeAllConnections();if(server.listening)await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
