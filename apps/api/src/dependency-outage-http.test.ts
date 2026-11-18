import {afterEach,describe,it,expect,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {createAvailabilityReader} from './repository';
import {createSupabaseIdentityVerifier} from './supabase-auth';

// Deterministic boundary fault injection, not live-provider recovery certification.
const origin='https://portal.staging.example.test';
const actor='a3100000-0000-4000-8000-000000000001';
const tenant='a3100000-0000-4000-8000-000000000002';
const service='a3100000-0000-4000-8000-000000000003';
const projectUrl='https://abcdefghij0123456789.supabase.co';
const now=1700000000000;
const enc=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({iss:projectUrl+'/auth/v1',aud:'authenticated',is_anonymous:false,sub:actor,session_id:tenant,exp:now/1000+3600})+'.'+Buffer.from('synthetic-signature-material').toString('base64url');
let server:Server|undefined;
afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;});

describe('essential dependency failure boundaries',()=>{
 it.each(['auth','database','payment'] as const)('fails closed during %s outage',async mode=>{
  const network=vi.fn(async(_input:RequestInfo|URL)=>{throw Error('private auth failure');});
  const verifier=createSupabaseIdentityVerifier({projectUrl,publicKey:'sb_publishable_unittestkey0123456789'},{now:()=>now,fetch:network});
  const connect=vi.fn(async()=>{throw Error('private database failure');});
  const availability=vi.fn(createAvailabilityReader({connect} as never));
  const payment=vi.fn(async()=>{throw Error('private payment failure');});
  const confirmation=vi.fn(async()=>{throw Error('confirmation must not run');});
  const repository={call:vi.fn(async()=>{throw Error('repository must not run');})};
  server=createFlowHttpServer({repository,ownerOrigins:[origin],customerOrigins:[origin],authenticateOwner:mode==='auth'?async credential=>(await verifier(credential)).userId:async()=>actor,availability,customerMockPayment:payment,customerConfirmation:confirmation});
  await new Promise<void>((r,j)=>{server!.once('error',j);server!.listen(0,'127.0.0.1',r);});
  const path=mode==='payment'?'/api/flow-sessions/mock-payment':`/api/availability?tenantId=${tenant}&serviceId=${service}&from=2026-01-05T00:00:00.000Z&to=2026-01-06T00:00:00.000Z`;
  const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}${path}`,{method:mode==='payment'?'POST':'GET',signal:AbortSignal.timeout(5000),headers:{origin,authorization:`Bearer ${mode==='auth'?token:'a'.repeat(43)}`,'content-type':'application/json'},...(mode==='payment'?{body:'{}'}:{})});
  expect(response.status).toBe(mode==='auth'?401:500);
  expect(await response.json()).toEqual({ok:false,code:mode==='auth'?'UNAUTHENTICATED':'INTERNAL_ERROR'});
  expect(network).toHaveBeenCalledTimes(mode==='auth'?1:0);
  if(mode==='auth')expect(String(network.mock.calls[0]?.[0])).toBe(projectUrl+'/auth/v1/user');
  expect(connect).toHaveBeenCalledTimes(mode==='database'?1:0);
  expect(payment).toHaveBeenCalledTimes(mode==='payment'?1:0);
  expect(availability).toHaveBeenCalledTimes(mode==='database'?1:0);
  expect(confirmation).not.toHaveBeenCalled();expect(repository.call).not.toHaveBeenCalled();
 });
});
