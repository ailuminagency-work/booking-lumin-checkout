/** Real disposable PostgreSQL transport acceptance. Synthetic local identity only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {Pool,type PoolClient} from 'pg';
import {__createPlanningAllocationRepositoryForTests as create,createLocalPlanningAllocationRepository} from './planning-allocation-repository';
import {actor,request,seed,state,observer,pool,config,blocker,blocked,gone,observe,pause,backendPid,commitFixture,type Fixture} from './planning-allocation-fixtures';
type Hook=(client:PoolClient,text:string,values:unknown[]|undefined,run:()=>Promise<any>)=>Promise<any>;
type RecordEntry={pid:number,commands:string[],releases:boolean[]};
function tracked(real:Pool,hook?:Hook){const records:RecordEntry[]=[];const facade={
 async connect(){const client=await real.connect();const record={pid:backendPid(client),commands:[] as string[],releases:[] as boolean[]};records.push(record);return {
 query(text:string,values?:unknown[]){record.commands.push(text);const run=()=>client.query(text,values);return hook?hook(client,text,values,run):run();},
 release(error?:Error){record.releases.push(Boolean(error));client.release(error);},
 on(name:string,fn:any){client.on(name as 'error'|'end',fn);return this;},removeListener(name:string,fn:any){client.removeListener(name,fn);return this;}
 };},end:()=>real.end(),on(name:string,fn:any){real.on(name as 'error',fn);return this;},removeListener(name:string,fn:any){real.removeListener(name,fn);return this;}};
 return {repository:create(facade),records,real};}
function receipt(out:any){assert.equal(out.kind,'committed');assert.equal(out.delivery,'receipt');assert.equal(out.receipt.confirmed,false);return out.receipt;}
function failed(out:any,code?:string):asserts out is {kind:'failed';code:string;transaction:string;backendMayStillRun:boolean}{assert.equal(out.kind,'failed');if(code)assert.equal(out.code,code);assert.equal('receipt' in out,false);}
async function phase(ready:Promise<void>,outcome:Promise<unknown>,label:string){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([ready,outcome.then(value=>{throw Error(label+' returned before fixture phase: '+JSON.stringify(value));}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' fixture phase timeout')),4000);})]);}finally{if(timer)clearTimeout(timer);}}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
const isCommit=(text:string)=>text.trim().toUpperCase()==='COMMIT';
const c=await observer();const resources:Array<()=>Promise<unknown>>=[];const errors:unknown[]=[];
const unhandled=(error:unknown)=>errors.push(error);process.on('unhandledRejection',unhandled);
function make(hook?:Hook,real=pool()){const result=tracked(real,hook);resources.push(()=>result.repository.close());return result;}
async function hasNoState(f:Fixture){const s=await state(c,f);for(const key of ['heads','groups','capacity','resources','workers','workerManifest','resourceManifest'])assert.deepEqual(s[key],[],key);assert.equal(s.booking.state,'draft');assert.equal(s.booking.payment_id,null);}
async function waitPid(t:ReturnType<typeof make>){await observe(async()=>t.records.length>0,'adapter acquired PID');return t.records.at(-1)!.pid;}
/** Parse actual server protocol frames. Drop COMMIT completion and ensuing ReadyForQuery;
 * no driver result is fabricated. Closing is bounded and all sockets remain owned. */
