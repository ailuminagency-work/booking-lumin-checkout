import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
import {reserveBookingInTransaction} from './reservation';
const Text=(max:number)=>z.string().min(1).max(max).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(v));
const Instant=z.string().datetime().refine(v=>Number.isFinite(Date.parse(v))).transform(v=>new Date(v).toISOString());
const Id=z.string().uuid().refine(v=>v===v.toLowerCase());
export const PaidJourneyHoldInput=z.object({schemaVersion:z.literal(1),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),requestedStart:Instant,customer:z.object({name:Text(200),email:Text(254).refine(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(v))}).strict(),answers:z.object({}).strict()}).strict();
export type PaidJourneyHoldInput=z.infer<typeof PaidJourneyHoldInput>;
const Slot=z.object({start:Instant,end:Instant}).strict().refine(v=>Date.parse(v.end)>Date.parse(v.start));
const Target=z.object({tenantId:Id,sessionExpiresAt:z.string().datetime({offset:true}),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),slot:Slot}).strict();
export const PaidJourneyHoldReceipt=z.object({schemaVersion:z.literal(1),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),state:z.literal('draft'),confirmed:z.literal(false),paymentMode:z.literal('unavailable'),slot:Slot,holdId:Id,status:z.literal('active'),expiresAt:z.string().datetime({offset:true}),replayed:z.boolean()}).strict();
export type PaidJourneyHoldReceipt=z.infer<typeof PaidJourneyHoldReceipt>;
export type PaidJourneyHoldWriter=(hash:string,origin:string,input:PaidJourneyHoldInput)=>Promise<PaidJourneyHoldReceipt>;
/** Atomic dedicated request + existing capacity hold. No legacy token, payment or confirmation. */
export function createPaidJourneyHoldWriter(pool:Pool,clock=()=>new Date().toISOString()):PaidJourneyHoldWriter{return async(hash,origin,input)=>{
 const parsed=PaidJourneyHoldInput.safeParse(input);if(!parsed.success||!/^([0-9a-f]{64})$/.test(hash))throw new FlowError('INVALID_REQUEST');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('begin isolation level read committed');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
  const b=parsed.data;
  const accepted=z.object({...Target.shape,replayed:z.boolean()}).strict().parse((await c.query('select public.submit_paid_journey_hold_request($1,$2,$3,$4::jsonb,$5::jsonb,$6::timestamptz) result',[hash,origin,b.idempotencyKey,JSON.stringify(b.customer),JSON.stringify(b.answers),b.requestedStart])).rows[0]?.result);
  const {replayed,...target}=accepted;if(target.slot.start!==b.requestedStart||Date.parse(target.sessionExpiresAt)<=Date.parse(clock()))throw new FlowError('FORBIDDEN');
  await c.query('lock table public.services,public.availability_rules,public.availability_overrides,public.scheduling_policies in share mode');
  const old=(await c.query('select status,expires_at from public.capacity_holds where booking_id=$1::uuid',[target.bookingId])).rows[0];
  // Never reactivate or replace an expired/released/missing replay hold.
  if((replayed&&!old)||(old&&(old.status!=='active'||new Date(old.expires_at).getTime()<=Date.parse(clock()))))throw new FlowError('CONFLICT');
  const hold=await reserveBookingInTransaction(c,target.tenantId,target.bookingId,clock,target.serviceId);
  const final=Target.parse((await c.query('select public.paid_journey_hold_target($1,$2) result',[hash,origin])).rows[0]?.result);
  if(!isDeepStrictEqual(final,target)||Date.parse(final.sessionExpiresAt)<=Date.parse(clock())||Date.parse(hold.expiresAt)<=Date.parse(clock()))throw new FlowError('FORBIDDEN');
  const {tenantId:_tenant,sessionExpiresAt:_expiry,...publicTarget}=target;
  const receipt=PaidJourneyHoldReceipt.parse({schemaVersion:1,...publicTarget,...hold,state:'draft',confirmed:false,paymentMode:'unavailable',replayed});
  await c.query('commit');return receipt;
 }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['40001','40P01','55P03','57014','23505','23P01'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}
 finally{c.release(broken);}
};}
