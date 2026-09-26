import { afterEach, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createFlowHttpServer } from './http';
import type { OwnerAllocator } from './owner-planning-http';

const actor='11111111-1111-4111-8111-111111111111';
const tenant='22222222-2222-4222-8222-222222222222';
const booking='33333333-3333-4333-8333-333333333333';
const crew='44444444-4444-4444-8444-444444444444';
const group='55555555-5555-4555-8555-555555555555';
const origin='https://owner.example.test';
const token='t'.repeat(32);
let server:Server|undefined;
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});

async function setup(allocate:OwnerAllocator){
  server=createFlowHttpServer({repository:{call:async()=>{throw Error('UNEXPECTED_RPC');}},authenticateOwner:async credential=>credential===token?actor:null,
    ownerOrigins:[origin],customerOrigins:['https://customer.example.test'],allocatePlanning:allocate});
  await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as AddressInfo).port;
  return async (body:unknown,options:{method?:string;credential?:string;tenantId?:string;origin?:string}={})=>{
    const method=options.method??'POST';
    const response=await fetch(`http://127.0.0.1:${port}/api/planning/allocate?tenantId=${options.tenantId??tenant}`,{
      method,headers:{origin:options.origin??origin,authorization:`Bearer ${options.credential??token}`,...(method==='POST'?{'content-type':'application/json'}:{})},
      body:method==='POST'?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
}

it('binds tentative allocation to the verified owner and single tenant query',async()=>{
  const allocate=vi.fn<OwnerAllocator>(async()=>({kind:'committed',delivery:'receipt',receipt:{schemaVersion:1,groupId:group,generation:2,bookingId:booking,status:'held',usable:true,expiresAt:'2099-01-01T00:00:00.000000Z',bookingState:'draft',confirmed:false}}));
  const request=await setup(allocate);
  const result=await request({bookingId:booking,crewId:crew,targetGeneration:2});
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ok:true,data:{bookingId:booking,bookingState:'draft',confirmed:false}});
  expect(allocate).toHaveBeenCalledExactlyOnceWith({mode:'verified_owner',userId:actor},{tenantId:tenant,bookingId:booking,crewId:crew,targetGeneration:2});
});

it('rejects browser authority, wrong identity, wrong origin and GET before allocation',async()=>{
  const allocate=vi.fn<OwnerAllocator>(async()=>({kind:'failed',code:'FORBIDDEN',transaction:'not_started',backendMayStillRun:false}));
  const request=await setup(allocate);
  expect((await request({bookingId:booking,crewId:crew,targetGeneration:2,userId:actor})).status).toBe(400);
  expect((await request({bookingId:booking,crewId:crew,targetGeneration:2},{credential:'x'.repeat(32)})).status).toBe(401);
  expect((await request({bookingId:booking,crewId:crew,targetGeneration:2},{tenantId:'invalid'})).status).toBe(400);
  expect((await request({bookingId:booking,crewId:crew,targetGeneration:2},{origin:'https://other.example.test'})).status).toBe(403);
  expect((await request(null,{method:'GET'})).status).toBe(405);
  expect(allocate).not.toHaveBeenCalled();
});

it('does not report uncertain allocation as a successful hold',async()=>{
  const allocate=vi.fn<OwnerAllocator>(async()=>({kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'}));
  const request=await setup(allocate);
  expect(await request({bookingId:booking,crewId:crew,targetGeneration:2})).toEqual({status:503,body:{ok:false,code:'COMMIT_UNCERTAIN',reconciliation:'REAUTHORIZE_SAME_TARGET'}});
  expect(allocate).toHaveBeenCalledTimes(1);
});
