import {afterEach,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from '../server/http';
import {createFlowRepository,type FlowRepository} from '../server/repository';
import {RpcResults} from '../server/contracts';
import {LOCAL_FIXTURE as F,localIdentity} from '../server/fixtures';
const catalog={id:F.serviceA,name:'Request',durationMinutes:30,questions:[{id:'mode',prompt:'Mode',kind:'single_choice',required:true,choices:[{id:'basic',label:'Basic'},{id:'extra',label:'Extra'}]},{id:'quantity',prompt:'Count',kind:'quantity',required:false,choices:[],minQty:0,maxQty:10}]};
const authoring={authoringVersion:2,config:{key:'request',steps:[{key:'mode',questionKey:'mode',kind:'question',required:true},{key:'quantity',questionKey:'quantity',kind:'question',required:true,visibleWhen:{field:'mode',op:'eq',value:'extra'}}]},questionOverrides:{}};
const servers:Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0))await new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());});});
async function start(call:FlowRepository["call"]){const s=createFlowHttpServer({repository:{call},authenticateOwner:localIdentity,ownerOrigins:[F.ownerOrigin],customerOrigins:[F.customerOrigin]});servers.push(s);await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const a=s.address() as {port:number};return `http://127.0.0.1:${a.port}`;}
const headers={Origin:F.ownerOrigin,Authorization:`Bearer ${F.ownerToken}`,'Content-Type':'application/json'};
const payload=()=>({serviceId:F.serviceA,name:'Configurable',expectedRevision:0,authoring:structuredClone(authoring)});
it('dispatches normalized V2 draft through verified actor and fixed RPC; does not touch V1',async()=>{
 const call=vi.fn(async(name:string)=>name==='flow_owner_services'?{services:[catalog]}:{flowId:F.serviceB,revision:1,authoringVersion:2});const base=await start(call);
 const r=await fetch(`${base}/api/configurable-flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(payload())});expect(r.status).toBe(200);expect(call).toHaveBeenLastCalledWith('save_configurable_flow_draft',[F.ownerA,F.tenantA,F.serviceB,F.serviceA,0,'Configurable',authoring]);
 const forged={...payload(),actorId:F.ownerB};expect((await fetch(`${base}/api/configurable-flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(forged)})).status).toBe(400);
 expect((await fetch(`${base}/api/flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(payload())})).status).toBe(400);
});
it.each(['\u0000','\ud800','\udc00'])('rejects PG-unrepresentable V2 strings before any RPC',async(value)=>{
 const call=vi.fn();const base=await start(call);const p=payload();p.name=value;
 const r=await fetch(`${base}/api/configurable-flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(p)});expect(r.status).toBe(400);expect(await r.json()).toEqual({ok:false,code:'INVALID_REQUEST'});expect(call).not.toHaveBeenCalled();
});
it('allows real non-BMP text and rejects weakening of required floor before write',async()=>{
 const call=vi.fn(async(name:string)=>name==='flow_owner_services'?{services:[catalog]}:{flowId:F.serviceB,revision:1,authoringVersion:2});const base=await start(call);const p=payload();p.name='😀';
 expect((await fetch(`${base}/api/configurable-flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(p)})).status).toBe(200);
 p.authoring.config.steps[0]!.required=false;call.mockClear();expect((await fetch(`${base}/api/configurable-flows/${F.serviceB}/draft?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify(p)})).status).toBe(422);expect(call).toHaveBeenCalledTimes(1);
});
it('requires explicit V2 render marker and rejects unknown/payment authority',()=>{
 const render={versionId:F.serviceA,renderSchemaVersion:2,config:authoring.config,service:catalog,submissionMode:'unconfirmed_request'};const session={expiresAt:'2030-01-01T00:00:00Z',render};expect(RpcResults.issue_flow_session.safeParse(session).success).toBe(true);
 for(const changed of [{...render,renderSchemaVersion:3},{...render,submissionMode:'confirmed'},{...render,paid:true},{...render,renderSchemaVersion:undefined}])expect(RpcResults.issue_flow_session.safeParse({...session,render:changed}).success).toBe(false);
});
it('rolls back malformed V2 result before commit',async()=>{
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('select')?[{result:{flowId:F.serviceA,revision:1,authoringVersion:2,secret:'must not pass'}}]:[]}));const release=vi.fn();const repo=createFlowRepository({connect:async()=>({query,release})} as never);
 await expect(repo.call('save_configurable_flow_draft',[F.ownerA,F.tenantA,F.serviceB,F.serviceA,0,'name',authoring])).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(query).toHaveBeenCalledWith('rollback');expect(query).not.toHaveBeenCalledWith('commit');expect(release).toHaveBeenCalled();
});
it('separates configurable list and binds generated publish path to returned installation',async()=>{
 const call=vi.fn(async(name:string)=>name==='flow_owner_configurable_list'?{flows:[]}:{versionId:F.serviceA,installationId:F.serviceB,renderSchemaVersion:2});const base=await start(call);
 expect((await fetch(`${base}/api/configurable-flows?tenantId=${F.tenantA}`,{headers})).status).toBe(200);expect(call).toHaveBeenLastCalledWith('flow_owner_configurable_list',[F.ownerA,F.tenantA]);
 const r=await fetch(`${base}/api/configurable-flows/${F.serviceB}/publish?tenantId=${F.tenantA}`,{method:'POST',headers,body:JSON.stringify({expectedRevision:1,allowedOrigins:[F.customerOrigin]})});expect(r.status).toBe(200);expect((await r.json() as {data:{hostedPath:string}}).data.hostedPath).toBe(`/checkout/flow/${F.serviceB}`);
});

it.each(['\u0000','\ud800','\udc00'])('rejects unrepresentable customer strings without needing a client version marker',async(value)=>{
 const call=vi.fn();const base=await start(call);
 const r=await fetch(`${base}/api/flow-sessions/request`,{method:'POST',headers:{...headers,Origin:F.customerOrigin,Authorization:`Bearer ${'a'.repeat(43)}`},body:JSON.stringify({idempotencyKey:'request-valid-key',answers:{},customer:{name:value,email:'test@example.test'},requestedStart:'2030-01-01T00:00:00Z'})});expect(r.status).toBe(400);expect(call).not.toHaveBeenCalled();
});
it.each(['unknown','mismatch'])('rolls back invalid draft override projection %s',async(kind)=>{
 const a=structuredClone(authoring) as typeof authoring & {questionOverrides:Record<string,unknown>};a.questionOverrides=kind==='unknown'?{unknown:{prompt:'Invalid'}}:{mode:{prompt:'Different'}};
 const result={flowId:F.serviceA,name:'Draft',revision:1,serviceId:F.serviceA,authoring:a,effectiveService:catalog};
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('select')?[{result}]:[]}));const repo=createFlowRepository({connect:async()=>({query,release:vi.fn()})} as never);
 await expect(repo.call('get_configurable_flow_draft',[F.ownerA,F.tenantA,F.serviceA])).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(query).toHaveBeenCalledWith('rollback');expect(query).not.toHaveBeenCalledWith('commit');
});
it('rejects a pinned V2 response carrying unused catalog palette data',()=>{
 const render={versionId:F.serviceA,renderSchemaVersion:2,config:{key:'request',steps:[authoring.config.steps[0]]},service:catalog,submissionMode:'unconfirmed_request'};
 expect(RpcResults.issue_flow_session.safeParse({expiresAt:'2030-01-01T00:00:00Z',render}).success).toBe(false);
});
