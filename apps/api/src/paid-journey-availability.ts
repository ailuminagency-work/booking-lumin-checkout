import type {Pool} from 'pg';
import {z} from 'zod';
import {Slot} from '@lumin/contracts';
import {FlowError,readAvailabilitySlots} from './repository';
const Instant=z.string().datetime().refine(s=>Number.isFinite(Date.parse(s))).transform(s=>new Date(s).toISOString());
export const PaidJourneyAvailabilityQuery=z.object({from:Instant,to:Instant}).strict().refine(q=>Date.parse(q.to)>Date.parse(q.from)&&Date.parse(q.to)-Date.parse(q.from)<=7*86400000,'Invalid availability window');
export type PaidJourneyAvailabilityQuery=z.infer<typeof PaidJourneyAvailabilityQuery>;
const Scope=z.object({tenantId:z.string().uuid(),serviceId:z.string().uuid(),timezone:z.string().min(1).max(100),durationMinutes:z.number().int().min(5).max(1440)}).strict();
export const PaidJourneyAvailabilityReceipt=z.object({schemaVersion:z.literal(1),serviceId:z.string().uuid(),durationMinutes:z.number().int().min(5).max(1440),slots:z.array(Slot.strict().extend({remainingCapacity:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)})).max(2016)}).strict().refine(r=>r.slots.every((s,i)=>Date.parse(s.end)-Date.parse(s.start)===r.durationMinutes*60000&&(i===0||Date.parse(r.slots[i-1]!.start)<Date.parse(s.start))),'Invalid authoritative slots');
export type PaidJourneyAvailabilityReceipt=z.infer<typeof PaidJourneyAvailabilityReceipt>;
export type PaidJourneyAvailabilityReader=(hash:string,origin:string,query:PaidJourneyAvailabilityQuery)=>Promise<PaidJourneyAvailabilityReceipt>;
/** Same existing capacity engine, pinned V8 session scope, no financial writes. */
export function createPaidJourneyAvailabilityReader(pool:Pool,clock=()=>new Date().toISOString()):PaidJourneyAvailabilityReader{
 return async(hash,origin,input)=>{
  const query=PaidJourneyAvailabilityQuery.safeParse(input);if(!query.success||!/^([0-9a-f]{64})$/.test(hash))throw new FlowError('INVALID_REQUEST');
  const c=await pool.connect();let broken=false;
  try{
   await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   const scope=Scope.parse((await c.query('select public.paid_journey_availability_scope($1,$2) scope',[hash,origin])).rows[0]?.scope);
   const computed=await readAvailabilitySlots(c,scope.tenantId,scope.serviceId,{timezone:scope.timezone,duration_minutes:scope.durationMinutes},query.data.from,query.data.to,clock);
   const result=PaidJourneyAvailabilityReceipt.parse({schemaVersion:1,...computed});
   if(result.serviceId!==scope.serviceId||result.durationMinutes!==scope.durationMinutes||result.slots.some(s=>Date.parse(s.start)<Date.parse(query.data.from)||Date.parse(s.end)>Date.parse(query.data.to)))throw new FlowError('INTERNAL_ERROR');
   const final=Scope.parse((await c.query('select public.paid_journey_availability_scope($1,$2) scope',[hash,origin])).rows[0]?.scope);
   if(final.tenantId!==scope.tenantId||final.serviceId!==scope.serviceId||final.timezone!==scope.timezone||final.durationMinutes!==scope.durationMinutes)throw new FlowError('CONFLICT');
   await c.query('commit');return result;
  }catch(error){
   try{await c.query('rollback');}catch{broken=true;}
   if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;
   throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='40001'||code==='40P01'||code==='55P03'||code==='57014'?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');
  }finally{c.release(broken);}
 };
}
