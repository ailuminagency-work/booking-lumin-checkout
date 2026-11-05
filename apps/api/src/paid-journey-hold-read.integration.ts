import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createPaidJourneyHoldReader} from './paid-journey-hold-read';
import {createPaidJourneyHoldWriter} from './paid-journey-hold';
import {createMockPaymentWriter} from './mock-payment';
import {createReservationWriter} from './reservation';
assert.equal(process.env.PAID_JOURNEY_HOLD_READ_LOCAL_TEST,'1');
const ci=process.env.CI==='true';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let trustedDatabaseHost='127.0.0.1';
if(ci){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_hold_read_ci');
 trustedDatabaseHost=process.env.PAID_JOURNEY_HOLD_READ_CI_DATABASE_HOST??'';
 assert.equal(isIP(trustedDatabaseHost),4);
 assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
}else{
 assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_hold_read_[a-z0-9_]+$/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`39000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test','https://second-checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidJourneyDrafts:true,paidJourneyPublication:true,paidJourneySessions:true,paidJourneyHold:createPaidJourneyHoldWriter(pool),paidJourneyHoldRead:createPaidJourneyHoldReader(pool),mockPayment:createMockPaymentWriter(pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'}),paidSimplePublication:true});
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
 let before=await counts();const oldHold=(await pool.query('select * from public.capacity_holds where id=$1',[won.holdId])).rows[0];
 async function recovery(t=token,o='https://checkout.example.test',suffix=''){const r=await fetch(base+'/api/paid-journey-flow-sessions/hold'+suffix,{headers:{origin:o,authorization:`Bearer ${t}`}});assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(r.headers.get('x-request-id'));return{status:r.status,json:await r.json()};}
 const recovered=await recovery();assert.equal(recovered.status,200);assert.deepEqual(recovered.json,{ok:true,data:{...won,replayed:true}});
 const concurrent=await Promise.all([recovery(),recovery()]);for(const r of concurrent)assert.deepEqual(r,recovered);
 assert.equal((await recovery('z'.repeat(43))).status,403);assert.equal((await recovery('weak')).status,401);assert.equal((await recovery(token,origin)).status,403);assert.equal((await recovery(token,'https://second-checkout.example.test')).status,403);
 for(const key of ['tenantId','actorId','serviceId','bookingId','sessionToken'])assert.equal((await recovery(token,'https://checkout.example.test','?'+key+'='+foreignTenant)).status,400);
 assert.deepEqual(await counts(),before);assert.deepEqual((await pool.query('select * from public.capacity_holds where id=$1',[won.holdId])).rows[0],oldHold);
 const noHold=await issue();assert.equal(noHold.status,200);const withNoHold=await counts();assert.deepEqual(withNoHold,{...before,paid_journey_sessions:before.paid_journey_sessions+1});before=withNoHold;assert.equal((await recovery(noHold.json.data.sessionToken)).status,404);assert.deepEqual(await counts(),before);
 await pool.query('update public.services set base_price=12600 where id=$1',[service]);assert.equal((await recovery()).status,409);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);assert.equal((await recovery()).status,404);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query("update public.capacity_holds set status='released' where id=$1",[won.holdId]);assert.equal((await recovery()).status,404);await pool.query("update public.capacity_holds set status='active' where id=$1",[won.holdId]);
 // A real concurrent row update wins before the read's final expiry check.
 const blocker=await pool.connect();try{await blocker.query('begin');await blocker.query('select id from public.capacity_holds where id=$1 for update',[won.holdId]);const pending=recovery();let waiting=false;const deadline=Date.now()+2000;while(Date.now()<deadline){waiting=(await pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select public.get_paid_journey_hold%') waiting")).rows[0].waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,'reader must wait on exactly linked hold row');await blocker.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where id=$1",[won.holdId]);await blocker.query('commit');assert.equal((await pending).status,404);}finally{await blocker.query('rollback');blocker.release();}
 assert.deepEqual(await counts(),before);assert.equal((await recovery()).status,404);
 assert.equal((await request('POST',{...body,expectedRevision:1,name:'Next draft'})).status,200);assert.equal((await publish({...pubBody,expectedDraftRevision:2})).status,200);assert.equal((await recovery()).status,404);
 assert.deepEqual(await counts(),before);assert.equal((await pool.query("select count(*) n from public.bookings where state='confirmed'")).rows[0].n,'0');
 console.log('PASS dedicated V8 hold recovery actual HTTP/Postgres: exact receipt, concurrent read, expiry/release/current-pointer denial, unchanged lifecycle counts');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