async function lossProxy(){const sockets=new Set<net.Socket>();let sawCommit=false,sawReady=false;
 const server=net.createServer(front=>{const back=net.connect({host:config().host,port:config().port!});sockets.add(front);sockets.add(back);let pending=Buffer.alloc(0),dropping=false;
 const close=()=>{front.destroy();back.destroy();};front.on('error',close);back.on('error',close);front.on('close',()=>{sockets.delete(front);back.destroy();});back.on('close',()=>{sockets.delete(back);front.destroy();});front.on('data',b=>back.write(b));
 back.on('data',b=>{pending=Buffer.concat([pending,b]);while(pending.length>=5){const len=pending.readInt32BE(1);assert.ok(len>=4&&len<=1_048_576);if(pending.length<len+1)return;const frame=pending.subarray(0,len+1);pending=pending.subarray(len+1);
 if(frame[0]===67&&frame.subarray(5).toString('utf8')==='COMMIT\0'){sawCommit=true;dropping=true;}
 if(dropping){if(frame[0]===90){sawReady=true;close();}continue;}front.write(frame);
 }});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;
 return {port,get sawCommit(){return sawCommit;},get sawReady(){return sawReady;},async close(){for(const s of sockets)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}};}
try{
 // Exercise exported guarded factory itself; fault seams cannot replace wiring evidence.
 const factoryFixture=await seed(c);const publicA=createLocalPlanningAllocationRepository();resources.push(()=>publicA.close());const publicReceipt=receipt(await publicA.allocate(actor(factoryFixture),request(factoryFixture)));assert.equal(publicReceipt.usable,true);const factoryState=await state(c,factoryFixture);await publicA.close();const publicB=createLocalPlanningAllocationRepository();resources.push(()=>publicB.close());assert.deepEqual(receipt(await publicB.allocate(actor(factoryFixture),request(factoryFixture))),publicReceipt);assert.deepEqual(await state(c,factoryFixture),factoryState);
 console.log('PASS guarded public factory commits, restarts and reconciles exact target without renewal');
 // Stable receipt and source of truth survive closing the entire adapter pool.
 const f=await seed(c);let t=make();const first=receipt(await t.repository.allocate(actor(f),request(f)));assert.equal(first.usable,true);const original=await state(c,f);await t.repository.close();
 t=make();assert.deepEqual(receipt(await t.repository.allocate(actor(f),request(f))),first);assert.deepEqual(await state(c,f),original);
 const next=await seed(c);receipt(await t.repository.allocate(actor(next),request(next)));assert.equal(t.records[0]!.pid,t.records[1]!.pid,'successful clean client not reused in sequential control');
 const checkout=await t.real.connect();try{const reset=(await checkout.query("select current_user, current_setting('role') role,current_setting('transaction_isolation') isolation")).rows[0];assert.equal(reset.current_user,process.env.PGUSER??'postgres');assert.equal(reset.role,'none');assert.equal(reset.isolation,'read committed');}finally{checkout.release();}
 console.log('PASS committed state/pool restart/exact retry and clean role reuse');

 // Actual tenant/member authority, not mock result assertions.
 for(const kind of ['foreign','staff','platform'] as const){const target=await seed(c);const other=await seed(c);if(kind==='staff')await c.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')",[target.tenant,other.actor]);if(kind==='platform')await c.query('insert into public.platform_admins(user_id) values($1)',[other.actor]);const r=make();failed(await r.repository.allocate(actor(other),request(target)),'FORBIDDEN');await hasNoState(target);}
 console.log('PASS foreign owner, staff and platform cannot allocate another tenant');

 const revoke=await seed(c);const revoker=await blocker();try{await revoker.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[revoke.tenant,revoke.actor]);const r=make();const outcome=r.repository.allocate(actor(revoke),request(revoke));const pid=await waitPid(r);await blocked(c,pid,backendPid(revoker));await revoker.query('commit');failed(await outcome,'FORBIDDEN');await gone(c,pid);await hasNoState(revoke);}finally{await revoker.end();}
 console.log('PASS owner revocation first is rechecked after observed row wait');

 // Active driver timeout, local disposal, then separately observed eventual rollback.
 const timeout=await seed(c);const holder=await blocker();try{await holder.query('lock table public.resources in access exclusive mode');const r=make();const started=performance.now();const outcome=r.repository.allocate(actor(timeout),request(timeout));const pid=await waitPid(r);await blocked(c,pid,backendPid(holder));const out=await outcome;failed(out);assert.ok(['SERVER_TIMEOUT','LOCK_TIMEOUT'].includes(out.code));assert.ok(performance.now()-started<7500);assert.deepEqual(r.records[0]!.releases,[true]);await holder.query('rollback');await gone(c,pid);await hasNoState(timeout);receipt(await r.repository.allocate(actor(timeout),request(timeout)));assert.notEqual(r.records.at(-1)!.pid,pid);}finally{await holder.end();}
 console.log('PASS observed SQL lock timeout, poisoned-client nonreuse and eventual rollback');

 // Actual acquisition subdeadline while both fixed pool slots are occupied.
 const saturated=await seed(c);const saturatedRepo=make();const reserved=[await saturatedRepo.real.connect(),await saturatedRepo.real.connect()];try{const started=performance.now();const out=await saturatedRepo.repository.allocate(actor(saturated),request(saturated));failed(out,'ACQUISITION_TIMEOUT');assert.equal(out.transaction,'not_started');assert.ok(performance.now()-started>=2800&&performance.now()-started<4500);assert.equal(saturatedRepo.records.length,0);await hasNoState(saturated);}finally{for(const held of reserved)held.release();}await observe(async()=>saturatedRepo.real.waitingCount===0,'expired acquisition queue drained');if(saturatedRepo.records.length){assert.deepEqual(saturatedRepo.records[0]!.commands,[]);assert.deepEqual(saturatedRepo.records[0]!.releases,[true]);}
 console.log('PASS real saturated pool respects original3s acquisition subdeadline without transaction');
 // Saturate the real pool; external abort does not remove driver's pending checkout.
 const late=await seed(c);const rlate=make();const held=[await rlate.real.connect(),await rlate.real.connect()];const controller=new AbortController();const pending=rlate.repository.allocate(actor(late),request(late),{signal:controller.signal});await observe(async()=>rlate.real.waitingCount===1,'pending checkout');controller.abort();failed(await pending,'ABORTED');held[0]!.release();await observe(async()=>rlate.records.length===1&&rlate.records[0]!.releases.length===1,'late acquired client discarded');assert.deepEqual(rlate.records[0]!.commands,[]);assert.deepEqual(rlate.records[0]!.releases,[true]);held[1]!.release();await hasNoState(late);
 console.log('PASS real queued late acquisition is consumed without BEGIN and discarded');

 // Reverse source ordering: pause only at test boundary before COMMIT (< idle1s).
 const source=await seed(c);await c.query('update public.service_resources set quantity_required=2 where service_id=$1',[source.service]);const ready=deferred(),resume=deferred();const rs=make(async(_client,text,_v,run)=>{if(isCommit(text)){ready.resolve();await resume.promise;}return run();});const sourceOut=rs.repository.allocate(actor(source),request(source));await phase(ready.promise,sourceOut,'source');const writer=await blocker();try{const writing=writer.query('update public.resources set capacity=0+1 where id=$1',[source.resource]);await blocked(c,backendPid(writer),rs.records[0]!.pid);resume.resolve();receipt(await sourceOut);await writing;await writer.query('commit');const saved=await state(c,source);
 failed(await rs.repository.allocate(actor(source),request(source)),'UNAVAILABLE');assert.deepEqual(await state(c,source),saved);
 }finally{resume.resolve();await writer.end();}
 console.log('PASS allocation-first source writer waits; changed source rejects retry without renewal');

 // Real aborted transaction yields command ROLLBACK from actual COMMIT.
 const aborted=await seed(c);let rollbackTag='';const ra=make(async(client,text,_v,run)=>{if(isCommit(text)){await client.query('select 1/0').catch(()=>{});const result=await run();rollbackTag=result.command;return result;}return run();});const abortOut=await ra.repository.allocate(actor(aborted),request(aborted));assert.equal(rollbackTag,'ROLLBACK');failed(abortOut);assert.equal(abortOut.transaction,'rolled_back');await hasNoState(aborted);
 console.log('PASS actual failed transaction COMMIT acknowledges ROLLBACK, never success');

 // Real deferred FK failure at COMMIT, via test-only session-local fixture.
 const invalid=await seed(c);const fk=await commitFixture(c);resources.push(fk.cleanup);let actualCommit=false,commitCode='';const rf=make(async(client,text,_v,run)=>{if(isCommit(text)){await client.query('set local role none');await client.query(fk.defer);await client.query(fk.insert,[randomUUID()]);actualCommit=true;try{return await run();}catch(error){commitCode=(error as {code:string}).code;throw error;}}return run();});const fkOut=await rf.repository.allocate(actor(invalid),request(invalid));assert.equal(actualCommit,true);assert.equal(commitCode,'23503');assert.equal(fkOut.kind,'unknown_commit');assert.equal(fkOut.receipt,null);await gone(c,rf.records[0]!.pid);await hasNoState(invalid); console.log('PASS real deferred COMMIT rejection is conservatively uncertain, eventual rollback observed');

 // Actual wire loss after PostgreSQL committed, before driver sees COMMIT completion.
 const lost=await seed(c);const proxy=await lossProxy();try{const rl=make(undefined,new Pool({...config(),port:proxy.port,ssl:false}));const out=await rl.repository.allocate(actor(lost),request(lost));assert.equal(out.kind,'unknown_commit');assert.equal(out.receipt,null);assert.equal(proxy.sawCommit,true);assert.equal(proxy.sawReady,true);await gone(c,rl.records[0]!.pid);const committed=await state(c,lost);assert.equal(committed.groups.length,1);const direct=make();const reconciled=receipt(await direct.repository.allocate(actor(lost),request(lost)));assert.equal(reconciled.groupId,committed.groups[0].id);assert.deepEqual(await state(c,lost),committed);}finally{await proxy.close();}
 console.log('PASS actual committed-response wire loss yields unknown; authorized same-target retry preserves state');

 // Real COMMIT waits on a deferred FK. Test-only commands create the pending FK.
 const commitWait=await seed(c);const fkWait=await commitFixture(c);resources.push(fkWait.cleanup);const waitReady=deferred(),waitResume=deferred();let fixtureError:unknown,commitWasSent=false;const rc=make(async(client,text,_v,run)=>{if(isCommit(text)){try{await client.query('set local role none');await client.query(fkWait.defer);await client.query(fkWait.insert,[fkWait.parent]);waitReady.resolve();await waitResume.promise;}catch(error){fixtureError=error;throw error;}commitWasSent=true;}return run();});const stop=new AbortController();const waiting=rc.repository.allocate(actor(commitWait),request(commitWait),{signal:stop.signal});try{await phase(waitReady.promise,waiting,'COMMIT wait');}catch(error){if(fixtureError)throw fixtureError;throw error;}const lock=await blocker();try{await lock.query(fkWait.lock,[fkWait.parent]);waitResume.resolve();await blocked(c,rc.records[0]!.pid,backendPid(lock));assert.equal(commitWasSent,true);assert.equal((await c.query('select query from pg_stat_activity where pid=$1',[rc.records[0]!.pid])).rows[0].query.toUpperCase(),'COMMIT');stop.abort();const out=await waiting;assert.equal(out.kind,'unknown_commit');assert.equal(out.receipt,null);await lock.query('rollback');await gone(c,rc.records[0]!.pid);const settled=await state(c,commitWait);assert.ok(settled.groups.length===0||settled.groups.length===1,'unknown outcome must be resolved from actual DB');const after=make();receipt(await after.repository.allocate(actor(commitWait),request(commitWait)));if(settled.groups.length)assert.deepEqual(await state(c,commitWait),settled);}finally{waitResume.resolve();await lock.end();} console.log('PASS observed blocked COMMIT interruption remains unknown; eventual outcome reconciles same target');

 // Explicit synthetic active server delays test cumulative caller budget, not SQL workload performance.
 const total=await seed(c);let sleeps=0,commitSent=false;const rt=make(async(client,text,_v,run)=>{if(text.includes('SET LOCAL ROLE')||text.includes('allocate_planning_group')||text.includes('SET CONSTRAINTS')){sleeps++;await client.query('select pg_sleep(3.6)');}if(isCommit(text))commitSent=true;return run();});const start=performance.now();const totalOut=await rt.repository.allocate(actor(total),request(total));failed(totalOut,'DEADLINE');assert.equal(sleeps,3);assert.equal(commitSent,false);assert.ok(performance.now()-start>=9500&&performance.now()-start<12500);await gone(c,rt.records[0]!.pid);await hasNoState(total);
 console.log('PASS three actual sub5s synthetic stages exhaust original10s caller budget without COMMIT');

 await pause(30);assert.deepEqual(errors,[],'unhandled asynchronous rejection');console.log('PASS real allocator transport integration: local synthetic Auth only; no hosted or immediate backend cessation claim');
}finally{for(const close of resources.reverse())await close();await c.end();process.removeListener('unhandledRejection',unhandled);}
