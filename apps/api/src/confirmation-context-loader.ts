import type {Pool,PoolClient} from 'pg';
import {Money,NotificationContext,type NotificationChannel} from '@lumin/contracts';
import {NotificationPlannerReceipt} from './notification-planner-config.js';

export interface ConfirmationContextBinding {
  // Trusted server adapter selection; never request-supplied recipients/config.
  tenantId:string;connectionId:string;providerName:string;supportedChannels:readonly NotificationChannel[];
}
export class ConfirmationContextError extends Error {
  constructor(readonly code:'INVALID_BINDING'|'NOT_AVAILABLE'|'CONFIG_NOT_READY'|'UNAVAILABLE'){super(`CONFIRMATION_CONTEXT_${code}`);}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function deny(code:ConfirmationContextError['code']):never{throw new ConfirmationContextError(code);}
function bind(binding:ConfirmationContextBinding,tenant:string,booking:string){
  if(!uuid.test(binding.tenantId)||!uuid.test(binding.connectionId)||!uuid.test(booking)||tenant!==binding.tenantId||
    !binding.providerName.trim()||!binding.supportedChannels.length||binding.supportedChannels.some(channel=>channel!=='email'&&channel!=='sms'))deny('INVALID_BINDING');
}
export function validateConfirmationContextSnapshot(value:unknown,binding:ConfirmationContextBinding,bookingId:string){
  bind(binding,binding.tenantId,bookingId);
  if(!object(value)||!object(value.tenant)||!object(value.booking)||!object(value.customer)||!object(value.service)||!object(value.connection))deny('NOT_AVAILABLE');
  const {tenant,booking,customer,service,connection,planner}=value;
  if(tenant.id!==binding.tenantId||tenant.status!=='active'||typeof tenant.name!=='string'||!tenant.name.trim()||typeof tenant.timezone!=='string'||
    booking.id!==bookingId||booking.tenantId!==binding.tenantId||booking.state!=='confirmed'||
    customer.tenantId!==binding.tenantId||customer.id!==booking.customerId||typeof customer.id!=='string'||!uuid.test(customer.id)||
    service.tenantId!==binding.tenantId||service.id!==booking.serviceId||typeof service.id!=='string'||!uuid.test(service.id)||service.active!==true)deny('NOT_AVAILABLE');
  if(connection.id!==binding.connectionId||connection.tenantId!==binding.tenantId||connection.provider!==binding.providerName||connection.status!=='connected')deny('CONFIG_NOT_READY');
  // Canonical planner data comes only from the service-only runtime getter.
  // Missing/malformed envelopes never fall back to provider configuration.
  const receipt=NotificationPlannerReceipt.safeParse(planner);
  if(!receipt.success||receipt.data.tenantId!==binding.tenantId||receipt.data.config.timezone!==tenant.timezone)deny('CONFIG_NOT_READY');
  const config=receipt.data.config;
  try{
    Intl.getCanonicalLocales(config.locale);
    new Intl.DateTimeFormat(config.locale,{timeZone:config.timezone});
    for(const template of config.templates)Intl.getCanonicalLocales(template.locale);
  }catch{deny('CONFIG_NOT_READY');}
  const policies=config.events.filter(policy=>policy.event==='booking.confirmed');
  if(policies.length!==1||new Set(policies[0]!.channels).size!==policies[0]!.channels.length)deny('CONFIG_NOT_READY');
  for(const channel of policies[0]!.channels){
    if(!binding.supportedChannels.includes(channel)||!config.templates.some(template=>template.trigger==='booking.confirmed'&&template.channel===channel))deny('CONFIG_NOT_READY');
    if(channel==='email'&&(!config.sender.emailFrom||!config.sender.emailFrom.trim()))deny('CONFIG_NOT_READY');
    if(channel==='sms'&&(!config.sender.smsFrom||!/^\+[1-9]\d{6,14}$/.test(config.sender.smsFrom)))deny('CONFIG_NOT_READY');
  }
  const total=Money.strict().safeParse(booking.total);
  if(!total.success||!Number.isSafeInteger(total.data.amount)||total.data.amount<0||total.data.currency!==service.currency)deny('NOT_AVAILABLE');
  const phone=customer.phone===null||customer.phone===undefined?undefined:customer.phone;
  if(phone!==undefined&&(typeof phone!=='string'||!/^\+[1-9]\d{6,14}$/.test(phone)))deny('NOT_AVAILABLE');
  if(policies[0]!.channels.includes('sms')&&phone===undefined)deny('NOT_AVAILABLE');
  const context=NotificationContext.safeParse({tenant:{id:tenant.id,name:tenant.name},booking:{
    id:booking.id,reference:booking.reference,state:booking.state,slotStart:booking.slotStart,slotEnd:booking.slotEnd,
    customerName:customer.name,customerEmail:customer.email,...(phone===undefined?{}:{customerPhone:phone}),total:total.data,
  }});
  if(!context.success||!context.data.booking.customerName.trim()||Date.parse(context.data.booking.slotEnd)<=Date.parse(context.data.booking.slotStart))deny('NOT_AVAILABLE');
  return {bookingTenantId:binding.tenantId,context:context.data,config:config};
}

// Existing 0007 service-role SELECT grants permit this fixed joined projection.
// No settings/secrets, raw errors or customer-submitted recipient overrides are
// read. No production configuration or connection is created/enabled here.
const query=`select jsonb_build_object(
 'tenant',jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'timezone',t.timezone),
 'booking',jsonb_build_object('id',b.id,'tenantId',b.tenant_id,'state',b.state,'reference',b.reference,'customerId',b.customer_id,
   'serviceId',b.selection->>'serviceId','slotStart',to_char(b.slot_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'slotEnd',to_char(b.slot_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'total',b.pricing->'total'),
 'customer',jsonb_build_object('id',c.id,'tenantId',c.tenant_id,'name',c.name,'email',c.email,'phone',c.phone),
 'service',jsonb_build_object('id',s.id,'tenantId',s.tenant_id,'active',s.active,'currency',s.currency),
 'connection',jsonb_build_object('id',n.id,'tenantId',n.tenant_id,'provider',n.provider,'status',n.status),
 'planner',public.runtime_notification_planner_config(b.tenant_id)
 ) result from public.bookings b
 join public.tenants t on t.id=b.tenant_id
 join public.customers c on c.id=b.customer_id and c.tenant_id=b.tenant_id
 join public.services s on s.id::text=b.selection->>'serviceId' and s.tenant_id=b.tenant_id
 join public.notification_connections n on n.tenant_id=b.tenant_id and n.id=$3::uuid
 where b.tenant_id=$1::uuid and b.id=$2::uuid and t.status='active'`;

export function createConfirmationContextLoader(pool:Pool,binding:ConfirmationContextBinding){
  const trusted={...binding,supportedChannels:[...binding.supportedChannels]};
  bind(trusted,trusted.tenantId,'00000000-0000-0000-0000-000000000000');
  return async(tenantId:string,bookingId:string)=>{
    bind(trusted,tenantId,bookingId);
    let client:PoolClient|undefined;let broken=false;
    try{
      client=await pool.connect();await client.query('begin isolation level repeatable read read only');
      await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      const result=await client.query(query,[trusted.tenantId,bookingId,trusted.connectionId]);
      if(result.rows.length!==1)deny('NOT_AVAILABLE');
      const loaded=validateConfirmationContextSnapshot(result.rows[0]?.result,trusted,bookingId);
      await client.query('commit');return loaded;
    }catch(error){
      try{await client?.query('rollback');}catch{broken=true;}
      if(error instanceof ConfirmationContextError)throw error;
      throw new ConfirmationContextError('UNAVAILABLE');
    }finally{client?.release(broken);}
  };
}
