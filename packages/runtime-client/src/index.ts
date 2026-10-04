import {CreateDetailingOffer,DetailingOfferReceipt,buildDetailingService} from '@lumin/contracts';
export type {CreateDetailingOffer,DetailingOfferReceipt} from '@lumin/contracts';
export type DetailingOfferState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateDetailingOffer}|{phase:'created';attempt:CreateDetailingOffer;receipt:DetailingOfferReceipt};
export type DetailingOfferContext=SimpleOfferContext;
import {ConditionalCustomerFields,type ConditionalCustomerTextField} from "@lumin/contracts";
import {InitializeBusinessProfile} from '@lumin/contracts';
import {CustomerFieldInstallHealth} from '@lumin/contracts';
export type ConditionalCustomerFieldInstallHealth=Omit<CustomerFieldInstallHealth,'renderSchemaVersion'|'installation'>&{renderSchemaVersion:6;installation:{status:'available'|'unavailable';receipt:PaidConditionalPublicationReceipt['publication']|null}};
/** Explicit V6 boundary. Never widens the closed V5 schema or its public reader. */
export function parseConditionalCustomerFieldInstallHealth(value:unknown):ConditionalCustomerFieldInstallHealth|undefined{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const v=value as Record<string,unknown>,i=v.installation;if(v.renderSchemaVersion!==6||!i||typeof i!=='object'||Array.isArray(i))return;
  const installation=i as Record<string,unknown>,receipt=installation.receipt;
  if(receipt!==null&&(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||(receipt as Record<string,unknown>).renderSchemaVersion!==6))return;
  // Preserve every supplied key so the existing strict evidence invariants reject widening.
  const parsed=CustomerFieldInstallHealth.safeParse({...v,renderSchemaVersion:5,installation:{...installation,receipt:receipt===null?null:{...receipt,renderSchemaVersion:5}}});
  if(!parsed.success)return;const h=parsed.data;
  return {...h,renderSchemaVersion:6,installation:{...h.installation,receipt:h.installation.receipt?{...h.installation.receipt,renderSchemaVersion:6}:null}};
 }catch{return;}
}
export type {CustomerFieldInstallHealth} from '@lumin/contracts';
import {BusinessProfile,CreateBusiness,CreateSimpleOffer,SimpleOfferReceipt,CurrencyCode,BusinessTimezone,CreateOfferScheduling,OfferSchedulingReceipt,schedulingReceiptMatches,PaidInstallHealth,CustomerDraftFields,type CustomerDraftTextField} from '@lumin/contracts';
export type PaidInstallReceipt=NonNullable<PaidInstallHealth['installation']['receipt']>;
export type {PaidInstallHealth} from '@lumin/contracts';
export type {BusinessProfile,CreateBusiness,BusinessType} from '@lumin/contracts';
/** Browser-only public Supabase interface. No provider credentials or service role. */
import {parseBookingDetail,type ConnectedBookingDetail} from './bookingDetail';
export type {ConnectedBookingDetail} from './bookingDetail';
export class BusinessOnboardingError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'unavailable'|'unknown',message:string){super(message);}}
export type BusinessCreationState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateBusiness}|{phase:'created';attempt:CreateBusiness;profile:BusinessProfile}|{phase:'unavailable'};
export type SimpleOfferState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateSimpleOffer}|{phase:'created';attempt:CreateSimpleOffer;receipt:SimpleOfferReceipt};
export interface SimpleOfferContext {readonly tenantId:string;readonly currency:string;readonly timezone:string}
export interface OwnerBusinessContext {readonly tenantId:string;readonly name:string;readonly slug:string;readonly timezone:string;readonly currency:string;readonly status:'active'}
export type OfferSchedulingState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateOfferScheduling}|{phase:'configured';attempt:CreateOfferScheduling;receipt:OfferSchedulingReceipt};
export type {CreateOfferScheduling,OfferSchedulingReceipt,CreateSimpleOffer,SimpleOfferReceipt} from '@lumin/contracts';
export type BusinessProfileInitializationInput=InitializeBusinessProfile;
export type BusinessProfileInitializationState={phase:'ready'}|{phase:'unavailable'}|{phase:'blocked'}|{phase:'checking'|'initializing'|'unknown';attempt:BusinessProfileInitializationInput}|{phase:'initialized';attempt:BusinessProfileInitializationInput;profile:BusinessProfile};
export type BusinessProfileRead={status:'initialized';profile:BusinessProfile}|{status:'uninitialized';tenantId:string};
export interface RuntimeConfig { url: string; publishableKey: string; tenantId: string; allowMembershipDiscovery?: boolean; bookingApiOrigin?: string }
export interface PaidSimplePublicationReceipt { readonly versionId:string; readonly installationId:string; readonly renderSchemaVersion:3; readonly hostedPath:string }
export interface SavedPaidSimplePublication {readonly flowId:string;readonly name:string;readonly publication:PaidSimplePublicationReceipt}
export type PaidSimplePublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string}|{phase:'published';flowId:string;receipt:PaidSimplePublicationReceipt};
export const PAID_SIMPLE_ACCENT_COLORS=['#4f46e5','#0e7490','#0f766e','#2563eb','#be123c'] as const;
export interface PaidSimplePresentation {readonly accentColor:typeof PAID_SIMPLE_ACCENT_COLORS[number];readonly layout:'stacked'|'compact'}
export interface PaidSimpleDraftReceipt {readonly flowId:string;readonly revision:number}
export interface PaidSimpleFieldDraftReceipt extends PaidSimpleDraftReceipt {readonly schemaVersion:2}
export interface PaidSimpleLegacyOwnerDraft extends PaidSimpleDraftReceipt {readonly schemaVersion?:never;readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation}
export interface PaidSimpleFieldOwnerDraft extends PaidSimpleFieldDraftReceipt {readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly customerFields:readonly Readonly<CustomerDraftTextField>[]}
export interface PaidSimpleConditionalDraftReceipt extends PaidSimpleDraftReceipt {readonly schemaVersion:3}
export interface PaidSimpleConditionalOwnerDraft extends PaidSimpleConditionalDraftReceipt {readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly customerFields:readonly Readonly<ConditionalCustomerTextField>[]}
export interface PaidSimpleConditionalDraftInput {readonly schemaVersion:3;readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly expectedRevision:number;readonly customerFields:readonly Readonly<ConditionalCustomerTextField>[]}
export type PaidSimpleOwnerDraft=PaidSimpleLegacyOwnerDraft|PaidSimpleFieldOwnerDraft|PaidSimpleConditionalOwnerDraft;
export interface PaidSimpleFieldDraftInput {readonly schemaVersion:2;readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly expectedRevision:number;readonly customerFields:readonly Readonly<CustomerDraftTextField>[]}
export type {CustomerDraftTextField} from '@lumin/contracts';
export interface PaidSimpleVersion {readonly versionId:string;readonly draftRevision:number;readonly name:string;readonly presentation:PaidSimplePresentation;readonly current:boolean;readonly publication:PaidSimplePublicationReceipt|null}
export interface PaidSimpleVersionHistory {readonly flowId:string;readonly versions:readonly PaidSimpleVersion[]}
export interface PaidSimpleRollbackReceipt extends PaidSimplePublicationReceipt {readonly flowId:string}
export type PaidSimpleRollbackState={phase:'ready'}|{phase:'rolling_back'|'unknown';flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:PaidSimplePublicationReceipt}|{phase:'verified';flowId:string;receipt:PaidSimpleRollbackReceipt};
export type PaidSimpleDraftState={phase:'ready'}|{phase:'saving'|'loading'|'unverified'|'conflict';flowId:string}|{phase:'saved';flowId:string;revision:number;schemaVersion?:2|3}|{phase:'loaded';flowId:string;revision:number;draft:PaidSimpleOwnerDraft};
export class PaidSimpleDraftError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'conflict'|'unknown',message:string){super(message);}}
export interface PaidSimpleSavedDraftPublicationReceipt {readonly flowId:string;readonly draftRevision:number;readonly publication:PaidSimplePublicationReceipt}
export type PaidSimpleSavedDraftPublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string;draftRevision:number;checkoutOrigin:string}|{phase:'published';flowId:string;draftRevision:number;checkoutOrigin:string;receipt:PaidSimpleSavedDraftPublicationReceipt};
export interface PaidCustomerFieldPublicationReceipt {readonly flowId:string;readonly draftRevision:number;readonly publication:{readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:5;readonly hostedPath:string}}
export type PaidCustomerFieldPublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string;draftRevision:number;checkoutOrigin?:string}|{phase:'published';flowId:string;draftRevision:number;checkoutOrigin?:string;receipt:PaidCustomerFieldPublicationReceipt};
export interface PaidConditionalPublicationReceipt {readonly flowId:string;readonly draftRevision:number;readonly publication:{readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:6;readonly hostedPath:string}}
export type PaidConditionalPublicationState={phase:'ready'}|{phase:'publishing'|'unknown';flowId:string;draftRevision:number;checkoutOrigin?:string}|{phase:'published';flowId:string;draftRevision:number;checkoutOrigin?:string;receipt:PaidConditionalPublicationReceipt};
export interface CustomerFieldInstallReceipt {readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:3|5;readonly hostedPath:string}
export type CustomerFieldVersion= {readonly versionId:string;readonly draftRevision:number;readonly name:string;readonly presentation:PaidSimplePresentation;readonly current:boolean;readonly publication:CustomerFieldInstallReceipt|null}&({readonly renderSchemaVersion:3;readonly customerFields?:never}|{readonly renderSchemaVersion:5;readonly customerFields:readonly Readonly<CustomerDraftTextField>[]});
export interface CustomerFieldVersionHistory {readonly flowId:string;readonly versions:readonly CustomerFieldVersion[]}
export interface CustomerFieldRollbackReceipt extends CustomerFieldInstallReceipt {readonly flowId:string}
export type CustomerFieldRollbackState={phase:'ready'}|{phase:'rolling_back'|'unknown';flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:CustomerFieldInstallReceipt}|{phase:'verified';flowId:string;receipt:CustomerFieldRollbackReceipt};
export interface ConditionalInstallReceipt {readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:3|5|6;readonly hostedPath:string}
export type ConditionalVersion= {readonly versionId:string;readonly draftRevision:number;readonly name:string;readonly presentation:PaidSimplePresentation;readonly current:boolean;readonly publication:ConditionalInstallReceipt|null}&({readonly renderSchemaVersion:3;readonly customerFields?:never}|{readonly renderSchemaVersion:5;readonly customerFields:readonly Readonly<CustomerDraftTextField>[]}|{readonly renderSchemaVersion:6;readonly customerFields:readonly Readonly<ConditionalCustomerTextField>[]} );
export interface ConditionalVersionHistory {readonly flowId:string;readonly versions:readonly ConditionalVersion[]}
export interface ConditionalRollbackReceipt extends ConditionalInstallReceipt {readonly flowId:string}
export type ConditionalRollbackState={phase:'ready'}|{phase:'rolling_back'|'unknown';flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:ConditionalInstallReceipt}|{phase:'verified';flowId:string;receipt:ConditionalRollbackReceipt};
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
 let token:string|undefined;let generation=0;let userId:string|undefined;let businessCreation:BusinessCreationState={phase:'ready'};
 const detailingOffers=new Map<string,Exclude<DetailingOfferState,{phase:'ready'}>>();
 const detailingAttempts=new Map<string,{actor:string;tenantId:string;body:string}>();
 const uncertainDetailing=new Map<string,{actor:string;tenantId:string;attempt:CreateDetailingOffer}>();
 const detailingLocked=()=>uncertainDetailing.size>0||[...detailingOffers.values()].some(state=>state.phase!=='created');
 const immutableDetailing=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(immutableDetailing);Object.freeze(value);}return value;};
 const offers=new Map<string,Exclude<SimpleOfferState,{phase:'ready'}>>();
 const offerAttempts=new Map<string,{actor:string;tenantId:string;body:string}>();
 const uncertainOffers=new Map<string,{actor:string;tenantId:string;attempt:CreateSimpleOffer}>();
 const scheduling=new Map<string,Exclude<OfferSchedulingState,{phase:'ready'}>>();
 const schedulingAttempts=new Map<string,{actor:string;tenantId:string;serviceId:string;body:string}>();
 const uncertainScheduling=new Map<string,{actor:string;tenantId:string;serviceId:string;attempt:CreateOfferScheduling;offer:Extract<SimpleOfferState,{phase:'created'}>}>();
 const schedulingLocked=()=>[...scheduling.values()].some(state=>state.phase!=='configured');
 const offerOperationsLocked=()=>detailingLocked()||schedulingLocked()||[...offers.values()].some(state=>state.phase==='checking'||state.phase==='creating'||state.phase==='unknown');
 const profileInitializations=new Map<string,{actor:string;state:Exclude<BusinessProfileInitializationState,{phase:'ready'|'blocked'}>}>();
 const profileInitializationKeys=new Map<string,{actor:string;tenantId:string;body:string}>();
 const profileInitializationLocked=()=>[...profileInitializations.values()].some(({state})=>state.phase==='checking'||state.phase==='initializing'||state.phase==='unknown');
 const offerLocked=()=>offerOperationsLocked()||profileInitializationLocked();
 const businessAttempts=new Map<string,{actor:string;body:string}>();
 const businessCreationLocked=()=>businessCreation.phase==='checking'||businessCreation.phase==='creating'||businessCreation.phase==='unknown';
 const publications=new Map<string,Exclude<PaidSimplePublicationState,{phase:'ready'}>>();
 const recovering=new Set<string>();
 const rollbacks=new Map<string,Exclude<PaidSimpleRollbackState,{phase:'ready'}>>();
 const rollbackReads=new Set<string>();
 const histories=new Map<string,PaidSimpleVersionHistory>();
 let fieldHistorySequence=0;
 const fieldHistoryReads=new Map<string,number>();
 const fieldHistories=new Map<string,CustomerFieldVersionHistory>();
 const fieldRollbacks=new Map<string,Exclude<CustomerFieldRollbackState,{phase:'ready'}>>();
 const fieldRollbackReads=new Set<string>();
 // Frozen actor-bound operation identity survives auth resets, never a bearer.
 const fieldRollbackAttempts=new Map<string,{actor:string;tenantId:string;flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:CustomerFieldInstallReceipt}>();
 let conditionalHistorySequence=0;
 const conditionalHistoryReads=new Map<string,number>();
 const conditionalHistories=new Map<string,ConditionalVersionHistory>();
 const conditionalRollbacks=new Map<string,Exclude<ConditionalRollbackState,{phase:'ready'}>>();
 const conditionalRollbackReads=new Set<string>();
 // Frozen actor-bound operation identity survives auth resets, never a bearer.
 const conditionalRollbackAttempts=new Map<string,{actor:string;tenantId:string;flowId:string;expectedCurrentVersionId:string;targetVersionId:string;targetPublication:ConditionalInstallReceipt}>();
 const fieldRollbackLocked=(tenantId:string)=>[...fieldRollbackAttempts.values()].some(attempt=>attempt.tenantId===tenantId.toLowerCase());
 const requireNoFieldRollback=(tenantId:string)=>{if(conditionalRollbackAttempts.size>0||fieldRollbackLocked(tenantId))throw new PublicationError('not_sent','Rollback outcome is pending or unverified. Check the same frozen target receipt before another writer action.');};
 const rollbackLocked=(tenantId:string)=>{const state=rollbacks.get(tenantId.toLowerCase());return fieldRollbackLocked(tenantId)||state?.phase==='rolling_back'||state?.phase==='unknown';};
 const customerPublications=new Map<string,Exclude<PaidCustomerFieldPublicationState,{phase:'ready'}>>();
 const customerPublicationReads=new Set<string>();
 // Actor-bound uncertainty survives sign-out in memory; it never stores a bearer.
 const customerPublicationAttempts=new Map<string,{actor:string;tenantId:string;flowId:string;draftRevision:number;checkoutOrigin?:string;body?:string;verifiedPublication?:PaidCustomerFieldPublicationReceipt['publication']}>();
 const conditionalPublications=new Map<string,Exclude<PaidConditionalPublicationState,{phase:'ready'}>>();
 const conditionalPublicationReads=new Set<string>();
 const conditionalPublicationAttempts=new Map<string,{actor:string;tenantId:string;flowId:string;draftRevision:number;checkoutOrigin?:string;body?:string;verifiedPublication?:PaidConditionalPublicationReceipt['publication']}>();
 const conditionalPublicationLocked=(tenantId:string)=>conditionalPublicationReads.has(tenantId.toLowerCase())||[...conditionalPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId.toLowerCase());
 const uncertainConditionalDrafts=new Map<string,{actor:string;flowId:string;input:PaidSimpleConditionalDraftInput}>();
 const customerPublicationLocked=(tenantId:string)=>customerPublicationReads.has(tenantId.toLowerCase())||[...customerPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId.toLowerCase());
 const requireNoCustomerPublication=(tenantId:string)=>{if(customerPublicationLocked(tenantId)||conditionalPublicationAttempts.size>0||conditionalPublicationReads.size>0)throw new PublicationError('not_sent','Informational-field publication is pending or unverified. Verify the same frozen attempt before changing drafts or publications.');};
 const requireNoRollback=(tenantId:string,allowCustomerAttempt=false)=>{if(conditionalRollbackAttempts.size>0)throw new PublicationError('not_sent','Conditional rollback is pending or unverified. Check the frozen target receipt before another writer.');if(uncertainConditionalDrafts.size>0)throw new PublicationError('not_sent','Verify the frozen conditional draft save before publication or rollback.');if(!allowCustomerAttempt)requireNoCustomerPublication(tenantId);if(offerLocked())throw new PublicationError('not_sent','Offer creation is pending or unverified. Finish the frozen offer attempt first.');if(businessCreationLocked())throw new PublicationError('not_sent','Business creation is pending or unverified. Finish that same attempt before changing publications.');if(rollbackLocked(tenantId))throw new PublicationError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing drafts or publications.');};
 const savedDraftPublications=new Map<string,Exclude<PaidSimpleSavedDraftPublicationState,{phase:'ready'}>>();
 const uncertainFieldDrafts=new Map<string,{flowId:string;input:PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput}>();
 const ownerDrafts=new Map<string,Exclude<PaidSimpleDraftState,{phase:'ready'}>>();
 async function request(path:string, method='GET', body?:unknown, authenticated=false):Promise<unknown> {
  if(authenticated&&!token)return fail('Please sign in again.');
  const current=generation;
  let response:Response;
  try{response=await transport(base.origin+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{ }), 'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{return fail('Connection unavailable. Check your connection and retry.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  if(!response.ok){if(response.status===401){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();scheduling.clear();return fail('Please sign in again.')}return fail(response.status===403?'Access denied for this account.':'The request was not accepted. Please check your details and retry.')}
  if(response.status===204)return null;
  let parsed:unknown;try{parsed=await response.json()}catch{return fail('The server returned an invalid response.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  return parsed;
 }
 const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?value:fail('The server returned an invalid response.');
 const tenant=(id:string)=>{if(!uuid(id))return fail('Invalid business selection.');return encodeURIComponent(id)};
 async function signIn(email:string,password:string){
  token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();scheduling.clear();
  const attempt=generation;
  const result=await request('/auth/v1/token?grant_type=password','POST',{email,password}) as {access_token?:unknown};
  if(attempt!==generation||typeof result?.access_token!=='string')return fail('Sign-in was not completed.');
  token=result.access_token;
  try{const user=await request('/auth/v1/user','GET',undefined,true) as {id?:unknown};if(!uuid(user?.id))return fail('Sign-in was not completed.');userId=user.id;for(const [tenantId,attempt] of uncertainConditionalDrafts){if(attempt.actor===userId.toLowerCase())ownerDrafts.set(tenantId,{phase:'unverified',flowId:attempt.flowId});}for(const attempt of conditionalPublicationAttempts.values()){if(attempt.actor===userId.toLowerCase())conditionalPublications.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})});}for(const attempt of fieldRollbackAttempts.values()){if(attempt.actor===userId.toLowerCase())fieldRollbacks.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId,targetPublication:attempt.targetPublication});}for(const attempt of conditionalRollbackAttempts.values()){if(attempt.actor===userId.toLowerCase())conditionalRollbacks.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId,targetPublication:attempt.targetPublication});}for(const attempt of customerPublicationAttempts.values()){if(attempt.actor===userId.toLowerCase())customerPublications.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})});}for(const uncertain of uncertainDetailing.values()){if(uncertain.actor===userId.toLowerCase())detailingOffers.set(uncertain.tenantId,{phase:'unknown',attempt:uncertain.attempt});}for(const uncertain of uncertainOffers.values()){if(uncertain.actor===userId)offers.set(uncertain.tenantId,{phase:'unknown',attempt:uncertain.attempt});}for(const uncertain of uncertainScheduling.values()){if(uncertain.actor===userId){scheduling.set(uncertain.tenantId+':'+uncertain.serviceId,{phase:'unknown',attempt:uncertain.attempt});offers.set(uncertain.tenantId,uncertain.offer);}}return userId}catch(error){if(attempt===generation){token=undefined;userId=undefined}throw error}
 }
 function signOut(){token=undefined;userId=undefined;generation++;publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();scheduling.clear()}
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
 function ownerDraft(value:unknown):PaidSimpleOwnerDraft|undefined{
  const v2=exact(value,['schemaVersion','flowId','revision','serviceId','name','presentation','customerFields'])&&(value.schemaVersion===2||value.schemaVersion===3);
  if(!v2&&!exact(value,['flowId','revision','serviceId','name','presentation']))return;
  const data=value as Record<string,unknown>;
  if(!uuid(data.flowId)||!draftRevision(data.revision)||!uuid(data.serviceId)||typeof data.name!=='string'||!data.name.trim()||data.name!==data.name.trim()||data.name.length>200||!presentation(data.presentation))return;
  const fields=v2?(data.schemaVersion===3?ConditionalCustomerFields:CustomerDraftFields).safeParse(data.customerFields):undefined;if(v2&&!fields?.success)return;
  return Object.freeze({...data,presentation:Object.freeze({...data.presentation}),...(fields?.success?{customerFields:Object.freeze(fields.data.map(field=>Object.freeze({...field,...('when' in field&&field.when?{when:Object.freeze({...field.when})}:{})})))}:{})}) as unknown as PaidSimpleOwnerDraft;
 }
 function matchesFieldSave(draft:PaidSimpleOwnerDraft,input:PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput){return draft.schemaVersion===input.schemaVersion&&draft.revision===input.expectedRevision+1&&draft.serviceId===input.serviceId&&draft.name===input.name&&draft.presentation.accentColor===input.presentation.accentColor&&draft.presentation.layout===input.presentation.layout&&JSON.stringify(draft.customerFields)===JSON.stringify(input.customerFields);}
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
   const draft=ownerDraft(entry);
   if(!draft||draft.flowId!==draft.flowId.toLowerCase()||draft.flowId<=previous)throw new PaidSimpleDraftError('not_sent','The saved draft list could not be validated.');
   previous=draft.flowId;result.push(draft);
  }
  // Discovery grants no save, publish or retry authority; selection needs a fresh draft read.
  return Object.freeze(result);
 }
 async function paidPublicationHealth(tenantId:string,flowId:string,expected:PaidInstallReceipt):Promise<PaidInstallHealth>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The publication health service is not configured.');
  if(!uuid(tenantId)||!uuid(flowId)||flowId!==flowId.toLowerCase()||!exact(expected,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(expected.versionId)||!uuid(expected.installationId)||(expected.renderSchemaVersion!==3&&expected.renderSchemaVersion!==4)||expected.hostedPath!=='/checkout/flow/'+expected.installationId)throw new PublicationError('not_sent','Choose a verified publication receipt for this business.');
  const selected={...expected},current=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-simple-flows/'+flowId+'/health?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('not_sent','Install evidence could not be checked. Browser load health remains unverified.');}
  if(current!==generation)throw new PublicationError('not_sent','The session changed. Sign in again before checking install evidence.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('not_sent','Please sign in again to check install evidence.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('not_sent','Only an authorized owner of this active business can check install evidence.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('not_sent','Install evidence is unavailable. The server staging capability is disabled.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('not_sent','Install evidence is unavailable for this publication. This does not verify an uncertain publication or authorize another attempt.');
  }
  const parsed=response.status===200&&exact(value,['ok','data'])&&value.ok===true?PaidInstallHealth.safeParse(value.data):undefined;
  if(!parsed?.success)throw new PublicationError('not_sent','Install evidence could not be validated. Browser load health remains unverified.');
  const health=parsed.data,receipt=health.installation.receipt;
  if(health.flowId!==flowId||health.versionId!==selected.versionId||health.renderSchemaVersion!==selected.renderSchemaVersion||receipt&&(receipt.versionId!==selected.versionId||receipt.installationId!==selected.installationId||receipt.renderSchemaVersion!==selected.renderSchemaVersion||receipt.hostedPath!==selected.hostedPath))throw new PublicationError('not_sent','The current publication no longer matches the selected version and installation. Refresh its receipt before checking evidence again.');
  return health;
 }
 async function paidCustomerFieldPublicationHealth(tenantId:string,expected:PaidCustomerFieldPublicationReceipt):Promise<CustomerFieldInstallHealth>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The publication health service is not configured.');
  if(!uuid(tenantId)||!exact(expected,['flowId','draftRevision','publication'])||!uuid(expected.flowId)||expected.flowId!==expected.flowId.toLowerCase()||!draftRevision(expected.draftRevision)||!exact(expected.publication,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(expected.publication.versionId)||!uuid(expected.publication.installationId)||expected.publication.renderSchemaVersion!==5||expected.publication.hostedPath!=='/checkout/flow/'+expected.publication.installationId)throw new PublicationError('not_sent','Choose a verified customer-field publication receipt for this business.');
  const flowId=expected.flowId,revision=expected.draftRevision,selected={...expected.publication},current=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-customer-field-flows/'+flowId+'/health?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('not_sent','Install evidence could not be checked. Browser load health remains unverified.');}
  if(current!==generation)throw new PublicationError('not_sent','The session changed. Sign in again before checking install evidence.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('not_sent','Please sign in again to check install evidence.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('not_sent','Only an authorized owner of this active business can check install evidence.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('not_sent','Install evidence is unavailable. The server staging capability is disabled.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('not_sent','Install evidence is unavailable for this publication. This does not verify an uncertain publication or authorize another attempt.');
  }
  const parsed=response.status===200&&exact(value,['ok','data'])&&value.ok===true?CustomerFieldInstallHealth.safeParse(value.data):undefined;
  if(!parsed?.success)throw new PublicationError('not_sent','Install evidence could not be validated. Browser load health remains unverified.');
  const health=parsed.data,receipt=health.installation.receipt;
  if(health.flowId!==flowId||health.draftRevision!==revision||health.versionId!==selected.versionId||health.renderSchemaVersion!==selected.renderSchemaVersion||receipt&&(receipt.versionId!==selected.versionId||receipt.installationId!==selected.installationId||receipt.renderSchemaVersion!==selected.renderSchemaVersion||receipt.hostedPath!==selected.hostedPath))throw new PublicationError('not_sent','The current publication no longer matches the selected version and installation. Refresh its receipt before checking evidence again.');
  return health;
 }
 async function paidConditionalPublicationHealth(tenantId:string,expected:PaidConditionalPublicationReceipt):Promise<ConditionalCustomerFieldInstallHealth>{
  if(!token||!userId)throw new PublicationError('not_sent','Please sign in again.');
  if(!bookingApiOrigin)throw new PublicationError('not_sent','The publication health service is not configured.');
  if(!uuid(tenantId)||!exact(expected,['flowId','draftRevision','publication'])||!uuid(expected.flowId)||expected.flowId!==expected.flowId.toLowerCase()||!draftRevision(expected.draftRevision)||!exact(expected.publication,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(expected.publication.versionId)||!uuid(expected.publication.installationId)||expected.publication.versionId!==expected.publication.versionId.toLowerCase()||expected.publication.installationId!==expected.publication.installationId.toLowerCase()||expected.publication.renderSchemaVersion!==6||expected.publication.hostedPath!=='/checkout/flow/'+expected.publication.installationId)throw new PublicationError('not_sent','Choose a verified conditional publication receipt for this business.');
  tenantId=tenantId.toLowerCase();
  const flowId=expected.flowId,revision=expected.draftRevision,selected={...expected.publication},current=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-conditional-customer-field-flows/'+flowId+'/health?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('not_sent','Install evidence could not be checked. Browser load health remains unverified.');}
  if(current!==generation)throw new PublicationError('not_sent','The session changed. Sign in again before checking install evidence.');
  if(!response.ok&&exact(value,['ok','code'])&&value.ok===false){
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('not_sent','Please sign in again to check install evidence.');}
   if(response.status===403&&value.code==='FORBIDDEN')throw new PublicationError('not_sent','Only an authorized owner of this active business can check install evidence.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new PublicationError('not_sent','Install evidence is unavailable. The server staging capability is disabled.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new PublicationError('not_sent','Install evidence is unavailable for this publication. This does not verify an uncertain publication or authorize another attempt.');
  }
  const health=response.status===200&&exact(value,['ok','data'])&&value.ok===true?parseConditionalCustomerFieldInstallHealth(value.data):undefined;
  if(!health)throw new PublicationError('not_sent','Install evidence could not be validated. Browser load health remains unverified.');
  const receipt=health.installation.receipt;
  if(health.flowId!==flowId||health.draftRevision!==revision||health.versionId!==selected.versionId||health.renderSchemaVersion!==selected.renderSchemaVersion||receipt&&(receipt.versionId!==selected.versionId||receipt.installationId!==selected.installationId||receipt.renderSchemaVersion!==selected.renderSchemaVersion||receipt.hostedPath!==selected.hostedPath))throw new PublicationError('not_sent','The current publication no longer matches the selected version and installation. Refresh its receipt before checking evidence again.');
  return health;
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
  draftAuthority(tenantId,flowId);requireNoCustomerPublication(tenantId);
  if(conditionalRollbackAttempts.size>0)throw new PaidSimpleDraftError('not_sent','Conditional rollback is pending or unverified. Check its frozen receipt before changing draft fields.');
  if(offerLocked())throw new PaidSimpleDraftError('not_sent','Offer creation is pending or unverified. Finish the frozen attempt first.');if(businessCreationLocked())throw new PaidSimpleDraftError('not_sent','Business creation is pending or unverified. Finish that same attempt before changing draft fields.');
  if(rollbackLocked(tenantId))throw new PaidSimpleDraftError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing draft fields.');
  const publicationAttempt=savedDraftPublications.get(tenantId);if(publicationAttempt&&publicationAttempt.phase!=='published')throw new PaidSimpleDraftError('not_sent','Saved-draft publication status is unverified. Verify that same publication before changing or loading draft fields.');
  const uncertainConditional=uncertainConditionalDrafts.get(tenantId.toLowerCase());if(uncertainConditional&&(uncertainConditional.actor!==userId!.toLowerCase()||uncertainConditional.flowId!==flowId))throw new PaidSimpleDraftError('not_sent','Load only this actor’s exact frozen conditional draft.');
  const previous=ownerDrafts.get(tenantId.toLowerCase());
  if(previous&&(previous.phase==='saving'||previous.phase==='loading'||(previous.phase==='unverified'||previous.phase==='conflict')&&previous.flowId!==flowId))throw new PaidSimpleDraftError('not_sent','This business has a draft operation in progress or an unverified draft. Load that same draft first.');
  const current=generation,credential=token!;ownerDrafts.set(tenantId.toLowerCase(),{phase:'loading',flowId});
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-simple-flows/'+flowId+'/draft?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
   catch{throw new PaidSimpleDraftError('unknown','The draft could not be loaded. Current persisted fields remain unverified; do not save again yet.');}
   if(current!==generation)throw new PaidSimpleDraftError('unknown','The session changed. Sign in again before loading this draft.');
   const error=draftError(response,value);if(error)throw error;
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   const draft=response.status===200?ownerDraft(data):undefined;
   if(!draft||draft.flowId!==flowId)throw new PaidSimpleDraftError('unknown','The current draft could not be validated. Load this same draft again before saving.');
   const frozen=uncertainConditionalDrafts.get(tenantId.toLowerCase())??uncertainFieldDrafts.get(tenantId.toLowerCase());if(frozen&&'actor' in frozen&&frozen.actor!==userId!.toLowerCase())throw new PaidSimpleDraftError('unknown','An unverified conditional save belongs to another signed-in actor.');
   if(frozen&&(frozen.flowId!==flowId||!matchesFieldSave(draft,frozen.input)))throw new PaidSimpleDraftError('unknown','The current draft does not match the frozen informational-field save. Its outcome remains unverified; do not repeat or replace the save.');
   uncertainFieldDrafts.delete(tenantId.toLowerCase());uncertainConditionalDrafts.delete(tenantId.toLowerCase());
   ownerDrafts.set(tenantId.toLowerCase(),{phase:'loaded',flowId,revision:draft.revision,draft});return draft;
  }catch(error){if(current===generation)ownerDrafts.set(tenantId.toLowerCase(),{phase:'unverified',flowId});throw error;}
 }
 async function savePaidSimpleDraft(tenantId:string,flowId:string,input:{serviceId:string;name:string;presentation:PaidSimplePresentation;expectedRevision:number}):Promise<PaidSimpleDraftReceipt>{return saveDraft(tenantId,flowId,input,1);}
 async function savePaidSimpleCustomerFieldDraft(tenantId:string,flowId:string,input:PaidSimpleFieldDraftInput):Promise<PaidSimpleFieldDraftReceipt>{return saveDraft(tenantId,flowId,input,2) as Promise<PaidSimpleFieldDraftReceipt>;}
 async function savePaidSimpleConditionalDraft(tenantId:string,flowId:string,input:PaidSimpleConditionalDraftInput):Promise<PaidSimpleConditionalDraftReceipt>{return saveDraft(tenantId,flowId,input,3) as Promise<PaidSimpleConditionalDraftReceipt>;}
 async function saveDraft(tenantId:string,flowId:string,input:{serviceId:string;name:string;presentation:PaidSimplePresentation;expectedRevision:number}|PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput,version:1|2|3):Promise<PaidSimpleDraftReceipt|PaidSimpleFieldDraftReceipt|PaidSimpleConditionalDraftReceipt>{
  const v2=version!==1;
  draftAuthority(tenantId,flowId);requireNoCustomerPublication(tenantId);
  if(conditionalRollbackAttempts.size>0)throw new PaidSimpleDraftError('not_sent','Conditional rollback is pending or unverified. Check its frozen receipt before changing draft fields.');
  if(offerLocked())throw new PaidSimpleDraftError('not_sent','Offer creation is pending or unverified. Finish the frozen attempt first.');if(businessCreationLocked())throw new PaidSimpleDraftError('not_sent','Business creation is pending or unverified. Finish that same attempt before changing draft fields.');
  if(rollbackLocked(tenantId))throw new PaidSimpleDraftError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing draft fields.');
  const publicationAttempt=savedDraftPublications.get(tenantId);if(publicationAttempt&&publicationAttempt.phase!=='published')throw new PaidSimpleDraftError('not_sent','Saved-draft publication status is unverified. Verify that same publication before changing or loading draft fields.');
  if(uncertainConditionalDrafts.size>0)throw new PaidSimpleDraftError('not_sent','Load the exact frozen conditional save before another writer.');
  const fieldInput=input as PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput;
  const parsedFields=v2&&exact(input,['schemaVersion','serviceId','name','presentation','expectedRevision','customerFields'])&&fieldInput.schemaVersion===version?(version===3?ConditionalCustomerFields:CustomerDraftFields).safeParse(fieldInput.customerFields):undefined;
  if(!(v2?parsedFields?.success:exact(input,['serviceId','name','presentation','expectedRevision']))||!uuid(input.serviceId)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>200||!presentation(input.presentation)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new PaidSimpleDraftError('not_sent','Check the draft service, name, design choices and expected revision.');
  const previous=ownerDrafts.get(tenantId.toLowerCase());
  if((previous?.phase==='loaded'?(previous.draft.schemaVersion??1):previous?.phase==='saved'?(previous.schemaVersion??1):1)>version)throw new PaidSimpleDraftError('not_sent','This saved draft cannot be downgraded. Use its explicit versioned save without stripping informational fields or conditions.');
  if(previous){
   if(previous.phase!=='saved'&&previous.phase!=='loaded'||previous.flowId!==flowId||previous.revision!==input.expectedRevision)throw new PaidSimpleDraftError('not_sent','Load the current draft before saving. An unverified save cannot be retried or replaced.');
  }else if(input.expectedRevision!==0)throw new PaidSimpleDraftError('not_sent','Load the current draft before saving an existing revision.');
  const requested={...(v2?{schemaVersion:version as 2|3,customerFields:Object.freeze(parsedFields!.data!.map(field=>Object.freeze({...field,...('when' in field&&field.when?{when:Object.freeze({...field.when})}:{})})))}:{}),serviceId:input.serviceId,name:input.name.trim(),presentation:Object.freeze({...input.presentation}),expectedRevision:input.expectedRevision};
  const body=JSON.stringify(requested),current=generation,credential=token!;ownerDrafts.set(tenantId.toLowerCase(),{phase:'saving',flowId});
  if(version===3)uncertainConditionalDrafts.set(tenantId.toLowerCase(),{actor:userId!.toLowerCase(),flowId,input:requested as PaidSimpleConditionalDraftInput});
  if(version===2)uncertainFieldDrafts.set(tenantId.toLowerCase(),{flowId,input:requested as PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput});
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-simple-flows/'+flowId+'/draft?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body});value=await response.json();}
   catch{throw new PaidSimpleDraftError('unknown','Draft save status is unverified. The draft may have been saved. Load this same draft before saving again; do not repeat the save.');}
   if(current!==generation)throw new PaidSimpleDraftError('unknown','The session changed. This draft save outcome cannot be verified here.');
   const error=draftError(response,value);if(error)throw error;
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(data,v2?['schemaVersion','flowId','revision']:['flowId','revision'])||v2&&data.schemaVersion!==version||data.flowId!==flowId||!draftRevision(data.revision)||data.revision!==requested.expectedRevision+1)throw new PaidSimpleDraftError('unknown','The draft save receipt could not be validated. Load this same draft before saving again.');
   const receipt=Object.freeze({...data}) as unknown as PaidSimpleDraftReceipt|PaidSimpleFieldDraftReceipt|PaidSimpleConditionalDraftReceipt;uncertainFieldDrafts.delete(tenantId.toLowerCase());uncertainConditionalDrafts.delete(tenantId.toLowerCase());ownerDrafts.set(tenantId.toLowerCase(),{phase:'saved',flowId,revision:receipt.revision,...(v2?{schemaVersion:version as 2|3}:{})});return receipt;
  }catch(error){if(current===generation){if(error instanceof PaidSimpleDraftError&&(error.delivery==='rejected'||error.delivery==='conflict')){uncertainFieldDrafts.delete(tenantId.toLowerCase());uncertainConditionalDrafts.delete(tenantId.toLowerCase());if(error.delivery==='conflict'){ownerDrafts.set(tenantId.toLowerCase(),{phase:'conflict',flowId});}else if(previous)ownerDrafts.set(tenantId.toLowerCase(),previous);else ownerDrafts.delete(tenantId.toLowerCase());}else ownerDrafts.set(tenantId.toLowerCase(),{phase:error instanceof PaidSimpleDraftError&&error.delivery==='conflict'?'conflict':'unverified',flowId});}throw error;}
 }

 async function publishPaidSimpleDraft(tenantId:string,flowId:string,input:{expectedDraftRevision:number;checkoutOrigin:string}):Promise<PaidSimpleSavedDraftPublicationReceipt>{
  requireNoRollback(tenantId);
  if(!token||!userId||!bookingApiOrigin)throw new PublicationError('not_sent','Sign in with the configured publication service.');
  if(!uuid(tenantId)||!uuid(flowId)||flowId!==flowId.toLowerCase()||!exact(input,['expectedDraftRevision','checkoutOrigin'])||!draftRevision(input.expectedDraftRevision)||!httpsOrigin(input.checkoutOrigin))throw new PublicationError('not_sent','Choose the verified draft revision and Checkout origin.');
  const prior=savedDraftPublications.get(tenantId),publication=publications.get(tenantId),draft=ownerDrafts.get(tenantId.toLowerCase());
  if(draft?.phase==='loaded'&&draft.draft.schemaVersion!==undefined||draft?.phase==='saved'&&draft.schemaVersion!==undefined)throw new PublicationError('not_sent','V2 informational-field drafts cannot be published until the customer renderer supports their exact fields.');
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
   if(prior?.phase==='published')savedDraftPublications.set(tenantId,prior);else savedDraftPublications.delete(tenantId);if(publication)publications.set(tenantId,publication);else publications.delete(tenantId);ownerDrafts.set(tenantId.toLowerCase(),{phase:'conflict',flowId});
   throw new PublicationError('rejected','Saved-draft publication was rejected. Load the current draft before another explicit publication; saved data or eligibility may have changed.');
  }
  unknown();throw new PublicationError('unknown','Saved-draft publication status remains unverified. This response does not prove the earlier attempt failed. Retry only the same frozen revision and origin.');
 }

 const customerPublicationAuthority=(tenantId:string,flowId:string,revision:number)=>{
  if(!token||!userId||!bookingApiOrigin)throw new PublicationError('not_sent','Sign in with the configured publication service.');
  if(!uuid(tenantId)||!uuid(flowId)||!draftRevision(revision))throw new PublicationError('not_sent','Choose the exact business, form and saved revision.');
 };
 const otherPublicationUncertain=(tenantId:string)=>[...recovering].some(id=>id.toLowerCase()===tenantId)||[...publications].some(([id,state])=>id.toLowerCase()===tenantId&&state.phase!=='published')||[...savedDraftPublications].some(([id,state])=>id.toLowerCase()===tenantId&&state.phase!=='published');
 const customerFieldReceipt=(response:Response,value:unknown,flowId:string,revision:number):PaidCustomerFieldPublicationReceipt|undefined=>{
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['flowId','draftRevision','publication'])||data.flowId!==flowId||data.draftRevision!==revision)return undefined;
  const publication=data.publication;
  if(!exact(publication,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(publication.versionId)||publication.versionId!==publication.versionId.toLowerCase()||!uuid(publication.installationId)||publication.installationId!==publication.installationId.toLowerCase()||publication.renderSchemaVersion!==5||publication.hostedPath!==`/checkout/flow/${publication.installationId}`)return undefined;
  return Object.freeze({flowId,draftRevision:revision,publication:Object.freeze({...publication})}) as PaidCustomerFieldPublicationReceipt;
 };
 const matchesCustomerPublication=(receipt:PaidCustomerFieldPublicationReceipt,expected:PaidCustomerFieldPublicationReceipt['publication']|undefined)=>!expected||receipt.publication.versionId===expected.versionId&&receipt.publication.installationId===expected.installationId&&receipt.publication.renderSchemaVersion===expected.renderSchemaVersion&&receipt.publication.hostedPath===expected.hostedPath;
 async function publishPaidCustomerFieldDraft(tenantId:string,flowId:string,input:{expectedDraftRevision:number;checkoutOrigin:string}):Promise<PaidCustomerFieldPublicationReceipt>{
  customerPublicationAuthority(tenantId,flowId,input?.expectedDraftRevision);
  if(!exact(input,['expectedDraftRevision','checkoutOrigin'])||!httpsOrigin(input.checkoutOrigin))throw new PublicationError('not_sent','Choose the verified V2 draft revision and Checkout origin.');
  tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();requireNoRollback(tenantId,true);
  if(conditionalPublicationAttempts.size>0||conditionalPublicationReads.size>0||uncertainConditionalDrafts.size>0||otherPublicationUncertain(tenantId))throw new PublicationError('not_sent','Verify the existing publication attempt before using another publisher.');
  const actor=userId!.toLowerCase(),key=actor+':'+tenantId,prior=customerPublications.get(tenantId),frozen=customerPublicationAttempts.get(key),draft=ownerDrafts.get(tenantId);
  if(customerPublicationReads.has(tenantId)||prior?.phase==='publishing')throw new PublicationError('not_sent','A publication operation is already in progress.');
  if(draft&&draft.phase!=='loaded'&&draft.phase!=='saved')throw new PublicationError('not_sent','Verify the pending or uncertain draft before retrying publication.');
  if([...customerPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId&&attempt.actor!==actor))throw new PublicationError('not_sent','This business has an unverified publication belonging to another signed-in session.');
  if(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===input.expectedDraftRevision&&prior.checkoutOrigin&&prior.checkoutOrigin!==input.checkoutOrigin)throw new PublicationError('not_sent','This published revision is bound to its original Checkout origin.');
  if(frozen){if(!frozen.body||frozen.flowId!==flowId||frozen.draftRevision!==input.expectedDraftRevision||frozen.checkoutOrigin!==input.checkoutOrigin)throw new PublicationError('not_sent','Retry only the original frozen publication body, revision and origin. A read does not authorize a new writer.');}
  else if((draft?.phase!=='loaded'&&draft?.phase!=='saved')||draft.flowId!==flowId||draft.revision!==input.expectedDraftRevision||(draft.phase==='loaded'?draft.draft.schemaVersion!==2:draft.schemaVersion!==2))throw new PublicationError('not_sent','Save or load the exact current V2 informational-field draft before publishing.');
  const attempt=frozen??{actor,tenantId,flowId,draftRevision:input.expectedDraftRevision,checkoutOrigin:input.checkoutOrigin,body:JSON.stringify({expectedDraftRevision:input.expectedDraftRevision,allowedOrigins:[input.checkoutOrigin]}),...(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===input.expectedDraftRevision?{verifiedPublication:prior.receipt.publication}:{})};
  const current=generation,credential=token!,metadata={flowId,draftRevision:attempt.draftRevision,checkoutOrigin:attempt.checkoutOrigin};customerPublicationAttempts.set(key,attempt);customerPublications.set(tenantId,{phase:'publishing',...metadata});
  const unknown=()=>customerPublications.set(tenantId,{phase:'unknown',...metadata});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-customer-field-flows/'+flowId+'/publish-draft?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:attempt.body});value=await response.json();}
  catch{if(current===generation)unknown();throw new PublicationError('unknown','Informational-field publication status is unverified. Check its exact receipt or explicitly retry only the same frozen request.');}
  if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
  const receipt=customerFieldReceipt(response,value,flowId,attempt.draftRevision);
  if(receipt&&matchesCustomerPublication(receipt,attempt.verifiedPublication)){customerPublicationAttempts.delete(key);customerPublications.set(tenantId,{phase:'published',...metadata,receipt});return receipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('unknown','Sign in again to check this same publication attempt.');}
  const statuses:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!frozen&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===statuses[value.code]){customerPublicationAttempts.delete(key);if(prior?.phase==='published')customerPublications.set(tenantId,prior);else customerPublications.delete(tenantId);ownerDrafts.set(tenantId,{phase:'conflict',flowId});throw new PublicationError('rejected',value.code==='UNSUPPORTED_CONFIG'?'Informational-field publication is unavailable in this workspace. The staging capability and service configuration must be supported.':'Publication was rejected. Load the current draft before reviewing another explicit publication.');}
  unknown();throw new PublicationError('unknown','Publication remains unverified. This response does not prove an earlier attempt failed; keep the same frozen revision and origin.');
 }
 async function recoverPaidCustomerFieldPublication(tenantId:string,flowId:string,expectedDraftRevision:number):Promise<PaidCustomerFieldPublicationReceipt>{
  customerPublicationAuthority(tenantId,flowId,expectedDraftRevision);tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();requireNoRollback(tenantId,true);
  if(conditionalPublicationAttempts.size>0||conditionalPublicationReads.size>0||uncertainConditionalDrafts.size>0||otherPublicationUncertain(tenantId))throw new PublicationError('not_sent','Verify the existing publication attempt before checking a different publisher.');
  const actor=userId!.toLowerCase(),key=actor+':'+tenantId,frozen=customerPublicationAttempts.get(key),prior=customerPublications.get(tenantId),draft=ownerDrafts.get(tenantId);
  if(customerPublicationReads.has(tenantId)||prior?.phase==='publishing'||draft&&draft.phase!=='saved'&&draft.phase!=='loaded')throw new PublicationError('not_sent','Wait for pending actions and verify any uncertain save before checking publication.');
  if([...customerPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId&&attempt.actor!==actor)||frozen&&(frozen.flowId!==flowId||frozen.draftRevision!==expectedDraftRevision))throw new PublicationError('not_sent','Check only the exact flow and revision of this actor’s frozen publication attempt.');
  const attempt=frozen??{actor,tenantId,flowId,draftRevision:expectedDraftRevision,...(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===expectedDraftRevision?{verifiedPublication:prior.receipt.publication}:{})};const current=generation,credential=token!,metadata={flowId,draftRevision:expectedDraftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})};customerPublicationAttempts.set(key,attempt);customerPublications.set(tenantId,{phase:'unknown',...metadata});customerPublicationReads.add(tenantId);
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-customer-field-flows/'+flowId+'/publication?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
   catch{throw new PublicationError('unknown','The receipt could not be checked. Publication remains unverified; do not replace its frozen attempt.');}
   if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
   const receipt=customerFieldReceipt(response,value,flowId,expectedDraftRevision);
   if(receipt&&matchesCustomerPublication(receipt,attempt.verifiedPublication)){customerPublicationAttempts.delete(key);customerPublications.set(tenantId,{phase:'published',...metadata,receipt});return receipt;}
   if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();
   throw new PublicationError('unknown','No matching authoritative publication receipt was verified for this flow and revision. A missing, different or unavailable current pointer does not prove the attempt failed.');
  }finally{if(current===generation)customerPublicationReads.delete(tenantId);}
 }

 const conditionalReceipt=(response:Response,value:unknown,flowId:string,revision:number):PaidConditionalPublicationReceipt|undefined=>{
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['flowId','draftRevision','publication'])||data.flowId!==flowId||data.draftRevision!==revision)return undefined;
  const publication=data.publication;
  if(!exact(publication,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(publication.versionId)||publication.versionId!==publication.versionId.toLowerCase()||!uuid(publication.installationId)||publication.installationId!==publication.installationId.toLowerCase()||publication.renderSchemaVersion!==6||publication.hostedPath!==`/checkout/flow/${publication.installationId}`)return undefined;
  return Object.freeze({flowId,draftRevision:revision,publication:Object.freeze({...publication})}) as PaidConditionalPublicationReceipt;
 };
 const matchesConditionalPublication=(receipt:PaidConditionalPublicationReceipt,expected:PaidConditionalPublicationReceipt['publication']|undefined)=>!expected||receipt.publication.versionId===expected.versionId&&receipt.publication.installationId===expected.installationId&&receipt.publication.renderSchemaVersion===expected.renderSchemaVersion&&receipt.publication.hostedPath===expected.hostedPath;
 async function publishPaidConditionalDraft(tenantId:string,flowId:string,input:{expectedDraftRevision:number;checkoutOrigin:string}):Promise<PaidConditionalPublicationReceipt>{
  customerPublicationAuthority(tenantId,flowId,input?.expectedDraftRevision);
  if(!exact(input,['expectedDraftRevision','checkoutOrigin'])||!httpsOrigin(input.checkoutOrigin))throw new PublicationError('not_sent','Choose the verified V3 conditional draft revision and Checkout origin.');
  tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();requireNoRollback(tenantId,true);
  if([...conditionalPublicationAttempts.values()].some(attempt=>attempt.tenantId!==tenantId||attempt.actor!==userId!.toLowerCase())||customerPublicationLocked(tenantId)||uncertainConditionalDrafts.size>0||otherPublicationUncertain(tenantId))throw new PublicationError('not_sent','Verify the existing publication attempt before using another publisher.');
  const actor=userId!.toLowerCase(),key=actor+':'+tenantId,prior=conditionalPublications.get(tenantId),frozen=conditionalPublicationAttempts.get(key),draft=ownerDrafts.get(tenantId);
  if(conditionalPublicationReads.has(tenantId)||prior?.phase==='publishing')throw new PublicationError('not_sent','A publication operation is already in progress.');
  if(draft&&draft.phase!=='loaded'&&draft.phase!=='saved')throw new PublicationError('not_sent','Verify the pending or uncertain draft before retrying publication.');
  if([...conditionalPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId&&attempt.actor!==actor))throw new PublicationError('not_sent','This business has an unverified publication belonging to another signed-in session.');
  if(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===input.expectedDraftRevision&&prior.checkoutOrigin&&prior.checkoutOrigin!==input.checkoutOrigin)throw new PublicationError('not_sent','This published revision is bound to its original Checkout origin.');
  if(frozen){if(!frozen.body||frozen.flowId!==flowId||frozen.draftRevision!==input.expectedDraftRevision||frozen.checkoutOrigin!==input.checkoutOrigin)throw new PublicationError('not_sent','Retry only the original frozen publication body, revision and origin. A read does not authorize a new writer.');}
  else if((draft?.phase!=='loaded'&&draft?.phase!=='saved')||draft.flowId!==flowId||draft.revision!==input.expectedDraftRevision||(draft.phase==='loaded'?draft.draft.schemaVersion!==3:draft.schemaVersion!==3))throw new PublicationError('not_sent','Save or load the exact current V3 conditional informational-field draft before publishing.');
  const attempt=frozen??{actor,tenantId,flowId,draftRevision:input.expectedDraftRevision,checkoutOrigin:input.checkoutOrigin,body:JSON.stringify({expectedDraftRevision:input.expectedDraftRevision,allowedOrigins:[input.checkoutOrigin]}),...(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===input.expectedDraftRevision?{verifiedPublication:prior.receipt.publication}:{})};
  const current=generation,credential=token!,metadata={flowId,draftRevision:attempt.draftRevision,checkoutOrigin:attempt.checkoutOrigin};conditionalPublicationAttempts.set(key,attempt);conditionalPublications.set(tenantId,{phase:'publishing',...metadata});
  const unknown=()=>conditionalPublications.set(tenantId,{phase:'unknown',...metadata});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-conditional-customer-field-flows/'+flowId+'/publish-draft?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:attempt.body});value=await response.json();}
  catch{if(current===generation)unknown();throw new PublicationError('unknown','Informational-field publication status is unverified. Check its exact receipt or explicitly retry only the same frozen request.');}
  if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
  const receipt=conditionalReceipt(response,value,flowId,attempt.draftRevision);
  if(receipt&&matchesConditionalPublication(receipt,attempt.verifiedPublication)){conditionalPublicationAttempts.delete(key);conditionalPublications.set(tenantId,{phase:'published',...metadata,receipt});return receipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new PublicationError('unknown','Sign in again to check this same publication attempt.');}
  const statuses:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!frozen&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===statuses[value.code]){conditionalPublicationAttempts.delete(key);if(prior?.phase==='published')conditionalPublications.set(tenantId,prior);else conditionalPublications.delete(tenantId);ownerDrafts.set(tenantId,{phase:'conflict',flowId});throw new PublicationError('rejected',value.code==='UNSUPPORTED_CONFIG'?'Informational-field publication is unavailable in this workspace. The staging capability and service configuration must be supported.':'Publication was rejected. Load the current draft before reviewing another explicit publication.');}
  unknown();throw new PublicationError('unknown','Publication remains unverified. This response does not prove an earlier attempt failed; keep the same frozen revision and origin.');
 }
 async function recoverPaidConditionalPublication(tenantId:string,flowId:string,expectedDraftRevision:number):Promise<PaidConditionalPublicationReceipt>{
  customerPublicationAuthority(tenantId,flowId,expectedDraftRevision);tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();requireNoRollback(tenantId,true);
  if([...conditionalPublicationAttempts.values()].some(attempt=>attempt.tenantId!==tenantId||attempt.actor!==userId!.toLowerCase())||customerPublicationLocked(tenantId)||uncertainConditionalDrafts.size>0||otherPublicationUncertain(tenantId))throw new PublicationError('not_sent','Verify the existing publication attempt before checking a different publisher.');
  const actor=userId!.toLowerCase(),key=actor+':'+tenantId,frozen=conditionalPublicationAttempts.get(key),prior=conditionalPublications.get(tenantId),draft=ownerDrafts.get(tenantId);
  if(conditionalPublicationReads.has(tenantId)||prior?.phase==='publishing'||draft&&draft.phase!=='saved'&&draft.phase!=='loaded')throw new PublicationError('not_sent','Wait for pending actions and verify any uncertain save before checking publication.');
  if([...conditionalPublicationAttempts.values()].some(attempt=>attempt.tenantId===tenantId&&attempt.actor!==actor)||frozen&&(frozen.flowId!==flowId||frozen.draftRevision!==expectedDraftRevision))throw new PublicationError('not_sent','Check only the exact flow and revision of this actor’s frozen publication attempt.');
  const attempt=frozen??{actor,tenantId,flowId,draftRevision:expectedDraftRevision,...(prior?.phase==='published'&&prior.flowId===flowId&&prior.draftRevision===expectedDraftRevision?{verifiedPublication:prior.receipt.publication}:{})};const current=generation,credential=token!,metadata={flowId,draftRevision:expectedDraftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})};conditionalPublicationAttempts.set(key,attempt);conditionalPublications.set(tenantId,{phase:'unknown',...metadata});conditionalPublicationReads.add(tenantId);
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-conditional-customer-field-flows/'+flowId+'/publication?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}
   catch{throw new PublicationError('unknown','The receipt could not be checked. Publication remains unverified; do not replace its frozen attempt.');}
   if(current!==generation)throw new PublicationError('unknown','The session changed. This publication outcome cannot be verified here.');
   const receipt=conditionalReceipt(response,value,flowId,expectedDraftRevision);
   if(receipt&&matchesConditionalPublication(receipt,attempt.verifiedPublication)){conditionalPublicationAttempts.delete(key);conditionalPublications.set(tenantId,{phase:'published',...metadata,receipt});return receipt;}
   if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();
   throw new PublicationError('unknown','No matching authoritative publication receipt was verified for this flow and revision. A missing, different or unavailable current pointer does not prove the attempt failed.');
  }finally{if(current===generation)conditionalPublicationReads.delete(tenantId);}
 }

 const fieldInstallReceipt=(value:unknown):CustomerFieldInstallReceipt|undefined=>{
  if(!exact(value,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(value.versionId)||!uuid(value.installationId)||value.versionId!==value.versionId.toLowerCase()||value.installationId!==value.installationId.toLowerCase()||(value.renderSchemaVersion!==3&&value.renderSchemaVersion!==5)||value.hostedPath!=='/checkout/flow/'+value.installationId)return;
  return Object.freeze({versionId:value.versionId,installationId:value.installationId,renderSchemaVersion:value.renderSchemaVersion,hostedPath:value.hostedPath});
 };
 const sameFieldInstallation=(left:CustomerFieldInstallReceipt,right:CustomerFieldInstallReceipt)=>left.versionId===right.versionId&&left.installationId===right.installationId&&left.renderSchemaVersion===right.renderSchemaVersion&&left.hostedPath===right.hostedPath;
 const fieldRollbackReceipt=(response:Response,value:unknown,flowId:string):CustomerFieldRollbackReceipt|undefined=>{
  const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(!exact(data,['flowId','versionId','installationId','renderSchemaVersion','hostedPath'])||data.flowId!==flowId)return;
  const receipt=fieldInstallReceipt({versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:data.renderSchemaVersion,hostedPath:data.hostedPath});
  return receipt?Object.freeze({flowId,...receipt}):undefined;
 };
 async function customerFieldVersionHistory(tenantId:string,flowId:string):Promise<CustomerFieldVersionHistory>{
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Choose a valid business and form.');tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();rollbackAuthority(tenantId,flowId);
  const key=tenantId+'|'+flowId,sequence=++fieldHistorySequence;fieldHistoryReads.set(key,sequence);fieldHistories.delete(key);
  const at=generation,credential=token!;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-customer-field-flows/'+flowId+'/versions?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('not_sent','Version history remains unverified. This read does not resolve any uncertain action.');}
  if(at!==generation||fieldHistoryReads.get(key)!==sequence)throw new PublicationError('not_sent','The session or history selection changed. Refresh the selected form history.');
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();
  const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(!exact(data,['flowId','versions'])||data.flowId!==flowId||!Array.isArray(data.versions)||data.versions.length<1||data.versions.length>50)throw new PublicationError('not_sent','The mixed version history could not be validated.');
  const versions:CustomerFieldVersion[]=[],ids=new Set<string>(),installs=new Set<string>();let previous:number|undefined,currentCount=0,v5=false;
  for(const entry of data.versions){
   const fields=entry&&typeof entry==='object'&&!Array.isArray(entry)&&entry.renderSchemaVersion===5;
   if(!exact(entry,['versionId','renderSchemaVersion','draftRevision','name','presentation','current','publication',...(fields?['customerFields']:[])])||!uuid(entry.versionId)||entry.versionId!==entry.versionId.toLowerCase()||ids.has(entry.versionId)||(entry.renderSchemaVersion!==3&&entry.renderSchemaVersion!==5)||!draftRevision(entry.draftRevision)||previous!==undefined&&entry.draftRevision>=previous||typeof entry.name!=='string'||entry.name.length<1||entry.name.length>200||!presentation(entry.presentation)||typeof entry.current!=='boolean')throw new PublicationError('not_sent','The mixed version history could not be validated.');
   const receipt=entry.publication===null?null:fieldInstallReceipt(entry.publication);
   if(receipt===undefined||receipt&&(receipt.versionId!==entry.versionId||receipt.renderSchemaVersion!==entry.renderSchemaVersion||installs.has(receipt.installationId)))throw new PublicationError('not_sent','The history installation binding could not be validated.');
   if(receipt)installs.add(receipt.installationId);ids.add(entry.versionId);previous=entry.draftRevision;if(entry.current)currentCount++;
   const common={versionId:entry.versionId,draftRevision:entry.draftRevision,name:entry.name,presentation:Object.freeze({...entry.presentation}),current:entry.current,publication:receipt};
   if(entry.renderSchemaVersion===5){const parsed=CustomerDraftFields.safeParse(entry.customerFields);if(!parsed.success)throw new PublicationError('not_sent','Pinned informational fields could not be validated.');v5=true;versions.push(Object.freeze({...common,renderSchemaVersion:5,customerFields:Object.freeze(parsed.data.map(field=>Object.freeze({...field,...('when' in field&&field.when?{when:Object.freeze({...field.when})}:{})})))}));}
   else versions.push(Object.freeze({...common,renderSchemaVersion:3}));
  }
  if(!v5||currentCount!==1)throw new PublicationError('not_sent','Choose a verified form history with one current publication.');
  const result=Object.freeze({flowId,versions:Object.freeze(versions)});fieldHistories.set(key,result);return result;
 }
 async function rollbackCustomerFieldPublication(tenantId:string,flowId:string,input:{expectedCurrentVersionId:string;targetVersionId:string}):Promise<CustomerFieldRollbackReceipt>{
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Choose a valid business and form.');tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();rollbackAuthority(tenantId,flowId);requireNoRollback(tenantId);
  if(writerUncertain(tenantId))throw new PublicationError('not_sent','Verify uncertain draft and publication operations before rollback.');
  if(!exact(input,['expectedCurrentVersionId','targetVersionId'])||!uuid(input.expectedCurrentVersionId)||!uuid(input.targetVersionId))throw new PublicationError('not_sent','Review a verified current and prior target version.');
  const expected=input.expectedCurrentVersionId.toLowerCase(),targetId=input.targetVersionId.toLowerCase(),history=fieldHistories.get(tenantId+'|'+flowId),current=history?.versions.find(v=>v.current),target=history?.versions.find(v=>v.versionId===targetId);
  if(!current?.publication||current.versionId!==expected||!target?.publication||target.current||target.draftRevision>=current.draftRevision)throw new PublicationError('not_sent','Refresh mixed version history and review a prior version with a verified installation.');
  const attempt={actor:userId!.toLowerCase(),tenantId,flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:target.publication},key=attempt.actor+':'+tenantId,at=generation,credential=token!;
  const previous=fieldRollbacks.get(tenantId);fieldRollbackAttempts.set(key,attempt);fieldRollbacks.set(tenantId,{phase:'rolling_back',flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:target.publication});fieldHistories.delete(tenantId+'|'+flowId);fieldHistoryReads.delete(tenantId+'|'+flowId);
  const unknown=()=>{if(at===generation&&fieldRollbackAttempts.get(key)===attempt)fieldRollbacks.set(tenantId,{phase:'unknown',flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:attempt.targetPublication});};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-customer-field-flows/'+flowId+'/rollback?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({expectedCurrentVersionId:expected,targetVersionId:targetId})});value=await response.json();}catch{unknown();throw new PublicationError('unknown','Rollback outcome is unverified. Do not repeat the action; explicitly check this frozen target receipt.');}
  if(at!==generation||fieldRollbackAttempts.get(key)!==attempt)throw new PublicationError('unknown','The session changed. Check this same rollback after fresh sign-in.');
  const receipt=fieldRollbackReceipt(response,value,flowId);
  if(receipt&&sameFieldInstallation(receipt,attempt.targetPublication)){fieldRollbackAttempts.delete(key);fieldRollbacks.set(tenantId,{phase:'verified',flowId,receipt});return receipt;}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422};
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){fieldRollbackAttempts.delete(key);if(previous?.phase==='verified')fieldRollbacks.set(tenantId,previous);else fieldRollbacks.delete(tenantId);throw new PublicationError('rejected','Rollback was rejected. Refresh history and review eligibility before any new explicit action.');}
  unknown();if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('unknown','Rollback outcome remains unverified. Check the frozen target receipt without repeating rollback.');
 }
 async function reconcileCustomerFieldRollback(tenantId:string):Promise<CustomerFieldRollbackReceipt>{
  if(!uuid(tenantId)||!userId)throw new PublicationError('not_sent','Sign in with the same account and business.');tenantId=tenantId.toLowerCase();const key=userId.toLowerCase()+':'+tenantId,attempt=fieldRollbackAttempts.get(key),state=fieldRollbacks.get(tenantId);
  if(!attempt||state?.phase!=='unknown')throw new PublicationError('not_sent','Only a settled uncertain rollback can be checked by the same actor.');rollbackAuthority(tenantId,attempt.flowId);
  if(fieldRollbackReads.has(tenantId))throw new PublicationError('not_sent','The rollback receipt is already being checked.');const at=generation,credential=token!;fieldRollbackReads.add(tenantId);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-customer-field-flows/'+attempt.flowId+'/rollback-receipt?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('unknown','The current rollback receipt is unavailable. The frozen operation remains locked.');}
   if(at!==generation||fieldRollbackAttempts.get(key)!==attempt)throw new PublicationError('unknown','The session changed. The rollback remains unverified.');
   const receipt=fieldRollbackReceipt(response,value,attempt.flowId);
   if(receipt&&sameFieldInstallation(receipt,attempt.targetPublication)){fieldRollbackAttempts.delete(key);fieldRollbacks.set(tenantId,{phase:'verified',flowId:attempt.flowId,receipt});return receipt;}
   if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('unknown','The current receipt does not verify the frozen target and installation. Rollback remains locked; do not repeat the writer.');
  }finally{if(at===generation)fieldRollbackReads.delete(tenantId);}
 }
 const conditionalInstallReceipt=(value:unknown):ConditionalInstallReceipt|undefined=>{
  if(!exact(value,['versionId','installationId','renderSchemaVersion','hostedPath'])||!uuid(value.versionId)||!uuid(value.installationId)||value.versionId!==value.versionId.toLowerCase()||value.installationId!==value.installationId.toLowerCase()||(value.renderSchemaVersion!==3&&value.renderSchemaVersion!==5&&value.renderSchemaVersion!==6)||value.hostedPath!=='/checkout/flow/'+value.installationId)return;
  return Object.freeze({versionId:value.versionId,installationId:value.installationId,renderSchemaVersion:value.renderSchemaVersion,hostedPath:value.hostedPath});
 };
 const sameConditionalInstallation=(left:ConditionalInstallReceipt,right:ConditionalInstallReceipt)=>left.versionId===right.versionId&&left.installationId===right.installationId&&left.renderSchemaVersion===right.renderSchemaVersion&&left.hostedPath===right.hostedPath;
 const conditionalRollbackReceipt=(response:Response,value:unknown,flowId:string):ConditionalRollbackReceipt|undefined=>{
  const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(!exact(data,['flowId','versionId','installationId','renderSchemaVersion','hostedPath'])||data.flowId!==flowId)return;
  const receipt=conditionalInstallReceipt({versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:data.renderSchemaVersion,hostedPath:data.hostedPath});
  return receipt?Object.freeze({flowId,...receipt}):undefined;
 };
 async function conditionalVersionHistory(tenantId:string,flowId:string):Promise<ConditionalVersionHistory>{
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Choose a valid business and form.');tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();rollbackAuthority(tenantId,flowId);
  const key=tenantId+'|'+flowId,sequence=++conditionalHistorySequence;conditionalHistoryReads.set(key,sequence);conditionalHistories.delete(key);
  const at=generation,credential=token!;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-conditional-customer-field-flows/'+flowId+'/versions?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('not_sent','Version history remains unverified. This read does not resolve any uncertain action.');}
  if(at!==generation||conditionalHistoryReads.get(key)!==sequence)throw new PublicationError('not_sent','The session or history selection changed. Refresh the selected form history.');
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();
  const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(!exact(data,['flowId','versions'])||data.flowId!==flowId||!Array.isArray(data.versions)||data.versions.length<1||data.versions.length>50)throw new PublicationError('not_sent','The mixed version history could not be validated.');
  const versions:ConditionalVersion[]=[],ids=new Set<string>(),installs=new Set<string>();let previous:number|undefined,currentCount=0,v6=false;
  for(const entry of data.versions){
   const fields=entry&&typeof entry==='object'&&!Array.isArray(entry)&&(entry.renderSchemaVersion===5||entry.renderSchemaVersion===6);
   if(!exact(entry,['versionId','renderSchemaVersion','draftRevision','name','presentation','current','publication',...(fields?['customerFields']:[])])||!uuid(entry.versionId)||entry.versionId!==entry.versionId.toLowerCase()||ids.has(entry.versionId)||(entry.renderSchemaVersion!==3&&entry.renderSchemaVersion!==5&&entry.renderSchemaVersion!==6)||!draftRevision(entry.draftRevision)||previous!==undefined&&entry.draftRevision>=previous||typeof entry.name!=='string'||entry.name.length<1||entry.name.length>200||!presentation(entry.presentation)||typeof entry.current!=='boolean')throw new PublicationError('not_sent','The mixed version history could not be validated.');
   const receipt=entry.publication===null?null:conditionalInstallReceipt(entry.publication);
   if(receipt===undefined||receipt&&(receipt.versionId!==entry.versionId||receipt.renderSchemaVersion!==entry.renderSchemaVersion||installs.has(receipt.installationId)))throw new PublicationError('not_sent','The history installation binding could not be validated.');
   if(receipt)installs.add(receipt.installationId);ids.add(entry.versionId);previous=entry.draftRevision;if(entry.current)currentCount++;
   const common={versionId:entry.versionId,draftRevision:entry.draftRevision,name:entry.name,presentation:Object.freeze({...entry.presentation}),current:entry.current,publication:receipt};
   if(entry.renderSchemaVersion===5){const parsed=CustomerDraftFields.safeParse(entry.customerFields);if(!parsed.success)throw new PublicationError('not_sent','Pinned informational fields could not be validated.');versions.push(Object.freeze({...common,renderSchemaVersion:5,customerFields:Object.freeze(parsed.data.map(field=>Object.freeze({...field})))}));}
   else if(entry.renderSchemaVersion===6){const parsed=ConditionalCustomerFields.safeParse(entry.customerFields);if(!parsed.success)throw new PublicationError('not_sent','Pinned conditional fields could not be validated.');v6=true;versions.push(Object.freeze({...common,renderSchemaVersion:6,customerFields:Object.freeze(parsed.data.map(field=>Object.freeze({...field,...(field.when?{when:Object.freeze({...field.when})}:{})})))}));}
   else versions.push(Object.freeze({...common,renderSchemaVersion:3}));
  }
  if(!v6||currentCount!==1)throw new PublicationError('not_sent','Choose a verified form history with one current publication.');
  const result=Object.freeze({flowId,versions:Object.freeze(versions)});conditionalHistories.set(key,result);return result;
 }
 async function rollbackConditionalPublication(tenantId:string,flowId:string,input:{expectedCurrentVersionId:string;targetVersionId:string}):Promise<ConditionalRollbackReceipt>{
  if(!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Choose a valid business and form.');tenantId=tenantId.toLowerCase();flowId=flowId.toLowerCase();rollbackAuthority(tenantId,flowId);requireNoRollback(tenantId);
  if(fieldRollbackAttempts.size>0||customerPublicationAttempts.size>0||conditionalPublicationAttempts.size>0||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...savedDraftPublications.keys(),...ownerDrafts.keys()].some(id=>writerUncertain(id.toLowerCase())))throw new PublicationError('not_sent','Verify uncertain draft and publication operations before rollback.');
  if(!exact(input,['expectedCurrentVersionId','targetVersionId'])||!uuid(input.expectedCurrentVersionId)||!uuid(input.targetVersionId))throw new PublicationError('not_sent','Review a verified current and prior target version.');
  const expected=input.expectedCurrentVersionId.toLowerCase(),targetId=input.targetVersionId.toLowerCase(),history=conditionalHistories.get(tenantId+'|'+flowId),current=history?.versions.find(v=>v.current),target=history?.versions.find(v=>v.versionId===targetId);
  if(!current?.publication||current.versionId!==expected||!target?.publication||target.current||target.draftRevision>=current.draftRevision)throw new PublicationError('not_sent','Refresh mixed version history and review a prior version with a verified installation.');
  const attempt={actor:userId!.toLowerCase(),tenantId,flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:target.publication},key=attempt.actor+':'+tenantId,at=generation,credential=token!;
  const previous=conditionalRollbacks.get(tenantId);conditionalRollbackAttempts.set(key,attempt);conditionalRollbacks.set(tenantId,{phase:'rolling_back',flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:target.publication});conditionalHistories.delete(tenantId+'|'+flowId);conditionalHistoryReads.delete(tenantId+'|'+flowId);
  const unknown=()=>{if(at===generation&&conditionalRollbackAttempts.get(key)===attempt)conditionalRollbacks.set(tenantId,{phase:'unknown',flowId,expectedCurrentVersionId:expected,targetVersionId:targetId,targetPublication:attempt.targetPublication});};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin!+'/api/paid-conditional-customer-field-flows/'+flowId+'/rollback?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({expectedCurrentVersionId:expected,targetVersionId:targetId})});value=await response.json();}catch{unknown();throw new PublicationError('unknown','Rollback outcome is unverified. Do not repeat the action; explicitly check this frozen target receipt.');}
  if(at!==generation||conditionalRollbackAttempts.get(key)!==attempt)throw new PublicationError('unknown','The session changed. Check this same rollback after fresh sign-in.');
  const receipt=conditionalRollbackReceipt(response,value,flowId);
  if(receipt&&sameConditionalInstallation(receipt,attempt.targetPublication)){conditionalRollbackAttempts.delete(key);conditionalRollbacks.set(tenantId,{phase:'verified',flowId,receipt});return receipt;}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422};
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){conditionalRollbackAttempts.delete(key);if(previous?.phase==='verified')conditionalRollbacks.set(tenantId,previous);else conditionalRollbacks.delete(tenantId);throw new PublicationError('rejected','Rollback was rejected. Refresh history and review eligibility before any new explicit action.');}
  unknown();if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('unknown','Rollback outcome remains unverified. Check the frozen target receipt without repeating rollback.');
 }
 async function reconcileConditionalRollback(tenantId:string):Promise<ConditionalRollbackReceipt>{
  if(!uuid(tenantId)||!userId)throw new PublicationError('not_sent','Sign in with the same account and business.');tenantId=tenantId.toLowerCase();const key=userId.toLowerCase()+':'+tenantId,attempt=conditionalRollbackAttempts.get(key),state=conditionalRollbacks.get(tenantId);
  if(!attempt||state?.phase!=='unknown')throw new PublicationError('not_sent','Only a settled uncertain rollback can be checked by the same actor.');rollbackAuthority(tenantId,attempt.flowId);
  if(conditionalRollbackReads.has(tenantId))throw new PublicationError('not_sent','The rollback receipt is already being checked.');const at=generation,credential=token!;conditionalRollbackReads.add(tenantId);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-conditional-customer-field-flows/'+attempt.flowId+'/rollback-receipt?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PublicationError('unknown','The current rollback receipt is unavailable. The frozen operation remains locked.');}
   if(at!==generation||conditionalRollbackAttempts.get(key)!==attempt)throw new PublicationError('unknown','The session changed. The rollback remains unverified.');
   const receipt=conditionalRollbackReceipt(response,value,attempt.flowId);
   if(receipt&&sameConditionalInstallation(receipt,attempt.targetPublication)){conditionalRollbackAttempts.delete(key);conditionalRollbacks.set(tenantId,{phase:'verified',flowId:attempt.flowId,receipt});return receipt;}
   if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('unknown','The current receipt does not verify the frozen target and installation. Rollback remains locked; do not repeat the writer.');
  }finally{if(at===generation)conditionalRollbackReads.delete(tenantId);}
 }
 const rollbackAuthority=(tenantId:string,flowId:string)=>{
  if(!token||!userId||!bookingApiOrigin)throw new PublicationError('not_sent','Sign in with the configured publication service.');
  if(!uuid(tenantId)||tenantId!==tenantId.toLowerCase()||!uuid(flowId)||flowId!==flowId.toLowerCase())throw new PublicationError('not_sent','Choose the exact business and form ID.');
 };
 const writerUncertain=(tenantId:string)=>{
  const matches=(id:string)=>id.toLowerCase()===tenantId;
  return conditionalRollbackAttempts.size>0||uncertainConditionalDrafts.has(tenantId)||conditionalPublicationLocked(tenantId)||fieldRollbackLocked(tenantId)||customerPublicationLocked(tenantId)||[...recovering].some(matches)||[...publications].some(([id,state])=>matches(id)&&state.phase!=='published')||[...savedDraftPublications].some(([id,state])=>matches(id)&&state.phase!=='published')||[...ownerDrafts].some(([id,state])=>matches(id)&&state.phase!=='saved'&&state.phase!=='loaded');
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


 const creationBody=(input:CreateBusiness)=>JSON.stringify({name:input.name,slug:input.slug,timezone:input.timezone,currency:input.currency,businessType:input.businessType,idempotencyKey:input.idempotencyKey});
 async function createBusiness(input:CreateBusiness):Promise<BusinessProfile>{
  if(!token||!userId||!bookingApiOrigin)throw new BusinessOnboardingError('not_sent','Sign in with the configured business onboarding service.');
  const parsed=CreateBusiness.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Check the business name, slug, named timezone, uppercase currency and fixed business type.');
  const body=Object.freeze({...parsed.data}),prior=businessCreation,binding=businessAttempts.get(parsed.data.idempotencyKey);
  if(binding&&(binding.actor!==userId||binding.body!==creationBody(body)))throw new BusinessOnboardingError('not_sent','This creation key is bound to its original signed-in account and reviewed details. Do not reuse it for another account or changed details.');
  if(prior.phase==='checking'||prior.phase==='creating')throw new BusinessOnboardingError('not_sent','This business creation is still in progress.');
  if(prior.phase==='created')throw new BusinessOnboardingError('not_sent','This session already has a created business. Open its verified owner membership.');
  if(prior.phase==='unavailable')throw new BusinessOnboardingError('unavailable','Business onboarding is unavailable. The server capability must be enabled in staging.');
  if(prior.phase==='unknown'&&creationBody(prior.attempt)!==creationBody(body))throw new BusinessOnboardingError('not_sent','The uncertain attempt is locked to its original key and all original business details.');
  if(offerLocked())throw new BusinessOnboardingError('not_sent','Offer creation is pending or unverified. Finish the frozen offer attempt first.');
  if((fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase())))throw new BusinessOnboardingError('not_sent','Verify pending or uncertain drafts, publications and rollbacks before creating a different business.');
  const at=generation,actor=userId,credential=token;businessAttempts.set(body.idempotencyKey,{actor,body:creationBody(body)});
  businessCreation={phase:'checking',attempt:body};
  try{
   const memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));
   if(at!==generation||userId!==actor)throw new BusinessOnboardingError('not_sent','The signed-in account changed. This attempt was not sent.');
   if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||(memberships.length>0&&!memberships.some(row=>row.role==='BUSINESS_OWNER')))throw new BusinessOnboardingError('not_sent','Creation requires a verified business owner or a successful fresh membership lookup with no assigned businesses.');
  }catch(error){if(at===generation)businessCreation=prior;throw error instanceof BusinessOnboardingError?error:new BusinessOnboardingError('not_sent','Fresh business membership could not be verified. No creation request was sent.');}
  businessCreation={phase:'creating',attempt:body};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/businesses',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:creationBody(body)});value=await response.json();}
  catch{if(at===generation)businessCreation={phase:'unknown',attempt:body};throw new BusinessOnboardingError('unknown','Business creation outcome is unverified. Retry only this same key and unchanged business details; do not start another attempt.');}
  if(at!==generation||userId!==actor)throw new BusinessOnboardingError('unknown','The signed-in account changed. This creation outcome cannot be verified here.');
  const result=exact(value,['ok','data'])&&value.ok===true&&response.status===200?BusinessProfile.safeParse(value.data):undefined;
  if(result?.success&&result.data.businessType===body.businessType){const profile=Object.freeze({...result.data});businessCreation={phase:'created',attempt:body,profile};return profile;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in again with the same account to verify this creation attempt.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(prior.phase!=='unknown'&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){
   businessCreation=value.code==='UNSUPPORTED_CONFIG'?{phase:'unavailable'}:{phase:'ready'};
   throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected',value.code==='UNSUPPORTED_CONFIG'?'Business onboarding is unavailable. The server capability must be enabled in staging.':'Business creation was rejected. Review the details and slug before another explicit attempt.');
  }
  businessCreation={phase:'unknown',attempt:body};throw new BusinessOnboardingError('unknown','Business creation remains unverified. This response does not prove an earlier attempt failed; retry only the same frozen key and details.');
 }
 const offerBody=(input:CreateSimpleOffer)=>JSON.stringify({name:input.name,description:input.description,price:{amount:input.price.amount,currency:input.price.currency},durationMinutes:input.durationMinutes,idempotencyKey:input.idempotencyKey});
 async function ownerBusinessContext(tenantId:string):Promise<OwnerBusinessContext>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified business.');
  tenantId=tenantId.toLowerCase();const at=generation,actor=userId,credential=token;
  const current=()=>at===generation&&actor===userId&&credential===token;
  let memberships:Record<string,unknown>[];
  try{memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));}catch{throw new BusinessOnboardingError('not_sent','Owner membership could not be verified.');}
  if(!current())throw new BusinessOnboardingError('not_sent','The signed-in account changed. Check this business again.');
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(member=>String(member.tenant_id).toLowerCase()===tenantId&&member.role==='BUSINESS_OWNER'))throw new BusinessOnboardingError('not_sent','Fresh owner membership for this exact business is required.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/profile?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','The business profile could not be verified.');}
  if(!current())throw new BusinessOnboardingError('not_sent','The signed-in account changed. Check this business again.');
  if(response.status===401){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again.');}
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined,profile=exact(data,['schemaVersion','profile'])&&data.schemaVersion===1?data.profile:undefined;
  if(response.status!==200||!exact(profile,['id','name','slug','timezone','currency','status'])||typeof profile.id!=='string'||profile.id.toLowerCase()!==tenantId||typeof profile.name!=='string'||!profile.name.trim()||typeof profile.slug!=='string'||!profile.slug||!BusinessTimezone.safeParse(profile.timezone).success||!CurrencyCode.safeParse(profile.currency).success||profile.status!=='active')throw new BusinessOnboardingError('not_sent','The active business profile could not be verified.');
  return Object.freeze({tenantId,name:profile.name,slug:profile.slug,timezone:profile.timezone as string,currency:profile.currency as string,status:'active'});
 }
 async function simpleOfferContext(tenantId:string):Promise<SimpleOfferContext>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified business.');
  tenantId=tenantId.toLowerCase();const at=generation,actor=userId,credential=token;
  const memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string'))throw new BusinessOnboardingError('not_sent','Owner membership data is invalid.');
  if(!memberships.some(member=>String(member.tenant_id).toLowerCase()===tenantId&&member.role==='BUSINESS_OWNER'))throw new BusinessOnboardingError('not_sent','Fresh owner membership for this exact business is required.');
  const business=await businessProfile(tenantId);
  if(business.status!=='initialized'||business.profile.businessType!=='HOUSEKEEPING')throw new BusinessOnboardingError('not_sent','The current housekeeping profile could not be verified.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/profile?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','Business currency remains unverified.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed. Check the business again.');
  if(response.status===401){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again.');}
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined,profile=exact(data,['schemaVersion','profile'])&&data.schemaVersion===1?data.profile:undefined;
  if(response.status!==200||!exact(profile,['id','name','slug','timezone','currency','status'])||typeof profile.id!=='string'||profile.id.toLowerCase()!==tenantId||typeof profile.name!=='string'||!profile.name.trim()||typeof profile.slug!=='string'||!profile.slug||!BusinessTimezone.safeParse(profile.timezone).success||profile.status!=='active'||!CurrencyCode.safeParse(profile.currency).success)throw new BusinessOnboardingError('not_sent','The active business currency profile could not be verified.');
  return Object.freeze({tenantId,currency:profile.currency as string,timezone:profile.timezone as string});
 }
 async function createSimpleOffer(tenantId:string,input:CreateSimpleOffer):Promise<SimpleOfferReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified business.');
  tenantId=tenantId.toLowerCase();const parsed=CreateSimpleOffer.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Use a positive safe integer price in minor units and a duration from 5 to 1440 minutes.');
  const body=Object.freeze({...parsed.data,price:Object.freeze({...parsed.data.price})}),serialized=offerBody(body),actor=userId,at=generation,credential=token,prior=offers.get(tenantId),binding=offerAttempts.get(body.idempotencyKey);
  if(binding&&(binding.actor!==actor||binding.tenantId!==tenantId||binding.body!==serialized))throw new BusinessOnboardingError('not_sent','The offer key is bound to its original account, business and reviewed details.');
  if(prior&&prior.phase!=='unknown')throw new BusinessOnboardingError('not_sent','This session offer is already pending or created.');
  if(prior?.phase==='unknown'&&offerBody(prior.attempt)!==serialized)throw new BusinessOnboardingError('not_sent','The uncertain offer is locked to its unchanged details and original key.');
  if(detailingLocked()||profileInitializationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||schedulingLocked()||businessCreationLocked()||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase()))||[...offers.entries()].some(([id,state])=>id!==tenantId&&state.phase!=='created'))throw new BusinessOnboardingError('not_sent','Resolve pending or uncertain business, draft, publication or rollback actions first.');
  offerAttempts.set(body.idempotencyKey,{actor,tenantId,body:serialized});offers.set(tenantId,{phase:'checking',attempt:body});
  try{const context=await simpleOfferContext(tenantId);if(context.currency!==body.price.currency)throw new BusinessOnboardingError('not_sent','The reviewed currency no longer matches the current business.');if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The account changed before sending.');}catch(error){if(at===generation){if(prior)offers.set(tenantId,prior);else offers.delete(tenantId);}throw error;}
  offers.set(tenantId,{phase:'creating',attempt:body});uncertainOffers.set(actor+':'+tenantId,{actor,tenantId,attempt:body});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/simple-offers?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:serialized});value=await response.json();}catch{if(at===generation)offers.set(tenantId,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Offer creation is unverified. Retry only the same account, business, key and reviewed details.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('unknown','The account changed. This offer outcome cannot be verified here.');
  const result=response.status===200&&exact(value,['ok','data'])&&value.ok===true?SimpleOfferReceipt.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId&&result.data.service.name===body.name&&result.data.service.description===body.description&&result.data.service.price.amount===body.price.amount&&result.data.service.price.currency===body.price.currency&&result.data.service.durationMinutes===body.durationMinutes){const receipt=Object.freeze({...result.data,service:Object.freeze({...result.data.service,price:Object.freeze({...result.data.service.price})})});uncertainOffers.delete(actor+':'+tenantId);offers.set(tenantId,{phase:'created',attempt:body,receipt});return receipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in again with the same account to check the frozen attempt.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!prior&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){uncertainOffers.delete(actor+':'+tenantId);offers.delete(tenantId);throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected',value.code==='UNSUPPORTED_CONFIG'?'Offer authoring is unavailable. The server staging capability is disabled.':'Offer creation was rejected. Check current owner access and reviewed details.');}
  offers.set(tenantId,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Offer creation remains unverified. This response does not prove an earlier attempt failed. Keep the original frozen details and key.');
 }
 const detailingBody=(input:CreateDetailingOffer)=>JSON.stringify(CreateDetailingOffer.parse(input));
 async function detailingOfferContext(tenantId:string):Promise<SimpleOfferContext>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified business.');
  tenantId=tenantId.toLowerCase();const at=generation,actor=userId,credential=token;
  const memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string'))throw new BusinessOnboardingError('not_sent','Owner membership data is invalid.');
  if(!memberships.some(member=>String(member.tenant_id).toLowerCase()===tenantId&&member.role==='BUSINESS_OWNER'))throw new BusinessOnboardingError('not_sent','Fresh owner membership for this exact business is required.');
  const business=await businessProfile(tenantId);
  if(business.status!=='initialized'||business.profile.businessType!=='AUTO_DETAILING')throw new BusinessOnboardingError('not_sent','The current auto detailing profile could not be verified.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/profile?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','Business currency remains unverified.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed. Check the business again.');
  if(response.status===401){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again.');}
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined,profile=exact(data,['schemaVersion','profile'])&&data.schemaVersion===1?data.profile:undefined;
  if(response.status!==200||!exact(profile,['id','name','slug','timezone','currency','status'])||typeof profile.id!=='string'||profile.id.toLowerCase()!==tenantId||typeof profile.name!=='string'||!profile.name.trim()||typeof profile.slug!=='string'||!profile.slug||!BusinessTimezone.safeParse(profile.timezone).success||profile.status!=='active'||!CurrencyCode.safeParse(profile.currency).success)throw new BusinessOnboardingError('not_sent','The active business currency profile could not be verified.');
  return Object.freeze({tenantId,currency:profile.currency as string,timezone:profile.timezone as string});
 }
 async function createDetailingOffer(tenantId:string,input:CreateDetailingOffer):Promise<DetailingOfferReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified business.');
  tenantId=tenantId.toLowerCase();const parsed=CreateDetailingOffer.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Check ordered package, vehicle, addon and location rates, safe integer minor units and duration from 5 to 1440 minutes.');
  const body=immutableDetailing(parsed.data),serialized=detailingBody(body),actor=userId.toLowerCase(),at=generation,credential=token,prior=detailingOffers.get(tenantId),binding=detailingAttempts.get(body.idempotencyKey);
  if(binding&&(binding.actor!==actor||binding.tenantId!==tenantId||binding.body!==serialized))throw new BusinessOnboardingError('not_sent','The offer key is bound to its original account, business and reviewed details.');
  if(prior&&prior.phase!=='unknown')throw new BusinessOnboardingError('not_sent','This session offer is already pending or created.');
  if(prior?.phase==='unknown'&&detailingBody(prior.attempt)!==serialized)throw new BusinessOnboardingError('not_sent','The uncertain offer is locked to its unchanged details and original key.');
  if(uncertainOffers.size>0||uncertainScheduling.size>0||[...uncertainDetailing.values()].some(entry=>entry.actor!==actor||entry.tenantId!==tenantId)||[...detailingOffers.entries()].some(([id,state])=>id!==tenantId&&state.phase!=='created')||profileInitializationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||schedulingLocked()||businessCreationLocked()||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase()))||[...offers.values()].some(state=>state.phase!=='created'))throw new BusinessOnboardingError('not_sent','Resolve pending or uncertain business, draft, publication or rollback actions first.');
  detailingAttempts.set(body.idempotencyKey,{actor,tenantId,body:serialized});detailingOffers.set(tenantId,{phase:'checking',attempt:body});
  try{const context=await detailingOfferContext(tenantId);if(context.currency!==body.currency)throw new BusinessOnboardingError('not_sent','The reviewed currency no longer matches the current business.');if(at!==generation||actor!==userId?.toLowerCase())throw new BusinessOnboardingError('not_sent','The account changed before sending.');}catch(error){if(at===generation){if(prior)detailingOffers.set(tenantId,prior);else detailingOffers.delete(tenantId);}throw error;}
  detailingOffers.set(tenantId,{phase:'creating',attempt:body});uncertainDetailing.set(actor+':'+tenantId,{actor,tenantId,attempt:body});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/detailing-offers?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:serialized});value=await response.json();}catch{if(at===generation)detailingOffers.set(tenantId,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Offer creation is unverified. Retry only the same account, business, key and reviewed details.');}
  if(at!==generation||actor!==userId?.toLowerCase())throw new BusinessOnboardingError('unknown','The account changed. This offer outcome cannot be verified here.');
  const result=response.status===200&&exact(value,['ok','data'])&&value.ok===true?DetailingOfferReceipt.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId&&JSON.stringify(result.data.service)===JSON.stringify(buildDetailingService(result.data.service.id,tenantId,body))){const receipt=immutableDetailing(result.data);uncertainDetailing.delete(actor+':'+tenantId);detailingOffers.set(tenantId,{phase:'created',attempt:body,receipt});return receipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in again with the same account to check the frozen attempt.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!prior&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){uncertainDetailing.delete(actor+':'+tenantId);detailingOffers.delete(tenantId);throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected',value.code==='UNSUPPORTED_CONFIG'?'Offer authoring is unavailable. The server staging capability is disabled.':'Offer creation was rejected. Check current owner access and reviewed details.');}
  detailingOffers.set(tenantId,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Offer creation remains unverified. This response does not prove an earlier attempt failed. Keep the original frozen details and key.');
 }
 async function readDetailingOffer(tenantId:string,serviceId:string):Promise<DetailingOfferReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(serviceId))throw new BusinessOnboardingError('not_sent','Sign in and select a valid detailing business and service.');
  const at=generation,credential=token,actor=userId,context=await detailingOfferContext(tenantId);
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed.');let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/detailing-offers/'+serviceId.toLowerCase()+'?tenantId='+context.tenantId,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','Detailing catalog read remains unverified.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed.');
  if(response.status===401){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again.');}
  const parsed=response.status===200&&exact(value,['ok','data'])&&value.ok===true?DetailingOfferReceipt.safeParse(value.data):undefined;
  if(!parsed?.success||parsed.data.tenantId!==context.tenantId||parsed.data.service.id!==serviceId.toLowerCase()||parsed.data.service.currency!==context.currency)throw new BusinessOnboardingError('not_sent','The current detailing catalog receipt could not be verified.');
  return immutableDetailing(parsed.data);
 }
 const schedulingBody=(input:CreateOfferScheduling)=>JSON.stringify({timezone:input.timezone,windows:input.windows.map(window=>({weekday:window.weekday,startMinute:window.startMinute,endMinute:window.endMinute,capacity:window.capacity})),policy:{leadTimeMinutes:input.policy.leadTimeMinutes,horizonDays:input.policy.horizonDays,slotIntervalMinutes:input.policy.slotIntervalMinutes},idempotencyKey:input.idempotencyKey});
 async function createOfferScheduling(tenantId:string,serviceId:string,input:CreateOfferScheduling):Promise<OfferSchedulingReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(serviceId))throw new BusinessOnboardingError('not_sent','Sign in and select the verified owner-created offer.');
  tenantId=tenantId.toLowerCase();serviceId=serviceId.toLowerCase();const parsed=CreateOfferScheduling.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Check same-day hours, sorted unique weekdays, fixed capacity and bounded policy.');
  const offer=offers.get(tenantId);if(offer?.phase!=='created'||offer.receipt.service.id!==serviceId)throw new BusinessOnboardingError('not_sent','A verified owner-created offer receipt is required.');
  if(parsed.data.windows.some(window=>window.endMinute-window.startMinute<offer.receipt.service.durationMinutes))throw new BusinessOnboardingError('not_sent','Each same-day window must fit the verified offer duration.');
  const body=Object.freeze({...parsed.data,windows:Object.freeze(parsed.data.windows.map(window=>Object.freeze({...window}))),policy:Object.freeze({...parsed.data.policy})}) as unknown as CreateOfferScheduling;
  const key=tenantId+':'+serviceId,actor=userId,at=generation,credential=token,serialized=schedulingBody(body),prior=scheduling.get(key),binding=schedulingAttempts.get(body.idempotencyKey);
  if(binding&&(binding.actor!==actor||binding.tenantId!==tenantId||binding.serviceId!==serviceId||binding.body!==serialized))throw new BusinessOnboardingError('not_sent','This scheduling key is bound to its original account, business, offer and reviewed settings.');
  if(prior&&prior.phase!=='unknown')throw new BusinessOnboardingError('not_sent','Scheduling is already pending or configured for this session offer.');
  if(prior?.phase==='unknown'&&schedulingBody(prior.attempt)!==serialized)throw new BusinessOnboardingError('not_sent','The uncertain scheduling attempt is locked to its original key and unchanged settings.');
  if(detailingLocked()||profileInitializationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||businessCreationLocked()||[...offers.values()].some(state=>state.phase!=='created')||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase()))||[...scheduling.entries()].some(([id,state])=>id!==key&&state.phase!=='configured'))throw new BusinessOnboardingError('not_sent','Resolve uncertain offers, drafts, publications, rollbacks or other scheduling before this action.');
  schedulingAttempts.set(body.idempotencyKey,{actor,tenantId,serviceId,body:serialized});scheduling.set(key,{phase:'checking',attempt:body});
  try{const context=await simpleOfferContext(tenantId);if(context.timezone!==body.timezone)throw new BusinessOnboardingError('not_sent','The reviewed timezone no longer matches the current business.');if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The account changed before sending scheduling.');}catch(error){if(at===generation){if(prior)scheduling.set(key,prior);else scheduling.delete(key);}throw error;}
  scheduling.set(key,{phase:'creating',attempt:body});uncertainScheduling.set(actor+':'+key,{actor,tenantId,serviceId,attempt:body,offer});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/simple-offers/'+serviceId+'/scheduling?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:serialized});value=await response.json();}catch{if(at===generation)scheduling.set(key,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Scheduling creation is unverified. Retry only the same account, business, offer, key and settings.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('unknown','The account changed. This scheduling outcome cannot be verified here.');
  const result=response.status===200&&exact(value,['ok','data'])&&value.ok===true?OfferSchedulingReceipt.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId&&result.data.serviceId===serviceId&&schedulingReceiptMatches(result.data,body)){const receipt=result.data;uncertainScheduling.delete(actor+':'+key);scheduling.set(key,{phase:'configured',attempt:body,receipt:JSON.parse(JSON.stringify(receipt)) as OfferSchedulingReceipt});return JSON.parse(JSON.stringify(receipt)) as OfferSchedulingReceipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in with the same account to check the frozen scheduling attempt.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!prior&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){uncertainScheduling.delete(actor+':'+key);scheduling.delete(key);throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected',value.code==='UNSUPPORTED_CONFIG'?'Scheduling authoring is unavailable. The server staging capability is disabled.':'Scheduling was rejected. Check current owner access, hours and existing configuration.');}
  scheduling.set(key,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Scheduling remains unverified. This response does not prove an earlier attempt failed. Keep the frozen key and settings.');
 }
 const initializationBody=(input:BusinessProfileInitializationInput)=>JSON.stringify({businessType:input.businessType,idempotencyKey:input.idempotencyKey});
 async function initializeBusinessProfile(tenantId:string,input:BusinessProfileInitializationInput):Promise<BusinessProfile>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Sign in and choose a verified existing business.');
  const parsed=InitializeBusinessProfile.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Choose one fixed permanent business type and a valid attempt key.');
  tenantId=tenantId.toLowerCase();const body=Object.freeze({...parsed.data}),serialized=initializationBody(body),prior=profileInitializations.get(tenantId),binding=profileInitializationKeys.get(body.idempotencyKey);
  if(binding&&(binding.actor!==userId||binding.tenantId!==tenantId||binding.body!==serialized)||prior&&prior.actor!==userId&&prior.state.phase!=='initialized')throw new BusinessOnboardingError('not_sent','This frozen initialization belongs to its original account, business, type and key.');
  if(prior?.state.phase==='checking'||prior?.state.phase==='initializing'||prior?.state.phase==='initialized'||prior?.state.phase==='unavailable')throw new BusinessOnboardingError('not_sent','Initialization is already in progress, verified or unavailable. Check its existing state.');
  if(prior?.state.phase==='unknown'&&initializationBody(prior.state.attempt)!==serialized)throw new BusinessOnboardingError('not_sent','Keep the same frozen initialization key and permanent type.');
  if([...profileInitializations].some(([id,value])=>id!==tenantId&&['checking','initializing','unknown'].includes(value.state.phase))||offerOperationsLocked()||businessCreationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase())))throw new BusinessOnboardingError('not_sent','Resolve other pending or uncertain owner operations before initializing this business.');
  const at=generation,actor=userId,credential=token;profileInitializationKeys.set(body.idempotencyKey,{actor,tenantId,body:serialized});profileInitializations.set(tenantId,{actor,state:{phase:'checking',attempt:body}});
  try{
   const memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));
   if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(row=>String(row.tenant_id).toLowerCase()===tenantId&&row.role==='BUSINESS_OWNER'))throw new BusinessOnboardingError('not_sent','Fresh exact owner membership for this existing business could not be verified.');
   if(prior?.state.phase!=='unknown'){const profile=await businessProfile(tenantId);if(profile.status!=='uninitialized')throw new BusinessOnboardingError('not_sent','This business already has a permanent initialized type. It cannot be changed here.');}
   if(at!==generation||userId!==actor)throw new BusinessOnboardingError('not_sent','The signed-in account changed. No initialization request was sent.');
  }catch(error){if(prior)profileInitializations.set(tenantId,prior);else if(error instanceof BusinessOnboardingError&&error.delivery==='unavailable')profileInitializations.set(tenantId,{actor,state:{phase:'unavailable'}});else profileInitializations.delete(tenantId);throw error instanceof BusinessOnboardingError?error:new BusinessOnboardingError('not_sent','Fresh owner and uninitialized business evidence could not be verified.');}
  profileInitializations.set(tenantId,{actor,state:{phase:'initializing',attempt:body}});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/business-profile/initialize?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:serialized});value=await response.json();}
  catch{profileInitializations.set(tenantId,{actor,state:{phase:'unknown',attempt:body}});throw new BusinessOnboardingError('unknown','Business type initialization is unverified. Retry only this same account, business, frozen key and permanent type.');}
  if(at!==generation||userId!==actor){profileInitializations.set(tenantId,{actor,state:{phase:'unknown',attempt:body}});throw new BusinessOnboardingError('unknown','The signed-in account changed. This initialization outcome remains unverified.');}
  const result=exact(value,['ok','data'])&&value.ok===true&&response.status===200?BusinessProfile.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId&&result.data.businessType===body.businessType){const profile=Object.freeze({...result.data});profileInitializations.set(tenantId,{actor,state:{phase:'initialized',attempt:body,profile}});return profile;}
  profileInitializations.set(tenantId,{actor,state:{phase:'unknown',attempt:body}});
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in again with the same account to verify this frozen initialization.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,CONFLICT:409,UNSUPPORTED_CONFIG:422};
  if(prior?.state.phase!=='unknown'&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){if(value.code==='UNSUPPORTED_CONFIG')profileInitializations.set(tenantId,{actor,state:{phase:'unavailable'}});else profileInitializations.delete(tenantId);throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected','Business type initialization was rejected or is unavailable. Recheck the current business type before another reviewed attempt.');}
  throw new BusinessOnboardingError('unknown','Business type initialization remains unverified. A read or later rejection cannot prove which attempt succeeded. Keep the same frozen key and type.');
 }
 function businessProfileInitializationState(tenantId:string):BusinessProfileInitializationState{
  if(!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Choose a valid business.');const entry=profileInitializations.get(tenantId.toLowerCase());if(!entry)return {phase:'ready'};
  if(entry.actor!==userId)return ['checking','initializing','unknown'].includes(entry.state.phase)?{phase:'blocked'}:{phase:'ready'};
  return JSON.parse(JSON.stringify(entry.state)) as BusinessProfileInitializationState;
 }
 async function businessProfile(tenantId:string):Promise<BusinessProfileRead>{
  if(!token||!userId||!bookingApiOrigin)throw new BusinessOnboardingError('not_sent','Sign in with the configured business profile service.');
  if(!uuid(tenantId))throw new BusinessOnboardingError('not_sent','Choose a valid business.');const at=generation,credential=token;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/business-profile?tenantId='+encodeURIComponent(tenantId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','The current business type could not be checked.');}
  if(at!==generation)throw new BusinessOnboardingError('not_sent','The signed-in account changed. Check this business again.');
  const result=exact(value,['ok','data'])&&value.ok===true&&response.status===200?BusinessProfile.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId.toLowerCase())return Object.freeze({status:'initialized',profile:Object.freeze({...result.data})});
  if(exact(value,['ok','code'])&&value.ok===false){
   if(response.status===404&&value.code==='NOT_AVAILABLE')return Object.freeze({status:'uninitialized',tenantId:tenantId.toLowerCase()});
   if(response.status===401&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again to check this business type.');}
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new BusinessOnboardingError('unavailable','Business profile onboarding is unavailable in this workspace.');
   if(response.status===403&&value.code==='FORBIDDEN')throw new BusinessOnboardingError('not_sent','Only an authorized owner can check this business type.');
  }
  throw new BusinessOnboardingError('not_sent','The business type receipt could not be validated.');
 }

 return {
  createBusiness,businessProfile,initializeBusinessProfile,businessProfileInitializationState,
  businessProfileInitializationLocked:profileInitializationLocked,
  ownerBusinessContext,simpleOfferContext,createSimpleOffer,createOfferScheduling,detailingOfferContext,createDetailingOffer,readDetailingOffer,
  detailingOfferState(tenantId:string):DetailingOfferState {if(!uuid(tenantId))return fail('Invalid business selection.');const state=detailingOffers.get(tenantId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as DetailingOfferState:{phase:'ready'};},
  offerSchedulingState(tenantId:string,serviceId:string):OfferSchedulingState {const state=scheduling.get(tenantId.toLowerCase()+':'+serviceId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as OfferSchedulingState:{phase:'ready'};},
  simpleOfferState(tenantId:string):SimpleOfferState {const state=offers.get(tenantId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as SimpleOfferState:{phase:'ready'};},
  simpleOfferLocked:()=>conditionalRollbackAttempts.size>0||offerLocked()||conditionalPublicationAttempts.size>0||uncertainConditionalDrafts.size>0,
  simpleOfferRecoveryTenant():string|undefined {return [...uncertainDetailing.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...conditionalRollbackAttempts.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...uncertainConditionalDrafts.entries()].find(([,entry])=>entry.actor===userId?.toLowerCase())?.[0]??[...conditionalPublicationAttempts.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...profileInitializations.entries()].find(([,entry])=>entry.actor===userId&&entry.state.phase==='unknown')?.[0]??[...offers.entries()].find(([,state])=>state.phase==='unknown')?.[0]??[...scheduling.entries()].find(([,state])=>state.phase==='unknown')?.[0].split(':')[0];},
  businessCreationState():BusinessCreationState{return businessCreation.phase==='created'?{...businessCreation,attempt:{...businessCreation.attempt},profile:{...businessCreation.profile}}:businessCreation.phase==='ready'||businessCreation.phase==='unavailable'?{...businessCreation}:{...businessCreation,attempt:{...businessCreation.attempt}};},
  signIn,signOut,
  conditionalVersionHistory,rollbackConditionalPublication,reconcileConditionalRollback,
  conditionalRollbackState(tenantId:string):ConditionalRollbackState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=conditionalRollbacks.get(tenantId.toLowerCase());return state?.phase==='verified'?{...state,receipt:{...state.receipt}}:state?{...state,targetPublication:{...state.targetPublication}}:{phase:'ready'};},
  customerFieldVersionHistory,rollbackCustomerFieldPublication,reconcileCustomerFieldRollback,
  customerFieldRollbackState(tenantId:string):CustomerFieldRollbackState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=fieldRollbacks.get(tenantId.toLowerCase());return state?.phase==='verified'?{...state,receipt:{...state.receipt}}:state?{...state,targetPublication:{...state.targetPublication}}:{phase:'ready'};},
  rollbackPaidSimplePublication,reconcilePaidSimpleRollback,
  paidSimpleRollbackState(tenantId:string):PaidSimpleRollbackState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=rollbacks.get(tenantId.toLowerCase());return state?.phase==='verified'?{...state,receipt:{...state.receipt}}:state?{...state,targetPublication:{...state.targetPublication}}:{phase:'ready'};},
  publishPaidCustomerFieldDraft,recoverPaidCustomerFieldPublication,publishPaidConditionalDraft,recoverPaidConditionalPublication,
  paidConditionalPublicationState(tenantId:string):PaidConditionalPublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=conditionalPublications.get(tenantId.toLowerCase());return state?.phase==='published'?{...state,receipt:{...state.receipt,publication:{...state.receipt.publication}}}:state?{...state}:{phase:'ready'};},
  paidCustomerFieldPublicationState(tenantId:string):PaidCustomerFieldPublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=customerPublications.get(tenantId.toLowerCase());return state?.phase==='published'?{...state,receipt:{...state.receipt,publication:{...state.receipt.publication}}}:state?{...state}:{phase:'ready'};},
  publishPaidSimpleDraft,publishPaidSimple,recoverPaidSimplePublication,listPaidSimplePublications,listPaidSimpleDrafts,paidSimpleVersionHistory,paidPublicationHealth,paidCustomerFieldPublicationHealth,paidConditionalPublicationHealth,loadPaidSimpleDraft,savePaidSimpleDraft,savePaidSimpleCustomerFieldDraft,savePaidSimpleConditionalDraft,
  paidSimpleSavedDraftPublicationState(tenantId:string):PaidSimpleSavedDraftPublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=savedDraftPublications.get(tenantId);return state?.phase==='published'?{...state,receipt:{...state.receipt,publication:{...state.receipt.publication}}}:state?{...state}:{phase:'ready'};},
  paidSimpleDraftState(tenantId:string):PaidSimpleDraftState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=ownerDrafts.get(tenantId.toLowerCase());return state?.phase==='loaded'?{...state,draft:{...state.draft,presentation:{...state.draft.presentation},...(state.draft.schemaVersion===2?{customerFields:state.draft.customerFields.map(field=>({...field}))}:{})}}:state?{...state}:{phase:'ready'};},
  paidSimplePublicationState(tenantId:string):PaidSimplePublicationState{if(!uuid(tenantId))return fail('Invalid business selection.');const state=publications.get(tenantId);return state?.phase==='published'?{...state,receipt:{...state.receipt}}:state?{...state}:{phase:'ready'};},
  async services(tenantId=config.tenantId,member=false):Promise<ServiceRow[]>{
   const result=rows(await request(`/rest/v1/services?select=id,tenant_id,name,currency,duration_minutes,base_price,active&tenant_id=eq.${tenant(tenantId)}&archetype=eq.simple${member?'':'&active=eq.true'}&order=name`,'GET',undefined,member));
   return result.map(r=>{if(r.tenant_id!==tenantId||!uuid(r.id)||typeof r.name!=='string'||typeof r.currency!=='string'||!Number.isSafeInteger(r.duration_minutes)||Number(r.duration_minutes)<5||!Number.isSafeInteger(r.base_price)||Number(r.base_price)<0||typeof r.active!=='boolean')return fail('Catalog data is invalid.');return r as unknown as ServiceRow});
  },
  async saveDraft(input:DraftInput):Promise<{booking_id:string;reference:string}>{
   if(detailingLocked()||uncertainConditionalDrafts.size>0||conditionalPublicationAttempts.size>0||conditionalPublicationReads.size>0)throw new PaidSimpleDraftError('not_sent','Verify the frozen conditional operation before another draft writer.');
   if(profileInitializationLocked())return fail('Business type initialization is pending or unverified. Finish that same frozen attempt first.');
   requireNoFieldRollback(config.tenantId);
   if(!uuid(config.tenantId))return fail('A valid business is required before submitting a booking.');
   if(!uuid(input.serviceId)||input.idempotencyKey.length<16||!Number.isFinite(Date.parse(input.slotStart))||Date.parse(input.slotEnd)<=Date.parse(input.slotStart)||!Number.isFinite(Date.parse(input.slotEnd)))return fail('Check the requested service and date.');
   const result=rows(await request('/rest/v1/rpc/create_booking_draft','POST',{p_tenant_id:config.tenantId,p_idempotency_key:input.idempotencyKey,p_selection:{serviceId:input.serviceId,archetype:'simple'},p_slot_start:input.slotStart,p_slot_end:input.slotEnd,p_customer:input.customer}))[0];
   if(!result||!uuid(result.booking_id)||typeof result.reference!=='string')return fail('The saved response could not be verified. Retry this same request.');
   return {booking_id:result.booking_id,reference:result.reference};
  },
  async memberships():Promise<Membership[]>{if(!userId)return fail('Please sign in again.');return rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(userId)}`,'GET',undefined,true)).map(r=>{if(!exact(r,['tenant_id','role'])||!uuid(r.tenant_id)||typeof r.role!=='string')return fail('Membership data could not be verified.');return r as unknown as Membership})},
  async bookings(tenantId:string):Promise<BookingRow[]>{
   const result=rows(await request(`/rest/v1/bookings?select=id,tenant_id,reference,state,slot_start,created_at&tenant_id=eq.${tenant(tenantId)}&order=created_at.desc&limit=100`,'GET',undefined,true));
   return result.map(r=>{if(!uuid(r.id)||r.tenant_id!==tenantId||typeof r.reference!=='string'||typeof r.state!=='string'||!['draft','pending_payment','confirmed','completed','cancelled','refunded','failed'].includes(r.state)||typeof r.slot_start!=='string'||!Number.isFinite(Date.parse(r.slot_start))||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at)))return fail('Booking data is invalid.');return r as unknown as BookingRow});
  },
  async bookingDetail(tenantId:string,bookingId:string):Promise<ConnectedBookingDetail|null>{
   const select='id,tenant_id,reference,state,slot_start,slot_end,created_at,selection,pricing,customer_id,payment_id,address,notes,customer:customers(id,tenant_id,name,email,phone),payment:payments!bookings_payment_id_fkey(id,tenant_id,booking_id,state,amount,currency,provider),history:booking_state_history(booking_id,from_state,to_state,reason,at)';
   return parseBookingDetail(await request(`/rest/v1/bookings?select=${encodeURIComponent(select)}&tenant_id=eq.${tenant(tenantId)}&id=eq.${tenant(bookingId)}&limit=1`,'GET',undefined,true),tenantId,bookingId);
  },
  async drafts(tenantId:string):Promise<DraftRow[]>{return rows(await request(`/rest/v1/bookings?select=id,reference,state,slot_start,created_at&tenant_id=eq.${tenant(tenantId)}&state=eq.draft&order=created_at.desc&limit=100`,'GET',undefined,true)).map(r=>{if(!uuid(r.id)||typeof r.reference!=='string'||r.state!=='draft'||typeof r.slot_start!=='string'||typeof r.created_at!=='string')return fail();return r as unknown as DraftRow})},
  async setServiceActive(tenantId:string,id:string,active:boolean){if(uncertainConditionalDrafts.size>0)throw new BusinessOnboardingError('not_sent','Verify the frozen conditional draft save before changing the catalog.');requireNoFieldRollback(tenantId);requireNoCustomerPublication(tenantId);if(offerLocked())throw new BusinessOnboardingError('not_sent','Offer creation is pending or unverified. Finish the frozen attempt before changing the catalog.');await request(`/rest/v1/services?tenant_id=eq.${tenant(tenantId)}&id=eq.${tenant(id)}`,'PATCH',{active},true)},
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


