import type {Pool} from 'pg';
import {z} from 'zod';
import {Service,Selection} from '@lumin/contracts';
import {createPricingEngine} from '@lumin/core';
import {ConfirmationInput,ConfirmationReceipt} from './confirmation';
import {FlowError} from './repository';
export const MockPaymentInput=ConfirmationInput;
export const MockPaymentReceipt=ConfirmationReceipt.extend({provider:z.literal('staging_mock'),simulated:z.literal(true)}).strict();
export type MockPaymentWriter=(actor:string,tenant:string,booking:string)=>Promise<z.infer<typeof MockPaymentReceipt>>;
/**
 * The staging mock provider currently has one intentionally narrow contract:
 * it can complete only a simple service whose price is reconstructed from
 * the tenant-scoped service row. Configurable/cart/rental selections stay
 * fail-closed until their catalog, pricing, and (for rentals) resource-hold
 * authority are available at this boundary. In particular, this seam must
 * never fall back to a client supplied total.
 */
const SimpleMockPaymentSelection=z.object({serviceId:z.string().uuid()}).strict();
export function mockPaymentsEnabled(env:Record<string,string|undefined>):boolean{
 if(env.BOOKING_LUMIN_FAKE_PAYMENTS!=='1')return false;
 if(env.BOOKING_LUMIN_ENV!=='staging')throw Error('Fake payments require explicit staging environment');
 return true;
}
/** Only fake staging evidence. Never invoke with production databases. */
export function createMockPaymentWriter(pool:Pool,env:Record<string,string|undefined>):MockPaymentWriter{
 const enabled=mockPaymentsEnabled(env);
 return async(actor,tenant,booking)=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');
  booking=MockPaymentInput.parse({bookingId:booking}).bookingId;
  const c=await pool.connect();let broken=false;
  try{
   await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query('set local role service_role');
   const member=await c.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in ('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
   if(member.rows.length!==1)throw new FlowError('FORBIDDEN');
   // Existing statement trigger acquires the policy/head prefix without touching rows.
   await c.query('update public.bookings set payment_id=payment_id where false');
   await c.query('lock table public.services,public.service_items,public.service_addons,public.service_questions,public.service_resources,public.refunds in share mode');
   // Bounded staging seam: serialize payment writers, then payment rows before booking.
   await c.query('lock table public.payments in share row exclusive mode');
   const payments=await c.query('select * from public.payments where booking_id=$1::uuid order by id for update',[booking]);
   const result=await c.query('select * from public.bookings where id=$1::uuid and tenant_id=$2::uuid for update',[booking,tenant]);
   if(result.rows.length!==1)throw new FlowError('NOT_AVAILABLE');
   const b=result.rows[0];const selection=SimpleMockPaymentSelection.safeParse(b.selection);
   if(!selection.success)throw new FlowError('UNSUPPORTED_CONFIG');
   const service=await c.query(`select s.* from public.services s where s.id=$1::uuid and s.tenant_id=$2::uuid and s.active and s.archetype='simple' and s.tax_rate_bp=0 and s.rental is null and not exists(select 1 from public.service_items where service_id=s.id) and not exists(select 1 from public.service_addons where service_id=s.id) and not exists(select 1 from public.service_questions where service_id=s.id) and not exists(select 1 from public.service_resources where service_id=s.id)`,[selection.data.serviceId,tenant]);
   if(service.rows.length!==1)throw new FlowError('UNSUPPORTED_CONFIG');
   const s=service.rows[0];
   // Keep the explicit runtime guard alongside the SQL predicate: mocked or
   // substituted adapters must not widen this staging-only authority.
   if(s.archetype!=='simple')throw new FlowError('UNSUPPORTED_CONFIG');
   const amount=Number(s.base_price);
   if(!Number.isSafeInteger(amount)||amount<=0)throw new FlowError('UNSUPPORTED_CONFIG');
   const pricing=createPricingEngine().price(Service.parse({id:s.id,tenantId:s.tenant_id,name:s.name,archetype:s.archetype,currency:s.currency,basePrice:amount,durationMinutes:s.duration_minutes}),Selection.parse({serviceId:s.id}));
   let paymentId:string;
   if(payments.rows.length){
    const p=payments.rows[0];
    if(payments.rows.length!==1||p.provider!=='staging_mock'||p.provider_intent_id!==`staging_mock:${booking}`||p.tenant_id.toLowerCase()!==tenant.toLowerCase()||p.id!==b.payment_id||p.state!=='succeeded'||Number(p.amount)!==amount||p.currency!==s.currency||b.pricing?.total?.amount!==amount||b.pricing?.total?.currency!==s.currency)throw new FlowError('CONFLICT');
    paymentId=p.id;
   }else{
    if(b.state!=='draft'||b.payment_id!==null||Object.keys(b.pricing??{}).length)throw new FlowError('CONFLICT');
    const inserted=await c.query(`insert into public.payments(tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2::uuid,'staging_mock',$3,'succeeded',$4::bigint,$5) returning id`,[tenant,booking,`staging_mock:${booking}`,amount,s.currency]);
    paymentId=z.string().uuid().parse(inserted.rows[0]?.id);
    await c.query('update public.bookings set pricing=$1::jsonb,payment_id=$2::uuid where id=$3::uuid',[JSON.stringify(pricing),paymentId,booking]);
   }
   const confirmed=await c.query('select public.confirm_succeeded_payment($1::uuid) result',[paymentId]);
   const receipt=ConfirmationReceipt.safeParse(confirmed.rows[0]?.result);
   if(!receipt.success||receipt.data.bookingId!==booking||receipt.data.paymentId!==paymentId)throw new FlowError('INTERNAL_ERROR');
   await c.query('commit');return{...receipt.data,provider:'staging_mock',simulated:true};
  }catch(error){
   try{await c.query('rollback');}catch{broken=true;}
   if(error instanceof FlowError)throw error;
   const code=(error as {code?:string})?.code;
   if(code==='42883'||code==='0A000')throw new FlowError('UNSUPPORTED_CONFIG');
   if(['40001','40P01','22023','23505'].includes(code??''))throw new FlowError('CONFLICT');
   throw new FlowError('INTERNAL_ERROR');
  }finally{c.release(broken);}
 };
}
