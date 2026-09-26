/** Authenticated-owner seam for the existing, tentative-only planning RPC. */
import { performance } from 'node:perf_hooks';
import { planningRecord, parsePlanningReceipt, planningExpiryMicroseconds, type PlanningAllocationRequest, type PlanningAllocationOutcome } from './planning-allocation-contracts';

export interface OwnerPlanningClient {
 query(text:string,values?:unknown[]):Promise<{command:string;rowCount?:number|null;rows?:unknown[]}>;
 release(error?:Error):void;
}
export interface OwnerPlanningPool { connect():Promise<OwnerPlanningClient> }
export type VerifiedPlanningOwner=Readonly<{mode:'verified_owner';userId:string}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SQL='SELECT public.allocate_planning_group($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result';
type FailureCode=Extract<PlanningAllocationOutcome,{kind:'failed'}>['code'];
const mapping:Record<string,FailureCode>={
 '22023/ALLOCATION_INVALID':'INVALID_REQUEST','42501/FORBIDDEN':'FORBIDDEN','P0002/ALLOCATION_NOT_FOUND':'NOT_FOUND',
 '0A000/ALLOCATION_UNSUPPORTED_SCHEDULE':'UNSUPPORTED_SCHEDULE','54000/ALLOCATION_LIMIT':'LIMIT_EXCEEDED',
 '40001/ALLOCATION_GENERATION_CONFLICT':'GENERATION_CONFLICT','40001/ALLOCATION_EVIDENCE_CHANGED':'EVIDENCE_CHANGED',
 'P0001/ALLOCATION_UNAVAILABLE':'UNAVAILABLE','55000/ALLOCATION_CORRUPT':'CORRUPT_STATE','55000/ALLOCATION_PROTOCOL':'PROTOCOL_ERROR',
 '57014/ALLOCATION_DEADLINE':'DEADLINE',
};
function classify(error:unknown):FailureCode{
 try { const e=error as {code?:unknown;message?:unknown};const code=String(e?.code??''),message=String(e?.message??'');
  return mapping[`${code}/${message}`]??(code==='40P01'?'DEADLOCK':code==='55P03'?'LOCK_TIMEOUT':code==='57014'?'SERVER_TIMEOUT':'INTERNAL_ERROR');
 } catch { return 'INTERNAL_ERROR'; }
}
function input(actor:unknown,request:unknown):[VerifiedPlanningOwner,PlanningAllocationRequest]{
 const a=planningRecord(actor,['mode','userId']);const r=planningRecord(request,['tenantId','bookingId','crewId','targetGeneration']);
 if(a.mode!=='verified_owner'||typeof a.userId!=='string'||!UUID.test(a.userId)||
  !['tenantId','bookingId','crewId'].every(k=>typeof r[k]==='string'&&UUID.test(r[k] as string))||
  !Number.isSafeInteger(r.targetGeneration)||Number(r.targetGeneration)<1||Number(r.targetGeneration)>Number.MAX_SAFE_INTEGER)
  throw Error('INVALID_INPUT');
 return [a as VerifiedPlanningOwner,r as PlanningAllocationRequest];
}

/** Never reports a hold as confirmed, and never automatically repeats an uncertain mutation. */
export async function allocateOwnerPlanningGroup(pool:OwnerPlanningPool,actorInput:unknown,requestInput:unknown):Promise<PlanningAllocationOutcome>{
 let actor:VerifiedPlanningOwner,request:PlanningAllocationRequest;
 try{[actor,request]=input(actorInput,requestInput);}catch{return {kind:'failed',code:'INVALID_REQUEST',transaction:'not_started',backendMayStillRun:false};}
 const started=performance.now();
 if(!Number.isFinite(started)||started<0)return {kind:'failed',code:'INTERNAL_ERROR',transaction:'not_started',backendMayStillRun:false};
 let lastSample=started;let client:OwnerPlanningClient|undefined;let released=false;let beginSent=false;let committing=false;let committed=false;let expired=false;
 const discard=()=>{if(client&&!released){released=true;try{client.release(Error('OWNER_PLANNING_CONNECTION_DISCARDED'));}catch{/* conservative result */}}};
 const elapsed=()=>{const sample=performance.now();if(!Number.isFinite(sample)||sample<lastSample)throw Error('OWNER_PLANNING_CLOCK_UNAVAILABLE');lastSample=sample;return sample-started;};
 const guard=()=>{if(expired||elapsed()>=10000)throw Error('OWNER_PLANNING_DEADLINE');};
 const work=(async():Promise<PlanningAllocationOutcome>=>{
  try{
   client=await pool.connect();guard();
   const command=async(sql:string,tag:string,values?:unknown[])=>{guard();const result=await client!.query(sql,values);guard();if(result.command!==tag)throw Error('OWNER_PLANNING_COMMAND_TAG');return result;};
   beginSent=true;await command('BEGIN ISOLATION LEVEL READ COMMITTED','BEGIN');
   for(const sql of ["SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'",'SET LOCAL ROLE service_role'])await command(sql,'SET');
   const raw=await command(SQL,'SELECT',[actor.userId,request.tenantId,request.bookingId,request.crewId,request.targetGeneration]);
   const receipt=parsePlanningReceipt(raw,request);
   await command('SET CONSTRAINTS ALL IMMEDIATE','SET');guard();
   committing=true;const commit=await client.query('COMMIT');
   if(expired||commit.command!=='COMMIT'){
    if(commit.command==='ROLLBACK'&&!expired)return {kind:'failed',code:'INTERNAL_ERROR',transaction:'rolled_back',backendMayStillRun:false};
    return {kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'};
   }
   committed=true;if(!released){released=true;try{client.release();}catch{/* commit remains committed */}}
   // Expiry can pass between the database receipt and delivery. Usability is
   // monotone: a previously false receipt can never become true here.
   const now=Date.now();if(!Number.isSafeInteger(now))return {kind:'committed',delivery:'withheld',receipt:null,reason:'CLOCK_UNAVAILABLE'};
   const usable=receipt.usable&&BigInt(now)*1000n<planningExpiryMicroseconds(receipt.expiresAt);
   return {kind:'committed',delivery:'receipt',receipt:Object.freeze({...receipt,usable})};
  }catch(error){
   if(committed)return {kind:'committed',delivery:'withheld',receipt:null,reason:'CLOCK_UNAVAILABLE'};
   if(committing)return {kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'};
   return {kind:'failed',code:expired?'DEADLINE':classify(error),transaction:beginSent?'no_commit_submitted':'not_started',backendMayStillRun:beginSent};
  }finally{discard();}
 })();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<PlanningAllocationOutcome>(resolve=>{timer=setTimeout(()=>{expired=true;discard();resolve(committed?
  {kind:'committed',delivery:'withheld',receipt:null,reason:'DEADLINE'}:committing?
  {kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'}:
  {kind:'failed',code:'DEADLINE',transaction:beginSent?'no_commit_submitted':'not_started',backendMayStillRun:beginSent});},10000);});
 return Promise.race([work,deadline]).finally(()=>{if(timer)clearTimeout(timer);});
}
