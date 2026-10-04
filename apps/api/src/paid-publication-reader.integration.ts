import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createPaidPublicationReader} from './paid-publication-reader';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
assert.equal(process.env.PAID_RECOVERY_LOCAL_TEST,'1');
if(process.env.CI==='true'){
 assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');
}else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');}
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_recovery_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool(),id=(n:number)=>`38000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),service=id(3),flow=id(4),foreignActor=id(90),foreignTenant=id(91);
const reader=createPaidPublicationReader(pool),ownerOrigin='https://portal.example.test',customerOrigin='https://checkout.example.test';
const server=createFlowHttpServer({repository:createFlowRepository(pool),paidSimplePublication:true,paidPublication:reader,ownerOrigins:[ownerOrigin],customerOrigins:[customerOrigin],authenticateOwner:async token=>token==='owner-token-123456'?actor:token==='foreign-token-123456'?foreignActor:null});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function get(target=flow,targetTenant=tenant,token='owner-token-123456',origin=ownerOrigin){const r=await fetch(`${base}/api/paid-simple-flows/${target}/publication?tenantId=${targetTenant}`,{headers:{origin,authorization:`Bearer ${token}`}});return{status:r.status,json:await r.json()};}
try{
 await pool.query(`insert into auth.users(id,email) values($1,'recovery-owner@example.test'),($2,'recovery-foreign@example.test')`,[actor,foreignActor]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Recovery','recovery-fixture','UTC','USD'),($2,'Foreign','recovery-foreign','UTC','USD')`,[tenant,foreignTenant]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')`,[tenant,actor,foreignTenant,foreignActor]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping','simple','USD',12500,60)`,[service,tenant]);
 const before=await get();assert.deepEqual(before,{status:404,json:{ok:false,code:'NOT_AVAILABLE'}});
 const pub=await createFlowRepository(pool).call('publish_paid_simple_flow',[actor,tenant,flow,service,'Recovery paid',id(5),id(6),[customerOrigin]]) as {versionId:string;installationId:string;renderSchemaVersion:3};
 const receipt={...pub,hostedPath:`/checkout/flow/${pub.installationId}`};
 const expected={status:200,json:{ok:true,data:receipt}};assert.deepEqual(await get(),expected);assert.deepEqual(await get(),expected);
 assert.equal((await get(flow,tenant,'foreign-token-123456')).status,404);assert.equal((await get(flow,foreignTenant)).status,404);
 assert.equal((await get(flow,tenant,'invalid-token-123456')).status,401);assert.equal((await get(flow,tenant,undefined,customerOrigin)).status,403);
 for(const status of ['inactive','suspended']){await pool.query('update public.tenants set status=$2 where id=$1',[tenant,status]);assert.equal((await get()).status,404);}await pool.query("update public.tenants set status='active' where id=$1",[tenant]);
 await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[tenant,actor]);assert.equal((await get()).status,404);
 await pool.query('delete from public.tenant_members where tenant_id=$1 and user_id=$2',[tenant,actor]);assert.equal((await get()).status,404);
 await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",[tenant,actor]);
 await pool.query("update public.flows set status='archived' where id=$1",[flow]);assert.equal((await get()).status,404);await pool.query("update public.flows set status='active' where id=$1",[flow]);
 // The storage permits several installations. Recovery refuses to choose one.
 await pool.query('insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values($1,$2,$3,$4,$5::jsonb)',[id(7),tenant,flow,pub.versionId,JSON.stringify([customerOrigin])]);assert.equal((await get()).status,404);await pool.query('delete from public.flow_installations where id=$1',[id(7)]);
 await pool.query('update public.flows set published_version_id=null where id=$1',[flow]);assert.equal((await get()).status,404);await pool.query('update public.flows set published_version_id=$2 where id=$1',[flow,pub.versionId]);
 await pool.query('delete from public.flow_installations where id=$1',[pub.installationId]);assert.equal((await get()).status,404);await pool.query('insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values($1,$2,$3,$4,$5::jsonb)',[pub.installationId,tenant,flow,pub.versionId,JSON.stringify([customerOrigin])]);
 const config={key:'legacy',steps:[{key:'information',kind:'info',title:'Legacy'}]};
 await pool.query("insert into public.flows(id,tenant_id,name,status) values($1,$2,'Legacy','active')",[id(8),tenant]);
 await pool.query("insert into public.flow_versions(id,tenant_id,flow_id,source_revision,submission_mode,config) values($1,$2,$3,1,'unconfirmed_request',$4::jsonb)",[id(9),tenant,id(8),JSON.stringify(config)]);
 await pool.query('insert into public.flow_installations(id,tenant_id,flow_id,version_id,allowed_origins) values($1,$2,$3,$4,$5::jsonb)',[id(10),tenant,id(8),id(9),JSON.stringify([customerOrigin])]);await pool.query('update public.flows set published_version_id=$2 where id=$1',[id(8),id(9)]);assert.equal((await get(id(8))).status,404);
 assert.deepEqual(await get(),expected);
 // An actual publication may be in flight while recovery sees no committed row.
 // NOT_AVAILABLE must carry no retry authority, and the reader must not block it.
 const pendingWriter=await pool.connect();try{
  await pendingWriter.query('begin');await pendingWriter.query('set local role service_role');
  const pending=(await pendingWriter.query('select public.publish_paid_simple_flow($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::jsonb) receipt',[actor,tenant,id(11),service,'In-flight recovery',id(12),id(13),JSON.stringify([customerOrigin])])).rows[0].receipt;
  assert.deepEqual(await get(id(11)),{status:404,json:{ok:false,code:'NOT_AVAILABLE'}});
  await pendingWriter.query('commit');
  assert.deepEqual(await get(id(11)),{status:200,json:{ok:true,data:{...pending,hostedPath:`/checkout/flow/${pending.installationId}`}}});
 }finally{await pendingWriter.query('rollback');pendingWriter.release();}
 // Repeated GETs leave publication identity and all customer financial tables untouched.
 assert.equal(Number((await pool.query('select count(*) n from public.flow_versions where flow_id=$1',[flow])).rows[0].n),1);
 assert.equal(Number((await pool.query('select count(*) n from public.flow_installations where flow_id=$1',[flow])).rows[0].n),1);
 for(const table of ['flow_sessions','flow_requests','bookings','payments','capacity_holds'])assert.equal(Number((await pool.query(`select count(*) n from public.${table}`)).rows[0].n),0);
 console.log('PASS real read-only owner recovery HTTP/DB: exact existing V3 receipt/repeat, absent/foreign/invalid identity/origin/inactive/suspended/staff/revoked owner/archived/current-version-unset/missing installation/ambiguous installation/legacy denial; uncommitted publication NOT_AVAILABLE then committed receipt; no customer or financial writes');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
