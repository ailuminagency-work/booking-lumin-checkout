import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createPaidDraftListReader} from './paid-draft-list-reader';
assert.equal(process.env.PAID_DRAFT_LIST_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_draft_list_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`41000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),foreignActor=id(99),foreignTenant=id(98),origin='https://portal.example.test';
const repository=createFlowRepository(pool);
const server=createFlowHttpServer({repository,ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null,paidSimplePublication:true,paidDrafts:createPaidDraftListReader(pool)});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function request(targetTenant=tenant,token='owner-token-123456',o=origin){const r=await fetch(`${base}/api/paid-simple-drafts?tenantId=${targetTenant}`,{headers:{authorization:`Bearer ${token}`,origin:o}});return{status:r.status,json:await r.json()};}
const presentation={accentColor:'#4f46e5',layout:'stacked'};
try{
 await pool.query(`insert into auth.users(id,email) values($1,'list-owner@example.test'),($2,'list-foreign@example.test')`,[actor,foreignActor]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Draft list','draft-list','UTC','USD'),($2,'Foreign','draft-list-foreign','UTC','USD')`,[tenant,foreignTenant]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')`,[tenant,actor,foreignTenant,foreignActor]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping','simple','USD',12500,60),($3,$4,'Foreign','simple','USD',200,60)`,[service,tenant,id(97),foreignTenant]);
 assert.deepEqual(await request(),{status:200,json:{ok:true,data:{drafts:[]}}});
 await pool.query('insert into public.flows(id,tenant_id,name) values($1,$2,$3)',[id(95),tenant,'Legacy draft']);
 assert.deepEqual(await request(),{status:200,json:{ok:true,data:{drafts:[]}}});
 await repository.call('save_paid_simple_draft',[foreignActor,foreignTenant,id(96),id(97),0,'Private foreign',presentation.accentColor,presentation.layout]);
 for(const n of [11,10])await repository.call('save_paid_simple_draft',[actor,tenant,id(n),service,0,`Draft ${n}`,presentation.accentColor,presentation.layout]);
 await repository.call('save_paid_simple_draft',[actor,tenant,id(10),service,1,'Updated draft',presentation.accentColor,'compact']);
 const expected=[{flowId:id(10),name:'Updated draft',revision:2,serviceId:service,presentation:{...presentation,layout:'compact'}},{flowId:id(11),name:'Draft 11',revision:1,serviceId:service,presentation}];
 assert.deepEqual(await request(),{status:200,json:{ok:true,data:{drafts:expected}}});
 assert.equal((await request(tenant,'foreign-token-123456')).status,403);assert.equal((await request(foreignTenant)).status,403);
 assert.equal((await request(tenant,'invalid-token-123456')).status,401);assert.equal((await request(tenant,undefined,'https://checkout.example.test')).status,403);
 for(const status of ['inactive','suspended']){await pool.query('update public.tenants set status=$2 where id=$1',[tenant,status]);assert.equal((await request()).status,403);}await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await request()).status,403);
 await pool.query('delete from public.tenant_members where tenant_id=$1 and user_id=$2',[tenant,actor]);assert.equal((await request()).status,403);await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 for(const mutation of ['base_price=0','tax_rate_bp=100','active=false']){await pool.query(`update public.services set ${mutation} where id=$1`,[service]);assert.equal((await request()).status,mutation==='active=false'?403:422);await pool.query('update public.services set base_price=12500,tax_rate_bp=0,active=true where id=$1',[service]);}
 await pool.query(`insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,unit_price,min_qty,max_qty,choices) values($1,$2,'qty','Quantity','quantity',0,1,5,'[]')`,[tenant,service]);assert.equal((await request()).status,422);await pool.query('delete from public.service_questions where service_id=$1',[service]);
 for(let n=12;n<60;n++)await repository.call('save_paid_simple_draft',[actor,tenant,id(n),service,0,`Draft ${n}`,presentation.accentColor,presentation.layout]);
 assert.equal((await request()).json.data.drafts.length,50);
 await repository.call('save_paid_simple_draft',[actor,tenant,id(60),service,0,'Overflow',presentation.accentColor,presentation.layout]);assert.deepEqual(await request(),{status:404,json:{ok:false,code:'NOT_AVAILABLE'}});
 await pool.query('delete from public.paid_simple_drafts where flow_id=$1',[id(60)]);
 const inFlight=await pool.connect();
 try{await inFlight.query('begin');await inFlight.query('insert into public.paid_simple_drafts(flow_id,tenant_id,service_id,revision,name,accent_color,layout) values($1,$2,$3,1,$4,$5,$6)',[id(61),tenant,service,'Uncommitted',presentation.accentColor,presentation.layout]);assert.equal((await request()).json.data.drafts.length,50);}finally{await inFlight.query('rollback');inFlight.release();}
 const before=(await pool.query('select jsonb_agg(to_jsonb(d) order by flow_id) as snapshot from public.paid_simple_drafts d')).rows[0].snapshot;
 for(let i=0;i<3;i++)assert.equal((await request()).status,200);
 assert.deepEqual((await pool.query('select jsonb_agg(to_jsonb(d) order by flow_id) as snapshot from public.paid_simple_drafts d')).rows[0].snapshot,before);
 for(const table of ['flow_versions','flow_installations','flow_sessions','flow_requests','bookings','payments','capacity_holds'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 assert.equal(Number((await pool.query('select count(*) n from public.flows')).rows[0].n),1);
 console.log('PASS actual HTTP private draft discovery: ordered current revisions, legacy excluded and uncommitted save excluded; empty/foreign/staff/revoked/inactive/origin; current positive-price eligibility; 50 accepted/51 fails closed; immutable draft reads and zero publication/customer/financial writes');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
