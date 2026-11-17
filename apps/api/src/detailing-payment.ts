import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {DetailingRequestReceipt,DetailingOfferReceipt,DetailingSchedulingReceipt,PublishDetailingDraft,buildDetailingService} from '@lumin/contracts';
import {DetailingCatalogRender} from '@lumin/workflow';
import {MockPaymentReceipt,mockPaymentsEnabled,stagingMockEvidenceInTransaction} from './mock-payment';
import {ConfirmationReceipt} from './confirmation';
import {FlowError} from './repository';
export const DetailingPaymentReceipt=MockPaymentReceipt.extend({schemaVersion:z.literal(1),versionId:z.string().uuid(),installationId:z.string().uuid(),serviceId:z.string().uuid()}).strict();
export type DetailingPaymentReceipt=z.infer<typeof DetailingPaymentReceipt>;
const ReadinessIdentity=z.object({schemaVersion:z.literal(1),versionId:z.string().uuid(),installationId:z.string().uuid(),serviceId:z.string().uuid(),bookingId:z.string().uuid(),provider:z.literal('staging_mock'),simulated:z.literal(true)}).strict();
export const DetailingPaymentReadiness=z.discriminatedUnion('state',[
 ReadinessIdentity.extend({state:z.literal('draft'),canPay:z.literal(true),canConfirm:z.literal(false)}).strict(),
 ReadinessIdentity.extend({state:z.literal('confirmed'),canPay:z.literal(false),canConfirm:z.literal(true)}).strict()
]);
export type DetailingPaymentReadiness=z.infer<typeof DetailingPaymentReadiness>;
const Context=z.object({service:DetailingOfferReceipt.innerType().shape.service,catalog:DetailingCatalogRender.shape.catalog,scheduling:DetailingSchedulingReceipt,render:DetailingCatalogRender,installationId:z.string().uuid(),expiresAt:z.string().datetime({offset:true})}).strict();
const Target=z.object({context:Context,receipt:DetailingRequestReceipt,booking:z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),state:z.enum(['draft','confirmed']),payment_id:z.string().uuid().nullable(),pricing:DetailingRequestReceipt.innerType().shape.pricing}).strict(),payments:z.array(z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),provider:z.literal('staging_mock'),provider_intent_id:z.string(),state:z.literal('succeeded'),amount:z.union([z.string().regex(/^\d+$/),z.number().int().safe().positive()]),currency:z.string()}).strict()).max(1)}).strict();
export interface DetailingPaymentApi{readiness(hash:string,origin:string):Promise<DetailingPaymentReadiness>;mockPayment(hash:string,origin:string):Promise<DetailingPaymentReceipt>;confirm(hash:string,origin:string):Promise<DetailingPaymentReceipt>;}
export function createDetailingPaymentApi(pool:Pool,approvedInput:readonly string[],env:Record<string,string|undefined>,clock=()=>Date.now()):DetailingPaymentApi{
 const enabled=mockPaymentsEnabled(env)&&env.BOOKING_LUMIN_ENV==='staging'&&env.BOOKING_LUMIN_DETAILING_PUBLICATION==='1',approved=PublishDetailingDraft.shape.allowedOrigins.parse([...approvedInput]);
 const target=async(c:PoolClient,hash:string,origin:string)=>{const value=Target.safeParse((await c.query('select public.detailing_payment_target($1::text,$2::text,$3::jsonb) result',[hash,origin,JSON.stringify(approved)])).rows[0]?.result);if(!value.success)throw new FlowError('INTERNAL_ERROR');const t=value.data,r=t.receipt,x=t.context;
  if(Date.parse(x.expiresAt)<=clock())throw new FlowError('FORBIDDEN');
  if(r.versionId!==x.render.versionId||r.installationId!==x.installationId||r.serviceId!==x.service.id||r.bookingId!==t.booking.id||t.booking.tenant_id!==x.service.tenantId||x.scheduling.tenantId!==x.service.tenantId||x.scheduling.serviceId!==x.service.id||x.render.serviceId!==x.service.id||!isDeepStrictEqual(x.catalog,x.render.catalog)||!isDeepStrictEqual(buildDetailingService(x.service.id,x.service.tenantId,{...x.catalog,idempotencyKey:'catalog-validation-0001'}),x.service)||!isDeepStrictEqual(r.pricing,t.booking.pricing)||r.pricing.total.amount<=0)throw new FlowError('CONFLICT');
  if(t.booking.state==='draft'&&(t.booking.payment_id!==null||t.payments.length))throw new FlowError('CONFLICT');
  if(t.booking.state==='confirmed'){const p=t.payments[0];if(!p||p.id!==t.booking.payment_id||p.tenant_id!==t.booking.tenant_id||p.provider_intent_id!==`staging_mock:${r.bookingId}`||Number(p.amount)!==r.pricing.total.amount||p.currency!==r.pricing.total.currency)throw new FlowError('CONFLICT');}return t;
 };
 const run=async(hash:string,origin:string,makePayment:boolean)=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');if(!/^[0-9a-f]{64}$/.test(hash)||!approved.includes(origin))throw new FlowError('INVALID_REQUEST');
  const c=await pool.connect();let broken=false;try{await c.query('begin isolation level read committed');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   const before=await target(c,hash,origin);let confirmed;
   if(makePayment)confirmed=await stagingMockEvidenceInTransaction(c,before.booking.tenant_id,before.booking.id,before.booking,before.payments,before.receipt.pricing,true);
   else{if(!before.booking.payment_id)throw new FlowError('UNSUPPORTED_CONFIG');const parsed=ConfirmationReceipt.safeParse((await c.query('select public.confirm_succeeded_payment($1::uuid) result',[before.booking.payment_id])).rows[0]?.result);if(!parsed.success)throw new FlowError('INTERNAL_ERROR');confirmed={...parsed.data,provider:'staging_mock' as const,simulated:true as const};}
   const after=await target(c,hash,origin);if(!isDeepStrictEqual(before.context,after.context)||!isDeepStrictEqual(before.receipt,after.receipt)||after.booking.state!=='confirmed'||confirmed.bookingId!==after.booking.id||confirmed.paymentId!==after.booking.payment_id)throw new FlowError('CONFLICT');
   const receipt=DetailingPaymentReceipt.parse({...confirmed,schemaVersion:1,versionId:after.receipt.versionId,installationId:after.receipt.installationId,serviceId:after.receipt.serviceId});await c.query('commit');return receipt;
  }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','23505','22023'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{c.release(broken);}
 };
 // Read-only capability evidence. Locks serialize provenance; no payment/confirmation tail runs.
 const readiness=async(hash:string,origin:string):Promise<DetailingPaymentReadiness>=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');if(!/^[0-9a-f]{64}$/.test(hash)||!approved.includes(origin))throw new FlowError('INVALID_REQUEST');
  const c=await pool.connect();let broken=false;try{await c.query('begin isolation level read committed');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   const before=await target(c,hash,origin),after=await target(c,hash,origin);if(!isDeepStrictEqual(before,after))throw new FlowError('CONFLICT');
   const r=after.receipt,state=after.booking.state;const receipt=DetailingPaymentReadiness.parse({schemaVersion:1,versionId:r.versionId,installationId:r.installationId,serviceId:r.serviceId,bookingId:r.bookingId,provider:'staging_mock',simulated:true,state,canPay:state==='draft',canConfirm:state==='confirmed'});await c.query('commit');return receipt;
  }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','23505','22023'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{c.release(broken);}
 };
 return{readiness,mockPayment:(h,o)=>run(h,o,true),confirm:(h,o)=>run(h,o,false)};
}
