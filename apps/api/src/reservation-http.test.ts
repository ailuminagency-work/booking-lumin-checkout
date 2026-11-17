import {afterEach,describe,it,expect,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {FlowError} from './repository';
const actor='a4100000-0000-4000-8000-000000000001',tenant='a4100000-0000-4000-8000-000000000002',booking='a4100000-0000-4000-8000-000000000003',foreign='b4100000-0000-4000-8000-000000000002';
const origin='https://portal.example.test';let server:Server;
afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function setup(){const reservation=vi.fn(async(a:string,t:string,b:string)=>{if(a!==actor||t!==tenant)throw new FlowError('FORBIDDEN');return{bookingId:b,holdId:'a4100000-0000-4000-8000-000000000004',status:'active' as const,expiresAt:'2030-01-01T00:05:00.000Z'};});server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async t=>t==='owner-token-123456'?actor:null,reservation});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;return{reservation,post:(body:unknown,t=tenant,token='owner-token-123456')=>fetch(`${base}/api/reservations/hold?tenantId=${t}`,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})};}
describe('authenticated reservation hold',()=>{
 it('passes verified actor and exact tenant/booking only',async()=>{const h=await setup();const r=await h.post({bookingId:booking});expect(r.status).toBe(200);expect(h.reservation).toHaveBeenCalledWith(actor,tenant,booking);expect(await r.json()).toMatchObject({ok:true,data:{schemaVersion:1,status:'active'}});});
 it('rejects unauthenticated requests before writer',async()=>{const h=await setup();expect((await h.post({bookingId:booking},tenant,'invalid-token-123456')).status).toBe(401);expect(h.reservation).not.toHaveBeenCalled();});
 it('rejects actor/tenant/capacity/TTL spoof fields before writer',async()=>{const h=await setup();for(const extra of [{actorId:foreign},{tenantId:foreign},{capacity:100},{ttl:99999},{serviceId:foreign}])expect((await h.post({bookingId:booking,...extra})).status).toBe(400);expect(h.reservation).not.toHaveBeenCalled();});
 it('does not return a receipt for an unauthorized tenant',async()=>{const h=await setup();const r=await h.post({bookingId:booking},foreign);expect(r.status).toBe(403);expect(await r.json()).toEqual({ok:false,code:'FORBIDDEN'});});
});
