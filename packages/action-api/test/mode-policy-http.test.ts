import { describe, it, expect, vi } from 'vitest';
import { Agent, createServer, request as httpRequest, type Server } from 'node:http';
import { connect } from 'node:net';
import { createModePolicyHttpHandler, type ModePolicyReader } from '../server/mode-policy-http';
import type { ModeClock } from '../server/mode-installation-repository';
import type { InstallationPolicy } from '@lumin/contracts';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base='/api/public/installation-policies/';
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}
function clock(){let time=0,index=0;const timers=new Map<number,{at:number,fn:()=>void}>();const value:ModeClock={monotonic:()=>time,setTimer(fn,ms){const id=++index;timers.set(id,{at:time+ms,fn});return id;},clearTimer(id){timers.delete(id as number);}};return{value,set(n:number){time=n;},advance(n:number){time=n;for(const[id,timer]of[...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};}
interface Reply{status:number;headers:Record<string,string|string[]|undefined>;body:string}
async function world(override?:ModePolicyReader['publicPolicy'],time?:ModeClock,empty=false){
  const server=createServer({maxHeaderSize:8192});server.on('clientError',(_error,socket)=>socket.destroy());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
  const profile={profileVersion:'test-v1',rendererOrigin:'https://renderer.test:44301',apiOrigin:'https://api.test:'+port,portalOrigin:'https://portal.test:44303',loaderUrl:'https://renderer.test:44301/assets/booking-lumin-loader.'+'a'.repeat(64)+'.js'};
  const data:InstallationPolicy={schemaVersion:1,installationId:id,mode:'hosted',deploymentProfileVersion:'test-v1',rendererOrigin:profile.rendererOrigin,apiOrigin:profile.apiOrigin,loaderUrl:profile.loaderUrl,currentVersionId:id,targetRevision:1,policyRevision:1,allowedParentOrigins:[],enabled:true};
  const read=vi.fn(override??(async()=>({kind:'completed',delivery:'data',data} as const)));
  const handler=createModePolicyHttpHandler({reader:{publicPolicy:read,close:async()=>{}},profiles:empty?[]:[profile],clock:time});server.on('request',handler.handle);
  const keepAgent=new Agent({keepAlive:true,maxSockets:1});
  const send=(path=base+id,method='GET',headers:Record<string,string>={}):Promise<Reply>=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,agent:headers.Connection==='keep-alive'?keepAgent:false,headers:{Host:'api.test:'+port,Connection:'close',...headers}},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));});req.setTimeout(3000,()=>req.destroy(Error('test timeout')));req.on('error',reject);req.end();
  });
  return{server,port,profile,data,read,send,handler,async close(){await handler.close();keepAgent.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
describe('read-only native policy HTTP',()=>{
 it('delivers only minimized policy and HEAD parity with three no-store headers',async()=>{const w=await world();try{
   const get=await w.send();expect(get.status).toBe(200);expect(JSON.parse(get.body)).toEqual(w.data);
   const head=await w.send(undefined,'HEAD');expect(head.status).toBe(200);expect(head.body).toBe('');expect(head.headers['content-length']).toBe(get.headers['content-length']);
   expect(get.headers['cache-control']).toBe('no-store,max-age=0');expect(get.headers['cdn-cache-control']).toBe('no-store');expect(get.headers['netlify-cdn-cache-control']).toBe('no-store');expect(get.headers['set-cookie']).toBeUndefined();
   expect(w.read.mock.calls[0]?.[0]).toEqual({installationId:id});
 }finally{await w.close();}});
 it.each([[base+id+'/',400],[base+id+'?',400],[base+id+'#x',400],[base+'%61'+id.slice(1),400],['/api//public/installation-policies/'+id,400],['/index.html',404],[base+'INVALID',400],['/api/public/installation-policies',404]])('raw path %s -> %s without database',async(path,status)=>{const w=await world();try{expect((await w.send(path as string)).status).toBe(status);expect(w.read).not.toHaveBeenCalled();}finally{await w.close();}});
 it.each(['POST','PUT','DELETE','PATCH'])('method%s rejected',async method=>{const w=await world();try{const r=await w.send(undefined,method);expect(r.status).toBe(405);expect(r.headers.allow).toBe('GET, HEAD, OPTIONS');expect(w.read).not.toHaveBeenCalled();}finally{await w.close();}});
 it.each([{Cookie:'x=y'},{Authorization:'fixture-only'},{Host:'wrong.test'},{Origin:'null'},{Origin:'https://other.test'}])('headers%o reject without database',async headers=>{const w=await world();try{const clean=Object.fromEntries(Object.entries(headers).filter((e):e is[string,string]=>typeof e[1]==='string'));expect((await w.send(undefined,'GET',clean)).status).toBe(headers.Origin?403:400);expect(w.read).not.toHaveBeenCalled();}finally{await w.close();}});
 it('exact anonymous CORS preflight has no database and no credential grants',async()=>{const w=await world();try{
   const r=await w.send(undefined,'OPTIONS',{Origin:w.profile.rendererOrigin,'Access-Control-Request-Method':'GET'});expect(r.status).toBe(204);expect(r.body).toBe('');expect(r.headers['access-control-allow-origin']).toBe(w.profile.rendererOrigin);expect(r.headers['access-control-allow-credentials']).toBeUndefined();expect(w.read).not.toHaveBeenCalled();
   expect((await w.send(undefined,'OPTIONS',{Origin:w.profile.rendererOrigin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})).status).toBe(400);
   expect((await w.send(undefined,'OPTIONS',{'Access-Control-Request-Method':'GET'})).status).toBe(403);
   const get=await w.send(undefined,'GET',{Origin:w.profile.rendererOrigin,'X-Forwarded-Host':'evil.test'});expect(get.status).toBe(200);expect(get.headers['access-control-allow-origin']).toBe(w.profile.rendererOrigin);
 }finally{await w.close();}});
 it.each(['UNAVAILABLE','ABORTED','CLOSED','INTERNAL_ERROR'] as const)('repository failed%s exactpublicstatus',async code=>{const w=await world(async()=>({kind:'failed',code,transaction:'not_started',backendMayStillRun:false}));try{const r=await w.send();expect(r.status).toBe(code==='UNAVAILABLE'?404:503);expect(r.body).not.toContain('transaction');}finally{await w.close();}});
 it.each([{kind:'completion_uncertain',code:'READ_COMPLETION_UNCERTAIN',data:null,backendMayStillRun:true},{kind:'completed',delivery:'withheld',data:null,reason:'DEADLINE'}] as const)('undeliverable outcome never emptysuccess %o',async outcome=>{const w=await world(async()=>outcome);try{expect((await w.send()).status).toBe(503);}finally{await w.close();}});
 it('zero profile handler returns503 without invoking reader',async()=>{const w=await world(undefined,undefined,true);try{expect((await w.send()).status).toBe(503);expect(w.read).not.toHaveBeenCalled();}finally{await w.close();}});
 it('malformed returned public binding is503 with valid neighboring200',async()=>{const w=await world();try{w.read.mockImplementationOnce(async()=>({kind:'completed',delivery:'data',data:{...w.data,installationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}));expect((await w.send()).status).toBe(503);expect((await w.send()).status).toBe(200);}finally{await w.close();}});
 it('request deadlines retain two unresolved database slots until late settlement',async()=>{
   const time=clock();const calls:ReturnType<typeof deferred<Awaited<ReturnType<ModePolicyReader['publicPolicy']>>>>[]=[];
   const w=await world(()=>{const d=deferred<Awaited<ReturnType<ModePolicyReader['publicPolicy']>>>();calls.push(d);return d.promise;},time.value);
   try{const a=w.send(),b=w.send();await vi.waitFor(()=>expect(calls).toHaveLength(2));time.advance(2000);expect((await a).status).toBe(503);expect((await b).status).toBe(503);
     expect((await w.send()).status).toBe(429);expect(calls).toHaveLength(2);calls[0]!.resolve({kind:'completed',delivery:'data',data:w.data});await new Promise(resolve=>setTimeout(resolve,0));
     const next=w.send();await vi.waitFor(()=>expect(calls).toHaveLength(3));calls[2]!.resolve({kind:'completed',delivery:'data',data:w.data});expect((await next).status).toBe(200);
   }finally{for(const call of calls)call.resolve({kind:'completed',delivery:'data',data:w.data});await w.close();}
 });
 it('peraddress120 reset is real HTTP and authorizedOrigin429 keeps CORS',async()=>{const time=clock();const w=await world(undefined,time.value);try{for(let i=0;i<120;i++)expect((await w.send()).status).toBe(200);const denied=await w.send(undefined,'GET',{Origin:w.profile.rendererOrigin});expect(denied.status).toBe(429);expect(denied.headers['access-control-allow-origin']).toBe(w.profile.rendererOrigin);expect(w.read).toHaveBeenCalledTimes(120);time.set(60000);expect((await w.send()).status).toBe(200);}finally{await w.close();}});
 it('clock failure closes existing requests and all later admission',async()=>{const time=clock();time.set(100);const late=deferred<Awaited<ReturnType<ModePolicyReader['publicPolicy']>>>();const w=await world(()=>late.promise,time.value);try{const first=w.send();await vi.waitFor(()=>expect(w.read).toHaveBeenCalledTimes(1));time.set(99);expect((await w.send()).status).toBe(503);expect((await first).status).toBe(503);time.set(200);expect((await w.send()).status).toBe(503);expect(w.read).toHaveBeenCalledTimes(1);}finally{late.resolve({kind:'completed',delivery:'data',data:w.data});await w.close();}});
 it('duplicate rawHost rejects and native overflow closes connection',async()=>{const w=await world();try{
   const raw=(payload:string)=>new Promise<string>((resolve,reject)=>{const socket=connect(w.port,'127.0.0.1');let out='';socket.setTimeout(3000,()=>socket.destroy(Error('timeout')));socket.on('connect',()=>socket.end(payload));socket.on('data',b=>out+=b.toString());socket.on('error',reject);socket.on('close',()=>resolve(out));});
   const duplicate=await raw(`GET ${base+id} HTTP/1.1\r\nHost: api.test:${w.port}\r\nHost: api.test:${w.port}\r\nConnection: close\r\n\r\n`);expect(duplicate).toContain('400');expect(w.read).not.toHaveBeenCalled();
   const overflow=await raw(`GET ${base+id} HTTP/1.1\r\nHost: api.test:${w.port}\r\nX-Large: ${'x'.repeat(8192)}\r\nConnection: close\r\n\r\n`);expect(overflow).toBe('');expect(w.read).not.toHaveBeenCalled();expect((await w.send()).status).toBe(200);
 }finally{await w.close();}});
});

 it('600-per-installation window aggregates controlled virtual peers and resets',async()=>{
   const time=clock();const w=await world(async()=>({kind:'failed',code:'UNAVAILABLE',transaction:'not_started',backendMayStillRun:false}),time.value);
   let peer='192.0.2.1';w.server.prependListener('connection',socket=>Object.defineProperty(socket,'remoteAddress',{value:peer}));
   try{for(let i=0;i<600;i++){peer='192.0.2.'+(Math.floor(i/100)+1);expect((await w.send()).status).toBe(404);}
     peer='192.0.2.7';const denied=await w.send();expect(denied.status).toBe(429);expect(denied.headers['retry-after']).toBe('60');expect(w.read).toHaveBeenCalledTimes(600);
     time.set(60000);expect((await w.send()).status).toBe(404);
   }finally{await w.close();}
 },15000);
 it('combined10000 map cap never evicts active keys and expired windows reopen admission',async()=>{
   const time=clock();const w=await world(async()=>({kind:'failed',code:'UNAVAILABLE',transaction:'not_started',backendMayStillRun:false}),time.value);
   let peer='virtual-0';w.server.prependListener('request',req=>Object.defineProperty(req.socket,'remoteAddress',{value:peer,configurable:true}));
   // Controlled peer metadata per request over one owned keep-alive socket avoids thousands of native sockets.
   const send=(i:number)=>w.send(base+identity(i),'GET',{Connection:'keep-alive'});
   const identity=(i:number)=>i.toString(16).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   try{for(let i=0;i<5000;i++){peer='virtual-'+i;expect((await send(i)).status).toBe(404);}
     peer='virtual-new';expect((await send(5000)).status).toBe(429);
     peer='virtual-0';expect((await send(0)).status).toBe(404);
     peer='virtual-new';expect((await send(5000)).status).toBe(429);
     time.set(60000);expect((await send(5000)).status).toBe(404);
   }finally{await w.close();}
 },30000);
 it('disconnect keeps database admission until actual repository settlement',async()=>{
   const calls:ReturnType<typeof deferred<Awaited<ReturnType<ModePolicyReader['publicPolicy']>>>>[]=[];
   const w=await world(()=>{const d=deferred<Awaited<ReturnType<ModePolicyReader['publicPolicy']>>>();calls.push(d);return d.promise;});
   const sockets:ReturnType<typeof connect>[]=[];
   try{
     for(let i=0;i<2;i++){const socket=connect(w.port,'127.0.0.1');sockets.push(socket);socket.on('error',()=>{});await new Promise<void>(resolve=>socket.once('connect',resolve));socket.write(`GET ${base+id} HTTP/1.1\r\nHost: api.test:${w.port}\r\nConnection: close\r\n\r\n`);}
     await vi.waitFor(()=>expect(calls).toHaveLength(2));for(const socket of sockets)socket.destroy();
     expect((await w.send()).status).toBe(429);expect(calls).toHaveLength(2);
     calls[0]!.resolve({kind:'completed',delivery:'data',data:w.data});await new Promise(resolve=>setTimeout(resolve,0));
     const next=w.send();await vi.waitFor(()=>expect(calls).toHaveLength(3));calls[2]!.resolve({kind:'completed',delivery:'data',data:w.data});expect((await next).status).toBe(200);
   }finally{for(const socket of sockets)socket.destroy();for(const call of calls)call.resolve({kind:'completed',delivery:'data',data:w.data});await w.close();}
 });
 it('timer clear failure yields503 and bounds leftover callback admission',async()=>{
   const callbacks:(()=>void)[]=[];const time:ModeClock={monotonic:()=>0,setTimer(fn){callbacks.push(fn);return callbacks.length;},clearTimer(){throw Error('scheduler');}};
   const w=await world(undefined,time);try{for(let i=0;i<20;i++)expect((await w.send()).status).toBe(503);expect(callbacks).toHaveLength(1);expect(w.read).toHaveBeenCalledTimes(1);callbacks[0]!();expect((await w.send()).status).toBe(503);}finally{await w.close();}
 });

 it.each([1999,2000])('final scheduler cleanup sample at%s preserves exact2s response budget',async finishTime=>{
   let now=0;const time:ModeClock={monotonic:()=>now,setTimer:()=>undefined,clearTimer(){now=finishTime;}};
   const w=await world(undefined,time);try{const r=await w.send();expect(r.status).toBe(finishTime===1999?200:503);if(finishTime===2000)expect(r.body).not.toContain('installationId');}finally{await w.close();}
 });
