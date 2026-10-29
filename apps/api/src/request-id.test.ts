import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServer,IncomingMessage,ServerResponse,type Server} from 'node:http';
import {connect,Socket} from 'node:net';
import {attachRequestId} from './request-id';
import {createFlowHttpServer} from './http';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const owner='https://portal.example.test';
describe('server-only request correlation',()=>{
 it.each(['forged-id','01234567-89ab-4cde-8fab-0123456789ab','\r\nX-Secret: private','\u0000',undefined])('ignores inbound header %j and never trusts response headers',value=>{
  const req=new IncomingMessage(new Socket());req.headers['x-request-id']=value;
  const res=new ServerResponse(req);res.setHeader('X-Request-Id','forged-response');
  const first=attachRequestId(req,res);expect(first).toMatch(uuid);expect(first).not.toBe(value);expect(first).not.toBe('forged-response');expect(res.getHeader('x-request-id')).toBe(first);
  req.headers['x-request-id']='changed';res.setHeader('X-Request-Id','changed');
  expect(attachRequestId(req,res)).toBe(first);expect(res.getHeader('x-request-id')).toBe(first);
 });
 it('assigns a new UUID to each request even with the same supplied UUID',()=>{
  const ids=new Set();for(let i=0;i<100;i++){const req=new IncomingMessage(new Socket());req.headers['x-request-id']='01234567-89ab-4cde-8fab-0123456789ab';ids.add(attachRequestId(req,new ServerResponse(req)));}expect(ids.size).toBe(100);
 });
});

describe('HTTP correlation boundaries',()=>{
 let server:Server|undefined;
 afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});
 async function start(delegated=false){
  const call=vi.fn(async()=>{throw new Error('unexpected database operation');});
  const customerHold=vi.fn(async()=>{throw new Error('unexpected writer');});
  const flow=createFlowHttpServer({repository:{call},ownerOrigins:[owner],customerOrigins:['https://checkout.example.test'],authenticateOwner:async()=>null,customerHold});
  const observed:string[]=[];
  server=delegated?createServer((req,res)=>{observed.push(attachRequestId(req,res));flow.emit('request',req,res);}):flow;
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  return {base:`http://127.0.0.1:${port}`,port,observed,call,customerHold};
 }
 it.each(['/health','/version','/api/profile?tenantId=a3100000-0000-4000-8000-000000000002','/missing'])('adds a fresh safe ID on %s without changing bodies or security headers',async path=>{
  const {base,call}=await start();const response=await fetch(base+path,{headers:{origin:owner,'x-request-id':'private-attacker-input'}});
  expect(response.headers.get('x-request-id')).toMatch(uuid);expect(response.headers.get('x-request-id')).not.toBe('private-attacker-input');
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const body=await response.json();if(path==='/health')expect(body).toEqual({ok:true,data:{mode:'LOCAL_HARNESS',providerConnections:false}});else if(path==='/version')expect(body).toEqual({schemaVersion:1,service:'booking-lumin-api',environment:'unknown',releaseSha:null});else expect(body).toEqual({ok:false,code:'UNAUTHENTICATED'});
  expect(JSON.stringify(body)).not.toContain('private-attacker-input');expect(call).not.toHaveBeenCalled();
 });
 it('keeps exactly one generated ID across main-style delegation and distinct IDs across keep-alive requests',async()=>{
  const {base,observed}=await start(true);const ids=[];for(let i=0;i<4;i++){const response=await fetch(base+'/version',{headers:{'x-request-id':'01234567-89ab-4cde-8fab-0123456789ab'}});await response.json();ids.push(response.headers.get('x-request-id'));}
  expect(ids).toEqual(observed);expect(new Set(ids).size).toBe(4);expect(ids.every(id=>uuid.test(id!))).toBe(true);
 });
 it('does not alter owner/customer origin denials, bearer denials or invoke writers',async()=>{
  const {base,call,customerHold}=await start();
  for(const [path,init,status,code] of [
   ['/api/profile',{headers:{origin:'https://foreign.example'}},403,'FORBIDDEN'],
   ['/api/flow-sessions/hold',{method:'POST',headers:{origin:'https://checkout.example.test','content-type':'application/json'},body:'{}'},401,'UNAUTHENTICATED'],
  ] as const){const response=await fetch(base+path,init);expect(response.status).toBe(status);expect(await response.json()).toEqual({ok:false,code});expect(response.headers.get('x-request-id')).toMatch(uuid);}
  expect(call).not.toHaveBeenCalled();expect(customerHold).not.toHaveBeenCalled();
 });
 it('retains preflight allowlist and attaches an ID without exposing it through changed CORS',async()=>{
  const {base}=await start();const response=await fetch(base+'/api/profile',{method:'OPTIONS',headers:{origin:owner,'access-control-request-method':'GET'}});
  expect(response.status).toBe(204);expect(response.headers.get('x-request-id')).toMatch(uuid);expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization');expect(response.headers.get('access-control-expose-headers')).toBeNull();expect(await response.text()).toBe('');
 });
 it('ignores encoded CRLF and separately parsed injected headers on actual raw HTTP',async()=>{
  const {port}=await start();
  const source=await new Promise<string>((resolve,reject)=>{const socket=connect(port,'127.0.0.1',()=>socket.write('GET /version HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: forged%0d%0aX-Private: sentinel\r\nX-Injected: private-sentinel\r\nConnection: close\r\n\r\n'));let text='';socket.setEncoding('utf8');socket.on('data',chunk=>text+=chunk);socket.on('end',()=>resolve(text));socket.on('error',reject);});
  expect(source).toContain('HTTP/1.1 200');expect(source.match(/x-request-id: ([^\r\n]+)/i)?.[1]).toMatch(uuid);expect(source).not.toContain('sentinel');expect(source).not.toMatch(/x-injected:/i);
 });
 it('includes correlation on bounded rate-limit denials',async()=>{
  const {base}=await start();for(let i=0;i<120;i++){const response=await fetch(base+'/version');await response.text();}
  const response=await fetch(base+'/version');expect(response.status).toBe(429);expect(await response.json()).toEqual({ok:false,code:'RATE_LIMITED'});expect(response.headers.get('x-request-id')).toMatch(uuid);
 });
});
