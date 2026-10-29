import {afterEach,describe,expect,it,vi} from 'vitest';
import {createFlowHttpServer,tokenHash} from './http';
import type {Server} from 'node:http';
const origin='https://checkout.example.test',token='a'.repeat(43);
describe('customer hold transport',()=>{
 let server:Server;
 afterEach(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));});
 async function fixture(){
  const hold=vi.fn(async()=>({bookingId:'34000000-0000-4000-8000-000000000002',holdId:'34000000-0000-4000-8000-000000000003',status:'active' as const,expiresAt:'2030-01-01T00:00:00.000Z'}));
  const owner=vi.fn(async()=>null);
  server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[],customerOrigins:[origin],authenticateOwner:owner,customerHold:hold});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  return {hold,owner,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flow-sessions/hold`};
 }
 it('hashes bearer, accepts only empty object and avoids owner authentication',async()=>{
  const f=await fixture();const response=await fetch(f.url,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});
  expect(response.status).toBe(200);expect(f.hold).toHaveBeenCalledWith(tokenHash(token),origin);expect(f.owner).not.toHaveBeenCalled();
 });
 it.each(['{"bookingId":"34000000-0000-4000-8000-000000000002"}','{"tenantId":"x"}','{"serviceId":"x"}','{"actor":"x"}','null','[]',''])('rejects caller authority/body %s',async body=>{
  const f=await fixture();expect((await fetch(f.url,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body})).status).toBe(400);expect(f.hold).not.toHaveBeenCalled();
 });
 it('rejects query scope, missing bearer and foreign origin',async()=>{
  const f=await fixture();const headers={origin,authorization:`Bearer ${token}`,'content-type':'application/json'};
  expect((await fetch(f.url+'?bookingId=x',{method:'POST',headers,body:'{}'})).status).toBe(400);
  expect((await fetch(f.url,{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status).toBe(401);
  expect((await fetch(f.url,{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status).toBe(403);expect(f.hold).not.toHaveBeenCalled();
 });
});
