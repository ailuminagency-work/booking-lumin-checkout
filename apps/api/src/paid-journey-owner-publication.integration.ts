import assert from 'node:assert/strict';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
assert.equal(process.env.PAID_JOURNEY_OWNER_READ_LOCAL_TEST,'1');
const ci=process.env.CI==='true';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
let trustedDatabaseHost='127.0.0.1';
if(ci){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGDATABASE,'lumin_journey_owner_read_api_ci');
 trustedDatabaseHost=process.env.PAID_JOURNEY_OWNER_READ_CI_DATABASE_HOST??'';
 assert.equal(isIP(trustedDatabaseHost),4);
 assert.match(trustedDatabaseHost,/^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/);
}else{
 assert.notEqual(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.PGPORT,'59069');assert.match(process.env.PGDATABASE??'',/^lumin_journey_owner_read_api_[a-z0-9_]+$/);
}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`39000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test','https://second-checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidJourneyDrafts:true,paidJourneyPublication:true,paidSimplePublication:true});
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

 async function ownerRead(targetTenant=tenant,token='owner-token-123456',o=origin,suffix=''){const r=await fetch(`${base}/api/paid-journey-flows/${flow}/publication?tenantId=${targetTenant}${suffix}`,{headers:{authorization:`Bearer ${token}`,origin:o}});return{status:r.status,json:await r.json()};}
 const current=await ownerRead();assert.equal(current.status,200);assert.equal(current.json.data.versionId,receipt.versionId);assert.equal(current.json.data.installationId,receipt.installationId);assert.equal(current.json.data.render.versionId,receipt.versionId);assert.equal(current.json.data.draftRevision,1);assert.deepEqual(current.json.data.allowedOrigins,pubBody.allowedOrigins);assert.ok(!('actorId' in current.json.data));
 assert.equal((await read(receipt.installationId,origin)).status,403); // owner must not spoof a customer origin.
 assert.equal((await ownerRead(undefined,undefined,'https://checkout.example.test')).status,403);assert.equal((await ownerRead(undefined,'invalid-token-123456')).status,401);assert.equal((await ownerRead(undefined,'foreign-token-123456')).status,403);assert.equal((await ownerRead(foreignTenant)).status,403);assert.equal((await ownerRead(undefined,undefined,undefined,'&actorId='+foreignActor)).status,400);
 for(const status of ['inactive','suspended']){await pool.query('update public.tenants set status=$2 where id=$1',[tenant,status]);assert.equal((await ownerRead()).status,403);}await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await ownerRead()).status,403);await pool.query('delete from public.tenant_members where tenant_id=$1 and user_id=$2',[tenant,actor]);assert.equal((await ownerRead()).status,403);await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 await pool.query('update public.services set active=false where id=$1',[service]);assert.equal((await ownerRead()).status,403);await pool.query('update public.services set active=true,base_price=12600 where id=$1',[service]);assert.equal((await ownerRead()).status,409);await pool.query('update public.services set base_price=12500 where id=$1',[service]);
 const reordered={...journey,stages:[journey.stages[0],journey.stages[1],journey.stages[3],journey.stages[2],journey.stages[4],journey.stages[5]]};assert.equal((await request('POST',{...body,expectedRevision:1,journey:reordered})).status,200);assert.equal((await ownerRead()).json.data.draftRevision,1);const next=await publish({...pubBody,expectedDraftRevision:2});assert.equal(next.status,200);const newer=(await ownerRead()).json.data;assert.equal(newer.draftRevision,2);assert.equal(newer.versionId,next.json.data.versionId);assert.deepEqual(newer.render.form.journey,reordered);
 for(const table of ['paid_journey_sessions','flow_sessions','flow_requests','bookings','payments','capacity_holds'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 console.log('PASS actual authenticated V8 owner publication HTTP+Postgres current/immutable/tenant/member/catalog/origin no customer spoofing or writer');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
