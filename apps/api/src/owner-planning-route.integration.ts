/** Disposable PostgreSQL proof of the owner HTTP route and planning allocator. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {allocateOwnerPlanningGroup} from './owner-planning-allocation';
import {observer,seed,state,pool,blocker,backendPid,blocked,observe,type Fixture} from './planning-allocation-fixtures';

const origin='https://owner.planning.example.test';
const ownerToken='owner-planning-synthetic-token-0001';
const foreignToken='foreign-planning-synthetic-token-01';
const invalidToken='invalid-planning-synthetic-token-01';
const db=await observer();
const real=pool();
let server:Server|undefined;
let base='';
let ownerId='';
let foreignId='';
const auth=async (credential:string)=>credential===ownerToken?ownerId:credential===foreignToken?foreignId:null;
const body=(f:Fixture)=>({bookingId:f.booking,crewId:f.crew,targetGeneration:1});
async function post(f:Fixture,credential=ownerToken,tenantId=f.tenant){
 const response=await fetch(`${base}/api/planning/allocate?tenantId=${tenantId}`,{
  method:'POST',headers:{origin,authorization:`Bearer ${credential}`,'content-type':'application/json'},body:JSON.stringify(body(f)),
 });
 return {status:response.status,body:await response.json() as Record<string,any>};
}
async function noCarriers(f:Fixture){
 const saved=await state(db,f);
 for(const key of ['heads','groups','capacity','resources','workers','workerManifest','resourceManifest'])assert.deepEqual(saved[key],[],key);
 assert.equal(saved.booking.state,'draft');assert.equal(saved.booking.payment_id,null);
}
try{
 const foreign=await seed(db);foreignId=foreign.actor;
 const success=await seed(db);ownerId=success.actor;
 server=createFlowHttpServer({repository:{call:async()=>{throw Error('UNEXPECTED_RPC');}},authenticateOwner:auth,
  ownerOrigins:[origin],customerOrigins:[],allocatePlanning:(actor,request)=>allocateOwnerPlanningGroup(real,actor,request)});
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;

 assert.equal((await post(success,invalidToken)).status,401);
 assert.equal((await post(success,foreignToken)).status,403);
 assert.equal((await post(success,ownerToken,foreign.tenant)).status,403);
 await noCarriers(success);
 const first=await post(success);
 assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.ok,true);assert.equal(first.body.data.bookingId,success.booking);
 assert.equal(first.body.data.status,'held');assert.equal(first.body.data.usable,true);
 assert.equal(first.body.data.bookingState,'draft');assert.equal(first.body.data.confirmed,false);
 const saved=await state(db,success);
 for(const key of ['heads','groups','capacity','resources','workers','workerManifest','resourceManifest'])assert.equal(saved[key].length,1,key);
 assert.equal(saved.booking.state,'draft');assert.equal(saved.booking.payment_id,null);
 const retry=await post(success);assert.equal(retry.status,200,JSON.stringify(retry.body));
 assert.deepEqual(retry.body.data,first.body.data);assert.deepEqual(await state(db,success),saved);
 console.log('PASS owner HTTP route persists one tentative allocation, retries exactly, and rejects invalid/foreign identity');

 const blockedFixture=await seed(db);ownerId=blockedFixture.actor;
 const version=(await db.query('select version from public.worker_roster_state where tenant_id=$1',[blockedFixture.tenant])).rows[0].version;
 const blockedShift=randomUUID();
 await db.query(`select public.roster_shift_put($1,$2,$3,$4,$5,'blocked',b.slot_start,b.slot_end,'UTC',true,true)
  from public.bookings b where b.id=$6`,[blockedFixture.actor,blockedFixture.tenant,version,blockedShift,blockedFixture.worker,blockedFixture.booking]);
 const denied=await post(blockedFixture);assert.equal(denied.status,409,JSON.stringify(denied.body));
 assert.equal(denied.body.code,'UNAVAILABLE');await noCarriers(blockedFixture);
 console.log('PASS authoritative blocked shift rejects HTTP allocation without carriers');

 const race=await seed(db);ownerId=race.actor;
 const writer=await blocker();
 try{
  const v=(await db.query('select version from public.worker_roster_state where tenant_id=$1',[race.tenant])).rows[0].version;
  await writer.query(`select public.roster_shift_put($1,$2,$3,$4,$5,'blocked',b.slot_start,b.slot_end,'UTC',true,true)
   from public.bookings b where b.id=$6`,[race.actor,race.tenant,v,randomUUID(),race.worker,race.booking]);
  const pending=post(race);
  let pid=0;
  await observe(async()=>{
   const rows=(await db.query(`select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()
    and wait_event_type='Lock' and $1=any(pg_blocking_pids(pid)) and query like '%allocate_planning_group%'`,[backendPid(writer)])).rows;
   if(rows.length!==1)return false;pid=rows[0].pid;return true;
  },'HTTP allocator waits for roster writer');
  await blocked(db,pid,backendPid(writer));
  await writer.query('commit');
  const result=await pending;assert.equal(result.status,409,JSON.stringify(result.body));
  assert.equal(result.body.code,'UNAVAILABLE');await noCarriers(race);
  console.log('PASS committed blocked shift wins observed roster race; HTTP allocation leaves no carriers');
 }finally{try{await writer.query('rollback');}catch{/* already committed */}await writer.end();}
}finally{
 if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}
 await real.end();await db.end();
}
