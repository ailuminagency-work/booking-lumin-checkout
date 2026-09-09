import {afterEach,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from '../server/http';
import {createFlowRepository,type FlowRepository} from '../server/repository';
import {LOCAL_FIXTURE as F,localIdentity} from '../server/fixtures';
const servers:Server[]=[];afterEach(async()=>{for(const s of servers.splice(0))await new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());});});
async function start(call:FlowRepository['call']){const s=createFlowHttpServer({repository:{call},authenticateOwner:localIdentity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(s.address() as {port:number}).port}`;}
const headers={Origin:F.ownerOrigin,Authorization:`Bearer ${F.ownerToken}`,'Content-Type':'application/json'};
it('GET never provisions; rejects actor/query/body tricks and worker access routes',async()=>{
 const call=vi.fn(async()=>({rosterVersion:1,workers:[],crews:[],eligibility:[],shifts:[],services:[]}));const base=await start(call);
 expect((await fetch(`${base}/api/roster?tenantId=${F.tenantA}`,{headers})).status).toBe(200);expect(call).toHaveBeenCalledExactlyOnceWith('owner_roster_snapshot',[F.ownerA,F.tenantA]);
 expect((await fetch(`${base}/api/roster?tenantId=${F.tenantA}&actorId=${F.ownerB}`,{headers})).status).toBe(400);
 expect((await fetch(`${base}/api/roster/access?tenantId=${F.tenantA}`,{method:'POST',headers,body:'{}'})).status).toBe(404);
});
it('server mints identity, binds update path and preserves Unicode; denies unknown/null fields',async()=>{
 const call=vi.fn(async()=>2);const base=await start(call);const body={expectedRosterVersion:1,displayName:'😀'.repeat(160),active:true};
 const created=await fetch(`${base}/api/roster/workers?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(body)});expect(created.status).toBe(200);const {data}=await created.json() as {data:{entityId:string}};
 expect(call).toHaveBeenLastCalledWith('roster_worker_put',[F.ownerA,F.tenantA,1,data.entityId,body.displayName,true,true]);
 expect((await fetch(`${base}/api/roster/workers/${data.entityId}?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(body)})).status).toBe(200);expect(call).toHaveBeenLastCalledWith('roster_worker_put',[F.ownerA,F.tenantA,1,data.entityId,body.displayName,true,false]);
 for(const invalid of [{...body,id:F.ownerB},{...body,displayName:null},{...body,displayName:'\ud800'},{...body,active:'true'}])expect((await fetch(`${base}/api/roster/workers?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(invalid)})).status).toBe(400);
});
it('passes microsecond interval unchanged and rejects calendar normalization',async()=>{
 const call=vi.fn(async()=>2);const base=await start(call);const body={expectedRosterVersion:1,workerId:F.ownerA,kind:'available',startsAt:'2030-01-01T00:00:00.000001Z',endsAt:'2030-01-01T00:00:00.000002Z',sourceTimeZone:'UTC',active:true};
 expect((await fetch(`${base}/api/roster/shifts?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(body)})).status).toBe(200);expect(call).toHaveBeenCalledWith('roster_shift_put',expect.arrayContaining([body.startsAt,body.endsAt]));
 expect((await fetch(`${base}/api/roster/shifts?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify({...body,startsAt:'2030-02-30T00:00:00Z'})})).status).toBe(400);
});
it.each([1,3,Number.MAX_SAFE_INTEGER+1])('rolls back mismatched/unsafe roster receipt %s before commit',async(result)=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('select')?[{result}]:[]}));const repo=createFlowRepository({connect:async()=>({query,release:vi.fn()})} as never);
 await expect(repo.call('roster_worker_put',[F.ownerA,F.tenantA,1,F.ownerB,'Name',true,true])).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(query).toHaveBeenCalledWith('rollback');expect(query).not.toHaveBeenCalledWith('commit');
});
it.each([['P0002','ROSTER_NOT_INITIALIZED'],['54000','ROSTER_TOO_LARGE'],['22008','ROSTER_UNSUPPORTED_TIME'],['22023','INTERNAL_ERROR']])('maps snapshot error %s without reflecting SQL text',async(code,expected)=>{
 const query=vi.fn(async(sql:string)=>{if(sql.startsWith('select'))throw Object.assign(Error('secret'),{code});return {rows:[]};});const repo=createFlowRepository({connect:async()=>({query,release:vi.fn()})} as never);
 await expect(repo.call('owner_roster_snapshot',[F.ownerA,F.tenantA])).rejects.toMatchObject({code:expected,message:expected});
});
it('rejects oversized/private snapshot output before commit',async()=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('select')?[{result:{rosterVersion:1,workers:[],crews:[],eligibility:[],shifts:[],services:[],worker_access:['secret']}}]:[]}));const repo=createFlowRepository({connect:async()=>({query,release:vi.fn()})} as never);
 await expect(repo.call('owner_roster_snapshot',[F.ownerA,F.tenantA])).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(query).not.toHaveBeenCalledWith('commit');
});
