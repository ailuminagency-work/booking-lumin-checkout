import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createPaidJourneyHoldWriter} from './paid-journey-hold';
import {createMockPaymentWriter} from './mock-payment';
import {createReservationWriter} from './reservation';
assert.equal(process.env.PAID_JOURNEY_HOLD_LOCAL_TEST,'1');
const ci=process.env.CI==='true';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let trustedDatabaseHost='127.0.0.1';
if(ci){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_phase_a_journey_hold_ci');
 trustedDatabaseHost=process.env.PAID_JOURNEY_HOLD_CI_DATABASE_HOST??'';
 assert.equal(isIP(trustedDatabaseHost),4);
 assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
}else{
 assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59075');assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_journey_hold_[a-z0-9_]+$/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`39000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test','https://second-checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidJourneyDrafts:true,paidJourneyPublication:true,paidJourneySessions:true,paidJourneyHold:createPaidJourneyHoldWriter(pool),mockPayment:createMockPaymentWriter(pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'}),paidSimplePublication:true});
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
 async function counts(){const tables=['bookings','customers','payments','capacity_holds','flow_sessions','flow_requests','paid_journey_requests'];const entries=[];for(const table of tables)entries.push([table,Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n)]);return Object.fromEntries(entries);}
 const initial=await counts();
 for(const key of ['tenantId','serviceId','price','capacity','paymentId','confirmed'])assert.equal((await hold(token,{...input,[key]:foreignTenant})).status,400);
 assert.equal((await hold(token,{...input,answers:{option:'unsupported'}})).status,400);
 assert.equal((await hold(token,{...input,customer:{...input.customer,name:' invalid '}})).status,400);
 assert.equal((await hold(token,input,'https://second-checkout.example.test')).status,403);
 assert.equal((await hold('z'.repeat(43))).status,403);assert.equal((await hold('weak')).status,401);
 assert.equal((await hold(token,input,origin)).status,403);
 assert.deepEqual(await counts(),initial);
 // A disallowed slot rolls back the entire request, customer, draft and hold.
 assert.equal((await hold(token,{...input,requestedStart:new Date(day.getTime()+8*3600000).toISOString()})).status,404);assert.deepEqual(await counts(),initial);
 // Same-session concurrent replay serializes one draft/hold and stable metadata.
 const repeated=await Promise.all([hold(),hold()]);assert.deepEqual(repeated.map(r=>r.status),[200,200]);
 assert.deepEqual(repeated.map(r=>r.json.data.replayed).sort(),[false,true]);
 const won=repeated[0]!.json.data;for(const r of repeated)assert.deepEqual({...r.json.data,replayed:false},{...won,replayed:false});
 assert.equal(won.state,'draft');assert.equal(won.confirmed,false);assert.equal(won.paymentMode,'unavailable');assert.equal(won.versionId,receipt.versionId);assert.equal(won.installationId,receipt.installationId);assert.equal(won.serviceId,service);assert.equal(won.slot.start,start);assert.equal(won.slot.end,end);
 assert.deepEqual(Object.keys(won).sort(),['schemaVersion','versionId','installationId','serviceId','bookingId','reference','state','confirmed','paymentMode','slot','holdId','status','expiresAt','replayed'].sort());
 async function ownerPayment(bookingId:string){const r=await fetch(`${base}/api/bookings/mock-payment?tenantId=${tenant}`,{method:'POST',headers:{origin,authorization:'Bearer owner-token-123456','content-type':'application/json'},body:JSON.stringify({bookingId})});return{status:r.status,json:await r.json()};}
 const beforeOwner=await counts(),holdBefore=(await pool.query('select status,expires_at from public.capacity_holds where id=$1',[won.holdId])).rows[0];
 assert.equal((await ownerPayment(won.bookingId)).status,422);assert.deepEqual(await counts(),beforeOwner);
 await pool.query('update public.services set base_price=12600 where id=$1',[service]);
 const rejectedOwner=await ownerPayment(won.bookingId);assert.equal(rejectedOwner.status,422);assert.deepEqual(rejectedOwner.json,{ok:false,code:'UNSUPPORTED_CONFIG'});assert.deepEqual(await counts(),beforeOwner);
 const untouched=(await pool.query('select state,payment_id,pricing from public.bookings where id=$1',[won.bookingId])).rows[0];assert.deepEqual(untouched,{state:'draft',payment_id:null,pricing:{}});assert.deepEqual((await pool.query('select status,expires_at from public.capacity_holds where id=$1',[won.holdId])).rows[0],holdBefore);
 await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 const afterFirst=await counts();assert.equal(afterFirst.bookings,initial.bookings+1);assert.equal(afterFirst.capacity_holds,initial.capacity_holds+1);assert.equal(afterFirst.paid_journey_requests,1);assert.equal(afterFirst.flow_sessions,0);assert.equal(afterFirst.flow_requests,0);assert.equal(afterFirst.payments,0);
 assert.equal((await hold(token,{...input,idempotencyKey:'changed-key-0000001'})).status,409);assert.equal((await hold(token,{...input,customer:{name:'Other',email:'other@example.test'}})).status,409);assert.deepEqual(await counts(),afterFirst);
 const linked=(await pool.query('select b.state,b.selection,b.pricing,r.published_render,r.canonical_payload from public.bookings b join public.paid_journey_requests r on r.booking_id=b.id where b.id=$1',[won.bookingId])).rows[0];assert.equal(linked.state,'draft');assert.deepEqual(linked.selection,{serviceId:service});assert.deepEqual(linked.pricing,{});assert.equal(linked.published_render.versionId,receipt.versionId);assert.deepEqual(linked.canonical_payload,{customer:input.customer,answers:{},requestedStart:start});
 // Two independent customers contend for the last available second slot.
 const [a,b]=await Promise.all([issue(),issue()]);assert.equal(a.status,200);assert.equal(b.status,200);
 const next={...input,requestedStart:end,customer:{name:'Concurrent customer',email:'race@example.test'}};
 const raced=await Promise.all([hold(a.json.data.sessionToken,next),hold(b.json.data.sessionToken,next)]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
 const afterRace=await counts();assert.equal(afterRace.bookings,afterFirst.bookings+1);assert.equal(afterRace.capacity_holds,afterFirst.capacity_holds+1);assert.equal(afterRace.paid_journey_requests,afterFirst.paid_journey_requests+1);assert.equal(afterRace.payments,0);
 // Ended holds cannot silently renew even with matching session/key/payload.
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()-interval '1 second' where id=$1",[won.holdId]);assert.equal((await hold()).status,409);assert.deepEqual(await counts(),afterRace);
 // Current publication/service authority must still agree on every request/retry.
 await pool.query('update public.services set base_price=12600 where id=$1',[service]);assert.equal((await hold()).status,409);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 await pool.query("update public.tenants set status='suspended' where id=$1",[tenant]);assert.equal((await hold()).status,404);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 // Actual expiry during a blocked capacity lock must roll back the new customer/draft.
 const shortToken='s'.repeat(43),shortHash=createHash('sha256').update(shortToken).digest('hex');
 await pool.query(`insert into public.paid_journey_sessions select $1,tenant_id,flow_id,version_id,installation_id,service_id,origin,stamp-interval '15 minutes'+interval '2 seconds',stamp+interval '2 seconds' from public.paid_journey_sessions cross join (select clock_timestamp() stamp) x where token_hash=$2`,[shortHash,hash]);
 await pool.query('update public.availability_rules set end_minute=720 where tenant_id=$1',[tenant]);
 const blocker=await pool.connect();const beforeBlocked=await counts();try{await blocker.query('begin');await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['lumin:service-capacity:'+tenant+':'+service]);const pending=hold(shortToken,{...input,requestedStart:new Date(day.getTime()+11*3600000).toISOString(),customer:{name:'Expiry customer',email:'expiry@example.test'}});let waiting=false;const deadline=Date.now()+1200;while(Date.now()<deadline){waiting=(await pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select * from public.reserve_capacity%') waiting")).rows[0].waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,'hold must actually wait at capacity lock');const remaining=Number((await pool.query('select greatest(0,extract(epoch from expires_at-clock_timestamp())*1000) remaining from public.paid_journey_sessions where token_hash=$1',[shortHash])).rows[0].remaining);await new Promise(r=>setTimeout(r,remaining+30));await blocker.query('rollback');assert.equal((await pending).status,403);}finally{await blocker.query('rollback');blocker.release();}assert.deepEqual(await counts(),beforeBlocked);
 // Superseding the version removes old customer capability without legacy fallback.
 assert.equal((await request('POST',{...body,expectedRevision:1,name:'Next draft'})).status,200);assert.equal((await publish({...pubBody,expectedDraftRevision:2})).status,200);assert.equal((await hold()).status,404);
 assert.deepEqual(await counts(),beforeBlocked);assert.equal((await pool.query("select count(*) n from public.bookings where state='confirmed'")).rows[0].n,'0');
 // Ordinary owner simple booking payment remains available through the old authority.
 const legacy=id(83),legacyStart=new Date(day.getTime()+11*3600000).toISOString(),legacyEnd=new Date(day.getTime()+12*3600000).toISOString();
 await pool.query(`insert into public.bookings(id,tenant_id,reference,state,selection,slot_start,slot_end,idempotency_key) values($1,$2,'LMN-LEGACY-POSITIVE','draft',$3,$4,$5,'legacy-owner-positive-0001')`,[legacy,tenant,JSON.stringify({serviceId:service}),legacyStart,legacyEnd]);
 await createReservationWriter(pool)(actor,tenant,legacy);
 const legacyPaid=await ownerPayment(legacy);assert.equal(legacyPaid.status,200);assert.equal(legacyPaid.json.data.state,'confirmed');assert.equal(legacyPaid.json.data.simulated,true);assert.equal((await pool.query('select amount from public.payments where booking_id=$1',[legacy])).rows[0].amount,'12500');
 assert.equal((await pool.query("select count(*) n from public.bookings b join public.paid_journey_requests r on r.booking_id=b.id where b.state<>'draft' or b.payment_id is not null")).rows[0].n,'0');
 console.log('PASS actual dedicated V8 HTTP/Postgres atomic draft+hold, request provenance, duplicate replay, last-slot concurrency, expiry rollback and unchanged financial authority');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
