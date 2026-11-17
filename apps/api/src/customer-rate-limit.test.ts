import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer,tokenHash} from './http';

const origin='https://checkout.example.test';
const token='a'.repeat(43);
const installation='34000000-0000-4000-8000-000000000001';
const holdReceipt={bookingId:'34000000-0000-4000-8000-000000000002',holdId:'34000000-0000-4000-8000-000000000003',status:'active' as const,expiresAt:'2030-01-01T00:05:00.000Z'};
const common={idempotencyKey:'customer-request-test-0001',customer:{name:'Customer',email:'customer@example.test'},requestedStart:'2030-01-01T00:00:00Z'};
const v4={...common,answers:{access:{choiceIds:['front_door']}}};
const v5={...common,schemaVersion:2,answers:{},customerAnswers:{custom_access:'Front door'}};

describe('shared public customer abuse quota',()=>{
 let server:Server|undefined;
 afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});
 it.each([false,true])('does not bypass quota by concurrent failures, route/token changes or forwarded headers (trustProxy=%s)',async trustProxy=>{
  let now=0;
  const call=vi.fn(async()=>{throw new Error('rate-limited request reached database');});
  const hold=vi.fn(async()=>holdReceipt);
  const confirm=vi.fn(async()=>{throw new Error('rate-limited request reached confirmation');});
  const mock=vi.fn(async()=>{throw new Error('rate-limited request reached payment');});
  const owner=vi.fn(async()=>null);
  server=createFlowHttpServer({repository:{call},ownerOrigins:[],customerOrigins:[origin],authenticateOwner:owner,customerHold:hold,customerConfirmation:confirm,customerMockPayment:mock,trustProxy,now:()=>now});
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const headers=(index:number)=>({origin,'content-type':'application/json','x-forwarded-for':`192.0.2.${index%250+1}`,'x-real-ip':`198.51.100.${index%250+1}`,forwarded:`for=203.0.113.${index%250+1}`});
  // Failed capability requests consume the same peer quota before any async
  // writer. Forged proxy headers must not supply a fresh rate-limit identity.
  const flood=await Promise.all(Array.from({length:121},async(_,i)=>{
   const response=await fetch(base+'/api/flow-sessions/request',{method:'POST',headers:headers(i),body:JSON.stringify(i%2?v4:v5)});
   const body=await response.json();expect(body).toEqual({ok:false,code:response.status===429?'RATE_LIMITED':'UNAUTHENTICATED'});return response.status;
  }));
  expect(flood.filter(status=>status===401)).toHaveLength(120);expect(flood.filter(status=>status===429)).toHaveLength(1);
  const attempts=[
   [`/api/installations/${installation}/sessions`,{}],
   ['/api/flow-sessions/request',v4],
   ['/api/flow-sessions/request',v5],
   ['/api/flow-sessions/hold',{}],
   ['/api/flow-sessions/mock-payment',{}],
   ['/api/flow-sessions/confirm',{}],
  ] as const;
  for(const [index,[path,body]] of attempts.entries()){
   const response=await fetch(base+path,{method:'POST',headers:{...headers(200+index),authorization:`Bearer ${index%2?'b'.repeat(43):token}`},body:JSON.stringify(body)});
   expect(response.status).toBe(429);expect(await response.json()).toEqual({ok:false,code:'RATE_LIMITED'});expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }
  now=59999;
  const before=await fetch(base+'/api/flow-sessions/hold',{method:'POST',headers:{...headers(240),authorization:`Bearer ${token}`},body:'{}'});expect(before.status).toBe(429);await before.json();
  for(const seam of [call,hold,confirm,mock,owner])expect(seam).not.toHaveBeenCalled();
  // The existing 60-second window expires exactly at its boundary. The next
  // valid request reaches only the session-bound hold authority, not an owner.
  now=60000;
  const after=await fetch(base+'/api/flow-sessions/hold',{method:'POST',headers:{...headers(241),authorization:`Bearer ${token}`},body:'{}'});
  expect(after.status).toBe(200);expect(await after.json()).toEqual({ok:true,data:{schemaVersion:1,...holdReceipt}});expect(hold).toHaveBeenCalledExactlyOnceWith(tokenHash(token),origin);
  for(const seam of [call,confirm,mock,owner])expect(seam).not.toHaveBeenCalled();
 });
});
