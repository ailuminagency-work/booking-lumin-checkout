/** Mandatory real disposable PostgreSQL HTTP roster acceptance; never skip. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Server} from 'node:http';
import {localPool,seedLocalFixtures,LOCAL_FIXTURE as F,localIdentity} from './fixtures';
import {createFlowRepository} from './repository';
import {createFlowHttpServer} from './http';
let pool=localPool(),server:Server|undefined,base='';const tenant=randomUUID(),service=randomUUID();let created=false,foreignWorker:string|undefined;
async function start(){server=createFlowHttpServer({repository:createFlowRepository(pool),authenticateOwner:localIdentity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function stop(){if(server){server.closeAllConnections();await new Promise<void>((r,j)=>server!.close(e=>e?j(e):r()));server=undefined;}await pool.end();}
async function request(path:string,body?:unknown,token=F.ownerToken,t:string=tenant){const r=await fetch(`${base}/api/roster${path}?tenantId=${t}`,{method:body===undefined?'GET':'POST',headers:{Origin:F.ownerOrigin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json() as object} as any;}
try{
 await seedLocalFixtures(pool);await pool.query("begin");try{await pool.query("insert into public.tenants(id,name,slug,timezone,currency) values($1::uuid,'Roster HTTP',$1::text,'UTC','USD')",[tenant]);await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')",[tenant,F.ownerA,F.staffA]);await pool.query("insert into public.services(id,tenant_id,name,archetype,currency,base_price) values($1,$2,'Service','simple','USD',0)",[service,tenant]);await pool.query('commit');created=true;}catch(e){await pool.query('rollback');throw e;}
 await start();const missing=await request('');assert.equal(missing.status,409);assert.equal(missing.code,'ROSTER_NOT_INITIALIZED');assert.equal((await pool.query('select count(*)::int n from public.worker_roster_state where tenant_id=$1',[tenant])).rows[0].n,0);
 for(const token of [F.staffToken,F.platformToken,F.otherOwnerToken])assert.equal((await request('',undefined,token)).status,403);
 const provision=await request('/provision',{});assert.equal(provision.status,200);assert.equal(provision.data.rosterVersion,1);
 const worker=await request('/workers',{expectedRosterVersion:1,displayName:'😀'.repeat(160),active:true});assert.equal(worker.status,200);const workerId=worker.data.entityId;assert.equal(worker.data.rosterVersion,2);
 assert.equal((await request('/workers',{expectedRosterVersion:1,displayName:'Lost response retry',active:true})).status,409);
 const crew=await request('/crews',{expectedRosterVersion:2,name:'Crew',active:true});assert.equal(crew.status,200);const crewId=crew.data.entityId;
 assert.equal((await request(`/crews/${crewId}/members`,{expectedRosterVersion:3,workerId,present:true})).status,200);
 assert.equal((await request('/eligibility',{expectedRosterVersion:4,serviceId:service,workerId,active:true,create:true})).status,200);
 const shift=await request('/shifts',{expectedRosterVersion:5,workerId,kind:'blocked',startsAt:'2030-01-01T00:00:00.000001Z',endsAt:'2030-01-01T00:00:00.000002Z',sourceTimeZone:'UTC',active:true});assert.equal(shift.status,200);
 await stop();pool=localPool();await start();const restored=await request('');assert.equal(restored.status,200);assert.equal(restored.data.rosterVersion,6);assert.equal(restored.data.workers[0].displayName,'😀'.repeat(160));assert.equal(restored.data.services[0].name,'Service');assert.deepEqual(restored.data.crews[0].workerIds,[workerId]);assert.equal(restored.data.shifts[0].startsAt,'2030-01-01T00:00:00.000001Z');assert.equal(restored.data.shifts[0].endsAt,'2030-01-01T00:00:00.000002Z');assert.equal(JSON.stringify(restored).includes('worker_access'),false);
 const otherProvision=await request('/provision',{},F.otherOwnerToken,F.tenantB);assert.equal(otherProvision.status,200);const foreign=await request('/workers',{expectedRosterVersion:otherProvision.data.rosterVersion,displayName:'Other tenant',active:true},F.otherOwnerToken,F.tenantB);assert.equal(foreign.status,200);foreignWorker=foreign.data.entityId;
 assert.equal((await request(`/crews/${crewId}/members`,{expectedRosterVersion:6,workerId:foreign.data.entityId,present:true})).status,400);
 assert.equal((await request(`/workers/${foreign.data.entityId}`,{expectedRosterVersion:6,displayName:'Forged',active:true})).status,409);
 assert.equal((await request('/access',{expectedRosterVersion:6,userId:F.staffA,workerId})).status,404);
 assert.equal((await request('/workers',{expectedRosterVersion:6,displayName:'bad\0name',active:true})).status,400);
 const edits=await Promise.all([request(`/workers/${workerId}`,{expectedRosterVersion:6,displayName:'A',active:false}),request(`/workers/${workerId}`,{expectedRosterVersion:6,displayName:'B',active:false})]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
 const retired=await request('');assert.equal(retired.data.rosterVersion,7);assert.equal(retired.data.workers[0].active,false);assert.equal(retired.data.shifts.length,1);assert.equal(retired.data.crews[0].workerIds.length,1);
 await pool.query('update public.services set name=$1 where id=$2',['x'.repeat(4097),service]);const large=await request('');assert.equal(large.status,422);assert.equal(large.code,'ROSTER_TOO_LARGE');await pool.query("update public.services set name='Service' where id=$1",[service]);
 assert.equal((await pool.query('select count(*)::int n from public.worker_access where tenant_id=$1',[tenant])).rows[0].n,0);assert.equal((await pool.query('select count(*)::int n from public.bookings where tenant_id=$1',[tenant])).rows[0].n,0);
}finally{
 if(foreignWorker)await pool.query('delete from public.workers where tenant_id=$1 and id=$2',[F.tenantB,foreignWorker]);
 if(created)await pool.query('delete from public.service_worker_eligibility where tenant_id=$1',[tenant]);
 if(created)await pool.query('delete from public.tenants where id=$1::uuid and slug=$1::text',[tenant]);
 await stop();
}

 console.log('PASS real PostgreSQL roster HTTP: provision/edit/restart, scoped complete snapshot, microseconds/Unicode, CAS race, foreign identities and size denial; local synthetic auth only');
