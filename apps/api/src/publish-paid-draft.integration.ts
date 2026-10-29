import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createCustomerHoldWriter} from './customer-hold';
import {createCustomerMockPayment} from './customer-payment';
assert.equal(process.env.PUBLISH_DRAFT_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_publish_draft_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),origin='https://portal.example.test',customerOrigin='https://checkout.example.test',alternateOrigin='https://alternate.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),paidSimplePublication:true,ownerOrigins:[origin],customerOrigins:[customerOrigin,alternateOrigin],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?id(99):null,customerHold:createCustomerHoldWriter(pool),customerMockPayment:createCustomerMockPayment(pool,{BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'})});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function post(path:string,body:unknown,token='owner-token-123456',o=origin){const r=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,origin:o,'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,json:await r.json()};}
const save=(revision:number,name='Published housekeeping',color='#0e7490',layout='compact',target=flow)=>post(`/api/paid-simple-flows/${target}/draft?tenantId=${tenant}`,{expectedRevision:revision,serviceId:service,name,presentation:{accentColor:color,layout}});
const publish=(revision:number,target=flow,token='owner-token-123456',origins=[customerOrigin])=>post(`/api/paid-simple-flows/${target}/publish-draft?tenantId=${tenant}`,{expectedDraftRevision:revision,allowedOrigins:origins},token);
const session=(installation:string)=>post(`/api/installations/${installation}/sessions`,{},undefined,customerOrigin);
try{
 await pool.query(`insert into auth.users(id,email) values($1,'publish-draft-owner@example.test'),($2,'publish-draft-foreign@example.test')`,[actor,id(99)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Saved publish','publish-draft-fixture','UTC','USD')`,[tenant]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')`,[tenant,actor]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Catalog housekeeping','simple','USD',12500,60)`,[service,tenant]);
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[tenant,service]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n`,[tenant,service]);
 assert.equal((await publish(1)).status,404);assert.equal((await save(0)).status,200);assert.equal((await publish(2)).status,409);
 const first=await publish(1);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.json.data.flowId,flow);assert.equal(first.json.data.draftRevision,1);const receipt1=first.json.data.publication;
 assert.deepEqual(await publish(1),first);assert.equal((await publish(1,flow,undefined,[alternateOrigin])).status,409);
 const opened1=await session(receipt1.installationId);assert.equal(opened1.status,200);const render1=opened1.json.data.render;assert.deepEqual(render1.publication,{name:'Published housekeeping',draftRevision:1,presentation:{accentColor:'#0e7490',layout:'compact'}});assert.deepEqual(render1.service.price,{amount:12500,currency:'USD'});assert.equal(render1.service.name,'Catalog housekeeping');
 const snapshot1=(await pool.query('select paid_snapshot,source_revision from public.flow_versions where id=$1',[receipt1.versionId])).rows[0];assert.equal(snapshot1.source_revision,'1');
 assert.equal((await save(1,'Updated published name','#be123c','stacked')).status,200);
 assert.deepEqual((await session(receipt1.installationId)).json.data.render,render1);assert.deepEqual((await pool.query('select paid_snapshot,source_revision from public.flow_versions where id=$1',[receipt1.versionId])).rows[0],snapshot1);assert.equal((await publish(1)).status,409);
 const second=await publish(2);assert.equal(second.status,200);const receipt2=second.json.data.publication;assert.notEqual(receipt2.versionId,receipt1.versionId);assert.notEqual(receipt2.installationId,receipt1.installationId);assert.deepEqual(await publish(2),second);
 assert.deepEqual((await session(receipt1.installationId)).json.data.render,render1);const opened2=await session(receipt2.installationId);assert.equal(opened2.status,200);assert.deepEqual(opened2.json.data.render.publication,{name:'Updated published name',draftRevision:2,presentation:{accentColor:'#be123c',layout:'stacked'}});assert.deepEqual(opened2.json.data.render.service,render1.service);
 // Same saved revision under concurrent publication creates one immutable tuple.
 assert.equal((await save(0,'Concurrent publish','#2563eb','stacked',id(20))).status,200);
 const concurrent=await Promise.all([publish(1,id(20)),publish(1,id(20))]);assert.equal(concurrent[0].status,200);assert.deepEqual(concurrent[1],concurrent[0]);assert.equal(Number((await pool.query('select count(*) n from public.flow_versions where flow_id=$1',[id(20)])).rows[0].n),1);
 assert.equal((await publish(2,flow,'foreign-token-123456')).status,403);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1",[tenant]);assert.equal((await publish(2)).status,403);await pool.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1",[tenant]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);assert.equal((await publish(2)).status,403);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query('delete from public.tenant_members where tenant_id=$1',[tenant]);assert.equal((await publish(2)).status,403);await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 await pool.query('insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values($1,$2,$3,$4,$5::jsonb)',[id(30),tenant,flow,receipt2.versionId,JSON.stringify([customerOrigin])]);assert.equal((await publish(2)).status,409);await pool.query('delete from public.flow_installations where id=$1',[id(30)]);
 // Existing legacy paid source revision1 is not silently renumbered or overwritten.
 const legacy=await post(`/api/paid-simple-flows/${id(40)}/publish?tenantId=${tenant}`,{serviceId:service,name:'Legacy paid',allowedOrigins:[customerOrigin]});assert.equal(legacy.status,200);assert.equal((await save(0,'Saved legacy','#4f46e5','stacked',id(40))).status,200);assert.equal((await publish(1,id(40))).status,409);assert.equal(Number((await pool.query('select count(*) n from public.flow_versions where flow_id=$1',[id(40)])).rows[0].n),1);
 await pool.query('update public.services set tax_rate_bp=100 where id=$1',[service]);assert.equal((await publish(2)).status,422);await pool.query('update public.services set tax_rate_bp=0 where id=$1',[service]);
 for(const table of ['flow_requests','bookings','payments','capacity_holds'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 // Existing request/hold/mock-payment primitives still derive the same 12500 amount.
 const token=opened2.json.data.sessionToken;const start=new Date();start.setUTCDate(start.getUTCDate()+1);start.setUTCHours(10,0,0,0);
 const submitted=await post('/api/flow-sessions/request',{idempotencyKey:'saved-publish-journey-0001',answers:{},customer:{name:'Customer',email:'saved-publish@example.test'},requestedStart:start.toISOString()},token,customerOrigin);assert.equal(submitted.status,200,JSON.stringify(submitted));
 const hold=await post('/api/flow-sessions/hold',{},token,customerOrigin);assert.equal(hold.status,200,JSON.stringify(hold));const paid=await post('/api/flow-sessions/mock-payment',{},token,customerOrigin);assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.json.data.state,'confirmed');assert.deepEqual((await pool.query('select amount::int,currency,provider,state from public.payments where booking_id=$1',[hold.json.data.bookingId])).rows[0],{amount:12500,currency:'USD',provider:'staging_mock',state:'succeeded'});
 assert.equal((await pool.query('select status from public.capacity_holds where booking_id=$1',[hold.json.data.bookingId])).rows[0].status,'consumed');assert.deepEqual((await pool.query('select paid_snapshot,source_revision from public.flow_versions where id=$1',[receipt1.versionId])).rows[0],snapshot1);
 console.log('PASS real saved draft publication HTTP/DB: exact immutable name/design/revision, replay and concurrent single tuple, newer explicit version with old installations unchanged, stale/foreign/staff/revoked/inactive/ambiguity/origin/legacy collision/eligibility denial; no publication financial writes; existing server12500 simulated payment authority unchanged');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
