import { planningRecord, planningExpiryMicroseconds, type PlanningAllocationOutcome, type PlanningAllocationReceipt } from './planning-allocation-contracts';
import type { VerifiedPlanningOwner } from './owner-planning-allocation';

export type OwnerAllocateRequest=Readonly<{tenantId:string;bookingId:string;crewId:string;targetGeneration:number}>;
export type OwnerAllocator=(actor:VerifiedPlanningOwner,request:OwnerAllocateRequest)=>Promise<PlanningAllocationOutcome>;
export type OwnerPlanningHttpResult=Readonly<{status:number;body:Readonly<Record<string,unknown>>}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(status:number,code:string,reconciliation?:string):OwnerPlanningHttpResult=>({status,body:reconciliation?{ok:false,code,reconciliation}:{ok:false,code}});
const statuses:Record<Extract<PlanningAllocationOutcome,{kind:'failed'}>['code'],number>={
 INVALID_REQUEST:400,FORBIDDEN:403,NOT_FOUND:404,UNSUPPORTED_SCHEDULE:422,LIMIT_EXCEEDED:413,
 GENERATION_CONFLICT:409,EVIDENCE_CHANGED:409,UNAVAILABLE:409,CORRUPT_STATE:500,PROTOCOL_ERROR:500,
 DEADLINE:504,ABORTED:503,ACQUISITION_TIMEOUT:503,CONNECTION_FAILED:503,SERVER_TIMEOUT:504,
 DEADLOCK:409,LOCK_TIMEOUT:409,INTERNAL_ERROR:500,
};
function copyValidReceipt(value:unknown,request:OwnerAllocateRequest):PlanningAllocationReceipt|null{
 try{
  const r=planningRecord(value,['schemaVersion','groupId','generation','bookingId','status','usable','expiresAt','bookingState','confirmed']);
  if(r.schemaVersion!==1||typeof r.groupId!=='string'||!UUID.test(r.groupId)||r.generation!==request.targetGeneration||
   r.bookingId!==request.bookingId||!['held','released','expired'].includes(String(r.status))||typeof r.usable!=='boolean'||
   r.bookingState!=='draft'||r.confirmed!==false||typeof r.expiresAt!=='string'||(r.status!=='held'&&r.usable))return null;
  planningExpiryMicroseconds(r.expiresAt);return Object.freeze(r) as PlanningAllocationReceipt;
 }catch{return null;}
}
/** Called only after the existing owner HTTP boundary verifies bearer, origin and tenant query. */
export async function handleOwnerPlanningAllocation(method:string|undefined,actorId:unknown,tenantId:unknown,rawBody:unknown,allocate:OwnerAllocator):Promise<OwnerPlanningHttpResult>{
 if(method!=='POST')return failure(405,'METHOD_NOT_ALLOWED');
 let body:Record<string,unknown>;
 try{body=planningRecord(rawBody,['bookingId','crewId','targetGeneration']);}catch{return failure(400,'INVALID_REQUEST');}
 if(typeof actorId!=='string'||!UUID.test(actorId)||typeof tenantId!=='string'||!UUID.test(tenantId)||
  typeof body.bookingId!=='string'||!UUID.test(body.bookingId)||typeof body.crewId!=='string'||!UUID.test(body.crewId)||
  !Number.isSafeInteger(body.targetGeneration)||Number(body.targetGeneration)<1||Number(body.targetGeneration)>Number.MAX_SAFE_INTEGER)
  return failure(400,'INVALID_REQUEST');
 const request={tenantId,bookingId:body.bookingId,crewId:body.crewId,targetGeneration:body.targetGeneration as number};
 let outcome:PlanningAllocationOutcome;
 try{outcome=await allocate({mode:'verified_owner',userId:actorId},request);}catch{return failure(500,'INTERNAL_ERROR');}
 if(outcome.kind==='failed')return failure(statuses[outcome.code]??500,Object.hasOwn(statuses,outcome.code)?outcome.code:'INTERNAL_ERROR');
 if(outcome.kind==='unknown_commit')return failure(503,'COMMIT_UNCERTAIN','REAUTHORIZE_SAME_TARGET');
 if(outcome.kind!=='committed')return failure(500,'INTERNAL_ERROR');
 if(outcome.delivery==='withheld')return failure(503,'OUTCOME_UNAVAILABLE','REAUTHORIZE_SAME_TARGET');
 if(outcome.delivery!=='receipt')return failure(500,'INTERNAL_ERROR');
 const receipt=copyValidReceipt(outcome.receipt,request);
 if(!receipt)return failure(500,'INTERNAL_ERROR');
 const now=Date.now();if(!Number.isSafeInteger(now))return failure(503,'OUTCOME_UNAVAILABLE','REAUTHORIZE_SAME_TARGET');
 if(!receipt.usable||BigInt(now)*1000n>=planningExpiryMicroseconds(receipt.expiresAt))return failure(409,'HOLD_EXPIRED','REAUTHORIZE_SAME_TARGET');
 return {status:200,body:{ok:true,data:receipt}};
}
