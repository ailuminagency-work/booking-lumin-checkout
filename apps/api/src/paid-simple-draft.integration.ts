import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
assert.equal(process.env.PAID_DRAFT_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_draft_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`39000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[origin],customerOrigins:['https://checkout.example.test'],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidSimplePublication:true});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const body={serviceId:service,name:'Housekeeping',presentation:{accentColor:'#4f46e5',layout:'stacked'},expectedRevision:0};
async function request(method='POST',value:unknown=body,target=flow,targetTenant=tenant,token='owner-token-123456',o=origin){const r=await fetch(`${base}/api/paid-simple-flows/${target}/draft?tenantId=${targetTenant}`,{method,headers:{authorization:`Bearer ${token}`,origin:o,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(value)})});return{status:r.status,json:await r.json()};}
try{
 await pool.query(`insert into auth.users(id,email) values($1,'draft-owner@example.test'),($2,'draft-foreign@example.test')`,[actor,foreignActor]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Draft','paid-draft-fixture','UTC','USD'),($2,'Foreign','paid-draft-foreign-fixture','UTC','USD')`,[tenant,foreignTenant]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')`,[tenant,actor,foreignTenant,foreignActor]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping','simple','USD',12500,60),($3,$4,'Foreign','simple','USD',200,60)`,[service,tenant,id(97),foreignTenant]);
 assert.equal((await request('GET')).status,404);
 assert.deepEqual(await request(),{status:200,json:{ok:true,data:{flowId:flow,revision:1}}});
 const expected={flowId:flow,revision:1,serviceId:service,name:'Housekeeping',presentation:body.presentation};assert.deepEqual(await request('GET'),{status:200,json:{ok:true,data:expected}});
 const update={...body,expectedRevision:1,name:'Saved housekeeping',presentation:{accentColor:'#0e7490',layout:'compact'}};
 assert.deepEqual(await request('POST',update),{status:200,json:{ok:true,data:{flowId:flow,revision:2}}});
 assert.equal((await request('POST',update)).status,409);assert.equal((await request()).status,409);
 assert.deepEqual((await request('GET')).json.data,{...expected,name:update.name,presentation:update.presentation,revision:2});
 // Concurrent edits using the same revision have one winner and one conflict.
 const concurrent=await Promise.all([request('POST',{...update,expectedRevision:2,name:'Concurrent A'}),request('POST',{...update,expectedRevision:2,name:'Concurrent B'})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal((await request('GET')).json.data.revision,3);
 for(const method of ['GET','POST']){
  assert.equal((await request(method,{...update,expectedRevision:3},flow,tenant,'foreign-token-123456')).status,403);
  assert.equal((await request(method,{...update,expectedRevision:3},flow,foreignTenant)).status,403);
  assert.equal((await request(method,{...update,expectedRevision:3},flow,tenant,'invalid-token-123456')).status,401);
  assert.equal((await request(method,{...update,expectedRevision:3},flow,tenant,undefined,'https://checkout.example.test')).status,403);
 }
 assert.equal((await request('POST',{...update,expectedRevision:3,serviceId:id(97)})).status,403);
 for(const extra of [{price:1},{tenantId:tenant},{role:'BUSINESS_OWNER'},{provider:'stripe'},{authoring:{}}])assert.equal((await request('POST',{...update,expectedRevision:3,...extra})).status,400);
 assert.equal((await request('POST',{...update,expectedRevision:3,presentation:{...update.presentation,price:1}})).status,400);
 for(const status of ['inactive','suspended']){await pool.query('update public.tenants set status=$2 where id=$1',[tenant,status]);assert.equal((await request('GET')).status,403);assert.equal((await request('POST',{...update,expectedRevision:3})).status,403);}await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await request('GET')).status,403);assert.equal((await request('POST',{...update,expectedRevision:3})).status,403);
 await pool.query('delete from public.tenant_members where tenant_id=$1 and user_id=$2',[tenant,actor]);assert.equal((await request('GET')).status,403);assert.equal((await request('POST',{...update,expectedRevision:3})).status,403);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 for(const mutation of ['base_price=0','tax_rate_bp=100','active=false']){
  await pool.query(`update public.services set ${mutation} where id=$1`,[service]);const status=mutation==='active=false'?403:422;assert.equal((await request('GET')).status,status);assert.equal((await request('POST',{...update,expectedRevision:3})).status,status);
  await pool.query('update public.services set base_price=12500,tax_rate_bp=0,active=true where id=$1',[service]);
 }
 await pool.query(`insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values($1,$2,'qty','Quantity','quantity',0,1,5,'[]')`,[tenant,service]);assert.equal((await request('GET')).status,422);assert.equal((await request('POST',{...update,expectedRevision:3})).status,422);await pool.query('delete from public.service_questions where service_id=$1',[service]);
 assert.equal((await request('GET')).json.data.revision,3);
 assert.equal(Number((await pool.query('select count(*) n from public.paid_simple_drafts')).rows[0].n),1);
 for(const table of ['flows','flow_versions','flow_installations','flow_sessions','flow_requests','bookings','payments','capacity_holds'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 console.log('PASS real HTTP owner paid draft save/read/update/stale and concurrent revision conflict; foreign/staff/revoked/inactive/origin denial; strict presentation/authority and current positive-price eligibility; no publication/customer/payment writes');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
