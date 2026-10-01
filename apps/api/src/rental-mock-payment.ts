import type {Pool} from 'pg';
import {z} from 'zod';
import {Service,Selection} from '@lumin/contracts';
import {createPricingEngine} from '@lumin/core';
import {ConfirmationReceipt} from './confirmation';
import {FlowError} from './repository';

const Uuid=z.string().uuid().transform(value=>value.toLowerCase());
const CanonicalRentalSelection=Selection.strict().superRefine((value,ctx)=>{
  if(value.rentalPeriods===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,message:'rentalPeriods is required'});
  if(Object.keys(value.itemQuantities).length||value.addonIds.length||Object.keys(value.answers).length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'rental selection must be canonical and empty'});
});

export const RentalMockPaymentReceipt=ConfirmationReceipt.extend({
  provider:z.literal('staging_mock'),
  simulated:z.literal(true),
}).strict();
export type RentalMockPaymentReceipt=z.infer<typeof RentalMockPaymentReceipt>;
export type RentalMockPaymentWriter=(actor:string,tenant:string,booking:string)=>Promise<RentalMockPaymentReceipt>;

type ServiceRow={id:string;tenant_id:string;archetype:string;name:string;description:string;currency:string;base_price:number|string;duration_minutes:number|string;tax_rate_bp:number|string;rental:unknown;active?:boolean};
type LinkRow={resource_id:string;quantity_required:number|string;resource_tenant_id:string;resource_active:boolean;resource_capacity:number|string};
type ReservationRow={resource_id:string;tenant_id:string;status:string;expires_at:string;unexpired:boolean;slot_start:string;slot_end:string};

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
 * This adapter deliberately invokes the existing atomic confirmation RPC only
 * after the succeeded payment row exists. The current RPC may reject resource
 * linked services while that database authority is being promoted; that error
 * is mapped to UNSUPPORTED_CONFIG and the transaction rolls back.
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
      await c.query('lock table public.service_resources,public.resources,public.resource_reservations in share mode');
      await c.query('lock table public.payments in share row exclusive mode');
      const result=await c.query(`select id,tenant_id,selection,pricing,payment_id,state,slot_start,slot_end from public.bookings where id=$1::uuid and tenant_id=$2::uuid for update`,[booking,tenant]);
      if(result.rows.length!==1)throw new FlowError('NOT_AVAILABLE');
      const b=result.rows[0] as {id:string;tenant_id:string;selection:unknown;pricing:unknown;payment_id:string|null;state:string;slot_start:string;slot_end:string};
      if(b.tenant_id.toLowerCase()!==tenant.toLowerCase())throw new FlowError('FORBIDDEN');
      const selection=CanonicalRentalSelection.safeParse(b.selection);if(!selection.success)throw new FlowError('UNSUPPORTED_CONFIG');
      const serviceResult=await c.query(`select s.id,s.tenant_id,s.archetype,s.name,s.description,s.currency,s.base_price,s.duration_minutes,s.tax_rate_bp,s.rental,s.active from public.services s where s.id=$1::uuid and s.tenant_id=$2::uuid and s.active and s.archetype='rental' and s.rental is not null`,[selection.data.serviceId,tenant]);
      if(serviceResult.rows.length!==1)throw new FlowError('UNSUPPORTED_CONFIG');
      const s=serviceResult.rows[0] as ServiceRow;
      const links=(await c.query(`select sr.resource_id,sr.quantity_required,r.tenant_id resource_tenant_id,r.active resource_active,r.capacity resource_capacity from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.tenant_id=sr.tenant_id where sr.tenant_id=$1::uuid and sr.service_id=$2::uuid order by sr.resource_id`,[tenant,s.id])).rows as LinkRow[];
      if(links.length===0||links.some(x=>x.quantity_required!==1&&Number(x.quantity_required)!==1||x.resource_tenant_id.toLowerCase()!==tenant.toLowerCase()||x.resource_active!==true||Number(x.resource_capacity)<1))throw new FlowError('UNSUPPORTED_CONFIG');
      const reservations=(await c.query(`select resource_id,tenant_id,status,expires_at,(expires_at>clock_timestamp()) as unexpired,slot_start,slot_end from public.resource_reservations where booking_id=$1::uuid for update`,[booking])).rows as ReservationRow[];
      const required=new Set(links.map(x=>x.resource_id.toLowerCase()));
      if(reservations.length!==required.size||reservations.some(x=>x.tenant_id.toLowerCase()!==tenant.toLowerCase()||x.status!=='held'||x.unexpired!==true||new Date(x.slot_start).getTime()!==new Date(b.slot_start).getTime()||new Date(x.slot_end).getTime()!==new Date(b.slot_end).getTime()||!required.has(x.resource_id.toLowerCase())))throw new FlowError('CONFLICT');
      const service=Service.parse({id:s.id,tenantId:s.tenant_id,archetype:s.archetype,name:s.name,description:s.description,currency:s.currency,basePrice:Number(s.base_price),durationMinutes:Number(s.duration_minutes),taxRateBp:Number(s.tax_rate_bp),rental:s.rental,active:true,items:[],addons:[],questions:[]});
      const pricing=createPricingEngine().price(service,selection.data);const total=pricing.total.amount+pricing.deposit.amount;
      if(!Number.isSafeInteger(total)||total<=0)throw new FlowError('UNSUPPORTED_CONFIG');
      // The current atomic confirmation migration rejects resource-linked
      // services. Do not insert a succeeded payment until that authority is
      // widened in a separately reviewed migration; this candidate remains
      // an explicit, transaction-safe staging boundary in the meantime.
      void pricing;
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
