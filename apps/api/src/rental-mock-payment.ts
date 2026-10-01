import type {Pool} from 'pg';
import {z} from 'zod';
import {Service,Selection} from '@lumin/contracts';
import {createPricingEngine} from '@lumin/core';
import {FlowError} from './repository';
import {ConfirmationInput,ConfirmationReceipt} from './confirmation';

const Uuid=z.string().uuid().transform(value=>value.toLowerCase());
const CanonicalRentalSelection=Selection.strict().superRefine((value,ctx)=>{
  if(value.rentalPeriods===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'rentalPeriods is required'});
  if(Object.keys(value.itemQuantities).length||value.addonIds.length||Object.keys(value.answers).length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'rental selection must be canonical and empty'});
});

export type RentalMockPaymentPreflight=(actor:string,tenant:string,booking:string)=>Promise<never>;

type ServiceRow={id:string;tenant_id:string;archetype:string;name:string;description:string;currency:string;base_price:number|string;duration_minutes:number|string;tax_rate_bp:number|string;rental:unknown;active?:boolean};
type LinkRow={resource_id:string;quantity_required:number|string;resource_tenant_id:string;resource_active:boolean;resource_capacity:number|string};
type ReservationRow={resource_id:string;tenant_id:string;status:string;unexpired:boolean;required_quantity:number|string|null;reservation_quantity:number|string;resource_capacity:number|string|null};
function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}

export const RentalMockPaymentInput=ConfirmationInput;
export const RentalMockPaymentReceipt=ConfirmationReceipt.extend({provider:z.literal('staging_mock'),simulated:z.literal(true)}).strict();
export type RentalMockPaymentWriter=(actor:string,tenant:string,booking:string)=>Promise<z.infer<typeof RentalMockPaymentReceipt>>;

function fakeEnabled(env:Record<string,string|undefined>):boolean{
  if(env.BOOKING_LUMIN_FAKE_PAYMENTS!=='1')return false;
  if(env.BOOKING_LUMIN_ENV!=='staging')throw Error('Fake payments require explicit staging environment');
  return true;
}

/**
 * Narrow staging-only rental authority. It accepts no amount/provider/state
 * input: the HTTP boundary supplies only bookingId and this adapter derives
 * both charge and deposit from the tenant-owned persisted service config.
 *
 * This adapter currently performs only a pre-financial authority check. The
 * current atomic confirmation migration rejects resource-linked services, so
 * this candidate stops before payment insertion until that authority is
 * widened in a separately reviewed migration.
 */
