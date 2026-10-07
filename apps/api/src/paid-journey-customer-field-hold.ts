import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {z} from 'zod';
import {ConditionalCustomerFieldAnswers} from '@lumin/contracts';
import {PaidJourneyCustomerFieldRender,validatePaidJourneyCustomerFieldAnswers} from '@lumin/workflow';
import {FlowError} from './repository';
import {reserveBookingInTransaction} from './reservation';
const Id=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!value.includes('*');}catch{return false;}});
const Instant=z.string().max(40).datetime().refine(value=>Number.isFinite(Date.parse(value))).transform(value=>new Date(value).toISOString());
const Text=(max:number)=>z.string().min(1).max(max).refine(value=>value===value.trim()&&!/[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value));
const DataOnly=z.custom<unknown>(input=>{const seen=new Set<object>();let count=0;const visit=(value:unknown,depth:number):boolean=>{if(++count>2048||depth>16)return false;if(value===null||typeof value==='string'||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);if(!value||typeof value!=='object'||Array.isArray(value)||seen.has(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;seen.add(value);for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value')||!visit(descriptor.value,depth+1))return false;}seen.delete(value);return true;};return visit(input,0)&&new TextEncoder().encode(JSON.stringify(input)).length<=32768;});
export const PaidJourneyCustomerFieldHoldInput=DataOnly.pipe(z.object({schemaVersion:z.literal(2),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),requestedStart:Instant,customer:z.object({name:Text(200),email:Text(254).refine(value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))}).strict(),answers:ConditionalCustomerFieldAnswers}).strict());
export type PaidJourneyCustomerFieldHoldInput=z.infer<typeof PaidJourneyCustomerFieldHoldInput>;
const Slot=z.object({start:Instant,end:Instant}).strict().refine(value=>Date.parse(value.end)>Date.parse(value.start));
const Target=z.object({tenantId:Id,sessionExpiresAt:z.string().max(40).datetime({offset:true}),publicationGeneration:z.number().int().positive().safe(),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),slot:Slot,render:PaidJourneyCustomerFieldRender}).strict().refine(value=>value.render.versionId===value.versionId&&value.render.service.id===value.serviceId&&Date.parse(value.slot.end)-Date.parse(value.slot.start)===value.render.service.durationMinutes*60000&&value.reference==='LMN-'+value.bookingId.replaceAll('-','').toUpperCase());
export const PaidJourneyCustomerFieldHoldReceipt=z.object({schemaVersion:z.literal(2),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),state:z.literal('draft'),confirmed:z.literal(false),paymentMode:z.literal('unavailable'),slot:Slot,holdId:Id,status:z.literal('active'),expiresAt:z.string().max(40).datetime({offset:true}),replayed:z.boolean()}).strict().refine(value=>value.reference==='LMN-'+value.bookingId.replaceAll('-','').toUpperCase());
type ParsedReceipt=z.infer<typeof PaidJourneyCustomerFieldHoldReceipt>;
export type PaidJourneyCustomerFieldHoldReceipt=Readonly<Omit<ParsedReceipt,'slot'>>&{readonly slot:Readonly<ParsedReceipt['slot']>};
export type PaidJourneyCustomerFieldHoldWriter=(hash:string,origin:string,input:PaidJourneyCustomerFieldHoldInput)=>Promise<PaidJourneyCustomerFieldHoldReceipt>;
function failure(error:unknown){if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['40001','40P01','55P03','57014','23505','23P01'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}
/** Dedicated immutable V9 request plus original atomic capacity hold; no payment/confirmation writer. */
export function createPaidJourneyCustomerFieldHoldWriter(pool:Pool,options:{configuredCustomerOrigins:readonly string[]},clock=()=>new Date().toISOString()):PaidJourneyCustomerFieldHoldWriter{
 const approved=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length).parse([...options.configuredCustomerOrigins]);
 return async(hash,origin,input)=>{
  const parsed=PaidJourneyCustomerFieldHoldInput.safeParse(input);if(!parsed.success||typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash)||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');if(!approved.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin isolation level read committed');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const body=parsed.data,result=await client.query('select public.submit_paid_journey_customer_field_hold_request($1,$2,$3,$4::jsonb,$5::jsonb,$6::timestamptz) result',[hash,origin,body.idempotencyKey,JSON.stringify(body.customer),JSON.stringify(body.answers),body.requestedStart]);
   const row=result.rows[0]?.result;if(result.rows.length!==1||!row||typeof row!=='object'||typeof row.replayed!=='boolean')throw new FlowError('INTERNAL_ERROR');const {replayed,...raw}=row,target=Target.parse(raw);
   if(Date.parse(target.sessionExpiresAt)>Date.parse(clock())+901000)throw new FlowError('INTERNAL_ERROR');if(target.slot.start!==body.requestedStart||Date.parse(target.sessionExpiresAt)<=Date.parse(clock()))throw new FlowError('FORBIDDEN');
   try{validatePaidJourneyCustomerFieldAnswers(target.render,body.answers);}catch{throw new FlowError('INVALID_REQUEST');}
   const old=(await client.query('select status,expires_at from public.capacity_holds where booking_id=$1::uuid',[target.bookingId])).rows[0];
   if(replayed&&!old||old&&(old.status!=='active'||new Date(old.expires_at).getTime()<=Date.parse(clock())))throw new FlowError('CONFLICT');
   const hold=await reserveBookingInTransaction(client,target.tenantId,target.bookingId,clock,target.serviceId);
   const finalRows=await client.query('select public.paid_journey_customer_field_hold_target($1,$2) result',[hash,origin]);if(finalRows.rows.length!==1)throw new FlowError('INTERNAL_ERROR');const final=Target.parse(finalRows.rows[0]?.result);
   if(!isDeepStrictEqual(final,target)||Date.parse(final.sessionExpiresAt)<=Date.parse(clock()))throw new FlowError('FORBIDDEN');if(hold.bookingId!==target.bookingId||Date.parse(hold.expiresAt)<=Date.parse(clock())||Date.parse(hold.expiresAt)>Date.parse(clock())+301000)throw new FlowError('INTERNAL_ERROR');
   const {tenantId:_tenant,sessionExpiresAt:_expiry,publicationGeneration:_generation,render:_render,...publicTarget}=target;
   const receipt=PaidJourneyCustomerFieldHoldReceipt.parse({schemaVersion:2,...publicTarget,...hold,state:'draft',confirmed:false,paymentMode:'unavailable',replayed});
   await client.query('commit');return Object.freeze({...receipt,slot:Object.freeze({...receipt.slot})});
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}