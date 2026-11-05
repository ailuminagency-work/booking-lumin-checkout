import type { Pool,PoolClient } from 'pg';
import { z } from 'zod';
import { createAvailabilityEngine } from '@lumin/core';
import type { AvailabilityRule,AvailabilityOverride,SchedulingPolicy } from '@lumin/contracts';
import { FlowError } from './repository';

export const HoldInput=z.object({bookingId:z.string().uuid()}).strict();
export const HoldReceipt=z.object({bookingId:z.string().uuid(),holdId:z.string().uuid(),status:z.literal('active'),expiresAt:z.string().datetime({offset:true})}).strict();
export type ReservationWriter=(actor:string,tenant:string,booking:string)=>Promise<z.infer<typeof HoldReceipt>>;
/** Existing RPC owns atomic capacity accounting. No caller-controlled capacity or TTL. */
export function createReservationWriter(pool:Pool,clock=()=>new Date().toISOString()):ReservationWriter{return async(actor,tenant,booking)=>{
 const client=await pool.connect();let broken=false;
 try{
  await client.query('begin isolation level read committed');
  await client.query("set local statement_timeout='5s'");
  await client.query("set local lock_timeout='5s'");
  // Same early policy fence as the planning boundary; immutable scheduling snapshot.
  await client.query('lock table public.allocation_policies in share mode');
  await client.query('lock table public.service_resources,public.services,public.availability_rules,public.availability_overrides,public.scheduling_policies in share mode');
  await client.query('set local role service_role');
  const membership=await client.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
  if(!membership.rows.length)throw new FlowError('FORBIDDEN');
  const receipt=await reserveBookingInTransaction(client,tenant,booking,clock);
  await client.query('commit');return receipt;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='0A000'?'UNSUPPORTED_CONFIG':code==='40001'||code==='40P01'||code==='55P03'||code==='23P01'?'CONFLICT':'INTERNAL_ERROR');}
 finally{client.release(broken);}
};}

/** Internal transaction primitive: callers must establish their own owner/capability authority. */
export async function reserveBookingInTransaction(client:PoolClient,tenant:string,booking:string,clock:()=>string,expectedService?:string){
  const stored=await client.query(`select b.slot_start,b.slot_end,b.selection->>'serviceId' as service_id from public.bookings b where b.id=$1::uuid and b.tenant_id=$2::uuid and b.state='draft' for update`,[booking,tenant]);
  const b=stored.rows[0];if(!b)throw new FlowError('NOT_AVAILABLE');
  const service=z.string().uuid().parse(b.service_id);
  if(expectedService&&service!==expectedService)throw new FlowError('FORBIDDEN');
  const start=new Date(b.slot_start).toISOString(),end=new Date(b.slot_end).toISOString();
  const base=(await client.query(`select s.duration_minutes,t.timezone from public.services s join public.tenants t on t.id=s.tenant_id where s.id=$1::uuid and s.tenant_id=$2::uuid and s.active`,[service,tenant])).rows[0];
  if(!base)throw new FlowError('NOT_AVAILABLE');
  // Resource/group allocation is a different authority: do not issue partial holds.
  if((await client.query(`select 1 from public.service_resources where service_id=$1::uuid limit 1`,[service])).rows.length)throw new FlowError('UNSUPPORTED_CONFIG');
  const rules=(await client.query<AvailabilityRule>(`select id,tenant_id as "tenantId",service_id as "serviceId",weekday,start_minute as "startMinute",end_minute as "endMinute",capacity from public.availability_rules where tenant_id=$1::uuid and(service_id=$2::uuid or service_id is null)`,[tenant,service])).rows;
  const overrides=(await client.query<AvailabilityOverride>(`select id,tenant_id as "tenantId",service_id as "serviceId",date::text,kind,start_minute as "startMinute",end_minute as "endMinute",capacity from public.availability_overrides where tenant_id=$1::uuid and(service_id=$2::uuid or service_id is null)`,[tenant,service])).rows;
  const policy=(await client.query<SchedulingPolicy>(`select lead_time_minutes as "leadTimeMinutes",horizon_days as "horizonDays",slot_interval_minutes as "slotIntervalMinutes" from public.scheduling_policies where tenant_id=$1::uuid and(service_id=$2::uuid or service_id is null) order by service_id nulls last limit 1`,[tenant,service])).rows[0];
  if(!policy)throw new FlowError('NOT_AVAILABLE');
  const slot=createAvailabilityEngine().getSlots({tenantTimezone:base.timezone,serviceId:service,durationMinutes:Number(base.duration_minutes),policy,rules,overrides,existing:[],now:clock(),from:start,to:start}).find(s=>s.start===start&&s.end===end);
  if(!slot)throw new FlowError('NOT_AVAILABLE');
  // Reject stale/mismatched retry tuples before the legacy booking-id lookup.
  const old=(await client.query(`select tenant_id,service_id,slot_start,slot_end from public.capacity_holds where booking_id=$1::uuid`,[booking])).rows[0];
  if(old&&(old.tenant_id!==tenant||old.service_id!==service||new Date(old.slot_start).toISOString()!==start||new Date(old.slot_end).toISOString()!==end))throw new FlowError('CONFLICT');
  const row=(await client.query(`select * from public.reserve_capacity($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz,$5::uuid,$6::integer,interval '5 minutes')`,[tenant,service,start,end,booking,slot.remainingCapacity])).rows[0];
  if(row?.result==='NO_CAPACITY')throw new FlowError('CONFLICT');
  if(row?.result!=='GRANTED'||row.hold_status!=='active')throw new FlowError('INTERNAL_ERROR');
  const receipt=HoldReceipt.parse({bookingId:booking,holdId:row.hold_id,status:row.hold_status,expiresAt:new Date(row.expires_at).toISOString()});
  if(Date.parse(receipt.expiresAt)<=Date.parse(clock()))throw new FlowError('CONFLICT');
  return receipt;
}