export function createRentalMockPaymentPreflight(pool:Pool,env:Record<string,string|undefined>):RentalMockPaymentPreflight{
  const enabled=fakeEnabled(env);
  return async(actor,tenant,booking)=>{
    if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');
    const parsedBooking=Uuid.safeParse(booking);if(!parsedBooking.success)throw new FlowError('INVALID_REQUEST');booking=parsedBooking.data;
    const c=await pool.connect();let broken=false;
    try{
      await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query('set local role service_role');
      const member=await c.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in ('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
      if(member.rows.length!==1)throw new FlowError('FORBIDDEN');
      await c.query('lock table public.service_resources,public.resources,public.resource_reservations in share mode');
      const result=await c.query(`select id,tenant_id,selection,slot_start,slot_end from public.bookings where id=$1::uuid and tenant_id=$2::uuid for update`,[booking,tenant]);
      if(result.rows.length!==1)throw new FlowError('NOT_AVAILABLE');
      const b=result.rows[0] as {id:string;tenant_id:string;selection:unknown;slot_start:string;slot_end:string};
      if(b.tenant_id.toLowerCase()!==tenant.toLowerCase())throw new FlowError('FORBIDDEN');
      const selection=CanonicalRentalSelection.safeParse(b.selection);if(!selection.success)throw new FlowError('UNSUPPORTED_CONFIG');
      const serviceResult=await c.query(`select s.id,s.tenant_id,s.archetype,s.name,s.description,s.currency,s.base_price,s.duration_minutes,s.tax_rate_bp,s.rental,s.active from public.services s where s.id=$1::uuid and s.tenant_id=$2::uuid and s.active and s.archetype='rental' and s.rental is not null`,[selection.data.serviceId,tenant]);
      if(serviceResult.rows.length!==1)throw new FlowError('UNSUPPORTED_CONFIG');
      const s=serviceResult.rows[0] as ServiceRow;
      const links=(await c.query(`select sr.resource_id,sr.quantity_required,r.tenant_id resource_tenant_id,r.active resource_active,r.capacity resource_capacity from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.tenant_id=sr.tenant_id where sr.tenant_id=$1::uuid and sr.service_id=$2::uuid order by sr.resource_id`,[tenant,s.id])).rows as LinkRow[];
      if(links.length===0||links.some(x=>x.quantity_required!==1&&Number(x.quantity_required)!==1||x.resource_tenant_id.toLowerCase()!==tenant.toLowerCase()||x.resource_active!==true||Number(x.resource_capacity)<1))throw new FlowError('UNSUPPORTED_CONFIG');
      const reservations=(await c.query(`select rr.resource_id,rr.tenant_id,rr.status,(rr.expires_at>clock_timestamp()) as unexpired,sr.quantity_required as required_quantity,rr.quantity as reservation_quantity,r.capacity as resource_capacity from public.resource_reservations rr join public.bookings booked on booked.id=rr.booking_id left join public.service_resources sr on sr.resource_id=rr.resource_id and sr.service_id=$3::uuid and sr.tenant_id=$2::uuid left join public.resources r on r.id=rr.resource_id and r.tenant_id=$2::uuid where rr.booking_id=$1::uuid and rr.slot_start=booked.slot_start and rr.slot_end=booked.slot_end for update of rr`,[booking,tenant,s.id])).rows as ReservationRow[];
      const required=new Set(links.map(x=>x.resource_id.toLowerCase()));
      if(reservations.length!==required.size||reservations.some(x=>x.tenant_id.toLowerCase()!==tenant.toLowerCase()||x.status!=='held'||x.unexpired!==true||x.required_quantity===null||Number(x.required_quantity)!==Number(x.reservation_quantity)||Number(x.required_quantity)>Number(x.resource_capacity??0)||!required.has(x.resource_id.toLowerCase())))throw new FlowError('CONFLICT');
      const service=Service.parse({id:s.id,tenantId:s.tenant_id,archetype:s.archetype,name:s.name,description:s.description,currency:s.currency,basePrice:Number(s.base_price),durationMinutes:Number(s.duration_minutes),taxRateBp:Number(s.tax_rate_bp),rental:s.rental,active:true,items:[],addons:[],questions:[]});
      const pricing=createPricingEngine().price(service,selection.data);const preflightCharge=pricing.total.amount+pricing.deposit.amount;
      // Preflight-only: this amount is validated from persisted config but is
      // intentionally not written or charged while resource confirmation is
      // unsupported by the current database authority.
      if(!Number.isSafeInteger(preflightCharge)||preflightCharge<=0)throw new FlowError('UNSUPPORTED_CONFIG');
      // The current atomic confirmation migration rejects resource-linked
      // services. Do not insert a succeeded payment until that authority is
      // widened in a separately reviewed migration; this candidate remains
      // an explicit, transaction-safe staging boundary in the meantime.
      void preflightCharge;
      throw new FlowError('UNSUPPORTED_CONFIG');
    }catch(error){
      try{await c.query('rollback');}catch{broken=true;}
      if(error instanceof FlowError)throw error;
      const code=(error as {code?:string})?.code;
      if(code==='42883'||code==='0A000')throw new FlowError('UNSUPPORTED_CONFIG');
      if(code==='42501')throw new FlowError('FORBIDDEN');
      if(code==='P0002')throw new FlowError('NOT_AVAILABLE');
      if(['40001','40P01','22023','23505','P0001'].includes(code??''))throw new FlowError('CONFLICT');
      throw new FlowError('INTERNAL_ERROR');
    }finally{c.release(broken);}
  };
}

/**
 * Staging-only rental mock provider.  The request carries only bookingId;
 * service, rental periods, hold ownership and PriceBreakdown v1 are rebuilt
 * from tenant-owned rows inside one transaction.  The reviewed 0033 database
 * function is the only state-transition authority.
 */
export function createRentalMockPaymentWriter(pool:Pool,env:Record<string,string|undefined>):RentalMockPaymentWriter{
  const enabled=fakeEnabled(env);
  return async(actor,tenant,booking)=>{
    if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');
    const parsedBooking=Uuid.safeParse(booking);if(!parsedBooking.success)throw new FlowError('INVALID_REQUEST');booking=parsedBooking.data;
    const c=await pool.connect();let broken=false;
    try{
      await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query('set local role service_role');
      const member=await c.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in ('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
      if(member.rows.length!==1)throw new FlowError('FORBIDDEN');
      await c.query('lock table public.service_resources,public.resources,public.refunds in share mode');
      await c.query('lock table public.payments in share row exclusive mode');
      const payments=(await c.query('select * from public.payments where booking_id=$1::uuid order by id for update',[booking])).rows;
      const result=await c.query('select id,tenant_id,selection,pricing,payment_id,state,slot_start,slot_end from public.bookings where id=$1::uuid and tenant_id=$2::uuid for update',[booking,tenant]);
      if(result.rows.length!==1)throw new FlowError('NOT_AVAILABLE');
      const b=result.rows[0] as {id:string;tenant_id:string;selection:unknown;pricing:unknown;payment_id:string|null;state:string;slot_start:string;slot_end:string};
      if(b.tenant_id.toLowerCase()!==tenant.toLowerCase())throw new FlowError('FORBIDDEN');
      const selection=CanonicalRentalSelection.safeParse(b.selection);if(!selection.success)throw new FlowError('UNSUPPORTED_CONFIG');
      const serviceResult=await c.query(`select s.id,s.tenant_id,s.archetype,s.name,s.description,s.currency,s.base_price,s.duration_minutes,s.tax_rate_bp,s.rental,s.active from public.services s where s.id=$1::uuid and s.tenant_id=$2::uuid and s.active and s.archetype='rental' and s.rental is not null`,[selection.data.serviceId,tenant]);
      if(serviceResult.rows.length!==1)throw new FlowError('UNSUPPORTED_CONFIG');
      const s=serviceResult.rows[0] as ServiceRow;
      const links=(await c.query(`select sr.resource_id,sr.quantity_required,r.tenant_id resource_tenant_id,r.active resource_active,r.capacity resource_capacity from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.tenant_id=sr.tenant_id where sr.tenant_id=$1::uuid and sr.service_id=$2::uuid order by sr.resource_id`,[tenant,s.id])).rows as LinkRow[];
      if(links.length===0||links.some(x=>Number(x.quantity_required)!==1||x.resource_tenant_id.toLowerCase()!==tenant.toLowerCase()||x.resource_active!==true||Number(x.resource_capacity)<1))throw new FlowError('UNSUPPORTED_CONFIG');
      const reservations=(await c.query(`select rr.resource_id,rr.tenant_id,rr.status,(isfinite(rr.expires_at) and rr.expires_at>clock_timestamp()) as unexpired,sr.quantity_required as required_quantity,rr.quantity as reservation_quantity,r.capacity as resource_capacity,(rr.slot_start is not distinct from booked.slot_start and rr.slot_end is not distinct from booked.slot_end) as slot_matches from public.resource_reservations rr join public.bookings booked on booked.id=rr.booking_id left join public.service_resources sr on sr.resource_id=rr.resource_id and sr.service_id=$2::uuid and sr.tenant_id=$3::uuid left join public.resources r on r.id=rr.resource_id and r.tenant_id=$3::uuid where rr.booking_id=$1::uuid for update`,[booking,s.id,tenant])).rows as (ReservationRow & {slot_matches:boolean})[];
      const required=new Set(links.map(x=>x.resource_id.toLowerCase()));
      const expectedStatus=b.state==='confirmed'?'consumed':'held';
      if(b.state!=='draft'&&b.state!=='pending_payment'&&b.state!=='confirmed')throw new FlowError('CONFLICT');
      if(reservations.length!==required.size||reservations.some(x=>x.tenant_id.toLowerCase()!==tenant.toLowerCase()||x.status!==expectedStatus||(b.state!=='confirmed'&&x.unexpired!==true)||x.required_quantity===null||Number(x.required_quantity)!==Number(x.reservation_quantity)||Number(x.required_quantity)>Number(x.resource_capacity??0)||!required.has(x.resource_id.toLowerCase())||x.slot_matches!==true))throw new FlowError('CONFLICT');
      const service=Service.parse({id:s.id,tenantId:s.tenant_id,archetype:s.archetype,name:s.name,description:s.description,currency:s.currency,basePrice:Number(s.base_price),durationMinutes:Number(s.duration_minutes),taxRateBp:Number(s.tax_rate_bp),rental:s.rental,active:true,items:[],addons:[],questions:[]});
      const pricing=createPricingEngine().price(service,selection.data);
      const total=pricing.total.amount,deposit=pricing.deposit.amount,amount=total+deposit;
      if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(deposit)||deposit<0||!Number.isSafeInteger(amount)||amount<=0||pricing.total.currency!==s.currency||pricing.deposit.currency!==s.currency)throw new FlowError('UNSUPPORTED_CONFIG');
      let paymentId:string;
      if(payments.length){
        const p=payments[0] as {id:string;tenant_id:string;booking_id:string;provider:string;provider_intent_id:string;state:string;amount:number|string;currency:string};
        if(payments.length!==1||p.provider!=='staging_mock'||p.provider_intent_id!==`staging_mock:${booking}`||p.tenant_id.toLowerCase()!==tenant.toLowerCase()||p.booking_id.toLowerCase()!==booking||p.id!==b.payment_id||p.state!=='succeeded'||Number(p.amount)!==amount||p.currency!==s.currency||canonicalJson(b.pricing)!==canonicalJson(pricing))throw new FlowError('CONFLICT');
        paymentId=z.string().uuid().parse(p.id);
      }else{
        if(b.state!=='draft'||b.payment_id!==null||canonicalJson(b.pricing)!=='{}')throw new FlowError('CONFLICT');
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
      if(code==='42501')throw new FlowError('FORBIDDEN');
      if(code==='P0002')throw new FlowError('NOT_AVAILABLE');
      if(['40001','40P01','22023','23505','P0001'].includes(code??''))throw new FlowError('CONFLICT');
      throw new FlowError('INTERNAL_ERROR');
    }finally{c.release(broken);}
  };
}
