import {createPaidJourneyHistoryRollback} from './paid-journey-history-rollback';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createPaidJourneyMockPaymentWriter} from './paid-journey-payment';
import {createPaidJourneyHoldWriter} from './paid-journey-hold';
import {createMockPaymentWriter} from './mock-payment';
import {createReservationWriter} from './reservation';
assert.equal(process.env.PAID_JOURNEY_HISTORY_LOCAL_TEST,'1');
const ci=process.env.CI==='true';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let trustedDatabaseHost='127.0.0.1';
if(ci){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_history_ci');
 trustedDatabaseHost=process.env.PAID_JOURNEY_HISTORY_CI_DATABASE_HOST??'';
 assert.equal(isIP(trustedDatabaseHost),4);
 assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
}else{
 assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_history_[a-z0-9_]+$/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`49000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const ownerOperations=createPaidJourneyHistoryRollback(pool,['https://checkout.example.test']);
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test','https://second-checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidJourneyHistory:ownerOperations.history,paidJourneyRollback:ownerOperations.rollback,paidJourneyDrafts:true,paidJourneyPublication:true,paidJourneySessions:true,paidJourneyHold:createPaidJourneyHoldWriter(pool),paidJourneyMockPayment:createPaidJourneyMockPaymentWriter(pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'}),mockPayment:createMockPaymentWriter(pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'}),paidSimplePublication:true});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const journey={schemaVersion:1,stages:['service','options','schedule','information','review_payment','confirmation'].map(kind=>({id:kind,kind,label:kind,enabled:kind!=='options'}))};
const body={schemaVersion:1,journey,serviceId:service,name:'Housekeeping',presentation:{accentColor:'#4f46e5',layout:'stacked'},expectedRevision:0};
async function request(method='POST',value:unknown=body,target=flow,targetTenant=tenant,token='owner-token-123456',o=origin){const r=await fetch(`${base}/api/paid-journey-flows/${target}/draft?tenantId=${targetTenant}`,{method,headers:{authorization:`Bearer ${token}`,origin:o,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(value)})});return{status:r.status,json:await r.json()};}
try{
 const actual=(await pool.query('select current_database() db,current_user actor,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.equal(actual.db,process.env.PGDATABASE);assert.equal(actual.actor,'postgres');assert.equal(actual.host,trustedDatabaseHost);assert.equal(actual.port,Number(process.env.PGPORT));
 await pool.query(`insert into auth.users(id,email) values($1,'draft-owner@example.test'),($2,'draft-foreign@example.test')`,[actor,foreignActor]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Draft','paid-draft-fixture','UTC','USD'),($2,'Foreign','paid-draft-foreign-fixture','UTC','USD')`,[tenant,foreignTenant]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')`,[tenant,actor,foreignTenant,foreignActor]);
 await pool.query('select public.initialize_staging_business_profile($1,$2,$3,$4)',[actor,tenant,'HOUSEKEEPING','journey_api_fixture_owner']);
 await pool.query('select public.initialize_staging_business_profile($1,$2,$3,$4)',[foreignActor,foreignTenant,'HOUSEKEEPING','journey_api_fixture_other']);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping','simple','USD',12500,60),($3,$4,'Foreign','simple','USD',200,60)`,[service,tenant,id(97),foreignTenant]);
 assert.equal((await request()).status,200);
 const pubBody={schemaVersion:1,expectedDraftRevision:1,allowedOrigins:['https://checkout.example.test']};
 async function publish(value:unknown=pubBody,token='owner-token-123456',o=origin,targetTenant=tenant){const r=await fetch(`${base}/api/paid-journey-flows/${flow}/publish-draft?tenantId=${targetTenant}`,{method:'POST',headers:{authorization:`Bearer ${token}`,origin:o,'content-type':'application/json'},body:JSON.stringify(value)});return{status:r.status,json:await r.json()};}
 async function read(installation:string,o='https://checkout.example.test',suffix=''){const r=await fetch(`${base}/api/paid-journey-installations/${installation}/render${suffix}`,{headers:{origin:o}});return{status:r.status,json:await r.json()};}
 const first=await publish();assert.equal(first.status,200);const receipt=first.json.data;
 assert.deepEqual({...receipt,versionId:'version',installationId:'installation'},{schemaVersion:1,tenantId:tenant,flowId:flow,draftRevision:1,versionId:'version',installationId:'installation',renderSchemaVersion:8,replayed:false});

 async function issue(installation=receipt.installationId,o='https://checkout.example.test',value:unknown={},suffix=''){const r=await fetch(`${base}/api/paid-journey-installations/${installation}/sessions${suffix}`,{method:'POST',headers:{origin:o,'content-type':'application/json'},body:JSON.stringify(value)});return{status:r.status,json:await r.json()};}

 const session=await issue();assert.equal(session.status,200);const token=session.json.data.sessionToken,hash=createHash('sha256').update(token).digest('hex');
 const day=new Date(Date.now()+86400000);day.setUTCHours(0,0,0,0);const start=new Date(day.getTime()+9*3600000).toISOString(),end=new Date(day.getTime()+10*3600000).toISOString();
 await pool.query('insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) values($1,$2,$3,540,660,1)',[tenant,service,day.getUTCDay()]);
 await pool.query('insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,60,30)',[tenant,service]);
 const input={schemaVersion:1,idempotencyKey:'journey-hold-api-fixture-0001',requestedStart:start,customer:{name:'Staging customer',email:'customer@example.test'},answers:{}};
 async function hold(t=token,value:unknown=input,o='https://checkout.example.test',suffix=''){const r=await fetch(base+'/api/paid-journey-flow-sessions/hold'+suffix,{method:'POST',headers:{origin:o,authorization:`Bearer ${t}`,'content-type':'application/json'},body:JSON.stringify(value)});assert.equal(r.headers.get('cache-control'),'no-store');return{status:r.status,json:await r.json()};}
 async function counts(){const tables=['bookings','customers','payments','capacity_holds','flow_sessions','flow_requests','paid_journey_requests','paid_journey_sessions'];const entries=[];for(const table of tables)entries.push([table,Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n)]);return Object.fromEntries(entries);}
 const made=await hold();assert.equal(made.status,200);const won=made.json.data;
 const before=await counts();
 async function pay(t=token,o='https://checkout.example.test',value:unknown={},suffix=''){const r=await fetch(base+'/api/paid-journey-flow-sessions/mock-payment'+suffix,{method:'POST',headers:{origin:o,authorization:`Bearer ${t}`,'content-type':'application/json'},body:JSON.stringify(value)});assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(r.headers.get('x-request-id'));return{status:r.status,json:await r.json()};}
 assert.equal((await pay('weak')).status,401);assert.equal((await pay('z'.repeat(43))).status,403);assert.equal((await pay(token,origin)).status,403);assert.equal((await pay(token,'https://second-checkout.example.test')).status,403);
 for(const key of ['amount','currency','tenantId','actorId','bookingId','serviceId']){assert.equal((await pay(token,'https://checkout.example.test',{[key]:1})).status,400);assert.equal((await pay(token,'https://checkout.example.test',{},'?'+key+'='+foreignTenant)).status,400);}
 const generic=await fetch(base+'/api/bookings/mock-payment?tenantId='+tenant,{method:'POST',headers:{origin,authorization:'Bearer owner-token-123456','content-type':'application/json'},body:JSON.stringify({bookingId:won.bookingId})});assert.equal(generic.status,422);
 await pool.query('update public.services set base_price=13000 where id=$1',[service]);assert.equal((await pay()).status,409);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.capacity_holds set status='released' where id=$1",[won.holdId]);assert.equal((await pay()).status,409);await pool.query("update public.capacity_holds set status='active' where id=$1",[won.holdId]);
 assert.deepEqual(await counts(),before);
 const concurrent=await Promise.all([pay(),pay()]);for(const r of concurrent){assert.equal(r.status,200);assert.equal(r.json.data.amount,12500);assert.equal(r.json.data.currency,'USD');assert.equal(r.json.data.provider,'staging_mock');assert.equal(r.json.data.simulated,true);assert.equal(r.json.data.state,'confirmed');assert.equal(r.json.data.bookingId,won.bookingId);assert.equal(r.json.data.versionId,receipt.versionId);assert.equal(r.json.data.installationId,receipt.installationId);assert.equal(r.json.data.serviceId,service);assert.equal(r.json.data.reference,won.reference);assert.deepEqual(Object.keys(r.json.data).sort(),['schemaVersion','versionId','installationId','serviceId','bookingId','paymentId','reference','state','replayed','provider','simulated','amount','currency'].sort());}
 assert.equal(concurrent.filter(r=>r.json.data.replayed===false).length,1);assert.equal(concurrent.filter(r=>r.json.data.replayed===true).length,1);assert.equal(concurrent[0].json.data.paymentId,concurrent[1].json.data.paymentId);
 const after=await counts();assert.deepEqual(after,{...before,payments:before.payments+1});assert.equal((await pool.query("select count(*) n from public.bookings where state='confirmed'")).rows[0].n,'1');assert.equal((await pool.query("select count(*) n from public.capacity_holds where status='consumed'")).rows[0].n,'1');assert.equal((await pool.query("select count(*) n from public.durable_outbox where event_type='booking.confirmed'")).rows[0].n,'1');
 const replay=await pay();assert.equal(replay.status,200);assert.equal(replay.json.data.replayed,true);assert.equal(replay.json.data.paymentId,concurrent[0].json.data.paymentId);assert.deepEqual(await counts(),after);
 const originalRows=(await pool.query("select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),'holds',(select jsonb_agg(to_jsonb(h) order by id) from public.capacity_holds h),'outbox',(select jsonb_agg(to_jsonb(o) order by id) from public.durable_outbox o)) evidence")).rows[0].evidence;
 const financialBefore=await counts(),outboxBefore=(await pool.query('select count(*) n from public.durable_outbox')).rows[0].n;
 const reordered={...journey,stages:[...journey.stages.slice(0,2),journey.stages[3],journey.stages[2],...journey.stages.slice(4)]};
 assert.equal((await request('POST',{...body,journey:reordered,expectedRevision:1})).status,200);
 const second=await publish({...pubBody,expectedDraftRevision:2});assert.equal(second.status,200);
 const secondSession=await issue(second.json.data.installationId);assert.equal(secondSession.status,200);
 async function history(t='owner-token-123456',suffix=''){const r=await fetch(`${base}/api/paid-journey-flows/${flow}/versions?tenantId=${tenant}${suffix}`,{headers:{origin,authorization:`Bearer ${t}`}});return{status:r.status,json:await r.json()};}
 async function restore(t='owner-token-123456',value:unknown={expectedCurrentVersionId:second.json.data.versionId,targetVersionId:receipt.versionId}){const r=await fetch(`${base}/api/paid-journey-flows/${flow}/rollback?tenantId=${tenant}`,{method:'POST',headers:{origin,authorization:`Bearer ${t}`,'content-type':'application/json'},body:JSON.stringify(value)});return{status:r.status,json:await r.json()};}
 const h=await history();assert.equal(h.status,200);assert.equal(h.json.data.versions.length,2);assert.equal(h.json.data.versions[0].current,true);
 assert.equal((await history('foreign-token-123456')).status,403);assert.equal((await restore('foreign-token-123456')).status,403);assert.equal((await history('owner-token-123456','&generation=1')).status,400);
 assert.equal((await restore('owner-token-123456',{expectedCurrentVersionId:receipt.versionId,targetVersionId:second.json.data.versionId})).status,409);
 await pool.query('update public.services set base_price=13000 where id=$1',[service]);assert.equal((await restore()).status,422);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);assert.equal((await restore()).status,403);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 const racing=await Promise.all([restore(),restore()]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);const restored=racing.find(r=>r.status===200)!.json.data;assert.equal(restored.installationId,receipt.installationId);assert.equal(restored.versionId,receipt.versionId);assert.equal(restored.draftRevision,1);
 assert.equal((await pay()).status,403,'old A token must not revive');assert.equal((await hold()).status,403);assert.equal((await pay(secondSession.json.data.sessionToken)).status,404,'former B token invalid after rollback');
 const renewed=await issue();assert.equal(renewed.status,200);assert.equal(renewed.json.data.render.versionId,receipt.versionId);
 assert.equal((await pay(renewed.json.data.sessionToken)).status,404,'fresh token has no old financial capability');
 assert.deepEqual(await counts(),{...financialBefore,paid_journey_sessions:financialBefore.paid_journey_sessions+2});assert.equal((await pool.query('select count(*) n from public.durable_outbox')).rows[0].n,outboxBefore);
 assert.equal((await pool.query('select revision from public.paid_journey_drafts where flow_id=$1',[flow])).rows[0].revision,'2');
 assert.equal((await pool.query('select generation from public.paid_journey_publication_generations where flow_id=$1',[flow])).rows[0].generation,'4');
 assert.deepEqual((await pool.query("select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),'holds',(select jsonb_agg(to_jsonb(h) order by id) from public.capacity_holds h),'outbox',(select jsonb_agg(to_jsonb(o) order by id) from public.durable_outbox o)) evidence")).rows[0].evidence,originalRows);
 const newHold=await hold(renewed.json.data.sessionToken,{...input,idempotencyKey:'journey-history-restored-0001',requestedStart:end});assert.equal(newHold.status,200);
 const newPayment=await pay(renewed.json.data.sessionToken);assert.equal(newPayment.status,200);assert.equal(newPayment.json.data.state,'confirmed');assert.equal(newPayment.json.data.amount,12500);assert.notEqual(newPayment.json.data.bookingId,won.bookingId);
 assert.equal((await pool.query("select count(*) n from public.bookings where state='confirmed'")).rows[0].n,'2');assert.equal((await pool.query('select count(*) n from public.payments')).rows[0].n,'2');assert.equal((await pool.query("select count(*) n from public.durable_outbox where event_type='booking.confirmed'")).rows[0].n,'2');
 console.log('PASS V8 actual HTTP history/CAS race/rollback ABA session rejection/financial preservation');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
