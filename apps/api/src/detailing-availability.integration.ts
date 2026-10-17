import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createDetailingOfferCreator} from './detailing-catalog';
import {createDetailingSchedulingCreator} from './detailing-scheduling';
import {createDetailingPublicationApi} from './detailing-publication';
import {createDetailingAvailabilityReader} from './detailing-availability';
assert.equal(process.env.DETAILING_AVAILABILITY_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');}else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_detailing_availability_/);for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`65000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),tenant=id(2),flow=id(3),foreign=id(8),foreignTenant=id(9),ownerOrigin='https://portal.example.test',origin='https://checkout.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),catalogAuthoring:true,detailingOfferCreate:createDetailingOfferCreator(pool),schedulingAuthoring:true,detailingSchedulingCreate:createDetailingSchedulingCreator(pool),detailingPublication:true,detailingPublicationApi:createDetailingPublicationApi(pool,[origin]),detailingAvailability:createDetailingAvailabilityReader(pool,[origin]),ownerOrigins:[ownerOrigin],customerOrigins:[origin],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreign:null});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function req(path:string,body:unknown=undefined,token='owner-token-123456',o=ownerOrigin){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin:o,authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,json:await response.json()};}
const nextDay=new Date();nextDay.setUTCDate(nextDay.getUTCDate()+1);nextDay.setUTCHours(0,0,0,0);const from=nextDay.toISOString(),to=new Date(nextDay.getTime()+86400000).toISOString();
async function fingerprint(){const data:Record<string,unknown>={};for(const table of ['services','service_questions','service_addons','business_profiles','owner_detailing_catalog_creations','owner_detailing_scheduling','availability_rules','availability_overrides','scheduling_policies','flows','flow_versions','bound_flow_versions','detailing_publications','flow_installations','bookings','capacity_holds','payments','flow_requests'])data[table]=(await pool.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') data from public.${table} x where tenant_id=$1`,[tenant])).rows[0].data;return data;}
try{
 await pool.query("insert into auth.users(id,email) values($1,'availability-owner@example.test'),($2,'availability-foreign@example.test')",[actor,foreign]);for(const [a,t] of [[actor,tenant],[foreign,foreignTenant]])await pool.query('select public.create_staging_business($1,$2,$3,$4,$5,$6,$7,$8)',[a,t,'Detailing availability',t,'UTC','USD','AUTO_DETAILING','detailing-availability-business-'+t]);
 const offer={name:'Scheduled detail package',description:'',currency:'USD',durationMinutes:60,packages:[{id:'basic',label:'Basic',amount:15000}],vehicles:[{id:'sedan',label:'Sedan',multiplierBp:10000}],addons:[],locations:[],idempotencyKey:'detailing-availability-offer-0001'};
 const made=await req('/api/catalog/detailing-offers?tenantId='+tenant,offer);assert.equal(made.status,200,JSON.stringify(made));const service=made.json.data.service.id;
 const schedule={timezone:'UTC',windows:Array.from({length:7},(_,weekday)=>({weekday,startMinute:540,endMinute:1020,capacity:1})),policy:{leadTimeMinutes:0,horizonDays:30,slotIntervalMinutes:30},idempotencyKey:'detailing-availability-schedule-0001'};
 assert.equal((await req(`/api/catalog/detailing-offers/${service}/scheduling?tenantId=${tenant}`,schedule)).status,200);
 const path=(kind:string)=>`/api/detailing-flows/${flow}/${kind}?tenantId=${tenant}`;
 assert.equal((await req(path('draft'),{expectedRevision:0,serviceId:service,name:'Detail appointment',presentation:{accentColor:'#4f46e5',layout:'stacked'}})).status,200);
 const published=await req(path('publish-draft'),{expectedDraftRevision:1,allowedOrigins:[origin]});assert.equal(published.status,200);const receipt=published.json.data.publication;
 const issued=await req(`/api/detailing-installations/${receipt.installationId}/sessions`,{},'',origin);assert.equal(issued.status,200);const token=issued.json.data.sessionToken;
 const url='/api/detailing-flow-sessions/availability?'+new URLSearchParams({from,to}),availability=()=>req(url,undefined,token,origin);
 const empty=await availability();assert.equal(empty.status,200,JSON.stringify(empty));assert.equal(empty.json.data.versionId,receipt.versionId);assert.equal(empty.json.data.installationId,receipt.installationId);assert.equal(empty.json.data.expiresAt,issued.json.data.expiresAt);assert.equal(empty.json.data.serviceId,service);assert.equal(empty.json.data.durationMinutes,60);assert.equal(empty.json.data.timezone,'UTC');assert.equal(empty.json.data.slots.length,15);assert.equal(empty.json.data.slots[0].start,from.replace('00:00:00','09:00:00'));assert.ok(empty.json.data.slots.every((s:{remainingCapacity:number})=>s.remainingCapacity===1));assert.ok(!JSON.stringify(empty).includes(tenant));assert.ok(!JSON.stringify(empty).includes(actor));assert.ok(!JSON.stringify(empty).includes('15000'));
 // Explicit local fixture consumers, not a new customer hold/confirmation writer.
 const start=empty.json.data.slots[0].start,end=empty.json.data.slots[0].end;
 await pool.query('insert into public.bookings(id,tenant_id,reference,state,selection,slot_start,slot_end,idempotency_key) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8)',[id(30),tenant,'LMN-DETAIL-AVAIL-FIXTURE','confirmed',JSON.stringify({serviceId:service}),start,end,'detailing-availability-fixture-0001']);
 await pool.query("insert into public.capacity_holds(id,tenant_id,service_id,slot_start,slot_end,booking_id,hold_key,status,expires_at) values($1,$2,$3,$4,$5,$6,$7,'consumed',clock_timestamp()-interval '1 minute')",[id(31),tenant,service,start,end,id(30),'detailing-availability-consumed-0001']);
 const before=await fingerprint(),occupied=await availability();assert.equal(occupied.status,200,JSON.stringify(occupied));assert.equal(occupied.json.data.slots.length,13);assert.equal(occupied.json.data.slots[0].start,from.replace('00:00:00','10:00:00'));assert.deepEqual(await availability(),occupied);
 for(const suffix of ['&tenantId='+foreignTenant,'&serviceId='+service,'&price=1','&from='+from])assert.equal((await req(url+suffix,undefined,token,origin)).status,400);
 assert.equal((await req(url,undefined,token,ownerOrigin)).status,403);assert.equal((await req(url,undefined,'bad',origin)).status,401);
 const beyond=new Date(nextDay.getTime()+40*86400000).toISOString();assert.deepEqual((await req('/api/detailing-flow-sessions/availability?'+new URLSearchParams({from:beyond,to:new Date(Date.parse(beyond)+86400000).toISOString()}),undefined,token,origin)).json.data.slots,[]);
 await pool.query("update public.service_questions set prompt='Drift' where service_id=$1 and question_key='package'",[service]);assert.equal((await availability()).status,409);await pool.query("update public.service_questions set prompt='Detail package' where service_id=$1 and question_key='package'",[service]);
 await pool.query('update public.availability_rules set capacity=2 where service_id=$1 and weekday=0',[service]);assert.equal((await availability()).status,409);await pool.query('update public.availability_rules set capacity=1 where service_id=$1 and weekday=0',[service]);
 await pool.query("update public.tenants set currency='EUR' where id=$1",[tenant]);assert.equal((await availability()).status,409);await pool.query("update public.tenants set currency='USD' where id=$1",[tenant]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await availability()).status,403);await pool.query("update public.tenant_members set role='BUSINESS_OWNER' where tenant_id=$1 and user_id=$2",[tenant,actor]);
 await pool.query("update public.tenants set status='inactive' where id=$1",[tenant]);assert.equal((await availability()).status,403);await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query('insert into public.flow_installations values($1,$2,$3,$4,$5::jsonb)',[id(90),tenant,flow,receipt.versionId,JSON.stringify([origin])]);assert.equal((await availability()).status,403);await pool.query('delete from public.flow_installations where id=$1',[id(90)]);
 assert.deepEqual(await availability(),occupied);assert.deepEqual(await fingerprint(),before);
 // Observe actual session expiry while the resolver waits on tenant authority.
 await pool.query("update public.flow_sessions set expires_at=clock_timestamp()+interval '2 seconds' where installation_id=$1",[receipt.installationId]);
 const block=await pool.connect(),observe=await pool.connect();
 try{
  await block.query('begin');await block.query('select id from public.tenants where id=$1 for update',[tenant]);
  const pending=availability();let waiting=false;const deadline=Date.now()+1200;
  while(Date.now()<deadline){waiting=(await observe.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select public.resolve_detailing_flow_session%') waiting")).rows[0].waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(waiting,'resolver must actually wait on tenant authority');
  const remaining=Number((await observe.query('select greatest(0,extract(epoch from expires_at-clock_timestamp())*1000) remaining from public.flow_sessions where installation_id=$1',[receipt.installationId])).rows[0].remaining);await new Promise(r=>setTimeout(r,remaining+30));await block.query('rollback');assert.equal((await pending).status,403);
 }finally{await block.query('rollback');block.release();observe.release();}
 await pool.query('update public.flow_sessions set revoked=true where installation_id=$1',[receipt.installationId]);assert.equal((await availability()).status,403);
 await pool.query("update public.flow_sessions set revoked=false,expires_at=clock_timestamp()-interval '1 second' where installation_id=$1",[receipt.installationId]);assert.equal((await availability()).status,403);
 assert.deepEqual(await fingerprint(),before);
 console.log('PASS actual HTTP schema7 canonical slots, pinned60minute capacity1, consumed confirmed-booking exclusion, horizon, foreign/role/currency/catalog/schedule/alias/revoked/expiry denial, readonly catalog/publication/financial fingerprints');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
