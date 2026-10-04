/** Browser-only public Supabase interface. No provider credentials or service role. */
import {parseBookingDetail,type ConnectedBookingDetail} from './bookingDetail';
export type {ConnectedBookingDetail} from './bookingDetail';
export interface RuntimeConfig { url: string; publishableKey: string; tenantId: string; allowMembershipDiscovery?: boolean; bookingApiOrigin?: string }
export interface PaidSimplePublicationReceipt { readonly versionId:string; readonly installationId:string; readonly renderSchemaVersion:3; readonly hostedPath:string }
export interface SavedPaidSimplePublication {readonly flowId:string;readonly name:string;readonly publication:PaidSimplePublicationReceipt}
export type PaidSimplePublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string}|{phase:'published';flowId:string;receipt:PaidSimplePublicationReceipt};
export const PAID_SIMPLE_ACCENT_COLORS=['#4f46e5','#0e7490','#0f766e','#2563eb','#be123c'] as const;
export interface PaidSimplePresentation {readonly accentColor:typeof PAID_SIMPLE_ACCENT_COLORS[number];readonly layout:'stacked'|'compact'}
export interface PaidSimpleDraftReceipt {readonly flowId:string;readonly revision:number}
export interface PaidSimpleOwnerDraft extends PaidSimpleDraftReceipt {readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation}
export interface PaidSimpleVersion {readonly versionId:string;readonly draftRevision:number;readonly name:string;readonly presentation:PaidSimplePresentation;readonly current:boolean;readonly publication:PaidSimplePublicationReceipt|null}
export interface PaidSimpleVersionHistory {readonly flowId:string;readonly versions:readonly PaidSimpleVersion[]}
export interface PaidSimpleRollbackReceipt extends PaidSimplePublicationReceipt {readonly flowId:string}
export type PaidSimpleRollbackState={phase:'ready'}|{phase:'rolling_back'|'unknown';flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:PaidSimplePublicationReceipt}|{phase:'verified';flowId:string;receipt:PaidSimpleRollbackReceipt};
export type PaidSimpleDraftState={phase:'ready'}|{phase:'saving'|'loading'|'unverified'|'conflict';flowId:string}|{phase:'saved';flowId:string;revision:number}|{phase:'loaded';flowId:string;revision:number;draft:PaidSimpleOwnerDraft};
export class PaidSimpleDraftError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'conflict'|'unknown',message:string){super(message);}}
export interface PaidSimpleSavedDraftPublicationReceipt {readonly flowId:string;readonly draftRevision:number;readonly publication:PaidSimplePublicationReceipt}
export type PaidSimpleSavedDraftPublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string;draftRevision:number;checkoutOrigin:string}|{phase:'published';flowId:string;draftRevision:number;checkoutOrigin:string;receipt:PaidSimpleSavedDraftPublicationReceipt};
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
 const rollbacks=new Map<string,Exclude<PaidSimpleRollbackState,{phase:'ready'}>>();
 const rollbackReads=new Set<string>();
 const histories=new Map<string,PaidSimpleVersionHistory>();
 const rollbackLocked=(tenantId:string)=>{const state=rollbacks.get(tenantId.toLowerCase());return state?.phase==='rolling_back'||state?.phase==='unknown';};
 const requireNoRollback=(tenantId:string)=>{if(rollbackLocked(tenantId))throw new PublicationError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing drafts or publications.');};
 const savedDraftPublications=new Map<string,Exclude<PaidSimpleSavedDraftPublicationState,{phase:'ready'}>>();
 const ownerDrafts=new Map<string,Exclude<PaidSimpleDraftState,{phase:'ready'}>>();
 async function request(path:string, method='GET', body?:unknown, authenticated=false):Promise<unknown> {
  if(authenticated&&!token)return fail('Please sign in again.');
  const current=generation;
  let response:Response;
  try{response=await transport(base.origin+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{ }), 'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{return fail('Connection unavailable. Check your connection and retry.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  if(!response.ok){if(response.status===401){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();ownerDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();return fail('Please sign in again.')}return fail(response.status===403?'Access denied for this account.':'The request was not accepted. Please check your details and retry.')}
  if(response.status===204)return null;
  let parsed:unknown;try{parsed=await response.json()}catch{return fail('The server returned an invalid response.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  return parsed;
 }
 const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?value:fail('The server returned an invalid response.');
 const tenant=(id:string)=>{if(!uuid(id))return fail('Invalid business selection.');return encodeURIComponent(id)};
 async function signIn(email:string,password:string){
  token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();ownerDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();
  const attempt=generation;
  const result=await request('/auth/v1/token?grant_type=password','POST',{email,password}) as {access_token?:unknown};
  if(attempt!==generation||typeof result?.access_token!=='string')return fail('Sign-in was not completed.');
  token=result.access_token;
  try{const user=await request('/auth/v1/user','GET',undefined,true) as {id?:unknown};if(!uuid(user?.id))return fail('Sign-in was not completed.');userId=user.id;return userId}catch(error){if(attempt===generation){token=undefined;userId=undefined}throw error}
 }
 function signOut(){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();ownerDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear()}
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
  requireNoRollback(tenantId);
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
  requireNoRollback(tenantId);
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The Booking Lumin publication service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Enter the exact publication attempt ID for this business.');
  const savedAttempt=savedDraftPublications.get(tenantId);if(savedAttempt&&savedAttempt.phase!=='published')throw new PublicationError('not_sent','Retry the same saved-draft publication to verify its revision-bound receipt.');
  const previous=publications.get(tenantId);
  if(previous&&(previous.phase==='publishing'||previous.phase==='unknown'&&previous.flowId!==flowId))throw new PublicationError('not_sent','This session is bound to another publication attempt or publication is still in progress.');
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

 async function listPaidSimplePublications(tenantId:string):Promise<readonly SavedPaidSimplePublication[]>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The Booking Lumin publication service is not configured.');
  if(!uuid(tenantId))throw new PublicationError('not_sent','Invalid business selection.');
  const current=generation,credential=token;
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
  catch{throw new PublicationError('not_sent','Saved forms could not be checked. This does not verify a publication attempt or make publishing it again safe.');}
  if(current!==generation)throw new PublicationError('not_sent','The session changed. Sign in again before checking saved forms.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('not_sent','Please sign in again to check saved forms.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('not_sent','Only an authorized owner of this active business can check saved forms.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('not_sent','Saved forms are unavailable in this workspace.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('not_sent','The saved form list could not be verified. Check a known attempt directly; this does not make publishing it again safe.');
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['publications'])||!Array.isArray(data.publications)||data.publications.length>50)throw new PublicationError('not_sent','The saved form list could not be validated.');
  const result:SavedPaidSimplePublication[]=[];let previous='';
  for(const entry of data.publications){
   if(!exact(entry,['flowId','name','publication'])||!uuid(entry.flowId)||entry.flowId!==entry.flowId.toLowerCase()||entry.flowId<=previous||typeof entry.name!=='string'||entry.name.length<1||entry.name.length>200)throw new PublicationError('not_sent','The saved form list could not be validated.');
   const receipt=publicationReceipt(response,{ok:true,data:entry.publication});
   if(!receipt)throw new PublicationError('not_sent','The saved form list could not be validated.');
   previous=entry.flowId;result.push(Object.freeze({flowId:entry.flowId,name:entry.name,publication:receipt}));
  }
  // A list read never changes publication state or authorizes a create-only retry.
  return Object.freeze(result);
 }

 const presentation=(value:unknown):value is PaidSimplePresentation=>exact(value,['accentColor','layout'])&&PAID_SIMPLE_ACCENT_COLORS.some(color=>color===value.accentColor)&&(value.layout==='stacked'||value.layout==='compact');
 const draftRevision=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=1;
 const draftAuthority=(tenantId:string,flowId:string)=>{
  if(!token||!userId)throw new PaidSimpleDraftError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PaidSimpleDraftError('not_sent','The Booking Lumin draft service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId)||flowId!==flowId.toLowerCase())throw new PaidSimpleDraftError('not_sent','Choose a valid business and exact draft ID.');
 };
 const draftError=(response:Response,value:unknown):PaidSimpleDraftError|undefined=>{
  if(response.ok||!exact(value,['ok','code'])||value.ok!==false||typeof value.code!=='string')return undefined;
  if(response.status>=500)return new PaidSimpleDraftError('unknown','Draft status is unverified. Load this same draft before saving again.');
  if(response.status===409&&value.code==='CONFLICT')return new PaidSimpleDraftError('conflict','The draft revision changed. Your edits remain here; load the current draft before saving again.');
  if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();return new PaidSimpleDraftError('rejected','Please sign in again to load this draft.');}
  const messages:Record<string,string>={INVALID_REQUEST:'Check the draft service, name and design choices.',FORBIDDEN:'Only an authorized owner of this active business can use this draft.',NOT_AVAILABLE:'This draft is unavailable. Load a known draft ID to verify its current state.',UNSUPPORTED_CONFIG:'This workspace or service does not support staging paid drafts.',RATE_LIMITED:'Too many requests. Wait before checking this draft again.'};
  const statuses:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  return Object.hasOwn(messages,value.code)&&response.status===statuses[value.code]?new PaidSimpleDraftError('rejected',messages[value.code]!):undefined;
 };
 async function listPaidSimpleDrafts(tenantId:string):Promise<readonly PaidSimpleOwnerDraft[]>{
  if(!token||!userId)throw new PaidSimpleDraftError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PaidSimpleDraftError('not_sent','The Booking Lumin draft service is not configured.');
  if(!uuid(tenantId))throw new PaidSimpleDraftError('not_sent','Choose a valid business before checking saved drafts.');
  const current=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-drafts?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
  catch{throw new PaidSimpleDraftError('not_sent','Saved drafts could not be checked. This does not verify an uncertain save or publication.');}
  if(current!==generation)throw new PaidSimpleDraftError('not_sent','The session changed. Sign in again before checking saved drafts.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PaidSimpleDraftError('not_sent','Please sign in again to check saved drafts.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PaidSimpleDraftError('not_sent','Only an authorized owner of this active business can check saved drafts.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PaidSimpleDraftError('not_sent','This workspace or a saved service does not support staging paid drafts.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PaidSimpleDraftError('not_sent','The saved draft list could not be verified. An unavailable list does not permit repeating an uncertain save or publication.');
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['drafts'])||!Array.isArray(data.drafts)||data.drafts.length>50)throw new PaidSimpleDraftError('not_sent','The saved draft list could not be validated.');
  const result:PaidSimpleOwnerDraft[]=[];let previous='';
  for(const entry of data.drafts){
   if(!exact(entry,['flowId','name','revision','serviceId','presentation'])||!uuid(entry.flowId)||entry.flowId!==entry.flowId.toLowerCase()||entry.flowId<=previous||!draftRevision(entry.revision)||!uuid(entry.serviceId)||typeof entry.name!=='string'||!entry.name.trim()||entry.name!==entry.name.trim()||entry.name.length>200||!presentation(entry.presentation))throw new PaidSimpleDraftError('not_sent','The saved draft list could not be validated.');
   previous=entry.flowId;result.push(Object.freeze({...entry,presentation:Object.freeze({...entry.presentation})}) as unknown as PaidSimpleOwnerDraft);
  }
  // Discovery grants no save, publish or retry authority; selection needs a fresh draft read.
  return Object.freeze(result);
 }
 async function paidSimpleVersionHistory(tenantId:string,flowId:string):Promise<PaidSimpleVersionHistory>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The Booking Lumin publication service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId)||flowId!==flowId.toLowerCase())throw new PublicationError('not_sent','Enter the exact form ID for this business.');
  histories.delete(tenantId+'|'+flowId);
  const current=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows/'+flowId+'/versions?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
  catch{throw new PublicationError('not_sent','Version history could not be checked. This does not verify an uncertain save or publication.');}
  if(current!==generation)throw new PublicationError('not_sent','The session changed. Sign in again before checking version history.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('not_sent','Please sign in again to check version history.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('not_sent','Only an authorized owner of this active business can check version history.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('not_sent','Version history is unavailable in this workspace.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('not_sent','Version history is unavailable for this form. This does not permit repeating an uncertain save or publication.');
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['flowId','versions'])||data.flowId!==flowId||!Array.isArray(data.versions)||data.versions.length<1||data.versions.length>50)throw new PublicationError('not_sent','Version history could not be validated.');
  const versions:PaidSimpleVersion[]=[],ids=new Set<string>();let previous:number|undefined,currentCount=0;
  for(const entry of data.versions){
   if(!exact(entry,['versionId','draftRevision','name','presentation','current','publication'])||!uuid(entry.versionId)||ids.has(entry.versionId.toLowerCase())||!draftRevision(entry.draftRevision)||(previous!==undefined&&entry.draftRevision>=previous)||typeof entry.name!=='string'||entry.name.length<1||entry.name.length>200||!presentation(entry.presentation)||typeof entry.current!=='boolean')throw new PublicationError('not_sent','Version history could not be validated.');
   const receipt=entry.publication===null?null:publicationReceipt(response,{ok:true,data:entry.publication});
   if(receipt===undefined||receipt!==null&&receipt.versionId!==entry.versionId)throw new PublicationError('not_sent','Version history could not be validated.');
   previous=entry.draftRevision;ids.add(entry.versionId.toLowerCase());if(entry.current)currentCount++;
   versions.push(Object.freeze({versionId:entry.versionId,draftRevision:entry.draftRevision,name:entry.name,presentation:Object.freeze({...entry.presentation}),current:entry.current,publication:receipt}));
  }
  if(currentCount!==1)throw new PublicationError('not_sent','Version history could not be validated.');
  // History is evidence only; an unknown writer remains locked.
  const result=Object.freeze({flowId,versions:Object.freeze(versions)});histories.set(tenantId+'|'+flowId,result);return result;
 }
 async function loadPaidSimpleDraft(tenantId:string,flowId:string):Promise<PaidSimpleOwnerDraft>{
  draftAuthority(tenantId,flowId);
  if(rollbackLocked(tenantId))throw new PaidSimpleDraftError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing draft fields.');
  const publicationAttempt=savedDraftPublications.get(tenantId);if(publicationAttempt&&publicationAttempt.phase!=='published')throw new PaidSimpleDraftError('not_sent','Saved-draft publication status is unverified. Verify that same publication before changing or loading draft fields.');
  const previous=ownerDrafts.get(tenantId);
  if(previous&&(previous.phase==='saving'||previous.phase==='loading'||(previous.phase==='unverified'||previous.phase==='conflict')&&previous.flowId!==flowId))throw new PaidSimpleDraftError('not_sent','This business has a draft operation in progress or an unverified draft. Load that same draft first.');
  const current=generation,credential=token!;ownerDrafts.set(tenantId,{phase:'loading',flowId});
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-simple-flows/'+flowId+'/draft?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
   catch{throw new PaidSimpleDraftError('unknown','The draft could not be loaded. Current persisted fields remain unverified; do not save again yet.');}
   if(current!==generation)throw new PaidSimpleDraftError('unknown','The session changed. Sign in again before loading this draft.');
   const error=draftError(response,value);if(error)throw error;
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(data,['flowId','revision','serviceId','name','presentation'])||data.flowId!==flowId||!draftRevision(data.revision)||!uuid(data.serviceId)||typeof data.name!=='string'||!data.name.trim()||data.name!==data.name.trim()||data.name.length>200||!presentation(data.presentation))throw new PaidSimpleDraftError('unknown','The current draft could not be validated. Load this same draft again before saving.');
   const draft=Object.freeze({...data,presentation:Object.freeze({...data.presentation})}) as unknown as PaidSimpleOwnerDraft;
   ownerDrafts.set(tenantId,{phase:'loaded',flowId,revision:draft.revision,draft});return draft;
  }catch(error){if(current===generation)ownerDrafts.set(tenantId,{phase:'unverified',flowId});throw error;}
 }
 async function savePaidSimpleDraft(tenantId:string,flowId:string,input:{serviceId:string;name:string;presentation:PaidSimplePresentation;expectedRevision:number}):Promise<PaidSimpleDraftReceipt>{
  draftAuthority(tenantId,flowId);
  if(rollbackLocked(tenantId))throw new PaidSimpleDraftError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing draft fields.');
  const publicationAttempt=savedDraftPublications.get(tenantId);if(publicationAttempt&&publicationAttempt.phase!=='published')throw new PaidSimpleDraftError('not_sent','Saved-draft publication status is unverified. Verify that same publication before changing or loading draft fields.');
  if(!exact(input,['serviceId','name','presentation','expectedRevision'])||!uuid(input.serviceId)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>200||!presentation(input.presentation)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new PaidSimpleDraftError('not_sent','Check the draft service, name, design choices and expected revision.');
  const previous=ownerDrafts.get(tenantId);
  if(previous){
   if(previous.phase!=='saved'&&previous.phase!=='loaded'||previous.flowId!==flowId||previous.revision!==input.expectedRevision)throw new PaidSimpleDraftError('not_sent','Load the current draft before saving. An unverified save cannot be retried or replaced.');
  }else if(input.expectedRevision!==0)throw new PaidSimpleDraftError('not_sent','Load the current draft before saving an existing revision.');
  const current=generation,credential=token!;ownerDrafts.set(tenantId,{phase:'saving',flowId});
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-simple-flows/'+flowId+'/draft?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({serviceId:input.serviceId,name:input.name.trim(),presentation:{...input.presentation},expectedRevision:input.expectedRevision})});value=await response.json();}
   catch{throw new PaidSimpleDraftError('unknown','Draft save status is unverified. The draft may have been saved. Load this same draft before saving again; do not repeat the save.');}
   if(current!==generation)throw new PaidSimpleDraftError('unknown','The session changed. This draft save outcome cannot be verified here.');
   const error=draftError(response,value);if(error)throw error;
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(data,['flowId','revision'])||data.flowId!==flowId||!draftRevision(data.revision)||data.revision!==input.expectedRevision+1)throw new PaidSimpleDraftError('unknown','The draft save receipt could not be validated. Load this same draft before saving again.');
   const receipt=Object.freeze({...data}) as unknown as PaidSimpleDraftReceipt;ownerDrafts.set(tenantId,{phase:'saved',flowId,revision:receipt.revision});return receipt;
  }catch(error){if(current===generation){if(error instanceof PaidSimpleDraftError&&error.delivery==='rejected'){if(previous)ownerDrafts.set(tenantId,previous);else ownerDrafts.delete(tenantId);}else ownerDrafts.set(tenantId,{phase:error instanceof PaidSimpleDraftError&&error.delivery==='conflict'?'conflict':'unverified',flowId});}throw error;}
 }

 async function publishPaidSimpleDraft(tenantId:string,flowId:string,input:{expectedDraftRevision:number;checkoutOrigin:string}):Promise<PaidSimpleSavedDraftPublicationReceipt>{
  requireNoRollback(tenantId);
  if(!token||!userId||!bookingApiOrigin)throw new PublicationError('not_sent','Sign in with the configured publication service.');
  if(!uuid(tenantId)||!uuid(flowId)||flowId!==flowId.toLowerCase()||!exact(input,['expectedDraftRevision','checkoutOrigin'])||!draftRevision(input.expectedDraftRevision)||!httpsOrigin(input.checkoutOrigin))throw new PublicationError('not_sent','Choose the verified draft revision and Checkout origin.');
  const prior=savedDraftPublications.get(tenantId),publication=publications.get(tenantId),draft=ownerDrafts.get(tenantId);
  if(prior?.phase==='publishing'||recovering.has(tenantId))throw new PublicationError('not_sent','A publication operation is already in progress.');
  if(prior?.phase==='unknown'){
   if(prior.flowId!==flowId||prior.draftRevision!==input.expectedDraftRevision||prior.checkoutOrigin!==input.checkoutOrigin)throw new PublicationError('not_sent','This uncertain attempt is locked to its original draft, revision and origin.');
  }else{
   if(publication&&(!prior||publication.phase!=='published'||publication.flowId!==prior.flowId))throw new PublicationError('not_sent','This session is bound to another publication attempt. Check that attempt first.');
   if(draft?.phase!=='loaded'||draft.flowId!==flowId||draft.revision!==input.expectedDraftRevision)throw new PublicationError('not_sent','Load the current saved draft before publishing its verified revision.');
  }
  const current=generation,credential=token,attempt={flowId,draftRevision:input.expectedDraftRevision,checkoutOrigin:input.checkoutOrigin};
  savedDraftPublications.set(tenantId,{phase:'publishing',...attempt});publications.set(tenantId,{phase:'publishing',flowId});
  const unknown=()=>{savedDraftPublications.set(tenantId,{phase:'unknown',...attempt});publications.set(tenantId,{phase:'unknown',flowId});};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows/'+flowId+'/publish-draft?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({expectedDraftRevision:attempt.draftRevision,allowedOrigins:[attempt.checkoutOrigin]})});value=await response.json();}
  catch{if(current===generation)unknown();throw new PublicationError('unknown','Saved-draft publication status is unverified. Retry only this same frozen attempt to check its receipt.');}
  if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  const receipt=exact(data,['flowId','draftRevision','publication'])&&data.flowId===flowId&&data.draftRevision===attempt.draftRevision?publicationReceipt(response,{ok:true,data:data.publication}):undefined;
  if(receipt){const result=Object.freeze({flowId,draftRevision:attempt.draftRevision,publication:receipt});savedDraftPublications.set(tenantId,{phase:'published',...attempt,receipt:result});publications.set(tenantId,{phase:'published',flowId,receipt});return result;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('unknown','Sign in again to verify this same saved-draft publication.');}
  const statuses:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(prior?.phase!=='unknown'&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===statuses[value.code]){
   if(prior?.phase==='published')savedDraftPublications.set(tenantId,prior);else savedDraftPublications.delete(tenantId);if(publication)publications.set(tenantId,publication);else publications.delete(tenantId);ownerDrafts.set(tenantId,{phase:'conflict',flowId});
   throw new PublicationError('rejected','Saved-draft publication was rejected. Load the current draft before another explicit publication; saved data or eligibility may have changed.');
  }
  unknown();throw new PublicationError('unknown','Saved-draft publication status remains unverified. This response does not prove the earlier attempt failed. Retry only the same frozen revision and origin.');
 }

 const rollbackAuthority=(tenantId:string,flowId:string)=>{
  if(!token||!userId||!bookingApiOrigin)throw new PublicationError('not_sent','Sign in with the configured publication service.');
  if(!uuid(tenantId)||tenantId!==tenantId.toLowerCase()||!uuid(flowId)||flowId!==flowId.toLowerCase())throw new PublicationError('not_sent','Choose the exact business and form ID.');
 };
 const writerUncertain=(tenantId:string)=>{
  const matches=(id:string)=>id.toLowerCase()===tenantId;
  return [...recovering].some(matches)||[...publications].some(([id,state])=>matches(id)&&state.phase!=='published')||[...savedDraftPublications].some(([id,state])=>matches(id)&&state.phase!=='published')||[...ownerDrafts].some(([id,state])=>matches(id)&&state.phase!=='saved'&&state.phase!=='loaded');
 };
 const samePublication=(left:PaidSimplePublicationReceipt,right:PaidSimplePublicationReceipt)=>left.versionId===right.versionId&&left.installationId===right.installationId&&left.renderSchemaVersion===right.renderSchemaVersion&&left.hostedPath===right.hostedPath;
 async function rollbackPaidSimplePublication(tenantId:string,flowId:string,input:{expectedCurrentVersionId:string;targetVersionId:string}):Promise<PaidSimpleRollbackReceipt>{
  rollbackAuthority(tenantId,flowId);requireNoRollback(tenantId);
  if(writerUncertain(tenantId))throw new PublicationError('not_sent','An uncertain draft or publication must be verified before rollback.');
  if(!exact(input,['expectedCurrentVersionId','targetVersionId'])||!uuid(input.expectedCurrentVersionId)||!uuid(input.targetVersionId))throw new PublicationError('not_sent','Select a verified prior version and current version.');
  const history=histories.get(tenantId+'|'+flowId),currentVersion=history?.versions.find(version=>version.current),target=history?.versions.find(version=>version.versionId===input.targetVersionId);
  if(!currentVersion?.publication||currentVersion.versionId!==input.expectedCurrentVersionId||!target?.publication||target.current||target.draftRevision>=currentVersion.draftRevision)throw new PublicationError('not_sent','Refresh version history and review an eligible prior version before rollback.');
  const attempt={flowId,expectedCurrentVersionId:input.expectedCurrentVersionId,targetVersionId:input.targetVersionId,targetPublication:target.publication},at=generation,credential=token!;
  rollbacks.set(tenantId,{phase:'rolling_back',...attempt});histories.delete(tenantId+'|'+flowId);
  const unknown=()=>rollbacks.set(tenantId,{phase:'unknown',...attempt});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-simple-flows/'+flowId+'/rollback?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId})});value=await response.json();}
  catch{if(at===generation)unknown();throw new PublicationError('unknown','Rollback outcome is unverified. Do not repeat rollback; explicitly check this form current receipt.');}
  if(at!==generation)throw new PublicationError('unknown','The session changed. This rollback outcome cannot be verified here.');
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  const receipt=exact(data,['flowId','versionId','installationId','renderSchemaVersion','hostedPath'])&&data.flowId===flowId?publicationReceipt(response,{ok:true,data:{versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:data.renderSchemaVersion,hostedPath:data.hostedPath}}):undefined;
  if(receipt&&samePublication(receipt,attempt.targetPublication)){const result=Object.freeze({flowId,...receipt});rollbacks.set(tenantId,{phase:'verified',flowId,receipt:result});publications.set(tenantId,{phase:'published',flowId,receipt});return result;}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){rollbacks.delete(tenantId);throw new PublicationError('rejected','Rollback was rejected. Refresh version history and review the current version and catalog eligibility before another explicit action.');}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('unknown','Sign in again to check this form current receipt.');}
  unknown();throw new PublicationError('unknown','Rollback outcome is unverified. Its receipt could not be validated; check the current receipt without repeating rollback.');
 }
 async function reconcilePaidSimpleRollback(tenantId:string):Promise<PaidSimpleRollbackReceipt>{
  const attempt=rollbacks.get(tenantId);if(!attempt||attempt.phase!=='unknown')throw new PublicationError('not_sent','Only an uncertain rollback can be checked; wait for an in-flight action to finish.');
  rollbackAuthority(tenantId,attempt.flowId);if(rollbackReads.has(tenantId))throw new PublicationError('not_sent','The current rollback receipt is already being checked.');
  const at=generation;rollbackReads.add(tenantId);
  try{
   let history:PaidSimpleVersionHistory;try{history=await paidSimpleVersionHistory(tenantId,attempt.flowId);}catch{throw new PublicationError('unknown','The current rollback receipt could not be checked. Rollback remains unverified and locked.');}
   if(at!==generation)throw new PublicationError('unknown','The session changed. This rollback outcome cannot be verified here.');
   const receipt=history.versions.find(version=>version.current)?.publication;
   if(!receipt||!samePublication(receipt,attempt.targetPublication))throw new PublicationError('unknown','The current receipt does not verify the rollback target and installation. Rollback remains locked; refresh history for evidence or ask for help.');
   const result=Object.freeze({flowId:attempt.flowId,...receipt});rollbacks.set(tenantId,{phase:'verified',flowId:attempt.flowId,receipt:result});publications.set(tenantId,{phase:'published',flowId:attempt.flowId,receipt});return result;
  }finally{if(at===generation)rollbackReads.delete(tenantId);}
 }

 return {
  signIn,signOut,
  rollbackPaidSimplePublication,reconcilePaidSimpleRollback,
  paidSimpleRollbackState(tenantId:string):PaidSimpleRollbackState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=rollbacks.get(tenantId.toLowerCase());return state?.phase==='verified'?{...state,receipt:{...state.receipt}}:state?{...state,targetPublication:{...state.targetPublication}}:{phase:'ready'};},
  publishPaidSimpleDraft,publishPaidSimple,recoverPaidSimplePublication,listPaidSimplePublications,listPaidSimpleDrafts,paidSimpleVersionHistory,loadPaidSimpleDraft,savePaidSimpleDraft,
  paidSimpleSavedDraftPublicationState(tenantId:string):PaidSimpleSavedDraftPublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=savedDraftPublications.get(tenantId);return state?.phase==='published'?{...state,receipt:{...state.receipt,publication:{...state.receipt.publication}}}:state?{...state}:{phase:'ready'};},
  paidSimpleDraftState(tenantId:string):PaidSimpleDraftState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=ownerDrafts.get(tenantId);return state?.phase==='loaded'?{...state,draft:{...state.draft,presentation:{...state.draft.presentation}}}:state?{...state}:{phase:'ready'};},
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


