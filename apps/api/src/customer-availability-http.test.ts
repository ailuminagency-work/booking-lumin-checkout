import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {createFlowHttpServer,tokenHash} from './http';
import {FlowError} from './repository';
const origin='https://checkout.staging.example.test',token='a'.repeat(43);
describe('customer session availability transport',()=>{
 let server:Server;
 afterEach(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));});
 async function fixture(deny=false){
  const read=vi.fn(async()=>{if(deny)throw new FlowError('FORBIDDEN');return {serviceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',durationMinutes:60,slots:[]};});
  const owner=vi.fn(async()=>null);
  const http=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[],customerOrigins:[origin],authenticateOwner:owner,customerAvailability:read});
  server=createServer((req,res)=>http.emit('request',req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  return {read,owner,url:`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flow-sessions/availability`,query:'?from=2030-01-01T00:00:00Z&to=2030-01-02T00:00:00Z'};
 }
 it('hashes customer bearer and never invokes owner authentication',async()=>{
  const f=await fixture();const r=await fetch(f.url+f.query,{headers:{origin,authorization:`Bearer ${token}`}});
  expect(r.status).toBe(200);expect(f.read).toHaveBeenCalledWith(tokenHash(token),origin,'2030-01-01T00:00:00.000Z','2030-01-02T00:00:00.000Z');expect(f.owner).not.toHaveBeenCalled();
 });
 it.each(['&tenantId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','&serviceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','&from=2030-01-01T00:00:00Z','&other=x'])('rejects customer supplied scope/query %s',async extra=>{
  const f=await fixture();const r=await fetch(f.url+f.query+extra,{headers:{origin,authorization:`Bearer ${token}`}});expect(r.status).toBe(400);expect(f.read).not.toHaveBeenCalled();
 });
 it.each(['?from=2030-01-01T00:00:00Z&to=2030-01-09T00:00:00Z','?from=2030-01-02T00:00:00Z&to=2030-01-01T00:00:00Z'])('bounds scheduling window',async query=>{
  const f=await fixture();const r=await fetch(f.url+query,{headers:{origin,authorization:`Bearer ${token}`}});expect(r.status).toBe(400);expect(f.read).not.toHaveBeenCalled();
 });
 it('rejects missing bearer, foreign origin and revoked scope',async()=>{
  const f=await fixture(true);
  expect((await fetch(f.url+f.query,{headers:{origin}})).status).toBe(401);
  expect((await fetch(f.url+f.query,{headers:{origin:'https://evil.example',authorization:`Bearer ${token}`}})).status).toBe(403);
  expect(f.read).not.toHaveBeenCalled();
  expect((await fetch(f.url+f.query,{headers:{origin,authorization:`Bearer ${token}`}})).status).toBe(403);
 });
});
