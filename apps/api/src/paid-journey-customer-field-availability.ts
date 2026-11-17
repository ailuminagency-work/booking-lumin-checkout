import type {Pool} from 'pg';
import {z} from 'zod';
import {Slot} from '@lumin/contracts';
import {FlowError,readAvailabilitySlots} from './repository';
import {paidJourneyCustomerFieldSessionExpiryValid} from './paid-journey-customer-field-session';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!value.includes('*');}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length);
const Instant=z.string().max(40).datetime().refine(value=>Number.isFinite(Date.parse(value))).transform(value=>new Date(value).toISOString());
export const PaidJourneyCustomerFieldAvailabilityQuery=z.object({from:Instant,to:Instant}).strict().refine(value=>Date.parse(value.to)>Date.parse(value.from)&&Date.parse(value.to)-Date.parse(value.from)<=7*86400000);
export type PaidJourneyCustomerFieldAvailabilityQuery=z.infer<typeof PaidJourneyCustomerFieldAvailabilityQuery>;
const Scope=z.object({schemaVersion:z.literal(2),tenantId:Uuid,flowId:Uuid,versionId:Uuid,installationId:Uuid,serviceId:Uuid,publicationGeneration:z.number().int().positive().safe(),expiresAt:z.string().max(40).datetime({offset:true}),timezone:z.string().min(1).max(100),durationMinutes:z.number().int().min(5).max(1440)}).strict();
export const PaidJourneyCustomerFieldAvailabilityReceipt=z.object({schemaVersion:z.literal(2),installationId:Uuid,versionId:Uuid,serviceId:Uuid,durationMinutes:z.number().int().min(5).max(1440),slots:z.array(Slot.strict().extend({start:z.string().max(40).datetime(),end:z.string().max(40).datetime(),remainingCapacity:z.number().int().min(1).safe()})).max(2016)}).strict().refine(value=>value.slots.every((slot,index)=>Date.parse(slot.end)-Date.parse(slot.start)===value.durationMinutes*60000&&(index===0||Date.parse(value.slots[index-1]!.start)<Date.parse(slot.start))));
type ParsedReceipt=z.infer<typeof PaidJourneyCustomerFieldAvailabilityReceipt>;
export type PaidJourneyCustomerFieldAvailabilityReceipt=Readonly<Omit<ParsedReceipt,"slots">>&{readonly slots:readonly Readonly<ParsedReceipt["slots"][number]>[]};
export type PaidJourneyCustomerFieldAvailabilityReader=(hash:string,origin:string,query:PaidJourneyCustomerFieldAvailabilityQuery)=>Promise<PaidJourneyCustomerFieldAvailabilityReceipt>;
function failure(error:unknown){if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Existing capacity engine with a private current V9 session scope, never a reservation. */
export function createPaidJourneyCustomerFieldAvailabilityReader(pool:Pool,options:{configuredCustomerOrigins:readonly string[]},clock=()=>new Date().toISOString()):PaidJourneyCustomerFieldAvailabilityReader{
 const approved=Origins.parse([...options.configuredCustomerOrigins]);
 return async(hash,origin,input)=>{
  const query=PaidJourneyCustomerFieldAvailabilityQuery.safeParse(input);
  if(!query.success||typeof hash!=='string'||! /^[0-9a-f]{64}$/.test(hash)||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');
  if(!approved.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const scope=async()=>{const result=await client.query('select public.paid_journey_customer_field_availability_scope($1,$2) scope',[hash,origin]);const value=Scope.safeParse(result.rows[0]?.scope);if(result.rows.length!==1||!value.success||!paidJourneyCustomerFieldSessionExpiryValid(value.data,Date.now()))throw new FlowError('INTERNAL_ERROR');return value.data;};
   const before=await scope();
   const computed=await readAvailabilitySlots(client,before.tenantId,before.serviceId,{timezone:before.timezone,duration_minutes:before.durationMinutes},query.data.from,query.data.to,clock);
   const result=PaidJourneyCustomerFieldAvailabilityReceipt.parse({schemaVersion:2,installationId:before.installationId,versionId:before.versionId,...computed});
   if(result.serviceId!==before.serviceId||result.durationMinutes!==before.durationMinutes||result.slots.some(slot=>Date.parse(slot.start)<Date.parse(query.data.from)||Date.parse(slot.end)>Date.parse(query.data.to)))throw new FlowError('INTERNAL_ERROR');
   const after=await scope();if(JSON.stringify(before)!==JSON.stringify(after))throw new FlowError('CONFLICT');
   await client.query('commit');return Object.freeze({...result,slots:Object.freeze(result.slots.map(slot=>Object.freeze(slot)))});
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}
