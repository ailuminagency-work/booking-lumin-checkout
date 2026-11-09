import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServer,type Server,type RequestListener} from 'node:http';
import {readReleaseMetadata,serveReleaseMetadata,type ReleaseEnvironment} from './release-metadata';
import {createFlowHttpServer} from './http';

const sha='0123456789abcdef0123456789abcdef01234567';
const owner='https://portal.staging.example.test';
describe('safe optional release metadata',()=>{
 it.each(['staging','demo','production'] as const)('allows exact %s only',environment=>{
  expect(readReleaseMetadata({BOOKING_LUMIN_ENV:environment,RENDER_GIT_COMMIT:sha})).toEqual({schemaVersion:1,service:'booking-lumin-api',environment,releaseSha:sha});
 });
 it.each([undefined,'','STAGING',' staging','staging\n','unknown','private credential'])('does not echo invalid environment %j',BOOKING_LUMIN_ENV=>{
  expect(readReleaseMetadata({BOOKING_LUMIN_ENV})).toEqual({schemaVersion:1,service:'booking-lumin-api',environment:'unknown',releaseSha:null});
 });
 it.each([undefined,'',sha.toUpperCase(),sha.slice(1),sha+'0',' '+sha,sha+'\n','g'.repeat(40),'private credential'])('does not echo invalid SHA %j',RENDER_GIT_COMMIT=>{
  expect(readReleaseMetadata({RENDER_GIT_COMMIT}).releaseSha).toBeNull();
 });
 it('never spreads raw environment or derives identity from other variables',()=>{
  const env={NODE_ENV:'production',DATABASE_URL:'private credential',RENDER_SERVICE_ID:'private-id',PWD:'private-path'};
  const result=readReleaseMetadata(env as ReleaseEnvironment);
  expect(result).toEqual({schemaVersion:1,service:'booking-lumin-api',environment:'unknown',releaseSha:null});
  expect(Object.isFrozen(result)).toBe(true);
 });
});

describe('public release HTTP boundary',()=>{
 let server:Server|undefined;
 afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});
 async function start(handler?:RequestListener){
  const call=vi.fn(async()=>{throw new Error('unexpected database invocation');});
  const authenticateOwner=vi.fn(async()=>null);
  const customerHold=vi.fn(async()=>{throw new Error('unexpected financial writer');});
  const env={BOOKING_LUMIN_ENV:'staging',RENDER_GIT_COMMIT:sha};
  const flow=createFlowHttpServer({repository:{call},ownerOrigins:[owner],customerOrigins:['https://checkout.staging.example.test'],authenticateOwner,customerHold,releaseEnvironment:env});
  server=createServer(handler??((req,res)=>flow.emit('request',req,res)));
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  return {base:`http://127.0.0.1:${(server.address() as {port:number}).port}`,call,authenticateOwner,customerHold,env};
 }
 it('GET is public, bounded, no-store, no CORS reflection and performs no auth or database operation',async()=>{
  const {base,call,authenticateOwner,env}=await start();env.BOOKING_LUMIN_ENV='private mutation';env.RENDER_GIT_COMMIT='private mutation';
  const response=await fetch(base+'/version',{headers:{origin:'https://foreign.example',authorization:'Bearer private-invalid'}});
  expect(response.status).toBe(200);expect(await response.json()).toEqual(readReleaseMetadata({BOOKING_LUMIN_ENV:'staging',RENDER_GIT_COMMIT:sha}));
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(call).not.toHaveBeenCalled();expect(authenticateOwner).not.toHaveBeenCalled();
 });
 it('the same handler used by main serves sanitized metadata without delegation',async()=>{
  const delegated=vi.fn();const metadata=readReleaseMetadata({BOOKING_LUMIN_ENV:'secret',RENDER_GIT_COMMIT:'secret'});
  const {base}=await start((req,res)=>{if(!serveReleaseMetadata(req,res,new URL(req.url!,'http://localhost').pathname,metadata)){delegated();res.writeHead(404);res.end();}});
  const response=await fetch(base+'/version');expect(response.status).toBe(200);expect(await response.json()).toEqual({schemaVersion:1,service:'booking-lumin-api',environment:'unknown',releaseSha:null});expect(delegated).not.toHaveBeenCalled();
 });
 it('preserves local health exactly',async()=>{
  const {base,call,authenticateOwner}=await start();const response=await fetch(base+'/health');
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,data:{mode:'LOCAL_HARNESS',providerConnections:false}});expect(call).not.toHaveBeenCalled();expect(authenticateOwner).not.toHaveBeenCalled();
 });
 it.each(['/api/profile?tenantId=a3100000-0000-4000-8000-000000000002','/ready'])('does not bypass existing owner boundary on %s',async path=>{
  const {base,call}=await start();const missing=await fetch(base+path,{headers:{origin:owner}});expect(missing.status).toBe(401);expect(await missing.json()).toEqual({ok:false,code:'UNAUTHENTICATED'});
  const foreign=await fetch(base+path,{headers:{origin:'https://foreign.example'}});expect(foreign.status).toBe(403);expect(await foreign.json()).toEqual({ok:false,code:'FORBIDDEN'});expect(call).not.toHaveBeenCalled();
 });
 it('does not widen customer bearer authority',async()=>{
  const {base,call,customerHold}=await start();const response=await fetch(base+'/api/flow-sessions/hold',{method:'POST',headers:{origin:'https://checkout.staging.example.test','content-type':'application/json'},body:'{}'});
  expect(response.status).toBe(401);expect(await response.json()).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(call).not.toHaveBeenCalled();expect(customerHold).not.toHaveBeenCalled();
 });
 it('non-GET version and preflight retain existing origin and auth behavior',async()=>{
  const {base,call}=await start();const post=await fetch(base+'/version',{method:'POST',headers:{origin:owner}});expect(post.status).toBe(401);
  const options=await fetch(base+'/version',{method:'OPTIONS',headers:{origin:owner,'access-control-request-method':'GET'}});expect(options.status).toBe(204);expect(options.headers.get('access-control-allow-origin')).toBe(owner);
  const foreign=await fetch(base+'/version',{method:'OPTIONS',headers:{origin:'https://foreign.example','access-control-request-method':'GET'}});expect(foreign.status).toBe(403);expect(call).not.toHaveBeenCalled();
 });
});
