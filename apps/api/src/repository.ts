import {paidJourneySessionExpiryValid} from './paid-journey-session';
import type { Pool } from "pg";
import { RpcResults,type FlowRpc } from "./contracts";
import { createAvailabilityEngine } from "@lumin/core";
import type { AvailabilityOverride,AvailabilityRule,CapacityHold,SchedulingPolicy,Slot } from "@lumin/contracts";
export type FlowCode="ROSTER_NOT_INITIALIZED"|"ROSTER_TOO_LARGE"|"ROSTER_UNSUPPORTED_TIME"|"INVALID_REQUEST"|"UNAUTHENTICATED"|"FORBIDDEN"|"CONFLICT"|"NOT_AVAILABLE"|"UNSUPPORTED_CONFIG"|"INTERNAL_ERROR"|"RATE_LIMITED";
export class FlowError extends Error{constructor(readonly code:FlowCode){super(code);}}
export interface FlowRepository{call(name:FlowRpc,params:readonly unknown[]):Promise<unknown>}
export interface TenantProfile{
 id:string;
 name:string;
 slug:string;
 timezone:string;
 currency:string;
 status:"active"|"inactive"|"suspended";
}
export type TenantProfileReader=(actor:string,tenant:string)=>Promise<TenantProfile|null>;
export type AvailabilityReader=(actor:string,tenant:string,service:string,from:string,to:string)=>Promise<{serviceId:string;durationMinutes:number;slots:Slot[]}|null>;
const signatures:Record<FlowRpc,string[]>={get_paid_journey_owner_publication:["uuid","uuid","uuid"],issue_paid_journey_session:["uuid","text","text"],resolve_paid_journey_session:["text","text"],publish_paid_journey_draft:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb","jsonb"],get_paid_journey_render:["uuid","text"],save_paid_journey_draft:["uuid","uuid","uuid","uuid","bigint","text","jsonb","jsonb"],get_paid_journey_draft:["uuid","uuid","uuid"],publish_paid_conditional_customer_field_draft:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],submit_conditional_customer_field_request:["text","text","text","jsonb","jsonb","timestamptz"],save_paid_conditional_customer_field_draft:["uuid","uuid","uuid","uuid","bigint","text","text","text","jsonb"],publish_paid_customer_field_draft:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],submit_customer_field_request:["text","text","text","jsonb","jsonb","timestamptz"],save_paid_customer_field_draft:["uuid","uuid","uuid","uuid","bigint","text","text","text","jsonb"],publish_paid_option_flow:["uuid","uuid","uuid","uuid","text","uuid","uuid","jsonb"],publish_paid_simple_draft:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],save_paid_simple_draft:["uuid","uuid","uuid","uuid","bigint","text","text","text"],get_paid_simple_draft:["uuid","uuid","uuid"],publish_paid_simple_flow:["uuid","uuid","uuid","uuid","text","uuid","uuid","jsonb"],owner_roster_snapshot:["uuid","uuid"],roster_provision:["uuid","uuid"],roster_worker_put:["uuid","uuid","bigint","uuid","text","boolean","boolean"],roster_crew_put:["uuid","uuid","bigint","uuid","text","boolean","boolean"],roster_crew_member_set:["uuid","uuid","bigint","uuid","uuid","boolean"],roster_eligibility_put:["uuid","uuid","bigint","uuid","uuid","boolean","boolean"],roster_shift_put:["uuid","uuid","bigint","uuid","uuid","text","timestamptz","timestamptz","text","boolean","boolean"],flow_owner_configurable_list:["uuid","uuid"],get_configurable_flow_draft:["uuid","uuid","uuid"],save_configurable_flow_draft:["uuid","uuid","uuid","uuid","bigint","text","jsonb"],publish_configurable_flow:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],flow_owner_services:["uuid","uuid"],flow_owner_list:["uuid","uuid"],flow_owner_draft:["uuid","uuid","uuid"],flow_owner_requests:["uuid","uuid"],save_bound_flow_draft:["uuid","uuid","uuid","uuid","bigint","text","jsonb"],publish_bound_flow:["uuid","uuid","uuid","bigint","uuid","uuid","jsonb"],issue_flow_session:["uuid","text","text"],submit_flow_request:["text","text","text","jsonb","jsonb","timestamptz"]};
function mapped(error:unknown,name:FlowRpc):FlowError{
 const code=(error as {code?:unknown})?.code;
 if((name==='get_paid_journey_owner_publication'||name==='issue_paid_journey_session'||name==='resolve_paid_journey_session'||name==='publish_paid_journey_draft'||name==='publish_paid_customer_field_draft'||name==='submit_customer_field_request'||name==='publish_paid_conditional_customer_field_draft'||name==='submit_conditional_customer_field_request')&&['40P01','55P03','57014'].includes(String(code)))return new FlowError('CONFLICT');
 if(name==="owner_roster_snapshot"){
  if(code==="P0002")return new FlowError("ROSTER_NOT_INITIALIZED");
  if(code==="54000")return new FlowError("ROSTER_TOO_LARGE");
  if(code==="22008")return new FlowError("ROSTER_UNSUPPORTED_TIME");
  if(code==="22023")return new FlowError("INTERNAL_ERROR");
 }
 if(name.startsWith("roster_")&&["23503","23502","55000","22P02","22007","22008"].includes(String(code)))return new FlowError("INVALID_REQUEST");
 return new FlowError(code==="42501"?"FORBIDDEN":code==="40001"||code==="23505"?"CONFLICT":code==="22023"||code==="23514"?"INVALID_REQUEST":code==="P0002"?"NOT_AVAILABLE":code==="0A000"?"UNSUPPORTED_CONFIG":"INTERNAL_ERROR");
}
/** Fixed parameterized RPC adapter; no caller-selected SQL or table access. */
export function createFlowRepository(pool:Pool):FlowRepository{return {async call(name,params){
 const types=signatures[name];if(!types||types.length!==params.length)throw new FlowError("INVALID_REQUEST");
 const client=await pool.connect();
 try{
  await client.query("begin");await client.query("set local role service_role");
  if(name==='get_paid_journey_owner_publication'||name==='issue_paid_journey_session'||name==='resolve_paid_journey_session'||name==='publish_paid_journey_draft'||name==='publish_paid_customer_field_draft'||name==='submit_customer_field_request'||name==='publish_paid_conditional_customer_field_draft'||name==='submit_conditional_customer_field_request'){
   await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");
  }
  const placeholders=types.map((type,i)=>`$${i+1}::${type}`).join(",");
  const values=params.map((v,i)=>types[i]==="jsonb"?JSON.stringify(v):v);
  // Roster SQL returns bigint; JSONB keeps bounded numeric receipts as numbers
  // rather than pg's default int8 text representation. Existing JSON RPCs unchanged.
  const expression=`public.${name}(${placeholders})`;
  const result=await client.query(`select ${name.startsWith("roster_")?`to_jsonb(${expression})`:expression} as result`,values);
  const safe=RpcResults[name].parse(result.rows[0]?.result);
  if(name.startsWith("roster_")&&name!=="roster_provision"&&safe!==Number(params[2])+1)throw new FlowError("INTERNAL_ERROR");
  // Bind fixed RPC receipts to this request before committing side effects.
  if(name==='get_paid_journey_owner_publication'){
   const receipt=RpcResults.get_paid_journey_owner_publication.parse(safe);
   if(receipt.tenantId!==params[1]||receipt.flowId!==params[2])throw new FlowError('INTERNAL_ERROR');
  }else if(name==='issue_paid_journey_session'||name==='resolve_paid_journey_session'){
   const receipt=RpcResults[name].parse(safe);
   if(!paidJourneySessionExpiryValid(receipt,Date.now())||(name==='issue_paid_journey_session'&&receipt.installationId!==params[0]))throw new FlowError('INTERNAL_ERROR');
  }else if(name==='publish_paid_journey_draft'){
   const receipt=RpcResults.publish_paid_journey_draft.parse(safe);
   if(receipt.tenantId!==params[1]||receipt.flowId!==params[2]||receipt.draftRevision!==params[3]||(!receipt.replayed&&(receipt.versionId!==params[4]||receipt.installationId!==params[5])))throw new FlowError('INTERNAL_ERROR');
  }else if(name==="save_paid_journey_draft"||name==="get_paid_journey_draft"){
   const receipt=RpcResults[name].parse(safe);
   if(receipt.tenantId!==params[1]||receipt.flowId!==params[2]||(name==="save_paid_journey_draft"&&receipt.revision!==Number(params[4])+1))throw new FlowError("INTERNAL_ERROR");
  }else if(name==="publish_paid_simple_draft"||name==="publish_paid_customer_field_draft"||name==="publish_paid_conditional_customer_field_draft"){
   const receipt=RpcResults[name].parse(safe);
   if(receipt.flowId!==params[2]||receipt.draftRevision!==params[3]||(!receipt.replayed&&(receipt.versionId!==params[4]||receipt.installationId!==params[5])))throw new FlowError("INTERNAL_ERROR");
  }else if(name==="save_paid_customer_field_draft"||name==="save_paid_conditional_customer_field_draft"){
   const receipt=RpcResults[name].parse(safe);
   if(receipt.flowId!==params[2]||receipt.revision!==Number(params[4])+1)throw new FlowError("INTERNAL_ERROR");
  }else if(name==="save_paid_simple_draft"){
   const receipt=RpcResults.save_paid_simple_draft.parse(safe);
   if(receipt.flowId!==params[2]||receipt.revision!==Number(params[4])+1)throw new FlowError("INTERNAL_ERROR");
  }else if(name==="get_paid_simple_draft"){
   if(RpcResults.get_paid_simple_draft.parse(safe).flowId!==params[2])throw new FlowError("INTERNAL_ERROR");
  }else if((name==="publish_paid_simple_flow"||name==="publish_paid_option_flow")){
   const receipt=RpcResults[name].parse(safe);
   if(receipt.versionId!==params[5]||receipt.installationId!==params[6])throw new FlowError("INTERNAL_ERROR");
  }else if(name==="save_configurable_flow_draft"){
   const receipt=RpcResults.save_configurable_flow_draft.parse(safe);
   if(receipt.flowId!==params[2]||receipt.revision!==Number(params[4])+1)throw new FlowError("INTERNAL_ERROR");
  }else if(name==="get_configurable_flow_draft"){
   if(RpcResults.get_configurable_flow_draft.parse(safe).flowId!==params[2])throw new FlowError("INTERNAL_ERROR");
  }else if(name==="publish_configurable_flow"){
   const receipt=RpcResults.publish_configurable_flow.parse(safe);
   if(receipt.versionId!==params[4]||receipt.installationId!==params[5])throw new FlowError("INTERNAL_ERROR");
  }
  await client.query("commit");return safe;
 }catch(error){await client.query("rollback").catch(()=>{});throw mapped(error,name);}finally{client.release();}
}};}

/**
 * Read the authenticated tenant profile through a fixed, parameterized query.
 * The hosted service uses service_role for its bounded RPC transaction, so the
 * membership predicate is explicit here rather than relying on client RLS.
 * No settings, credentials, or platform-admin data are returned.
 */
export function createTenantProfileReader(pool:Pool):TenantProfileReader{return async(actor,tenant)=>{
 const client=await pool.connect();
 try{
  await client.query("begin");
  await client.query("set local role service_role");
  const result=await client.query<TenantProfile>(
   `select t.id,t.name,t.slug,t.timezone,t.currency,t.status
      from public.tenants t
     where t.id=$1::uuid
       and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.user_id=$2::uuid)`,
   [tenant,actor],
  );
  await client.query("commit");
  return result.rows[0]??null;
 }catch(error){
  await client.query("rollback").catch(()=>{});
  throw error;
 }finally{client.release();}
};}

/** Read only the tenant-owned scheduling inputs needed to compute slots.
 * The pure engine remains the availability authority; SQL only supplies its
 * tenant-bound inputs and existing capacity consumers. */
export async function readAvailabilitySlots(client:import("pg").PoolClient,tenant:string,service:string,base:{timezone:string;duration_minutes:number},from:string,to:string,clock:()=>string) {
  const rules=(await client.query<AvailabilityRule>(`select id,tenant_id as "tenantId",service_id as "serviceId",weekday,start_minute as "startMinute",end_minute as "endMinute",capacity from public.availability_rules where tenant_id=$1::uuid and (service_id=$2::uuid or service_id is null)`,[tenant,service])).rows;
  const overrides=(await client.query<AvailabilityOverride>(`select id,tenant_id as "tenantId",service_id as "serviceId",date::text,kind,start_minute as "startMinute",end_minute as "endMinute",capacity from public.availability_overrides where tenant_id=$1::uuid and (service_id=$2::uuid or service_id is null) and date between ($3::timestamptz at time zone $4)::date and ($5::timestamptz at time zone $4)::date`,[tenant,service,from,base.timezone,to])).rows;
  const policyRow=(await client.query<SchedulingPolicy>(`select lead_time_minutes as "leadTimeMinutes",horizon_days as "horizonDays",slot_interval_minutes as "slotIntervalMinutes" from public.scheduling_policies where tenant_id=$1::uuid and (service_id=$2::uuid or service_id is null) order by service_id nulls last limit 1`,[tenant,service])).rows[0]??{leadTimeMinutes:0,horizonDays:60,slotIntervalMinutes:30};
  const consumers=(await client.query<CapacityHold & {booking_id:string}>(`select slot_start as start,slot_end as end,booking_id from public.capacity_holds where tenant_id=$1::uuid and service_id=$4::uuid and status='active' and expires_at>now() and slot_start < $2::timestamptz and slot_end > $3::timestamptz union all select b.slot_start as start,b.slot_end as end,b.id as booking_id from public.bookings b where b.tenant_id=$1::uuid and (b.selection ->> 'serviceId')::uuid=$4::uuid and b.state in ('pending_payment','confirmed','completed') and b.slot_start < $2::timestamptz and b.slot_end > $3::timestamptz and not exists (select 1 from public.capacity_holds h2 where h2.booking_id=b.id and h2.status='active' and h2.expires_at>now())`,[tenant,to,from,service])).rows;
  const holds=[...new Map(consumers.map(consumer=>[`${consumer.booking_id}:${new Date(consumer.start).toISOString()}:${new Date(consumer.end).toISOString()}`,{start:consumer.start,end:consumer.end}])).values()];
  const policy={leadTimeMinutes:Number(policyRow.leadTimeMinutes),horizonDays:Number(policyRow.horizonDays),slotIntervalMinutes:Number(policyRow.slotIntervalMinutes)};
  const slots=createAvailabilityEngine().getSlots({tenantTimezone:base.timezone,serviceId:service,durationMinutes:Number(base.duration_minutes),policy,rules,overrides,existing:holds,now:clock(),from,to});
 return {serviceId:service,durationMinutes:Number(base.duration_minutes),slots};
}
export function createAvailabilityReader(pool:Pool,clock:()=>string=()=>new Date().toISOString()):AvailabilityReader{return async(actor,tenant,service,from,to)=>{
 const client=await pool.connect();
 try{
  await client.query("begin");await client.query("set local role service_role");
  const membership=await client.query<{timezone:string;duration_minutes:number}>(
   `select t.timezone,s.duration_minutes
      from public.tenants t join public.services s on s.tenant_id=t.id
     where t.id=$1::uuid and s.id=$2::uuid and s.active
       and exists(select 1 from public.tenant_members m where m.tenant_id=t.id and m.user_id=$3::uuid)`,
   [tenant,service,actor],
  );
  const base=membership.rows[0];if(!base){await client.query("commit");return null;}
  const result=await readAvailabilitySlots(client,tenant,service,base,from,to,clock);
  await client.query("commit");return result;
 }catch(error){await client.query("rollback").catch(()=>{});throw error;}finally{client.release();}
};}
