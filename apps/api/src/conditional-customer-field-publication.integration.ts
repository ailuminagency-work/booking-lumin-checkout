import {createConditionalCustomerFieldPublicationReader} from './conditional-customer-field-publication-reader';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createCustomerAvailabilityReader} from './customer-availability';
import {createCustomerHoldWriter} from './customer-hold';
import {createCustomerMockPayment,createCustomerConfirmation} from './customer-payment';
assert.equal(process.env.CONDITIONAL_CUSTOMER_FIELD_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_conditional_v6_/);for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`56000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreign=id(9),foreignTenant=id(90),ownerOrigin='https://portal.example.test',customerOrigin='https://checkout.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),paidSimplePublication:true,paidConditionalCustomerFieldPublication:createConditionalCustomerFieldPublicationReader(pool,[customerOrigin]),ownerOrigins:[ownerOrigin],customerOrigins:[customerOrigin],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreign:null,customerAvailability:createCustomerAvailabilityReader(pool),customerHold:createCustomerHoldWriter(pool),customerMockPayment:createCustomerMockPayment(pool,{BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'}),customerConfirmation:createCustomerConfirmation(pool)});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function post(path:string,body:unknown,token?:string,origin=customerOrigin){const r=await fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return{status:r.status,json:await r.json()};}

const draftPath=`/api/paid-simple-flows/${flow}/draft?tenantId=${tenant}`,publishPath=`/api/paid-conditional-customer-field-flows/${flow}/publish-draft?tenantId=${tenant}`;
const fields=[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20},{id:'custom_code',kind:'text',label:'Gate code',required:true,maxLength:4,when:{fieldId:'custom_access',equals:'gate'}},{id:'custom_note',kind:'text',label:'Note',required:false,maxLength:10,when:{fieldId:'custom_code',equals:'1234'}}];
const draft={schemaVersion:3,expectedRevision:0,serviceId:service,name:'Conditional saved cleaning',presentation:{accentColor:'#0e7490',layout:'compact'},customerFields:fields};
const ownerPost=(path:string,body:unknown,token='owner-token-123456')=>post(path,body,token,ownerOrigin);
const publish=(revision:number)=>ownerPost(publishPath,{expectedDraftRevision:revision,allowedOrigins:[customerOrigin]});
const session=(installation:string)=>post(`/api/installations/${installation}/sessions`,{});
try{
 await pool.query("insert into auth.users(id,email) values($1,'conditional-owner@example.test'),($2,'conditional-foreign@example.test')",[actor,foreign]);
 await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Conditional','conditional-http','UTC','USD'),($2,'Foreign','conditional-foreign','UTC','USD')",[tenant,foreignTenant]);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')",[tenant,actor,foreignTenant,foreign]);
 await pool.query("insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Catalog cleaning','simple','USD',12500,60)",[service,tenant]);
 await pool.query('insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)',[tenant,service]);
 await pool.query('insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n',[tenant,service]);
 assert.equal((await ownerPost(draftPath,draft,'foreign-token-123456')).status,403);
 assert.equal((await ownerPost(draftPath,draft)).status,200);assert.equal((await ownerPost(draftPath,draft)).status,409);
 const read=await fetch(base+draftPath,{headers:{origin:ownerOrigin,authorization:'Bearer owner-token-123456'}});assert.equal(read.status,200);assert.deepEqual((await read.json()).data.customerFields,fields);
 for(const schemaVersion of [undefined,2])assert.equal((await ownerPost(draftPath,{...draft,schemaVersion,expectedRevision:1,customerFields:schemaVersion===2?fields.map(({when,...f}:any)=>f):undefined})).status,422);
 assert.equal((await publish(2)).status,409);assert.equal((await ownerPost(publishPath,{expectedDraftRevision:1,allowedOrigins:['https://evil.example.test']})).status,403);
 const race=await Promise.all([publish(1),publish(1)]);assert.deepEqual(race.map(r=>r.status),[200,200]);assert.deepEqual(race[0],race[1]);const receipt=race[0]!.json.data;assert.equal(receipt.publication.renderSchemaVersion,6);
 const recovery=await fetch(base+`/api/paid-conditional-customer-field-flows/${flow}/publication?tenantId=${tenant}`,{headers:{origin:ownerOrigin,authorization:'Bearer owner-token-123456'}});assert.equal(recovery.status,200);assert.deepEqual((await recovery.json()).data,receipt);
 const loaded=await session(receipt.publication.installationId);assert.equal(loaded.status,200);const token=loaded.json.data.sessionToken;assert.deepEqual(loaded.json.data.render.customerFields,fields);assert.equal(loaded.json.data.render.service.price.amount,12500);
 const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);tomorrow.setUTCHours(0,0,0,0);const from=tomorrow.toISOString(),to=new Date(+tomorrow+86400000).toISOString();
 const availability=await fetch(base+'/api/flow-sessions/availability?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),{headers:{origin:customerOrigin,authorization:`Bearer ${token}`}});assert.equal(availability.status,200);const slots=(await availability.json()).data.slots;assert.ok(slots.length);const start=slots[0].start;
 const request={schemaVersion:3,idempotencyKey:'conditional-request-key-001',answers:{},customerAnswers:{custom_access:'gate',custom_code:'1234',custom_note:' hi '},customer:{name:'Customer',email:'conditional@example.test'},requestedStart:start};
 for(const customerAnswers of [{},{custom_access:'gate'},{custom_access:'door',custom_code:''},{custom_access:'door',custom_note:'hidden descendant'},{custom_access:'gate',custom_code:'12345'},{custom_access:'gate',custom_code:' ',custom_note:'x'},{custom_access:'door',custom_price:'1'}])assert.equal((await post('/api/flow-sessions/request',{...request,customerAnswers},token)).status,400);
 assert.equal((await post('/api/flow-sessions/request',{...request,schemaVersion:2},token)).status,422);assert.equal((await post('/api/flow-sessions/request',{...request,total:1},token)).status,400);
 assert.equal(Number((await pool.query('select count(*) n from public.bookings where tenant_id=$1',[tenant])).rows[0].n),0);
 const submitted=await post('/api/flow-sessions/request',request,token);assert.equal(submitted.status,200);assert.deepEqual(await post('/api/flow-sessions/request',request,token),submitted);assert.equal((await post('/api/flow-sessions/request',{...request,customerAnswers:{custom_access:'door'}},token)).status,409);
 const hold=await post('/api/flow-sessions/hold',{},token);assert.equal(hold.status,200);const booking=hold.json.data.bookingId;
 assert.deepEqual((await pool.query('select selection,pricing from public.bookings where id=$1',[booking])).rows[0],{selection:{serviceId:service},pricing:{}});
 assert.deepEqual((await pool.query('select customer_answers from public.flow_requests where booking_id=$1',[booking])).rows[0].customer_answers,request.customerAnswers);
 const paid=await post('/api/flow-sessions/mock-payment',{},token);assert.equal(paid.status,200);assert.equal(paid.json.data.state,'confirmed');assert.equal((await post('/api/flow-sessions/mock-payment',{},token)).json.data.replayed,true);
 assert.deepEqual((await pool.query('select amount::int,currency,provider,state from public.payments where booking_id=$1',[booking])).rows[0],{amount:12500,currency:'USD',provider:'staging_mock',state:'succeeded'});assert.equal((await pool.query('select status from public.capacity_holds where booking_id=$1',[booking])).rows[0].status,'consumed');
 const second=await session(receipt.publication.installationId);assert.equal(second.status,200);const secondToken=second.json.data.sessionToken,secondStart=slots[4].start;
 const hiddenOmitted={...request,idempotencyKey:'conditional-door-request-002',customerAnswers:{custom_access:'door'},requestedStart:secondStart};assert.equal((await post('/api/flow-sessions/request',hiddenOmitted,secondToken)).status,200);
 const secondHold=await post('/api/flow-sessions/hold',{},secondToken);assert.equal(secondHold.status,200);
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where booking_id=$1",[secondHold.json.data.bookingId]);
 assert.equal((await post('/api/flow-sessions/mock-payment',{},secondToken)).status,409);assert.equal(Number((await pool.query('select count(*) n from public.payments where booking_id=$1',[secondHold.json.data.bookingId])).rows[0].n),0);
 const recoveryPath=`/api/paid-conditional-customer-field-flows/${flow}/publication?tenantId=${tenant}`;
 const recover=async(auth='owner-token-123456')=>fetch(base+recoveryPath,{headers:{origin:ownerOrigin,authorization:`Bearer ${auth}`}});
 assert.equal((await recover('foreign-token-123456')).status,404);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await recover()).status,404);assert.equal((await publish(1)).status,403);
 await pool.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1 and user_id=$2",[tenant,actor]);
 const before=(await pool.query('select jsonb_agg(to_jsonb(v) order by id) rows from public.flow_versions v where tenant_id=$1',[tenant])).rows[0].rows;
 assert.equal((await ownerPost(draftPath,{...draft,expectedRevision:1,name:'Edited'})).status,200);assert.deepEqual((await pool.query('select jsonb_agg(to_jsonb(v) order by id) rows from public.flow_versions v where tenant_id=$1',[tenant])).rows[0].rows,before);assert.equal((await publish(1)).status,409);
 await pool.query("update public.flow_sessions set expires_at=clock_timestamp()-interval '1 second' where tenant_id=$1",[tenant]);assert.equal((await post('/api/flow-sessions/mock-payment',{},token)).status,403);
 console.log('PASS actual HTTP conditional save/CAS/read/immutable publication/replay/session/visibility/hidden descendant rejection/private answers/hold/server12500 staging confirmation/expiry');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
