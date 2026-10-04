import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import type {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository,FlowError} from './repository';
const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),tenant=id(2),flow=id(4),origin='https://portal.example.test',customerOrigin='https://checkout.example.test';
const body={expectedDraftRevision:2,allowedOrigins:[customerOrigin]},old={versionId:id(5),installationId:id(6)};
let server:Server;afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(enabled=true,result?:unknown){let existing:unknown;const call=vi.fn(async(_name:string,p:readonly unknown[])=>{if(result instanceof Error)throw result;if(result)return result;if(existing)return{...existing as object,replayed:true};return existing={flowId:p[2],draftRevision:p[3],versionId:p[4],installationId:p[5],renderSchemaVersion:5,replayed:false};});server=createFlowHttpServer({repository:{call},paidSimplePublication:enabled,ownerOrigins:[origin],customerOrigins:[customerOrigin],authenticateOwner:async token=>token==='owner-token-123456'?actor:null});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return{call,post:(value:unknown=body,token='owner-token-123456',o=origin,query=`tenantId=${tenant}`)=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/paid-customer-field-flows/${flow}/publish-draft?${query}`,{method:'POST',headers:{authorization:`Bearer ${token}`,origin:o,'content-type':'application/json'},body:JSON.stringify(value)})};}
describe('explicit saved V2 informational field publication HTTP',()=>{
 it('binds only saved revision/origins to verified owner and returns identical receipt on replay',async()=>{const f=await fixture();const first=await f.post();expect(first.status).toBe(200);const value=await first.json();expect(value).toEqual({ok:true,data:{flowId:flow,draftRevision:2,publication:{versionId:value.data.publication.versionId,installationId:value.data.publication.installationId,renderSchemaVersion:5,hostedPath:`/checkout/flow/${value.data.publication.installationId}`}}});expect(f.call).toHaveBeenCalledWith('publish_paid_customer_field_draft',[actor,tenant,flow,2,value.data.publication.versionId,value.data.publication.installationId,[customerOrigin]]);expect(await (await f.post()).json()).toEqual(value);});
 it.each([{name:'Unsaved'},{serviceId:id(3)},{presentation:{accentColor:'#be123c',layout:'compact'}},{price:1},{tenantId:tenant},{provider:'stripe'},{role:'BUSINESS_OWNER'},{versionId:flow},{expectedRevision:2}])('rejects unsaved or caller authority %j',async extra=>{const f=await fixture();expect((await f.post({...body,...extra})).status).toBe(400);expect(f.call).not.toHaveBeenCalled();});
 it.each([0,-1,0.5,Number.MAX_SAFE_INTEGER+1])('rejects invalid saved revision %s',async expectedDraftRevision=>{const f=await fixture();expect((await f.post({...body,expectedDraftRevision})).status).toBe(400);expect(f.call).not.toHaveBeenCalled();});
 it('keeps staging/auth/origin and configured customer origins enforced',async()=>{const f=await fixture(false);expect((await f.post()).status).toBe(422);expect((await f.post(body,'invalid-token-123456')).status).toBe(401);expect((await f.post(body,undefined,customerOrigin)).status).toBe(403);expect(f.call).not.toHaveBeenCalled();});
 it('denies foreign publication origin and duplicate/extra query',async()=>{const f=await fixture();expect((await f.post({...body,allowedOrigins:['https://foreign.example.test']})).status).toBe(403);expect((await f.post(body,undefined,undefined,`tenantId=${tenant}&tenantId=${tenant}`)).status).toBe(400);expect((await f.post(body,undefined,undefined,`tenantId=${tenant}&retry=true`)).status).toBe(400);expect(f.call).not.toHaveBeenCalled();});
 it.each([{flowId:id(99),draftRevision:2,...old,renderSchemaVersion:5,replayed:true},{flowId:flow,draftRevision:1,...old,renderSchemaVersion:5,replayed:true}])('rejects foreign flow/revision evidence even from a transport seam %j',async result=>{const f=await fixture(true,result);expect((await f.post()).status).toBe(500);});
 it('returns conflict without altering the request or granting retry permission',async()=>{const f=await fixture(true,new FlowError('CONFLICT'));const r=await f.post();expect(r.status).toBe(409);expect(await r.json()).toEqual({ok:false,code:'CONFLICT'});});
});
describe('V5 publication repository receipt binding',()=>{
 it('accepts bound existing identifiers only for replay and rolls back fresh/mismatched receipts',async()=>{const params=[actor,tenant,flow,2,id(7),id(8),[customerOrigin]];for(const receipt of [{flowId:flow,draftRevision:2,...old,renderSchemaVersion:5,replayed:true},{flowId:flow,draftRevision:2,...old,renderSchemaVersion:5,replayed:false},{flowId:flow,draftRevision:1,...old,renderSchemaVersion:5,replayed:true}]){const query=vi.fn(async(sql:string)=>sql.startsWith('select')?{rows:[{result:receipt}]}:{rows:[]});const release=vi.fn();const repo=createFlowRepository({connect:async()=>({query,release})} as unknown as Pool);if(receipt.replayed&&receipt.draftRevision===2){expect(await repo.call('publish_paid_customer_field_draft',params)).toEqual(receipt);expect(query).toHaveBeenLastCalledWith('commit');}else{await expect(repo.call('publish_paid_customer_field_draft',params)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(query).toHaveBeenLastCalledWith('rollback');}expect(release).toHaveBeenCalledOnce();}});
});

describe('V5 informational request HTTP dispatch',()=>{
 async function requestFixture(){
  const call=vi.fn(async()=>({reference:'LMN-TEST',state:'draft',confirmed:false}));
  server=createFlowHttpServer({repository:{call},ownerOrigins:[origin],customerOrigins:[customerOrigin]});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const input={schemaVersion:2,idempotencyKey:'v5-request-key-123456',answers:{},customerAnswers:{custom_access:'Door 😀'},customer:{name:'Customer',email:'customer@example.test'},requestedStart:'2030-01-01T10:00:00Z'};
  return{call,input,post:(body:unknown)=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flow-sessions/request`,{method:'POST',headers:{origin:customerOrigin,authorization:`Bearer ${'a'.repeat(43)}`,'content-type':'application/json'},body:JSON.stringify(body)})};
 }
 it('passes informational values only to the fixed capability RPC and keeps the receipt unchanged',async()=>{
  const f=await requestFixture();const r=await f.post(f.input);expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,data:{reference:'LMN-TEST',state:'draft',confirmed:false}});
  expect(f.call).toHaveBeenCalledOnce();expect(f.call).toHaveBeenCalledWith('submit_customer_field_request',[expect.stringMatching(/^[a-f0-9]{64}$/),customerOrigin,f.input.idempotencyKey,f.input.customerAnswers,f.input.customer,'2030-01-01T10:00:00.000Z']);
 });
 it.each([{schemaVersion:4},{schemaVersion:1},{price:1},{tenantId:tenant},{customerAnswers:{custom_price:'1'}},{answers:{service:{quantity:1}}},{customerAnswers:{custom_access:'bad\ud800'}}])('rejects explicit malformed markers and caller authority without legacy fallback %j',async change=>{
  const f=await requestFixture();expect((await f.post({...f.input,...change})).status).toBe(400);expect(f.call).not.toHaveBeenCalled();
 });
 it('dispatches explicit schema3 only to the conditional RPC without V5 or legacy fallback',async()=>{
  const f=await requestFixture();expect((await f.post({...f.input,schemaVersion:3})).status).toBe(200);
  expect(f.call).toHaveBeenCalledOnce();expect(f.call).toHaveBeenCalledWith('submit_conditional_customer_field_request',[expect.stringMatching(/^[a-f0-9]{64}$/),customerOrigin,f.input.idempotencyKey,f.input.customerAnswers,f.input.customer,'2030-01-01T10:00:00.000Z']);
 });
 it('preserves the unchanged legacy RPC for an unversioned valid legacy request',async()=>{
  const f=await requestFixture();const {schemaVersion:_,customerAnswers:__,...legacy}=f.input;
  expect((await f.post(legacy)).status).toBe(200);expect(f.call).toHaveBeenCalledWith('submit_flow_request',[expect.any(String),customerOrigin,legacy.idempotencyKey,{},legacy.customer,'2030-01-01T10:00:00.000Z']);
 });
});
