import {describe,expect,it,vi} from 'vitest';
import {performance} from 'node:perf_hooks';
import {allocateOwnerPlanningGroup,type OwnerPlanningClient,type OwnerPlanningPool} from './owner-planning-allocation';

const userId='11111111-1111-4111-8111-111111111111';
const tenantId='22222222-2222-4222-8222-222222222222';
const bookingId='33333333-3333-4333-8333-333333333333';
const crewId='44444444-4444-4444-8444-444444444444';
const groupId='55555555-5555-4555-8555-555555555555';
const actor={mode:'verified_owner',userId};
const request={tenantId,bookingId,crewId,targetGeneration:1};
const receipt={schemaVersion:1,groupId,generation:1,bookingId,status:'held',usable:true,expiresAt:'2099-01-01T00:00:00.000000Z',bookingState:'draft',confirmed:false};
type Result={command:string;rowCount?:number|null;rows?:unknown[]};
function harness(overrides:Partial<{rpc:()=>Promise<Result>;commit:()=>Promise<Result>}>= {}){
 const calls:{sql:string;values?:unknown[]}[]=[];const releases:(Error|undefined)[]=[];
 const client:OwnerPlanningClient={async query(sql,values){calls.push({sql,values});
  if(sql.includes('allocate_planning_group'))return overrides.rpc?.()??{command:'SELECT',rowCount:1,rows:[{result:receipt}]};
  if(sql==='COMMIT')return overrides.commit?.()??{command:'COMMIT'};
  return {command:sql.startsWith('BEGIN')?'BEGIN':'SET'};
 },release(error){releases.push(error);}};
 const pool:OwnerPlanningPool={connect:vi.fn(async()=>client)};
 return {pool,calls,releases};
}
function pg(code:string,message:string){return Object.assign(Error(message),{code});}

describe('verified-owner tentative planning seam',()=>{
 it('binds verified actor and tenant to the fixed allocator and returns draft-only receipt',async()=>{
  const h=harness();const outcome=await allocateOwnerPlanningGroup(h.pool,actor,request);
  expect(outcome).toMatchObject({kind:'committed',delivery:'receipt',receipt:{groupId,bookingId,bookingState:'draft',confirmed:false,usable:true}});
  expect(h.calls.filter(c=>c.sql.includes('allocate_planning_group'))).toEqual([{
   sql:'SELECT public.allocate_planning_group($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result',
   values:[userId,tenantId,bookingId,crewId,1],
  }]);
  expect(h.calls.at(-1)?.sql).toBe('COMMIT');expect(h.releases).toEqual([undefined]);
 });
 it('rejects forged actor mode, extra tenant authority and invalid generation before acquisition',async()=>{
  const h=harness();
  for(const [a,r] of [[{mode:'local_synthetic',userId},request],[{...actor,tenantId},request],[actor,{...request,tenantId:'other'}],[actor,{...request,targetGeneration:0}]]){
   expect(await allocateOwnerPlanningGroup(h.pool,a,r)).toMatchObject({kind:'failed',code:'INVALID_REQUEST',transaction:'not_started'});
  }
  expect(h.pool.connect).not.toHaveBeenCalled();
 });
 it('maps cross-tenant or revoked owner denial without committing',async()=>{
  const h=harness({rpc:async()=>{throw pg('42501','FORBIDDEN');}});
  expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'failed',code:'FORBIDDEN',transaction:'no_commit_submitted'});
  expect(h.calls.some(c=>c.sql==='COMMIT')).toBe(false);expect(h.releases[0]).toBeInstanceOf(Error);
 });
 it('maps stale generation and blocked worker shifts conservatively',async()=>{
  for(const [code,message,expected] of [['40001','ALLOCATION_GENERATION_CONFLICT','GENERATION_CONFLICT'],['P0001','ALLOCATION_UNAVAILABLE','UNAVAILABLE']] as const){
   const h=harness({rpc:async()=>{throw pg(code,message);}});
   expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'failed',code:expected});
   expect(h.calls.some(c=>c.sql==='COMMIT')).toBe(false);
  }
 });
 it('refuses a mismatched generation or confirmed receipt before commit',async()=>{
  for(const bad of [{...receipt,generation:2},{...receipt,confirmed:true}]){
   const h=harness({rpc:async()=>({command:'SELECT',rowCount:1,rows:[{result:bad}]})});
   expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'failed',code:'INTERNAL_ERROR'});
   expect(h.calls.some(c=>c.sql==='COMMIT')).toBe(false);
  }
 });
 it('never reports an expired hold as usable',async()=>{
  const h=harness({rpc:async()=>({command:'SELECT',rowCount:1,rows:[{result:{...receipt,expiresAt:'2000-01-01T00:00:00.000000Z'}}]})});
  expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'committed',delivery:'receipt',receipt:{usable:false,confirmed:false}});
 });
 it('treats a lost COMMIT acknowledgement as unknown and never retries',async()=>{
  const h=harness({commit:async()=>{throw Error('connection lost');}});
  expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toEqual({kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'});
  expect(h.calls.filter(c=>c.sql==='COMMIT')).toHaveLength(1);
  expect(h.releases[0]).toBeInstanceOf(Error);
 });
 it('recognizes an explicit transaction rollback as not committed',async()=>{
  const h=harness({commit:async()=>({command:'ROLLBACK'})});
  expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'failed',transaction:'rolled_back',backendMayStillRun:false});
 });
 it('fails closed on an invalid monotonic sample before acquiring a connection',async()=>{
  const h=harness();const sample=vi.spyOn(performance,'now').mockReturnValue(Number.NaN);
  try{expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toEqual({kind:'failed',code:'INTERNAL_ERROR',transaction:'not_started',backendMayStillRun:false});
   expect(h.pool.connect).not.toHaveBeenCalled();}finally{sample.mockRestore();}
 });
 it('rejects a backward monotonic sample before beginning the transaction',async()=>{
  const h=harness();const sample=vi.spyOn(performance,'now').mockReturnValueOnce(10).mockReturnValueOnce(9);
  try{expect(await allocateOwnerPlanningGroup(h.pool,actor,request)).toMatchObject({kind:'failed',code:'INTERNAL_ERROR',transaction:'not_started'});
   expect(h.calls).toHaveLength(0);expect(h.releases[0]).toBeInstanceOf(Error);}finally{sample.mockRestore();}
 });
 it('bounds stalled pool acquisition and discards a connection that arrives after deadline',async()=>{
  vi.useFakeTimers();
  try{
   const h=harness();let acquired!:(client:OwnerPlanningClient)=>void;
   const pending=new Promise<OwnerPlanningClient>(resolve=>{acquired=resolve;});
   const pool:OwnerPlanningPool={connect:vi.fn(()=>pending)};
   const operation=allocateOwnerPlanningGroup(pool,actor,request);
   expect(pool.connect).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(10000);
   expect(await operation).toEqual({kind:'failed',code:'DEADLINE',transaction:'not_started',backendMayStillRun:false});
   acquired(await h.pool.connect());await Promise.resolve();await Promise.resolve();
   expect(h.calls).toHaveLength(0);expect(h.releases[0]).toBeInstanceOf(Error);
  }finally{vi.useRealTimers();}
 });
});
