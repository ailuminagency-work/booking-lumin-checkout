/** Browser-only public Supabase interface. No provider credentials or service role. */
import {parseBookingDetail,type ConnectedBookingDetail} from './bookingDetail';
export type {ConnectedBookingDetail} from './bookingDetail';
export interface RuntimeConfig { url: string; publishableKey: string; tenantId: string; allowMembershipDiscovery?: boolean }
export interface ServiceRow { id:string; tenant_id:string; name:string; currency:string; duration_minutes:number; base_price:number; active:boolean }
export interface Membership { tenant_id:string; role:string }
export interface DraftRow { id:string; reference:string; state:string; slot_start:string; created_at:string }
export interface BookingRow extends DraftRow { tenant_id:string }
export interface DraftInput { serviceId:string; slotStart:string; slotEnd:string; customer:{name:string;email:string}; idempotencyKey:string }
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const fail=(message='The request could not be completed. Please retry.'):never=>{throw new Error(message)};
function publicKey(key:string) {
 if(key.startsWith('sb_publishable_'))return true;
 try{return JSON.parse(atob(key.split('.')[1]!.replace(/-/g,'+').replace(/_/g,'/'))).role==='anon'}catch{return false}
}
export function createRuntimeClient(config:RuntimeConfig, transport:typeof fetch=fetch) {
 let base:URL;
 try{base=new URL(config.url)}catch{return fail('Connected mode configuration is missing or invalid.')}
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!publicKey(config.publishableKey)||(!uuid(config.tenantId)&&!(config.allowMembershipDiscovery===true&&config.tenantId==='')))return fail('Connected mode configuration is missing or invalid.');
 let token:string|undefined;let generation=0;let userId:string|undefined;
 async function request(path:string, method='GET', body?:unknown, authenticated=false):Promise<unknown> {
  if(authenticated&&!token)return fail('Please sign in again.');
  const current=generation;
  let response:Response;
  try{response=await transport(base.origin+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{ }), 'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{return fail('Connection unavailable. Check your connection and retry.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  if(!response.ok){if(response.status===401){token=undefined;userId=undefined;generation++;return fail('Please sign in again.')}return fail(response.status===403?'Access denied for this account.':'The request was not accepted. Please check your details and retry.')}
  if(response.status===204)return null;
  let parsed:unknown;try{parsed=await response.json()}catch{return fail('The server returned an invalid response.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  return parsed;
 }
 const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?value:fail('The server returned an invalid response.');
 const tenant=(id:string)=>{if(!uuid(id))return fail('Invalid business selection.');return encodeURIComponent(id)};
 async function signIn(email:string,password:string){
  token=undefined;userId=undefined;generation++;
  const attempt=generation;
  const result=await request('/auth/v1/token?grant_type=password','POST',{email,password}) as {access_token?:unknown};
  if(attempt!==generation||typeof result?.access_token!=='string')return fail('Sign-in was not completed.');
  token=result.access_token;
  try{const user=await request('/auth/v1/user','GET',undefined,true) as {id?:unknown};if(!uuid(user?.id))return fail('Sign-in was not completed.');userId=user.id;return userId}catch(error){if(attempt===generation){token=undefined;userId=undefined}throw error}
 }
 function signOut(){token=undefined;userId=undefined;generation++}
 return {
  signIn,signOut,
  async services(tenantId=config.tenantId,member=false):Promise<ServiceRow[]>{
   const result=rows(await request(`/rest/v1/services?select=id,tenant_id,name,currency,duration_minutes,base_price,active&tenant_id=eq.${tenant(tenantId)}&archetype=eq.simple${member?'':'&active=eq.true'}&order=name`,'GET',undefined,member));
   return result.map(r=>{if(r.tenant_id!==tenantId||!uuid(r.id)||typeof r.name!=='string'||typeof r.currency!=='string'||!Number.isSafeInteger(r.duration_minutes)||Number(r.duration_minutes)<5||!Number.isSafeInteger(r.base_price)||Number(r.base_price)<0||typeof r.active!=='boolean')return fail('Catalog data is invalid.');return r as unknown as ServiceRow});
  },
  async saveDraft(input:DraftInput):Promise<{booking_id:string;reference:string}>{
   if(!uuid(config.tenantId))return fail('A valid business is required before submitting a booking.');
   if(!uuid(input.serviceId)||input.idempotencyKey.length<16||!Number.isFinite(Date.parse(input.slotStart))||Date.parse(input.slotEnd)<=Date.parse(input.slotStart)||!Number.isFinite(Date.parse(input.slotEnd)))return fail('Check the requested service and date.');
   const result=rows(await request('/rest/v1/rpc/create_booking_draft','POST',{p_tenant_id:config.tenantId,p_idempotency_key:input.idempotencyKey,p_selection:{serviceId:input.serviceId,archetype:'simple'},p_slot_start:input.slotStart,p_slot_end:input.slotEnd,p_customer:input.customer}))[0];
   if(!result||!uuid(result.booking_id)||typeof result.reference!=='string')return fail('The saved response could not be verified. Retry this same request.');
   return {booking_id:result.booking_id,reference:result.reference};
  },
  async memberships():Promise<Membership[]>{if(!userId)return fail('Please sign in again.');return rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(userId)}`,'GET',undefined,true)).map(r=>{if(!uuid(r.tenant_id)||typeof r.role!=='string')return fail();return r as unknown as Membership})},
  async bookings(tenantId:string):Promise<BookingRow[]>{
   const result=rows(await request(`/rest/v1/bookings?select=id,tenant_id,reference,state,slot_start,created_at&tenant_id=eq.${tenant(tenantId)}&order=created_at.desc&limit=100`,'GET',undefined,true));
   return result.map(r=>{if(!uuid(r.id)||r.tenant_id!==tenantId||typeof r.reference!=='string'||typeof r.state!=='string'||!['draft','pending_payment','confirmed','completed','cancelled','refunded','failed'].includes(r.state)||typeof r.slot_start!=='string'||!Number.isFinite(Date.parse(r.slot_start))||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))return fail('Booking data is invalid.');return r as unknown as BookingRow});
  },
  async bookingDetail(tenantId:string,bookingId:string):Promise<ConnectedBookingDetail|null>{
   const select='id,tenant_id,reference,state,slot_start,slot_end,created_at,selection,pricing,customer_id,payment_id,address,notes,customer:customers(id,tenant_id,name,email,phone),payment:payments!bookings_payment_id_fkey(id,tenant_id,booking_id,state,amount,currency,provider),history:booking_state_history(booking_id,from_state,to_state,reason,at)';
   return parseBookingDetail(await request(`/rest/v1/bookings?select=${encodeURIComponent(select)}&tenant_id=eq.${tenant(tenantId)}&id=eq.${tenant(bookingId)}&limit=1`,'GET',undefined,true),tenantId,bookingId);
  },
  async drafts(tenantId:string):Promise<DraftRow[]>{return rows(await request(`/rest/v1/bookings?select=id,reference,state,slot_start,created_at&tenant_id=eq.${tenant(tenantId)}&state=eq.draft&order=created_at.desc&limit=100`,'GET',undefined,true)).map(r=>{if(!uuid(r.id)||typeof r.reference!=='string'||r.state!=='draft'||typeof r.slot_start!=='string'||typeof r.created_at!=='string')return fail();return r as unknown as DraftRow})},
  async setServiceActive(tenantId:string,id:string,active:boolean){await request(`/rest/v1/services?tenant_id=eq.${tenant(tenantId)}&id=eq.${tenant(id)}`,'PATCH',{active},true)},
  async isPlatformAdmin(){if(!userId)return false;return rows(await request(`/rest/v1/platform_admins?select=user_id&user_id=eq.${tenant(userId)}`,'GET',undefined,true)).some(r=>r.user_id===userId)},
  async aggregates(){
   // No generic table accessor: the platform surface is aggregate-only.
   if(!userId)return fail('Please sign in again.');
   const admin=rows(await request(`/rest/v1/platform_admins?select=user_id&user_id=eq.${tenant(userId)}`,'GET',undefined,true));
   if(!admin.some(r=>r.user_id===userId))return fail('Platform administrator access is required.');
   const names=['platform_business_stats','platform_booking_stats','platform_economics','platform_integration_health'] as const;
   return Object.fromEntries(await Promise.all(names.map(async name=>[name,rows(await request(`/rest/v1/${name}?limit=1000`,'GET',undefined,true))]))) as Record<typeof names[number],Record<string,unknown>[]>;
  }
 };
}
export type RuntimeClient=ReturnType<typeof createRuntimeClient>;

export { readPublicRuntimeConfig, type PublicRuntimeConfig, type RuntimeEnvironment, type RuntimeMode } from "./publicConfig";


