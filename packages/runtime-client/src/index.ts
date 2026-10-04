/** Browser-only public Supabase interface. No provider credentials or service role. */
import {parseBookingDetail,type ConnectedBookingDetail} from './bookingDetail';
export type {ConnectedBookingDetail} from './bookingDetail';
export interface RuntimeConfig { url: string; publishableKey: string; tenantId: string; allowMembershipDiscovery?: boolean; bookingApiOrigin?: string }
export interface PaidSimplePublicationReceipt { readonly versionId:string; readonly installationId:string; readonly renderSchemaVersion:3; readonly hostedPath:string }
export type PaidSimplePublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string}|{phase:'published';flowId:string;receipt:PaidSimplePublicationReceipt};
export class PublicationError extends Error {
 constructor(readonly delivery:'not_sent'|'rejected'|'unknown',message:string){super(message);}
}
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
 const httpsOrigin=(value:unknown):value is string=>{try{if(typeof value!=='string')return false;const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.origin===value&&!parsed.username&&!parsed.password;}catch{return false}};
 const bookingApiOrigin=config.bookingApiOrigin;
 if(bookingApiOrigin!==undefined&&!httpsOrigin(bookingApiOrigin))return fail('Connected mode configuration is missing or invalid.');
 let token:string|undefined;let generation=0;let userId:string|undefined;
 const publications=new Map<string,Exclude<PaidSimplePublicationState,{phase:'ready'}>>();
 const recovering=new Set<string>();
 async function request(path:string, method='GET', body?:unknown, authenticated=false):Promise<unknown> {
  if(authenticated&&!token)return fail('Please sign in again.');
  const current=generation;
  let response:Response;
  try{response=await transport(base.origin+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{ }), 'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{return fail('Connection unavailable. Check your connection and retry.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  if(!response.ok){if(response.status===401){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();return fail('Please sign in again.')}return fail(response.status===403?'Access denied for this account.':'The request was not accepted. Please check your details and retry.')}
  if(response.status===204)return null;
  let parsed:unknown;try{parsed=await response.json()}catch{return fail('The server returned an invalid response.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  return parsed;
 }
 const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?value:fail('The server returned an invalid response.');
 const tenant=(id:string)=>{if(!uuid(id))return fail('Invalid business selection.');return encodeURIComponent(id)};
 async function signIn(email:string,password:string){
  token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();
  const attempt=generation;
  const result=await request('/auth/v1/token?grant_type=password','POST',{email,password}) as {access_token?:unknown};
  if(attempt!==generation||typeof result?.access_token!=='string')return fail('Sign-in was not completed.');
  token=result.access_token;
  try{const user=await request('/auth/v1/user','GET',undefined,true) as {id?:unknown};if(!uuid(user?.id))return fail('Sign-in was not completed.');userId=user.id;return userId}catch(error){if(attempt===generation){token=undefined;userId=undefined}throw error}
 }
 function signOut(){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear()}
 const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 const publicationReceipt=(response:Response,value:unknown):PaidSimplePublicationReceipt|undefined=>{
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(data.versionId)||!uuid(data.installationId)||data.renderSchemaVersion!==3||data.hostedPath!==`/checkout/flow/${data.installationId}`)return undefined;
  return Object.freeze({...data}) as unknown as PaidSimplePublicationReceipt;
 };
 async function publishPaidSimple(tenantId:string,flowId:string,input:{serviceId:string;name:string;checkoutOrigin:string}):Promise<PaidSimplePublicationReceipt>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The Booking Lumin publication service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId)||!exact(input,['serviceId','name','checkoutOrigin'])||!uuid(input.serviceId)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>200||!httpsOrigin(input.checkoutOrigin))throw new PublicationError('not_sent','Check the service, form name and Checkout origin.');
  const previous=publications.get(tenantId);
  if(previous)throw new PublicationError(previous.phase==='published'?'not_sent':'unknown',previous.phase==='published'?'This session already has a published form.':'Publication status is unverified. Use the explicit receipt lookup for this attempt; do not repeat publication.');
  const current=generation;const credential=token;
  publications.set(tenantId,{phase:'publishing',flowId});
  let response:Response;let value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows/'+flowId+'/publish?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({serviceId:input.serviceId,name:input.name.trim(),allowedOrigins:[input.checkoutOrigin]})});value=await response.json();}
  catch{if(current===generation)publications.set(tenantId,{phase:'unknown',flowId});throw new PublicationError('unknown','Publication status is unverified. The request may have been saved. Use the explicit receipt lookup for this attempt; do not repeat publication.');}
  if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
  const codes:Record<string,string>={INVALID_REQUEST:'Check the service, form name and Checkout origin.',UNAUTHENTICATED:'Please sign in again.',FORBIDDEN:'Only an authorized business owner can publish this form.',CONFLICT:'Publication was rejected because the saved data changed.',NOT_AVAILABLE:'The selected service is unavailable.',UNSUPPORTED_CONFIG:'This service does not support the staging paid form.',INTERNAL_ERROR:'The server rejected publication.',RATE_LIMITED:'Too many requests. Wait before publishing again.'};
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&Object.hasOwn(codes,value.code)){
   if(response.status>=500||value.code==='INTERNAL_ERROR'){publications.set(tenantId,{phase:'unknown',flowId});throw new PublicationError('unknown','Publication status is unverified. The server could not verify the outcome. Use the explicit receipt lookup for this attempt; do not repeat publication.');}
   publications.delete(tenantId);if(value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('rejected',codes[value.code]!);
  }
  const receipt=publicationReceipt(response,value);
  if(!receipt){publications.set(tenantId,{phase:'unknown',flowId});throw new PublicationError('unknown','Publication status is unverified. The receipt could not be validated. Use the explicit receipt lookup for this attempt; do not repeat publication.');}
  publications.set(tenantId,{phase:'published',flowId,receipt});return receipt;
 }
 async function recoverPaidSimplePublication(tenantId:string,flowId:string):Promise<PaidSimplePublicationReceipt>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The Booking Lumin publication service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Enter the exact publication attempt ID for this business.');
  const previous=publications.get(tenantId);
  if(previous&&(previous.flowId!==flowId||previous.phase==='publishing'))throw new PublicationError('not_sent','This session is bound to another publication attempt or publication is still in progress.');
  if(previous?.phase==='published')throw new PublicationError('not_sent','This session already holds this publication receipt.');
  if(recovering.has(tenantId))throw new PublicationError('not_sent','A receipt lookup is already in progress for this business.');
  const current=generation,credential=token;
  // Absence is not proof that the create-only publication did not commit.
  publications.set(tenantId,{phase:'unknown',flowId});recovering.add(tenantId);
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows/'+flowId+'/publication?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
   catch{throw new PublicationError('unknown','The receipt could not be checked. Publication status remains unverified. Check this same attempt again; do not publish again.');}
   if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
   const receipt=publicationReceipt(response,value);
   if(receipt){publications.set(tenantId,{phase:'published',flowId,receipt});return receipt;}
   if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
    if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('unknown','Please sign in again to check this same publication attempt.');}
    if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('unknown','No active receipt was found for this attempt in this business. Publication status remains unverified; this does not make publishing again safe.');
    if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('unknown','Only an authorized business owner can check this receipt. Publication status remains unverified.');
    if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('unknown','Receipt lookup is unavailable in this workspace. Publication status remains unverified.');
   }
   throw new PublicationError('unknown','The receipt could not be validated. Publication status remains unverified; do not publish again.');
  }finally{if(current===generation)recovering.delete(tenantId);}
 }

 return {
  signIn,signOut,
  publishPaidSimple,recoverPaidSimplePublication,
  paidSimplePublicationState(tenantId:string):PaidSimplePublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=publications.get(tenantId);return state?.phase==='published'?{...state,receipt:{...state.receipt}}:state?{...state}:{phase:'ready'};},
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


