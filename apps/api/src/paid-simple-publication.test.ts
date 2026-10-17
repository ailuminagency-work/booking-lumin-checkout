import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {PaidSimpleRender,isPaidSimpleRender} from '@lumin/workflow';
const actor='37000000-0000-4000-8000-000000000001',tenant='37000000-0000-4000-8000-000000000002',service='37000000-0000-4000-8000-000000000003',flow='37000000-0000-4000-8000-000000000004',origin='https://portal.example.test',customerOrigin='https://checkout.example.test';
let server:Server;afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(enabled=true){const call=vi.fn(async(_name:string,p:readonly unknown[])=>({versionId:p[5],installationId:p[6],renderSchemaVersion:3}));server=createFlowHttpServer({repository:{call},ownerOrigins:[origin],customerOrigins:[customerOrigin],authenticateOwner:async token=>token==='owner-token-123456'?actor:null,paidSimplePublication:enabled});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return{call,post:(body:unknown,token='owner-token-123456')=>fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/paid-simple-flows/${flow}/publish?tenantId=${tenant}`,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})};}
const body={serviceId:service,name:'Housekeeping',allowedOrigins:[customerOrigin]};
describe('paid V3 publication transport',()=>{
 it('passes verified owner with only service binding/name/origins and server identifiers',async()=>{const f=await fixture();const r=await f.post(body);expect(r.status).toBe(200);const data=(await r.json()).data;expect(data).toMatchObject({renderSchemaVersion:3,hostedPath:`/checkout/flow/${data.installationId}`});expect(f.call).toHaveBeenCalledWith('publish_paid_simple_flow',[actor,tenant,flow,service,'Housekeeping',data.versionId,data.installationId,[customerOrigin]]);});
 it.each([{amount:1},{currency:'USD'},{tenantId:tenant},{provider:'stripe'},{state:'confirmed'},{versionId:flow},{questions:[]}])('rejects caller authority %j',async extra=>{const f=await fixture();expect((await f.post({...body,...extra})).status).toBe(400);expect(f.call).not.toHaveBeenCalled();});
 it('requires staging publication gate and owner authentication',async()=>{const f=await fixture(false);expect((await f.post(body)).status).toBe(422);expect((await f.post(body,'invalid-owner-123456')).status).toBe(401);expect(f.call).not.toHaveBeenCalled();});
 it('rejects origins outside configured customer allowlist',async()=>{const f=await fixture();expect((await f.post({...body,allowedOrigins:['https://foreign.example.test']})).status).toBe(403);expect(f.call).not.toHaveBeenCalled();});
});
const render={versionId:flow,renderSchemaVersion:3,submissionMode:'paid_service_request',paymentMode:'staging_mock',simulated:true,service:{id:service,name:'Housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}}};
describe('explicit paid render',()=>{
 it('accepts a positive pinned minor-unit price in simulated V3 only',()=>{expect(PaidSimpleRender.parse(render)).toEqual(render);expect(isPaidSimpleRender(render)).toBe(true);});
 it.each([{...render,renderSchemaVersion:1},{...render,paymentMode:'stripe'},{...render,simulated:false},{...render,service:{...render.service,price:{amount:0,currency:'USD'}}},{...render,config:{steps:[]}}])('rejects ambiguous or widened render %j',value=>expect(isPaidSimpleRender(value)).toBe(false));
});
