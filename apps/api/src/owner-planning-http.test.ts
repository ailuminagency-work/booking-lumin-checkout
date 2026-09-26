import {describe,expect,it,vi} from 'vitest';
import {handleOwnerPlanningAllocation,type OwnerAllocator} from './owner-planning-http';
import type {PlanningAllocationOutcome} from './planning-allocation-contracts';

const actor='11111111-1111-4111-8111-111111111111';
const tenant='22222222-2222-4222-8222-222222222222';
const booking='33333333-3333-4333-8333-333333333333';
const crew='44444444-4444-4444-8444-444444444444';
const group='55555555-5555-4555-8555-555555555555';
const body={bookingId:booking,crewId:crew,targetGeneration:1};
const receipt={schemaVersion:1 as const,groupId:group,generation:1,bookingId:booking,status:'held' as const,usable:true,expiresAt:'2099-01-01T00:00:00.000000Z',bookingState:'draft' as const,confirmed:false as const};
const committed:PlanningAllocationOutcome={kind:'committed',delivery:'receipt',receipt};
const invoke=(allocate:OwnerAllocator,raw:unknown=body,method='POST',actorId:unknown=actor,tenantId:unknown=tenant)=>
 handleOwnerPlanningAllocation(method,actorId,tenantId,raw,allocate);
const allocator=(value:PlanningAllocationOutcome)=>vi.fn(async()=>value) as unknown as OwnerAllocator;

describe('owner tentative planning HTTP handler',()=>{
 it('passes only server verified actor and strict tenant-bound planning input',async()=>{
  const allocate=allocator(committed);
  expect(await invoke(allocate)).toEqual({status:200,body:{ok:true,data:receipt}});
  expect(allocate).toHaveBeenCalledExactlyOnceWith({mode:'verified_owner',userId:actor},{tenantId:tenant,bookingId:booking,crewId:crew,targetGeneration:1});
  expect(JSON.stringify((await invoke(allocate)).body)).not.toContain('payment');
 });
 it('rejects forged actor, tenant and booking authority in body before allocator',async()=>{
  const allocate=allocator(committed);
  for(const raw of [{...body,userId:actor},{...body,tenantId:tenant},{...body,confirmed:true},{...body,paymentId:group},{...body,targetGeneration:0}]){
   expect(await invoke(allocate,raw)).toMatchObject({status:400,body:{ok:false,code:'INVALID_REQUEST'}});
  }
  expect(await invoke(allocate,body,'GET')).toMatchObject({status:405});
  expect(await invoke(allocate,body,'POST','unverified')).toMatchObject({status:400});
  expect(await invoke(allocate,body,'POST',actor,'other-tenant')).toMatchObject({status:400});
  expect(allocate).not.toHaveBeenCalled();
 });
 it('maps simulated cross-tenant owner denial and stale generation without claiming a hold',async()=>{
  const forbidden=allocator({kind:'failed',code:'FORBIDDEN',transaction:'no_commit_submitted',backendMayStillRun:true});
  expect(await invoke(forbidden)).toEqual({status:403,body:{ok:false,code:'FORBIDDEN'}});
  const stale=allocator({kind:'failed',code:'GENERATION_CONFLICT',transaction:'no_commit_submitted',backendMayStillRun:true});
  expect(await invoke(stale)).toEqual({status:409,body:{ok:false,code:'GENERATION_CONFLICT'}});
 });
 it('keeps uncertain commit and withheld receipt separate from success',async()=>{
  const unknown=allocator({kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'});
  expect(await invoke(unknown)).toEqual({status:503,body:{ok:false,code:'COMMIT_UNCERTAIN',reconciliation:'REAUTHORIZE_SAME_TARGET'}});
  const withheld=allocator({kind:'committed',delivery:'withheld',receipt:null,reason:'DEADLINE'});
  expect(await invoke(withheld)).toEqual({status:503,body:{ok:false,code:'OUTCOME_UNAVAILABLE',reconciliation:'REAUTHORIZE_SAME_TARGET'}});
  expect(unknown).toHaveBeenCalledTimes(1);expect(withheld).toHaveBeenCalledTimes(1);
 });
 it('refuses expired, mismatched and confirmed receipts',async()=>{
  const expired=allocator({kind:'committed',delivery:'receipt',receipt:{...receipt,expiresAt:'2000-01-01T00:00:00.000000Z'}});
  expect(await invoke(expired)).toEqual({status:409,body:{ok:false,code:'HOLD_EXPIRED',reconciliation:'REAUTHORIZE_SAME_TARGET'}});
  for(const bad of [{...receipt,bookingId:tenant},{...receipt,generation:2},{...receipt,confirmed:true}]){
   expect(await invoke(allocator({kind:'committed',delivery:'receipt',receipt:bad as any}))).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
  }
 });
 it('never serializes extra fields or reads a changing receipt getter after validation',async()=>{
  const extra={...receipt,paymentSecret:'must-not-leak'};
  expect(await invoke(allocator({kind:'committed',delivery:'receipt',receipt:extra as any}))).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
  let reads=0;
  const changing=Object.defineProperty({...receipt},'expiresAt',{enumerable:true,get(){reads++;return reads===1?'2099-01-01T00:00:00.000000Z':'2000-01-01T00:00:00.000000Z';}});
  expect(await invoke(allocator({kind:'committed',delivery:'receipt',receipt:changing as any}))).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
  expect(reads).toBe(0);
  expect(JSON.stringify((await invoke(allocator(committed))).body)).not.toContain('paymentSecret');
 });
});
