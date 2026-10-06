import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createPaidJourneyAvailabilityReader} from './paid-journey-availability';
assert.equal(process.env.PAID_JOURNEY_AVAILABILITY_LOCAL_TEST,'1');
const ci=process.env.CI==='true';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let trustedDatabaseHost='127.0.0.1';
if(ci){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_availability_api_ci');
 trustedDatabaseHost=process.env.PAID_JOURNEY_AVAILABILITY_CI_DATABASE_HOST??'';
 assert.equal(isIP(trustedDatabaseHost),4);
 assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
}else{
 assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_availability_api_[a-z0-9_]+$/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`39000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test','https://second-checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidJourneyDrafts:true,paidJourneyPublication:true,paidJourneySessions:true,paidJourneyAvailability:createPaidJourneyAvailabilityReader(pool),paidSimplePublication:true});
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
 const day=new Date(Date.now()+86400000);day.setUTCHours(0,0,0,0);const from=day.toISOString(),to=new Date(day.getTime()+86400000).toISOString(),start=new Date(day.getTime()+9*3600000).toISOString(),end=new Date(day.getTime()+10*3600000).toISOString();
 await pool.query('insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) values($1,$2,$3,540,660,1)',[tenant,service,day.getUTCDay()]);
 await pool.query('insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,60,30)',[tenant,service]);
 async function availability(t=token,o='https://checkout.example.test',suffix=''){const r=await fetch(`${base}/api/paid-journey-flow-sessions/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${suffix}`,{headers:{origin:o,...(t?{authorization:`Bearer ${t}`}:{})}});assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(r.headers.get('x-request-id'));return{status:r.status,json:await r.json()};}
 const firstSlots=await availability();assert.equal(firstSlots.status,200);assert.equal(firstSlots.json.data.serviceId,service);assert.equal(firstSlots.json.data.durationMinutes,60);assert.equal(firstSlots.json.data.slots.length,3);assert.equal(firstSlots.json.data.slots[0].start,start);assert.deepEqual(Object.keys(firstSlots.json.data).sort(),['durationMinutes','schemaVersion','serviceId','slots']);
 // Controlled pre-existing pending booking consumes actual capacity. Reading does not create it.
 await pool.query(`insert into public.bookings(id,tenant_id,reference,state,selection,slot_start,slot_end,idempotency_key) values($1,$2,'LMN-AVAIL','pending_payment',$3,$4,$5,'availability-fixture-0001')`,[id(81),tenant,JSON.stringify({serviceId:service}),start,end]);
 const financialTables=['flow_sessions','flow_requests','bookings','payments','capacity_holds','paid_journey_sessions'];
 async function counts(){const entries=[];for(const table of financialTables)entries.push([table,Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n)]);return Object.fromEntries(entries);}
 const before=await counts(),expiry=(await pool.query('select expires_at from public.paid_journey_sessions where token_hash=$1',[hash])).rows[0].expires_at;
 const busy=await availability();assert.equal(busy.status,200);assert.deepEqual(busy.json.data.slots.map((s:any)=>s.start),[end]);
 await pool.query("insert into public.availability_overrides(tenant_id,service_id,date,kind) values($1,$2,$3,'closed')",[tenant,service,from.slice(0,10)]);assert.deepEqual((await availability()).json.data.slots,[]);await pool.query('delete from public.availability_overrides where tenant_id=$1',[tenant]);
 for(const extra of ['&tenantId='+foreignTenant,'&serviceId='+id(97),'&price=1','&actorId='+actor,'&from='+encodeURIComponent(from)])assert.equal((await availability(undefined,undefined,extra)).status,400);
 assert.equal((await availability('')).status,401);assert.equal((await availability('weak')).status,401);assert.equal((await availability('z'.repeat(43))).status,403);assert.equal((await availability(undefined,origin)).status,403);assert.equal((await availability(undefined,'https://second-checkout.example.test')).status,403);
 await pool.query(`insert into public.paid_journey_sessions select $1,tenant_id,flow_id,version_id,installation_id,service_id,origin,stamp-interval '16 minutes',stamp-interval '1 minute' from public.paid_journey_sessions cross join (select clock_timestamp() stamp) x where token_hash=$2`,[createHash('sha256').update('e'.repeat(43)).digest('hex'),hash]);assert.equal((await availability('e'.repeat(43))).status,403);
 await pool.query('update public.services set base_price=12600 where id=$1',[service]);assert.equal((await availability()).status,409);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);assert.equal((await availability()).status,404);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query('update public.services set active=false where id=$1',[service]);assert.equal((await availability()).status,404);await pool.query('update public.services set active=true where id=$1',[service]);
 const locker=await pool.connect(),writer=await pool.connect();try{await locker.query('begin');await locker.query('select public.paid_journey_availability_scope($1,$2)',[hash,'https://checkout.example.test']);for(const [sql,target] of [["update public.flows set status='archived' where id=$1",flow],["update public.tenants set status='suspended' where id=$1",tenant],["update public.services set active=false where id=$1",service],["update public.flow_installations set allowed_origins='[\"https://evil.example.test\"]' where id=$1",receipt.installationId]]){await writer.query('begin');await writer.query("set local lock_timeout='100ms'");await assert.rejects(writer.query(sql,[target]),{code:'55P03'});await writer.query('rollback');}await locker.query('rollback');}finally{await locker.query('rollback');await writer.query('rollback');locker.release();writer.release();}
 // Actual expiry while the reader waits on its tenant capability lock.
 const shortToken='s'.repeat(43),shortHash=createHash('sha256').update(shortToken).digest('hex');
 await pool.query(`insert into public.paid_journey_sessions select $1,tenant_id,flow_id,version_id,installation_id,service_id,origin,stamp-interval '15 minutes'+interval '2 seconds',stamp+interval '2 seconds' from public.paid_journey_sessions cross join (select clock_timestamp() stamp) x where token_hash=$2`,[shortHash,hash]);
 const blocker=await pool.connect();try{await blocker.query('begin');await blocker.query('select id from public.tenants where id=$1 for update',[tenant]);const pending=availability(shortToken);let waiting=false;const deadline=Date.now()+1200;while(Date.now()<deadline){waiting=(await pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select public.paid_journey_availability_scope%') waiting")).rows[0].waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,'scope must actually block before expiry');const remaining=Number((await pool.query('select greatest(0,extract(epoch from expires_at-clock_timestamp())*1000) remaining from public.paid_journey_sessions where token_hash=$1',[shortHash])).rows[0].remaining);await new Promise(r=>setTimeout(r,remaining+30));await blocker.query('rollback');assert.equal((await pending).status,403);}finally{await blocker.query('rollback');blocker.release();}
 assert.deepEqual(await counts(),{...before,paid_journey_sessions:before.paid_journey_sessions+2});assert.equal((await pool.query('select expires_at from public.paid_journey_sessions where token_hash=$1',[hash])).rows[0].expires_at.getTime(),expiry.getTime());
 const reordered={...journey,stages:[journey.stages[0],journey.stages[1],journey.stages[3],journey.stages[2],journey.stages[4],journey.stages[5]]};assert.equal((await request('POST',{...body,expectedRevision:1,journey:reordered})).status,200);assert.equal((await publish({...pubBody,expectedDraftRevision:2})).status,200);assert.equal((await availability()).status,404);
 console.log('PASS actual dedicated V8 availability HTTP+Postgres pinned service/capacity/closure/expiry/origin/current locks/privacy/no read writes');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
