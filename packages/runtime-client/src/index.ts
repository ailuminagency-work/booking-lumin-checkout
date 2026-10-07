export interface PaidJourneyAvailability {readonly schemaVersion:1;readonly serviceId:string;readonly durationMinutes:number;readonly slots:readonly Readonly<{start:string;end:string;remainingCapacity:number}>[]}
export interface PaidJourneyAvailabilityWindow {readonly from:string;readonly to:string}
export class PaidJourneyAvailabilityError extends Error {constructor(readonly code:'INVALID_REQUEST'|'EXPIRED'|'ABORTED'|'STALE_CONTEXT'|'REJECTED'|'UNVERIFIED',message:string){super(message);}}
export class PaidJourneyCustomerFieldRenderError extends Error {constructor(readonly code:'INVALID_REQUEST'|'ABORTED'|'STALE_CONTEXT'|'REJECTED'|'UNVERIFIED',message:string){super(message);}}
export interface PaidJourneyOwnerPublication {readonly schemaVersion:1;readonly tenantId:string;readonly flowId:string;readonly draftRevision:number;readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:8;readonly allowedOrigins:readonly string[];readonly render:PaidJourneyRender}
export interface PaidJourneyCustomerSession {readonly schemaVersion:1;readonly sessionToken:string;readonly expiresAt:string;readonly render:PaidJourneyRender}
export interface PaidJourneyHoldInput {readonly schemaVersion:1;readonly idempotencyKey:string;readonly requestedStart:string;readonly customer:Readonly<{name:string;email:string}>;readonly answers:Readonly<Record<string,never>>}
export interface PaidJourneyHoldReceipt {readonly schemaVersion:1;readonly versionId:string;readonly installationId:string;readonly serviceId:string;readonly bookingId:string;readonly reference:string;readonly state:'draft';readonly confirmed:false;readonly paymentMode:'unavailable';readonly slot:Readonly<{start:string;end:string}>;readonly holdId:string;readonly status:'active';readonly expiresAt:string;readonly replayed:boolean}
export type PaidJourneyHoldState=Readonly<{phase:'ready'|'holding'|'unknown'|'blocked'}>|Readonly<{phase:'held';receipt:PaidJourneyHoldReceipt}>;
export class PaidJourneyHoldError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'unknown',message:string){super(message);}}
export class PaidJourneyHoldRecoveryError extends Error {constructor(readonly code:'INVALID_REQUEST'|'UNVERIFIED',message:string){super(message);}}
export interface PaidJourneyPaymentReceipt {readonly schemaVersion:1;readonly versionId:string;readonly installationId:string;readonly serviceId:string;readonly bookingId:string;readonly paymentId:string;readonly reference:string;readonly state:'confirmed';readonly replayed:boolean;readonly provider:'staging_mock';readonly simulated:true;readonly amount:number;readonly currency:string}
export type PaidJourneyPaymentState=Readonly<{phase:'ready'|'paying'|'unknown'|'blocked'}>|Readonly<{phase:'confirmed';receipt:PaidJourneyPaymentReceipt}>;
export class PaidJourneyPaymentError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'unknown',message:string){super(message);}}
export class PaidJourneySessionError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'unknown',message:string){super(message);}}
export interface PaidJourneyPublishInput {readonly schemaVersion:1;readonly expectedDraftRevision:number;readonly allowedOrigins:readonly string[]}
export interface PaidJourneyPublicationReceipt {readonly schemaVersion:1;readonly tenantId:string;readonly flowId:string;readonly draftRevision:number;readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:8;readonly replayed:boolean}
export type PaidJourneyPublicationState={phase:'ready'}|{phase:'publishing'|'unknown'|'conflict';flowId:string;draftRevision:number}|{phase:'published';flowId:string;draftRevision:number;receipt:PaidJourneyPublicationReceipt};
import {PaidJourney,PaidJourneyRender,type PaidJourneySnapshot} from '@lumin/workflow';
import {PaidJourneyCustomerFieldForm,PaidJourneyCustomerFieldRender} from '@lumin/workflow';
export interface PaidJourneyCustomerFieldPublishInput {readonly schemaVersion:2;readonly expectedDraftRevision:number;readonly allowedOrigins:readonly string[]}
export interface PaidJourneyCustomerFieldPublicationReceipt {readonly schemaVersion:2;readonly tenantId:string;readonly flowId:string;readonly draftRevision:number;readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:9;readonly replayed:boolean}
export interface PaidJourneyCustomerFieldOwnerPublication extends Omit<PaidJourneyCustomerFieldPublicationReceipt,'replayed'> {readonly allowedOrigins:readonly string[];readonly render:PaidJourneyCustomerFieldRender}
export type PaidJourneyCustomerFieldPublicationState={phase:'ready'}|{phase:'publishing'|'unknown'|'conflict';flowId:string;draftRevision:number}|{phase:'published';flowId:string;draftRevision:number;receipt:PaidJourneyCustomerFieldPublicationReceipt};
export interface PaidJourneyCustomerFieldDraftInput {readonly schemaVersion:2;readonly serviceId:string;readonly expectedRevision:number;readonly form:PaidJourneyCustomerFieldForm}
export interface PaidJourneyCustomerFieldDraftReceipt {readonly schemaVersion:2;readonly tenantId:string;readonly flowId:string;readonly revision:number}
export interface PaidJourneyCustomerFieldOwnerDraft extends PaidJourneyCustomerFieldDraftReceipt {readonly serviceId:string;readonly form:PaidJourneyCustomerFieldForm}
export type PaidJourneyCustomerFieldDraftState={phase:'ready'}|{phase:'saving'|'loading'|'unverified'|'conflict';flowId:string}|{phase:'saved';flowId:string;revision:number}|{phase:'loaded';flowId:string;revision:number;draft:PaidJourneyCustomerFieldOwnerDraft};
export interface PaidJourneyDraftInput {readonly schemaVersion:1;readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly expectedRevision:number;readonly journey:PaidJourney}
export interface PaidJourneyDraftReceipt {readonly schemaVersion:1;readonly tenantId:string;readonly flowId:string;readonly revision:number}
export interface PaidJourneyOwnerDraft extends PaidJourneyDraftReceipt {readonly serviceId:string;readonly name:string;readonly presentation:PaidSimplePresentation;readonly journey:PaidJourneySnapshot}
export type PaidJourneyDraftState={phase:'ready'}|{phase:'saving'|'loading'|'unverified'|'conflict';flowId:string}|{phase:'saved';flowId:string;revision:number}|{phase:'loaded';flowId:string;revision:number;draft:PaidJourneyOwnerDraft};
export class PaidJourneyDraftError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'conflict'|'unknown',message:string){super(message);}}
export interface PaidJourneyVersionInstallation {readonly versionId:string;readonly installationId:string;readonly renderSchemaVersion:8;readonly hostedPath:string}
export interface PaidJourneyVersionHistory {readonly schemaVersion:1;readonly tenantId:string;readonly flowId:string;readonly versions:readonly Readonly<{versionId:string;draftRevision:number;name:string;journey:PaidJourneySnapshot;presentation:PaidSimplePresentation;current:boolean;publication:PaidJourneyVersionInstallation|null}>[]}
export interface PaidJourneyRollbackInput {readonly expectedCurrentVersionId:string;readonly targetVersionId:string}
export interface PaidJourneyRollbackReceipt extends PaidJourneyVersionInstallation {readonly schemaVersion:1;readonly tenantId:string;readonly flowId:string;readonly draftRevision:number}
export type PaidJourneyRollbackState=Readonly<{phase:'ready'}>|Readonly<{phase:'rolling_back'|'unknown';flowId:string;expectedCurrentVersionId:string;targetVersionId:string}>|Readonly<{phase:'verified';receipt:PaidJourneyRollbackReceipt}>;
import {OwnerBookingFormAnswers} from '@lumin/contracts';
export type {OwnerBookingFormAnswers} from '@lumin/contracts';
export class BookingFormAnswersError extends Error {constructor(readonly code:'INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_AVAILABLE'|'UNSUPPORTED_CONFIG'|'STALE_CONTEXT'|'ABORTED'|'UNVERIFIED',message:string){super(message);}}
import {ConfirmationReceiptHistory} from '@lumin/contracts';
export type {ConfirmationReceiptHistory} from '@lumin/contracts';
export class ConfirmationReceiptHistoryError extends Error {constructor(readonly code:'INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_AVAILABLE'|'UNSUPPORTED_CONFIG'|'STALE_CONTEXT'|'UNVERIFIED',message:string){super(message);}}
import {ConfirmationReceiptStatus} from '@lumin/contracts';
export type {ConfirmationReceiptStatus} from '@lumin/contracts';
export class ConfirmationReceiptStatusError extends Error {constructor(readonly code:'INVALID_REQUEST'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_AVAILABLE'|'UNSUPPORTED_CONFIG'|'STALE_CONTEXT'|'UNVERIFIED',message:string){super(message);}}
import {NotificationPlannerReceipt,SaveNotificationPlannerConfig} from '@lumin/contracts';
export type {NotificationPlannerReceipt,SaveNotificationPlannerConfig,StrictNotificationPlannerConfig} from '@lumin/contracts';
export class NotificationPlannerError extends Error {constructor(readonly delivery:'not_sent'|'rejected'|'conflict'|'unavailable'|'unknown',message:string){super(message);}}
import {CreateDetailingScheduling,DetailingSchedulingReceipt,detailingSchedulingReceiptMatches,CreateDetailingOffer,DetailingOfferReceipt,buildDetailingService} from '@lumin/contracts';
export type {CreateDetailingScheduling,DetailingSchedulingReceipt,CreateDetailingOffer,DetailingOfferReceipt} from '@lumin/contracts';
export type DetailingOfferState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateDetailingOffer}|{phase:'created';attempt:CreateDetailingOffer;receipt:DetailingOfferReceipt};
export type DetailingOfferContext=SimpleOfferContext;
export type DetailingSchedulingState={phase:'ready'}|{phase:'checking'|'creating'|'unknown';attempt:CreateDetailingScheduling}|{phase:'configured';attempt:CreateDetailingScheduling;receipt:DetailingSchedulingReceipt};
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
 const httpsOrigin=(value:unknown):value is string=>{try{if(typeof value!=='string'||value.includes('*'))return false;const parsed=new URL(value);return parsed.protocol==='https:'&&parsed.origin===value&&!parsed.username&&!parsed.password;}catch{return false}};
 const bookingApiOrigin=config.bookingApiOrigin;
 if(bookingApiOrigin!==undefined&&!httpsOrigin(bookingApiOrigin))return fail('Connected mode configuration is missing or invalid.');
 let token:string|undefined;let generation=0;let userId:string|undefined;
 const bookingAnswerReads=new Set<AbortController>();
 function abortBookingAnswerReads(){for(const read of bookingAnswerReads)read.abort();bookingAnswerReads.clear();}
 let businessCreation:BusinessCreationState={phase:'ready'};
 const detailingOffers=new Map<string,Exclude<DetailingOfferState,{phase:'ready'}>>();
 const detailingAttempts=new Map<string,{actor:string;tenantId:string;body:string}>();
 const uncertainDetailing=new Map<string,{actor:string;tenantId:string;attempt:CreateDetailingOffer}>();
 const detailingScheduling=new Map<string,Exclude<DetailingSchedulingState,{phase:'ready'}>>();
 const detailingSchedulingAttempts=new Map<string,{actor:string;tenantId:string;serviceId:string;body:string}>();
 const uncertainDetailingScheduling=new Map<string,{actor:string;tenantId:string;serviceId:string;attempt:CreateDetailingScheduling;offer:Extract<DetailingOfferState,{phase:'created'}>}>();
 const detailingSchedulingLocked=()=>uncertainDetailingScheduling.size>0||[...detailingScheduling.values()].some(state=>state.phase!=='configured');
 const detailingLocked=()=>detailingSchedulingLocked()||uncertainDetailing.size>0||[...detailingOffers.values()].some(state=>state.phase!=='created');
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
 // Frozen journey save identity survives auth resets; no bearer or customer data.
 const journeyPublicationAttempts=new Map<string,{actor:string;flowId:string;draftRevision:number;generation:number}>();
 let journeyOwnerReadSequence=0;
 let journeySessionSequence=0;
 let journeyAvailabilitySequence=0;
 let journeyHoldRecoveryPending=false;
 // Private same-attempt recovery survives auth changes. Never expose bearer/customer/body.
 let journeyHoldAttempt:{generation:number;sequence:number;installationId:string;sessionToken:string;expiresAt:number;renderBody:string;body:string;phase:'holding'|'unknown'|'held';uncertain:boolean;receipt?:PaidJourneyHoldReceipt}|undefined;
 let journeyPaymentAttempt:{hold:NonNullable<typeof journeyHoldAttempt>;phase:'paying'|'unknown'|'confirmed';receipt?:PaidJourneyPaymentReceipt}|undefined;
 const journeyPublications=new Map<string,{actor:string;state:Exclude<PaidJourneyPublicationState,{phase:'ready'}>}>();
 const journeyAttempts=new Map<string,{actor:string;flowId:string;expectedRevision:number}>();
 const journeyDrafts=new Map<string,{actor:string;state:Exclude<PaidJourneyDraftState,{phase:'ready'}>}>();
 // Frozen identity survives auth resets; no bearer, submitted form or customer values.
 const journeyFieldAttempts=new Map<string,{actor:string;flowId:string;expectedRevision:number;generation:number}>();
 const journeyFieldDrafts=new Map<string,{actor:string;generation:number;state:Exclude<PaidJourneyCustomerFieldDraftState,{phase:'ready'}>}>();
 // Publication uncertainty is private, actor-bound and never cleared by a read/auth reset.
 const journeyFieldPublicationAttempts=new Map<string,{actor:string;flowId:string;draftRevision:number;generation:number}>();
 const journeyFieldPublications=new Map<string,{actor:string;generation:number;state:Exclude<PaidJourneyCustomerFieldPublicationState,{phase:'ready'}>}>();
 let journeyFieldOwnerReadSequence=0;
 const journeyFieldLocked=()=>journeyFieldPublicationAttempts.size>0||[...journeyFieldPublications.values()].some(entry=>entry.generation===generation&&entry.state.phase==='conflict')||journeyFieldAttempts.size>0||[...journeyFieldDrafts.values()].some(entry=>entry.generation===generation&&['saving','loading'].includes(entry.state.phase));
 // No credential or financial state is retained in owner rollback identity.
 const journeyRollbacks=new Map<string,{actor:string;flowId:string;generation:number;phase:'rolling_back'|'unknown'|'verified';expectedCurrentVersionId:string;targetVersionId:string;receipt?:PaidJourneyRollbackReceipt}>();
 const journeyHistories=new Map<string,{actor:string;generation:number;history:PaidJourneyVersionHistory}>();
 const journeyHistoryReads=new Set<string>();
 const journeyRollbackLocked=()=>[...journeyRollbacks.values()].some(v=>v.phase!=='verified');
 const offerLocked=()=>journeyFieldLocked()||journeyRollbackLocked()||offerOperationsLocked()||profileInitializationLocked()||journeyPublicationAttempts.size>0||journeyAttempts.size>0;
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
 const requireNoCustomerPublication=(tenantId:string)=>{if(journeyFieldLocked()||journeyPublicationAttempts.size>0||journeyAttempts.size>0||customerPublicationLocked(tenantId)||conditionalPublicationAttempts.size>0||conditionalPublicationReads.size>0)throw new PublicationError('not_sent','Informational-field publication or journey save is pending or unverified. Verify the same frozen attempt before changing drafts or publications.');};
 const requireNoRollback=(tenantId:string,allowCustomerAttempt=false)=>{if(conditionalRollbackAttempts.size>0)throw new PublicationError('not_sent','Conditional rollback is pending or unverified. Check the frozen target receipt before another writer.');if(uncertainConditionalDrafts.size>0)throw new PublicationError('not_sent','Verify the frozen conditional draft save before publication or rollback.');if(!allowCustomerAttempt)requireNoCustomerPublication(tenantId);if(offerLocked())throw new PublicationError('not_sent','Offer creation is pending or unverified. Finish the frozen offer attempt first.');if(businessCreationLocked())throw new PublicationError('not_sent','Business creation is pending or unverified. Finish that same attempt before changing publications.');if(rollbackLocked(tenantId))throw new PublicationError('not_sent','Rollback status is unverified or still in progress. Check its current receipt before changing drafts or publications.');};
 const savedDraftPublications=new Map<string,Exclude<PaidSimpleSavedDraftPublicationState,{phase:'ready'}>>();
 const uncertainFieldDrafts=new Map<string,{flowId:string;input:PaidSimpleFieldDraftInput|PaidSimpleConditionalDraftInput}>();
 const ownerDrafts=new Map<string,Exclude<PaidSimpleDraftState,{phase:'ready'}>>();
 async function request(path:string, method='GET', body?:unknown, authenticated=false):Promise<unknown> {
  if(method!=='GET'&&path!=='/auth/v1/token?grant_type=password'&&(journeyFieldLocked()||journeyRollbackLocked()||journeyPublicationAttempts.size>0||journeyAttempts.size>0))return fail('Journey save or rollback status is pending or unverified. Do not replace this attempt with another writer.');
  if(authenticated&&!token)return fail('Please sign in again.');
  const current=generation;
  let response:Response;
  try{response=await transport(base.origin+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{ }), 'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{return fail('Connection unavailable. Check your connection and retry.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  if(!response.ok){if(response.status===401){token=undefined;userId=undefined;generation++;abortBookingAnswerReads();publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();journeyDrafts.clear();journeyPublications.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();detailingScheduling.clear();scheduling.clear();return fail('Please sign in again.')}return fail(response.status===403?'Access denied for this account.':'The request was not accepted. Please check your details and retry.')}
  if(response.status===204)return null;
  let parsed:unknown;try{parsed=await response.json()}catch{return fail('The server returned an invalid response.')}
  if(current!==generation)return fail('Session changed. Please sign in again.');
  return parsed;
 }
 const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))?value:fail('The server returned an invalid response.');
 const tenant=(id:string)=>{if(!uuid(id))return fail('Invalid business selection.');return encodeURIComponent(id)};
 async function signIn(email:string,password:string){
  token=undefined;userId=undefined;generation++;abortBookingAnswerReads();publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();journeyDrafts.clear();journeyPublications.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();detailingScheduling.clear();scheduling.clear();
  const attempt=generation;
  const result=await request('/auth/v1/token?grant_type=password','POST',{email,password}) as {access_token?:unknown};
  if(attempt!==generation||typeof result?.access_token!=='string')return fail('Sign-in was not completed.');
  token=result.access_token;
  try{const user=await request('/auth/v1/user','GET',undefined,true) as {id?:unknown};if(!uuid(user?.id))return fail('Sign-in was not completed.');userId=user.id;for(const [tenantId,attempt] of uncertainConditionalDrafts){if(attempt.actor===userId.toLowerCase())ownerDrafts.set(tenantId,{phase:'unverified',flowId:attempt.flowId});}for(const attempt of conditionalPublicationAttempts.values()){if(attempt.actor===userId.toLowerCase())conditionalPublications.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})});}for(const attempt of fieldRollbackAttempts.values()){if(attempt.actor===userId.toLowerCase())fieldRollbacks.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId,targetPublication:attempt.targetPublication});}for(const attempt of conditionalRollbackAttempts.values()){if(attempt.actor===userId.toLowerCase())conditionalRollbacks.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId,targetPublication:attempt.targetPublication});}for(const attempt of customerPublicationAttempts.values()){if(attempt.actor===userId.toLowerCase())customerPublications.set(attempt.tenantId,{phase:'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision,...(attempt.checkoutOrigin?{checkoutOrigin:attempt.checkoutOrigin}:{})});}for(const uncertain of uncertainDetailingScheduling.values()){if(uncertain.actor===userId.toLowerCase()){detailingScheduling.set(uncertain.tenantId+':'+uncertain.serviceId,{phase:'unknown',attempt:uncertain.attempt});detailingOffers.set(uncertain.tenantId,uncertain.offer);}}for(const uncertain of uncertainDetailing.values()){if(uncertain.actor===userId.toLowerCase())detailingOffers.set(uncertain.tenantId,{phase:'unknown',attempt:uncertain.attempt});}for(const uncertain of uncertainOffers.values()){if(uncertain.actor===userId)offers.set(uncertain.tenantId,{phase:'unknown',attempt:uncertain.attempt});}for(const uncertain of uncertainScheduling.values()){if(uncertain.actor===userId){scheduling.set(uncertain.tenantId+':'+uncertain.serviceId,{phase:'unknown',attempt:uncertain.attempt});offers.set(uncertain.tenantId,uncertain.offer);}}return userId}catch(error){if(attempt===generation){token=undefined;userId=undefined}throw error}
 }
 function signOut(){token=undefined;userId=undefined;generation++;abortBookingAnswerReads();publications.clear();recovering.clear();customerPublications.clear();customerPublicationReads.clear();conditionalPublications.clear();conditionalPublicationReads.clear();ownerDrafts.clear();journeyDrafts.clear();journeyPublications.clear();uncertainFieldDrafts.clear();savedDraftPublications.clear();rollbacks.clear();rollbackReads.clear();histories.clear();fieldRollbacks.clear();fieldRollbackReads.clear();fieldHistories.clear();fieldHistoryReads.clear();conditionalRollbacks.clear();conditionalRollbackReads.clear();conditionalHistories.clear();conditionalHistoryReads.clear();businessCreation={phase:'ready'};offers.clear();detailingOffers.clear();detailingScheduling.clear();scheduling.clear()}
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
 function journeyHistoryContext(tenantId:string,flowId:string,options:{signal?:AbortSignal}){
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(flowId)||!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||options.signal?.aborted)throw new PublicationError('not_sent','Sign in and choose a valid business and journey, with an optional cancellation signal.');
  return {tenant:tenantId.toLowerCase(),flow:flowId.toLowerCase(),actor:userId.toLowerCase(),credential:token,current:generation,signal:options.signal};
 }
 function journeyInstallation(value:unknown,versionId:string):PaidJourneyVersionInstallation|undefined{
  if(!exact(value,['versionId','installationId','renderSchemaVersion','hostedPath'])||value.versionId!==versionId||!uuid(value.installationId)||value.installationId!==value.installationId.toLowerCase()||value.renderSchemaVersion!==8||value.hostedPath!==`/checkout/flow/${value.installationId}`)return;
  return Object.freeze({...value}) as unknown as PaidJourneyVersionInstallation;
 }
 function parseJourneyHistory(value:unknown,tenant:string,flow:string):PaidJourneyVersionHistory|undefined{
  if(!exact(value,['schemaVersion','tenantId','flowId','versions'])||value.schemaVersion!==1||value.tenantId!==tenant||value.flowId!==flow||!Array.isArray(value.versions)||value.versions.length<1||value.versions.length>50)return;
  const versions:PaidJourneyVersionHistory['versions'][number][]=[],seen=new Set<string>();let previous=Number.MAX_SAFE_INTEGER+1;
  for(const v of value.versions){
   if(!exact(v,['versionId','draftRevision','name','journey','presentation','current','publication'])||!uuid(v.versionId)||v.versionId!==v.versionId.toLowerCase()||seen.has(v.versionId)||!draftRevision(v.draftRevision)||v.draftRevision>=previous||typeof v.name!=='string'||v.name.length<1||v.name.length>200||!presentation(v.presentation)||typeof v.current!=='boolean')return;
   const parsed=PaidJourney.safeParse(v.journey),installation=v.publication===null?null:journeyInstallation(v.publication,v.versionId);if(!parsed.success||installation===undefined)return;
   versions.push({versionId:v.versionId,draftRevision:v.draftRevision as number,name:v.name,journey:parsed.data,presentation:{...v.presentation},current:v.current,publication:installation});seen.add(v.versionId);previous=v.draftRevision as number;
  }
  if(versions.filter(v=>v.current).length!==1)return;
  return immutableDetailing({schemaVersion:1,tenantId:tenant,flowId:flow,versions});
 }
 /** Evidence only. A current pointer cannot establish settlement of an uncertain writer. */
 async function paidJourneyVersionHistory(tenantId:string,flowId:string,options:{signal?:AbortSignal}={}):Promise<PaidJourneyVersionHistory>{
  const {tenant,flow,actor,credential,current,signal}=journeyHistoryContext(tenantId,flowId,options),key=tenant+'|'+flow;
  if(journeyHistoryReads.has(key))throw new PublicationError('not_sent','This journey history read is already pending.');journeyHistories.delete(key);journeyHistoryReads.add(key);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-flows/'+flow+'/versions?tenantId='+encodeURIComponent(tenant),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`},...(signal?{signal}:{})});value=await response.json();}catch{throw new PublicationError('not_sent','Journey history could not be read. No rollback was retried or reconciled.');}
   if(current!==generation||signal?.aborted||response.redirected)throw new PublicationError('not_sent','Journey history cannot be accepted after the context changed.');
   const history=response.status===200&&exact(value,['ok','data'])&&value.ok===true?parseJourneyHistory(value.data,tenant,flow):undefined;if(!history)throw new PublicationError('not_sent','Journey history could not be verified. No rollback was reconciled.');
   journeyHistories.set(key,{actor,generation:current,history});return history;
  }finally{journeyHistoryReads.delete(key);}
 }
 function paidJourneyRollbackState(tenantId:string):PaidJourneyRollbackState{
  if(!uuid(tenantId))return fail('Invalid business selection.');const attempt=journeyRollbacks.get(tenantId.toLowerCase());
  if(!token||!userId||attempt?.actor!==userId.toLowerCase())return {phase:'ready'};
  if(attempt.phase==='verified')return attempt.generation===generation&&attempt.receipt?immutableDetailing({phase:'verified',receipt:structuredClone(attempt.receipt)}):{phase:'ready'};
  return Object.freeze({phase:attempt.generation===generation?attempt.phase:'unknown',flowId:attempt.flowId,expectedCurrentVersionId:attempt.expectedCurrentVersionId,targetVersionId:attempt.targetVersionId});
 }
 async function rollbackPaidJourney(tenantId:string,flowId:string,input:PaidJourneyRollbackInput,options:{signal?:AbortSignal}={}):Promise<PaidJourneyRollbackReceipt>{
  const {tenant,flow,actor,credential,current,signal}=journeyHistoryContext(tenantId,flowId,options);
  journeyAuthority(tenant,flow);
  if(!exact(input,['expectedCurrentVersionId','targetVersionId'])||!uuid(input.expectedCurrentVersionId)||!uuid(input.targetVersionId)||input.expectedCurrentVersionId===input.targetVersionId)throw new PublicationError('not_sent','Choose a different known version and the current version for an explicit rollback.');
  const expected=input.expectedCurrentVersionId.toLowerCase(),target=input.targetVersionId.toLowerCase(),cached=journeyHistories.get(tenant+'|'+flow),history=cached?.actor===actor&&cached.generation===current?cached.history:undefined;
  const selected=history?.versions.find(v=>v.versionId===target),active=history?.versions.find(v=>v.current);
  if(active?.versionId!==expected||!selected||selected.current||!selected.publication||journeyHistoryReads.has(tenant+'|'+flow))throw new PublicationError('not_sent','Read this journey history in the current session and choose an available prior installation.');
  const attempt={actor,flowId:flow,generation:current,phase:'rolling_back' as 'rolling_back'|'unknown'|'verified',expectedCurrentVersionId:expected,targetVersionId:target,receipt:undefined as PaidJourneyRollbackReceipt|undefined};journeyRollbacks.set(tenant,attempt);journeyHistories.delete(tenant+'|'+flow);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-flows/'+flow+'/rollback?tenantId='+encodeURIComponent(tenant),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({expectedCurrentVersionId:expected,targetVersionId:target}),...(signal?{signal}:{})});value=await response.json();}catch{throw new PublicationError('unknown','Rollback may have committed. Do not retry or replace this write.');}
   if(current!==generation||signal?.aborted||response.redirected||journeyRollbacks.get(tenant)!==attempt)throw new PublicationError('unknown','Rollback cannot be verified after the context changed. Do not repeat it.');
   const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&Object.hasOwn(codes,value.code)&&response.status===codes[value.code]){journeyRollbacks.delete(tenant);if(value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('rejected','Rollback was rejected. Read current history before another explicit action.');}
   const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(!exact(data,['schemaVersion','tenantId','flowId','draftRevision','versionId','installationId','renderSchemaVersion','hostedPath'])||data.schemaVersion!==1||data.tenantId!==tenant||data.flowId!==flow||data.draftRevision!==selected.draftRevision||data.versionId!==target||!journeyInstallation({versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:data.renderSchemaVersion,hostedPath:data.hostedPath},target)||data.installationId!==selected.publication.installationId)throw new PublicationError('unknown','Rollback receipt could not be verified. Do not repeat or replace this write.');
   const receipt=immutableDetailing({...data}) as unknown as PaidJourneyRollbackReceipt;attempt.phase='verified';attempt.receipt=receipt;journeyPublications.delete(tenant);return receipt;
  }catch(error){if(journeyRollbacks.get(tenant)===attempt)attempt.phase='unknown';throw error;}
 }
 function journeyAuthority(tenantId:string,flowId:string){
  if(!token||!userId||!bookingApiOrigin)throw new PaidJourneyDraftError('not_sent','Sign in with the configured journey draft service.');
  if(!uuid(tenantId)||!uuid(flowId))throw new PaidJourneyDraftError('not_sent','Choose a valid business and journey draft ID.');
  const tenant=tenantId.toLowerCase(),flow=flowId.toLowerCase(),actor=userId.toLowerCase();
  const pending=(state:{phase:string})=>['saving','loading','unverified','publishing','unknown','rolling_back'].includes(state.phase);
  if(journeyPublicationAttempts.size>0||journeyAttempts.size>0||uncertainConditionalDrafts.size>0||uncertainFieldDrafts.size>0||conditionalRollbackAttempts.size>0||fieldRollbackAttempts.size>0||customerPublicationAttempts.size>0||conditionalPublicationAttempts.size>0||offerLocked()||businessCreationLocked()||[...ownerDrafts.values(),...publications.values(),...savedDraftPublications.values(),...rollbacks.values(),...fieldRollbacks.values(),...conditionalRollbacks.values()].some(pending))throw new PaidJourneyDraftError('not_sent','Finish the existing pending or unverified operation before changing journey drafts. A read cannot reconcile another writer.');
  const entry=journeyDrafts.get(tenant);
  if(entry&&['saving','loading'].includes(entry.state.phase))throw new PaidJourneyDraftError('not_sent','A journey draft operation is already in progress.');
  return {tenant,flow,actor};
 }
 function journeyError(response:Response,value:unknown):PaidJourneyDraftError|undefined{
  if(response.ok||!exact(value,['ok','code'])||value.ok!==false||typeof value.code!=='string')return;
  if(response.status===409&&value.code==='CONFLICT')return new PaidJourneyDraftError('conflict','The journey draft revision changed. Load its current revision before editing again.');
  const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(Object.hasOwn(codes,value.code)&&response.status===codes[value.code]){if(value.code==='UNAUTHENTICATED')signOut();return new PaidJourneyDraftError('rejected','The journey draft request was rejected. Check your owner access and draft configuration.');}
 }
 function journeyDraft(value:unknown,tenantId:string,flowId:string):PaidJourneyOwnerDraft|undefined{
  if(!exact(value,['schemaVersion','tenantId','flowId','serviceId','revision','name','presentation','journey'])||value.schemaVersion!==1||value.tenantId!==tenantId||value.flowId!==flowId||!uuid(value.serviceId)||value.serviceId!==value.serviceId.toLowerCase()||!draftRevision(value.revision)||typeof value.name!=='string'||!value.name.trim()||value.name!==value.name.trim()||value.name.length>200||!presentation(value.presentation))return;
  const parsed=PaidJourney.safeParse(value.journey);if(!parsed.success)return;
  // Structural authoring validation only; never grants publication authority.
  return immutableDetailing({...value,presentation:{...value.presentation},journey:parsed.data}) as unknown as PaidJourneyOwnerDraft;
 }
 function paidJourneyPublicationState(tenantId:string):PaidJourneyPublicationState{
  if(!uuid(tenantId))return fail('Invalid business selection.');const tenant=tenantId.toLowerCase(),actor=userId?.toLowerCase();if(!token||!actor)return {phase:'ready'};
  const attempt=journeyPublicationAttempts.get(tenant);
  if(attempt?.actor===actor)return {phase:attempt.generation===generation?'publishing':'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision};
  const entry=journeyPublications.get(tenant);return entry?.actor===actor?immutableDetailing(structuredClone(entry.state)):{phase:'ready'};
 }
 async function publishPaidJourneyDraft(tenantId:string,flowId:string,input:PaidJourneyPublishInput):Promise<PaidJourneyPublicationReceipt>{
  const {tenant,flow,actor}=journeyAuthority(tenantId,flowId);
  if(!exact(input,['schemaVersion','expectedDraftRevision','allowedOrigins'])||input.schemaVersion!==1||!draftRevision(input.expectedDraftRevision)||!Array.isArray(input.allowedOrigins)||input.allowedOrigins.length<1||input.allowedOrigins.length>20||new Set(input.allowedOrigins).size!==input.allowedOrigins.length||input.allowedOrigins.some(o=>!httpsOrigin(o)||o.length>2048))throw new PublicationError('not_sent','Check the saved journey revision and exact Checkout origins.');
  const draft=journeyDrafts.get(tenant);
  if(draft?.actor!==actor||!['loaded','saved'].includes(draft.state.phase)||!('revision' in draft.state)||draft.state.flowId!==flow||draft.state.revision!==input.expectedDraftRevision)throw new PublicationError('not_sent','Load or save the current journey revision before explicit publication.');
  const body=JSON.stringify({schemaVersion:1,expectedDraftRevision:input.expectedDraftRevision,allowedOrigins:[...input.allowedOrigins]}),current=generation,credential=token!;
  const attempt={actor,flowId:flow,draftRevision:input.expectedDraftRevision,generation:current};journeyPublicationAttempts.set(tenant,attempt);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-flows/'+flow+'/publish-draft?tenantId='+encodeURIComponent(tenant),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body});value=await response.json();}catch{throw new PublicationError('unknown','Journey publication may have committed. Do not repeat or replace this write.');}
   if(current!==generation||journeyPublicationAttempts.get(tenant)!==attempt||response.redirected)throw new PublicationError('unknown','Journey publication cannot be verified in this session. Do not repeat it.');
   const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&Object.hasOwn(codes,value.code)&&response.status===codes[value.code]){
    journeyPublicationAttempts.delete(tenant);journeyPublications.set(tenant,{actor,state:{phase:'conflict',flowId:flow,draftRevision:attempt.draftRevision}});journeyDrafts.set(tenant,{actor,state:{phase:'conflict',flowId:flow}});
    if(value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('rejected','Journey publication was rejected. Recheck owner access and load the current saved revision.');
   }
   const d=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(d,['schemaVersion','tenantId','flowId','draftRevision','versionId','installationId','renderSchemaVersion','replayed'])||d.schemaVersion!==1||d.tenantId!==tenant||d.flowId!==flow||d.draftRevision!==attempt.draftRevision||!uuid(d.versionId)||d.versionId!==d.versionId.toLowerCase()||!uuid(d.installationId)||d.installationId!==d.installationId.toLowerCase()||d.renderSchemaVersion!==8||typeof d.replayed!=='boolean')throw new PublicationError('unknown','Journey publication receipt could not be verified. Do not repeat or replace this write.');
   const receipt=Object.freeze({...d}) as unknown as PaidJourneyPublicationReceipt;journeyPublicationAttempts.delete(tenant);journeyPublications.set(tenant,{actor,state:{phase:'published',flowId:flow,draftRevision:receipt.draftRevision,receipt}});return receipt;
  }catch(error){if(journeyPublicationAttempts.get(tenant)===attempt){attempt.generation=-1;}throw error;}
 }
 /** A fresh issuance may create another nonfinancial session. Never retry automatically. */
 async function issuePaidJourneySession(installationId:string,options:{signal?:AbortSignal}={}):Promise<PaidJourneyCustomerSession>{
  if(!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal)))throw new PaidJourneySessionError('not_sent','Use only an optional cancellation signal; session authority comes from the server.');
  if(!bookingApiOrigin||!uuid(installationId)||options.signal?.aborted)throw new PaidJourneySessionError('not_sent','Choose a valid V8 installation and configured API before starting a session.');
  if(journeyPaymentAttempt||journeyHoldRecoveryPending||(journeyHoldAttempt&&journeyHoldAttempt.phase!=='held'))throw new PaidJourneySessionError('not_sent','Resolve the retained reservation attempt before opening a different session.');
  if(journeyHoldAttempt?.phase==='held')journeyHoldAttempt=undefined;
  const current=generation,sequence=++journeySessionSequence,signal=options.signal;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-installations/'+installationId.toLowerCase()+'/sessions',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:'{}',...(signal?{signal}:{})});value=await response.json();}catch{throw new PaidJourneySessionError('unknown','The session response is unverified. No automatic retry was made; a new attempt may create another nonfinancial session.');}
  if(current!==generation||sequence!==journeySessionSequence||signal?.aborted||response.redirected||journeyHoldAttempt)throw new PaidJourneySessionError('unknown','The session context changed. This response cannot be accepted.');
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'){
   const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(Object.hasOwn(codes,value.code)&&response.status===codes[value.code])throw new PaidJourneySessionError('rejected','The session request was rejected. Check the installation and staging configuration.');
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['schemaVersion','sessionToken','expiresAt','render'])||data.schemaVersion!==1||typeof data.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.sessionToken)||typeof data.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(data.expiresAt))throw new PaidJourneySessionError('unknown','The session receipt could not be verified. No booking or payment was authorized.');
  const parts=data.expiresAt.slice(0,19).split(/[-T:]/).map(Number),[year,month,day,hour,minute,second]=parts;
  const calendar=new Date(Date.UTC(year!,month!-1,day!));
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()+1!==month||calendar.getUTCDate()!==day||hour!>23||minute!>59||second!>59)throw new PaidJourneySessionError('unknown','The session expiry is malformed. No booking or payment was authorized.');
  const expiry=Date.parse(data.expiresAt),now=Date.now(),parsed=PaidJourneyRender.safeParse(data.render);
  if(!Number.isFinite(expiry)||expiry<=now||expiry>now+15*60000||!parsed.success)throw new PaidJourneySessionError('unknown','The session expiry or immutable journey is incompatible. No booking or payment was authorized.');
  return Object.freeze({schemaVersion:1,sessionToken:data.sessionToken,expiresAt:data.expiresAt,render:parsed.data});
 }
 /** No automatic retry. Unknown writes keep their exact private request identity. */
 async function holdPaidJourneySlot(installationId:string,session:PaidJourneyCustomerSession,input:PaidJourneyHoldInput,options:{signal?:AbortSignal;retry?:true}={}):Promise<PaidJourneyHoldReceipt>{
  const reject=(message:string)=>new PaidJourneyHoldError('not_sent',message);
  if(journeyPaymentAttempt||journeyHoldRecoveryPending)throw reject('Resolve the retained reservation before sending another request.');
  const utc=(value:unknown,offset=false):number=>{if(typeof value!=='string'||!(offset?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/).test(value))return NaN;const parts=value.slice(0,19).split(/[-T:]/).map(Number),calendar=new Date(Date.UTC(parts[0]!,parts[1]!-1,parts[2]!)),n=Date.parse(value);return calendar.getUTCFullYear()===parts[0]&&calendar.getUTCMonth()+1===parts[1]&&calendar.getUTCDate()===parts[2]&&parts[3]!<=23&&parts[4]!<=59&&parts[5]!<=59&&Number.isFinite(n)?n:NaN;};
  const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(v);
  if(!bookingApiOrigin||!uuid(installationId)||!(exact(options,[])||exact(options,['signal'])||exact(options,['retry'])||exact(options,['signal','retry']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||(options.retry!==undefined&&options.retry!==true)||!exact(session,['schemaVersion','sessionToken','expiresAt','render'])||session.schemaVersion!==1||typeof session.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(session.sessionToken)||!exact(input,['schemaVersion','idempotencyKey','requestedStart','customer','answers'])||input.schemaVersion!==1||typeof input.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey)||!exact(input.customer,['name','email'])||!text(input.customer.name,200)||!text(input.customer.email,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.customer.email)||!exact(input.answers,[]))throw reject('Use only the exact customer hold request and cancellation or explicit retry options.');
  const expiry=utc(session.expiresAt,true),start=utc(input.requestedStart),render=PaidJourneyRender.safeParse(session.render),now=Date.now();
  if(!render.success||!Number.isFinite(start)||!Number.isFinite(expiry)||expiry<=now||expiry>now+15*60000||options.signal?.aborted)throw reject('The current customer session and UTC slot must be valid before sending a hold request.');
  const body=JSON.stringify({schemaVersion:1,idempotencyKey:input.idempotencyKey,requestedStart:new Date(start).toISOString(),customer:{name:input.customer.name,email:input.customer.email},answers:{}}),renderBody=JSON.stringify(render.data),installation=installationId.toLowerCase();
  let attempt=journeyHoldAttempt;
  if(attempt){if(attempt.phase==='holding'||options.retry!==true||attempt.generation!==generation||attempt.sequence!==journeySessionSequence||attempt.installationId!==installation||attempt.sessionToken!==session.sessionToken||attempt.expiresAt!==expiry||attempt.renderBody!==renderBody||attempt.body!==body)throw reject('Keep the original session, key and request unchanged; only an explicit same-attempt retry is permitted.');}
  else{if(options.retry===true||start<=now)throw reject('Start one future-slot attempt before requesting a retry.');attempt={generation,sequence:journeySessionSequence,installationId:installation,sessionToken:session.sessionToken,expiresAt:expiry,renderBody,body,phase:'holding',uncertain:false};journeyHoldAttempt=attempt;}
  const retained=attempt,hadUncertainty=retained.uncertain;retained.phase='holding';
  const unknown=()=>{retained.phase='unknown';retained.uncertain=true;return new PaidJourneyHoldError('unknown','The hold response could not be verified. A draft and hold may exist. Retry only this unchanged attempt explicitly; no payment or confirmation was authorized.');};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-flow-sessions/hold',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:`Bearer ${retained.sessionToken}`},body:retained.body,...(options.signal?{signal:options.signal}:{})});value=await response.json();}catch{throw unknown();}
  if(options.signal?.aborted||retained.generation!==generation||retained.sequence!==journeySessionSequence||retained.expiresAt<=Date.now()||response.redirected)throw unknown();
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'){
   const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(Object.hasOwn(codes,value.code)&&response.status===codes[value.code]){if(hadUncertainty||retained.receipt)throw unknown();journeyHoldAttempt=undefined;throw new PaidJourneyHoldError('rejected','The hold request was rejected. No hold receipt was accepted.');}
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  const canonical=(v:unknown):v is string=>uuid(v)&&v===v.toLowerCase();
  if(response.status!==200||!exact(data,['schemaVersion','versionId','installationId','serviceId','bookingId','reference','state','confirmed','paymentMode','slot','holdId','status','expiresAt','replayed'])||data.schemaVersion!==1||data.versionId!==render.data.versionId||data.installationId!==installation||data.serviceId!==render.data.service.id||!canonical(data.bookingId)||!canonical(data.holdId)||typeof data.reference!=='string'||!/^LMN-[A-F0-9]{32}$/.test(data.reference)||data.state!=='draft'||data.confirmed!==false||data.paymentMode!=='unavailable'||data.status!=='active'||typeof data.replayed!=='boolean'||!exact(data.slot,['start','end']))throw unknown();
  const slotStart=utc(data.slot.start),slotEnd=utc(data.slot.end),holdExpiry=utc(data.expiresAt,true);
  if(slotStart!==start||slotEnd-slotStart!==render.data.service.durationMinutes*60000||!Number.isFinite(holdExpiry)||holdExpiry<=Date.now()||holdExpiry>Date.now()+301000||(retained.receipt&&(data.replayed!==true||retained.receipt.bookingId!==data.bookingId||retained.receipt.holdId!==data.holdId||retained.receipt.reference!==data.reference||Date.parse(retained.receipt.expiresAt)!==holdExpiry)))throw unknown();
  const receipt=Object.freeze({...data,slot:Object.freeze({start:new Date(slotStart).toISOString(),end:new Date(slotEnd).toISOString()}),expiresAt:new Date(holdExpiry).toISOString()}) as PaidJourneyHoldReceipt;
  retained.phase='held';retained.receipt=receipt;return receipt;
 }
 /** Explicit read-only recovery for the same retained attempt; no reload or missing-token recovery. */
 async function recoverPaidJourneyHold(installationId:string,session:PaidJourneyCustomerSession,options:{signal?:AbortSignal}={}):Promise<PaidJourneyHoldReceipt>{
  const invalid=()=>new PaidJourneyHoldRecoveryError('INVALID_REQUEST','Use the original retained customer session and an optional cancellation signal. No replacement request was sent.');
  const retained=journeyHoldAttempt;
  if(journeyPaymentAttempt||!bookingApiOrigin||!uuid(installationId)||!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||options.signal?.aborted||!exact(session,['schemaVersion','sessionToken','expiresAt','render'])||session.schemaVersion!==1||!retained||retained.phase==='holding'||journeyHoldRecoveryPending||retained.generation!==generation||retained.sequence!==journeySessionSequence||retained.installationId!==installationId.toLowerCase()||retained.sessionToken!==session.sessionToken||retained.expiresAt!==Date.parse(session.expiresAt)||retained.expiresAt<=Date.now())throw invalid();
  const parsed=PaidJourneyRender.safeParse(session.render);
  if(!parsed.success||JSON.stringify(parsed.data)!==retained.renderBody)throw invalid();
  const utc=(value:unknown):number=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:NaN;};
  const original=JSON.parse(retained.body) as PaidJourneyHoldInput,service=parsed.data.service;
  const unverified=()=>{retained.phase='unknown';retained.uncertain=true;return new PaidJourneyHoldRecoveryError('UNVERIFIED','The original reservation status could not be verified. Its draft or hold may still exist. No writer was retried and no payment or confirmation was authorized.');};
  journeyHoldRecoveryPending=true;
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin+'/api/paid-journey-flow-sessions/hold',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${retained.sessionToken}`},...(options.signal?{signal:options.signal}:{})});value=await response.json();}catch{throw unverified();}
   if(options.signal?.aborted||response.redirected||journeyHoldAttempt!==retained||retained.generation!==generation||retained.sequence!==journeySessionSequence||retained.expiresAt<=Date.now())throw unverified();
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   const canonical=(v:unknown):v is string=>uuid(v)&&v===v.toLowerCase();
   if(response.status!==200||!exact(data,['schemaVersion','versionId','installationId','serviceId','bookingId','reference','state','confirmed','paymentMode','slot','holdId','status','expiresAt','replayed'])||data.schemaVersion!==1||data.versionId!==parsed.data.versionId||data.installationId!==retained.installationId||data.serviceId!==service.id||!canonical(data.bookingId)||!canonical(data.holdId)||data.reference!=='LMN-'+data.bookingId.replaceAll('-','').toUpperCase()||data.state!=='draft'||data.confirmed!==false||data.paymentMode!=='unavailable'||data.status!=='active'||data.replayed!==true||!exact(data.slot,['start','end']))throw unverified();
   const start=utc(data.slot.start),end=utc(data.slot.end),expiry=utc(data.expiresAt);
   if(start!==Date.parse(original.requestedStart)||end-start!==service.durationMinutes*60000||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+301000||(retained.receipt&&(data.bookingId!==retained.receipt.bookingId||data.holdId!==retained.receipt.holdId||data.reference!==retained.receipt.reference||expiry!==Date.parse(retained.receipt.expiresAt))))throw unverified();
   const receipt=Object.freeze({...data,slot:Object.freeze({start:data.slot.start,end:data.slot.end})}) as PaidJourneyHoldReceipt;
   retained.receipt=receipt;retained.phase='held';return receipt;
  }finally{journeyHoldRecoveryPending=false;}
 }
 function paidJourneyHoldState():PaidJourneyHoldState{
  if(journeyPaymentAttempt)return Object.freeze({phase:'blocked'});
  const attempt=journeyHoldAttempt;if(!attempt)return Object.freeze({phase:'ready'});
  if(attempt.generation!==generation||attempt.sequence!==journeySessionSequence)return Object.freeze({phase:'blocked'});
  if(attempt.phase==='held'&&(attempt.expiresAt<=Date.now()||!attempt.receipt||Date.parse(attempt.receipt.expiresAt)<=Date.now()))return Object.freeze({phase:'blocked'});
  return attempt.phase==='held'&&attempt.receipt?Object.freeze({phase:'held',receipt:attempt.receipt}):Object.freeze({phase:attempt.phase==='held'?'unknown':attempt.phase});
 }
 /** Staging mock only. Explicit retries retain the same original financial attempt. */
 async function mockPayPaidJourney(installationId:string,session:PaidJourneyCustomerSession,options:{signal?:AbortSignal;retry?:true}={}):Promise<PaidJourneyPaymentReceipt>{
  const reject=()=>new PaidJourneyPaymentError('not_sent','Use the original verified reservation and session; retry only the same financial attempt explicitly.');
  const hold=journeyHoldAttempt;
  if(!bookingApiOrigin||!uuid(installationId)||!(exact(options,[])||exact(options,['signal'])||exact(options,['retry'])||exact(options,['signal','retry']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||(options.retry!==undefined&&options.retry!==true)||options.signal?.aborted||!exact(session,['schemaVersion','sessionToken','expiresAt','render'])||session.schemaVersion!==1||!hold||!hold.receipt||journeyHoldRecoveryPending||hold.phase==='holding'||hold.generation!==generation||hold.sequence!==journeySessionSequence||hold.installationId!==installationId.toLowerCase()||hold.sessionToken!==session.sessionToken||hold.expiresAt!==Date.parse(session.expiresAt)||hold.expiresAt<=Date.now())throw reject();
  const render=PaidJourneyRender.safeParse(session.render);
  if(!render.success||JSON.stringify(render.data)!==hold.renderBody)throw reject();
  let attempt=journeyPaymentAttempt;
  if(attempt){if(attempt.hold!==hold||attempt.phase==='paying'||options.retry!==true)throw reject();}
  else{if(options.retry===true||hold.phase!=='held'||Date.parse(hold.receipt.expiresAt)<=Date.now())throw reject();attempt={hold,phase:'paying'};journeyPaymentAttempt=attempt;}
  const retained=attempt;retained.phase='paying';
  const unknown=()=>{retained.phase=retained.receipt?'confirmed':'unknown';return new PaidJourneyPaymentError('unknown','The financial response could not be verified. Keep this original attempt; no automatic payment retry or replacement booking was made.');};
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-flow-sessions/mock-payment',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:`Bearer ${hold.sessionToken}`},body:'{}',...(options.signal?{signal:options.signal}:{})});value=await response.json();}catch{throw unknown();}
  if(options.signal?.aborted||response.redirected||hold.generation!==generation||hold.sequence!==journeySessionSequence||hold.expiresAt<=Date.now()||journeyHoldAttempt!==hold)throw unknown();
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined,canonical=(v:unknown):v is string=>uuid(v)&&v===v.toLowerCase();
  if(response.status!==200||!exact(data,['schemaVersion','versionId','installationId','serviceId','bookingId','paymentId','reference','state','replayed','provider','simulated','amount','currency'])||data.schemaVersion!==1||data.versionId!==render.data.versionId||data.installationId!==hold.installationId||data.serviceId!==render.data.service.id||data.bookingId!==hold.receipt.bookingId||!canonical(data.paymentId)||data.reference!==hold.receipt.reference||data.reference!=='LMN-'+data.bookingId.replaceAll('-','').toUpperCase()||data.state!=='confirmed'||typeof data.replayed!=='boolean'||data.provider!=='staging_mock'||data.simulated!==true||!Number.isSafeInteger(data.amount)||data.amount!==render.data.service.price.amount||data.currency!==render.data.service.price.currency||(retained.receipt&&(data.replayed!==true||data.paymentId!==retained.receipt.paymentId)))throw unknown();
  const receipt:PaidJourneyPaymentReceipt=Object.freeze({schemaVersion:1,versionId:render.data.versionId,installationId:hold.installationId,serviceId:render.data.service.id,bookingId:hold.receipt.bookingId,paymentId:data.paymentId,reference:hold.receipt.reference,state:'confirmed',replayed:data.replayed,provider:'staging_mock',simulated:true,amount:render.data.service.price.amount,currency:render.data.service.price.currency});retained.receipt=receipt;retained.phase='confirmed';return receipt;
 }
 function paidJourneyPaymentState():PaidJourneyPaymentState{
  const attempt=journeyPaymentAttempt;if(!attempt)return Object.freeze({phase:'ready'});
  if(attempt.hold.generation!==generation||attempt.hold.sequence!==journeySessionSequence)return Object.freeze({phase:'blocked'});
  return attempt.phase==='confirmed'&&attempt.receipt?Object.freeze({phase:'confirmed',receipt:attempt.receipt}):Object.freeze({phase:attempt.phase==='confirmed'?'unknown':attempt.phase});
 }
 /** A read binds only to the supplied immutable customer session; it reconciles no writers. */
 async function readPaidJourneyAvailability(session:PaidJourneyCustomerSession,window:PaidJourneyAvailabilityWindow,options:{signal?:AbortSignal}={}):Promise<PaidJourneyAvailability>{
  const sequence=++journeyAvailabilitySequence;
  const invalid=()=>new PaidJourneyAvailabilityError('INVALID_REQUEST','Use a valid V8 session, bounded UTC window and optional cancellation signal.');
  const utc=(v:unknown):number=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v))return NaN;const n=Date.parse(v),d=new Date(n),parts=v.slice(0,19).split(/[-T:]/).map(Number);return Number.isFinite(n)&&d.getUTCFullYear()===parts[0]&&d.getUTCMonth()+1===parts[1]&&d.getUTCDate()===parts[2]&&d.getUTCHours()===parts[3]&&d.getUTCMinutes()===parts[4]&&d.getUTCSeconds()===parts[5]?n:NaN;};
  if(!bookingApiOrigin||!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||!exact(window,['from','to'])||!exact(session,['schemaVersion','sessionToken','expiresAt','render'])||session.schemaVersion!==1||typeof session.sessionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(session.sessionToken)||typeof session.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(session.expiresAt))throw invalid();
  const from=utc(window.from),to=utc(window.to),expiry=Date.parse(session.expiresAt),render=PaidJourneyRender.safeParse(session.render),parts=session.expiresAt.slice(0,19).split(/[-T:]/).map(Number),calendar=new Date(Date.UTC(parts[0]!,parts[1]!-1,parts[2]!));
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>7*86400000||!Number.isFinite(expiry)||expiry>Date.now()+15*60000||!render.success||calendar.getUTCFullYear()!==parts[0]||calendar.getUTCMonth()+1!==parts[1]||calendar.getUTCDate()!==parts[2]||parts[3]!>23||parts[4]!>59||parts[5]!>59)throw invalid();
  if(expiry<=Date.now())throw new PaidJourneyAvailabilityError('EXPIRED','Start a fresh customer session before checking availability.');
  const signal=options.signal;if(signal?.aborted)throw new PaidJourneyAvailabilityError('ABORTED','The availability read was canceled.');
  const current=generation,sessionSequence=journeySessionSequence,credential=session.sessionToken,service=render.data.service;
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-flow-sessions/availability?from='+encodeURIComponent(new Date(from).toISOString())+'&to='+encodeURIComponent(new Date(to).toISOString()),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`},...(signal?{signal}:{})});value=await response.json();}catch{throw new PaidJourneyAvailabilityError('UNVERIFIED','Availability could not be read. No retry or financial action was made.');}
  if(signal?.aborted)throw new PaidJourneyAvailabilityError('ABORTED','The availability read was canceled.');
  if(current!==generation||sessionSequence!==journeySessionSequence||sequence!==journeyAvailabilitySequence)throw new PaidJourneyAvailabilityError('STALE_CONTEXT','The customer availability context changed.');
  if(expiry<=Date.now())throw new PaidJourneyAvailabilityError('EXPIRED','The customer session expired during the availability read.');
  if(response.redirected)throw new PaidJourneyAvailabilityError('UNVERIFIED','Availability could not be verified without redirecting.');
  if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'){
   const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(Object.hasOwn(codes,value.code)&&response.status===codes[value.code])throw new PaidJourneyAvailabilityError('REJECTED','The availability read was rejected. No financial action was made.');
  }
  const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
  if(response.status!==200||!exact(data,['schemaVersion','serviceId','durationMinutes','slots'])||data.schemaVersion!==1||data.serviceId!==service.id||data.durationMinutes!==service.durationMinutes||!Array.isArray(data.slots)||data.slots.length>2016)throw new PaidJourneyAvailabilityError('UNVERIFIED','Availability does not match the pinned customer service.');
  const slots:Array<Readonly<{start:string;end:string;remainingCapacity:number}>>=[];let previous=-Infinity;
  for(const slot of data.slots){if(!exact(slot,['start','end','remainingCapacity']))throw new PaidJourneyAvailabilityError('UNVERIFIED','Availability contains incompatible slot data.');const start=utc(slot.start),end=utc(slot.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<from||end>to||start<=previous||end-start!==service.durationMinutes*60000||typeof slot.remainingCapacity!=='number'||!Number.isSafeInteger(slot.remainingCapacity)||slot.remainingCapacity<1)throw new PaidJourneyAvailabilityError('UNVERIFIED','Availability contains invalid or out-of-window slots.');previous=start;slots.push(Object.freeze({start:new Date(start).toISOString(),end:new Date(end).toISOString(),remainingCapacity:slot.remainingCapacity}));}
  return Object.freeze({schemaVersion:1,serviceId:service.id,durationMinutes:service.durationMinutes,slots:Object.freeze(slots)});
 }
 /** Owner verification reads never reconcile any uncertain publication/save writer. */
 async function readPaidJourneyOwnerPublication(tenantId:string,flowId:string,options:{signal?:AbortSignal}={}):Promise<PaidJourneyOwnerPublication>{
  if(!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||options.signal?.aborted)throw new PublicationError('not_sent','Use only an optional cancellation signal for owner publication verification.');
  if(!bookingApiOrigin||!token||!userId||!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Sign in and choose a valid business and journey publication.');
  const tenant=tenantId.toLowerCase(),flow=flowId.toLowerCase(),current=generation,credential=token,sequence=++journeyOwnerReadSequence,signal=options.signal;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-flows/'+flow+'/publication?tenantId='+encodeURIComponent(tenant),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`},...(signal?{signal}:{})});value=await response.json();}catch{throw new PublicationError('not_sent','The owner publication could not be read. No writer was reconciled or retried.');}
  if(current!==generation||sequence!==journeyOwnerReadSequence||signal?.aborted||response.redirected||response.status!==200||!exact(value,['ok','data'])||value.ok!==true)throw new PublicationError('not_sent','The owner publication could not be verified in this context. No writer was reconciled.');
  const data=value.data;
  if(!exact(data,['schemaVersion','tenantId','flowId','draftRevision','versionId','installationId','renderSchemaVersion','allowedOrigins','render'])||data.schemaVersion!==1||data.tenantId!==tenant||data.flowId!==flow||!draftRevision(data.draftRevision)||!uuid(data.versionId)||data.versionId!==data.versionId.toLowerCase()||!uuid(data.installationId)||data.installationId!==data.installationId.toLowerCase()||data.renderSchemaVersion!==8||!Array.isArray(data.allowedOrigins)||data.allowedOrigins.length<1||data.allowedOrigins.length>20||new Set(data.allowedOrigins).size!==data.allowedOrigins.length||data.allowedOrigins.some(o=>!httpsOrigin(o)||o.length>2048))throw new PublicationError('not_sent','The owner publication receipt is incompatible. No writer was reconciled.');
  const parsed=PaidJourneyRender.safeParse(data.render);
  if(!parsed.success||parsed.data.versionId!==data.versionId)throw new PublicationError('not_sent','The immutable published journey does not match its receipt. No writer was reconciled.');
  return Object.freeze({schemaVersion:1,tenantId:tenant,flowId:flow,draftRevision:data.draftRevision as number,versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:8,allowedOrigins:Object.freeze([...data.allowedOrigins]) as readonly string[],render:parsed.data});
 }
 let journeyFieldPublicReadSequence=0;
 /** Immutable V9 presentation only; never creates a customer session or settles a writer. */
 async function loadPaidJourneyCustomerFieldRender(installationId:string,options:{origin:string;signal?:AbortSignal}):Promise<PaidJourneyCustomerFieldRender>{
  const invalid=()=>new PaidJourneyCustomerFieldRenderError('INVALID_REQUEST','Choose a canonical V9 installation and exact approved Checkout origin.');
  if(!bookingApiOrigin||!uuid(installationId)||installationId!==installationId.toLowerCase()||!options||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw invalid();
  const descriptors=Object.getOwnPropertyDescriptors(options),names=Reflect.ownKeys(options);
  if(names.some(name=>typeof name!=='string'||!['origin','signal'].includes(name))||!descriptors.origin||Object.values(descriptors).some(p=>!p.enumerable||!('value' in p)))throw invalid();
  const origin=descriptors.origin.value,signal=descriptors.signal?.value;
  if(!httpsOrigin(origin)||origin.length>2048||signal!==undefined&&!(signal instanceof AbortSignal))throw invalid();
  if(signal?.aborted)throw new PaidJourneyCustomerFieldRenderError('ABORTED','Preview read was cancelled.');
  const current=generation,sequence=++journeyFieldPublicReadSequence;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/public/paid-journey-customer-field-installations/'+installationId+'/render',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Origin:origin},...(signal?{signal}:{})});value=await response.json();}
  catch{throw new PaidJourneyCustomerFieldRenderError(signal?.aborted?'ABORTED':'UNVERIFIED','Preview could not be read. No writer was retried or reconciled.');}
  if(signal?.aborted)throw new PaidJourneyCustomerFieldRenderError('ABORTED','Preview read was cancelled.');
  if(current!==generation||sequence!==journeyFieldPublicReadSequence)throw new PaidJourneyCustomerFieldRenderError('STALE_CONTEXT','Preview belongs to an older request or account context.');
  if(response.redirected)throw new PaidJourneyCustomerFieldRenderError('UNVERIFIED','Redirected preview cannot be verified.');
  if(response.status!==200)throw new PaidJourneyCustomerFieldRenderError('REJECTED','Preview is unavailable in this context.');
  if(!exact(value,['ok','data'])||value.ok!==true)throw new PaidJourneyCustomerFieldRenderError('UNVERIFIED','Preview response is incompatible.');
  const parsed=PaidJourneyCustomerFieldRender.safeParse(value.data);
  if(!parsed.success)throw new PaidJourneyCustomerFieldRenderError('UNVERIFIED','Immutable V9 preview is incompatible.');
  return parsed.data;
 }
 async function readPaidJourneyRender(installationId:string):Promise<PaidJourneyRender>{
  if(!bookingApiOrigin||!uuid(installationId))throw new PublicationError('not_sent','Choose a valid V8 installation and configured API.');
  const current=generation;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-installations/'+installationId.toLowerCase()+'/render',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});value=await response.json();}catch{throw new PublicationError('not_sent','The immutable journey preview could not be read. No writer was reconciled.');}
  if(current!==generation||response.redirected||response.status!==200||!exact(value,['ok','data'])||value.ok!==true)throw new PublicationError('not_sent','The immutable journey preview could not be verified. No writer was reconciled.');
  const parsed=PaidJourneyRender.safeParse(value.data);if(!parsed.success)throw new PublicationError('not_sent','The immutable journey preview is incompatible. No writer was reconciled.');
  return parsed.data;
 }
 function paidJourneyCustomerFieldPublicationState(tenantId:string):PaidJourneyCustomerFieldPublicationState{
  if(!uuid(tenantId))return fail('Invalid business selection.');const tenant=tenantId.toLowerCase(),actor=userId?.toLowerCase();if(!token||!actor)return {phase:'ready'};
  const attempt=journeyFieldPublicationAttempts.get(tenant);
  if(attempt?.actor===actor)return {phase:attempt.generation===generation?'publishing':'unknown',flowId:attempt.flowId,draftRevision:attempt.draftRevision};
  const entry=journeyFieldPublications.get(tenant);return entry?.actor===actor&&entry.generation===generation?immutableDetailing(structuredClone(entry.state)):{phase:'ready'};
 }
 function journeyFieldPublishInput(value:unknown):PaidJourneyCustomerFieldPublishInput|undefined{
  if(!exact(value,['schemaVersion','expectedDraftRevision','allowedOrigins'])||Reflect.ownKeys(value).length!==3||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return;
  const properties=Object.getOwnPropertyDescriptors(value);if(Object.values(properties).some(property=>!property.enumerable||!('value' in property)))return;
  const schema=properties.schemaVersion!.value,revision=properties.expectedDraftRevision!.value,origins=properties.allowedOrigins!.value;
  if(schema!==2||!draftRevision(revision)||!Array.isArray(origins)||Object.getPrototypeOf(origins)!==Array.prototype||origins.length<1||origins.length>20||Reflect.ownKeys(origins).length!==origins.length+1)return;
  const captured:string[]=[];for(let index=0;index<origins.length;index++){const property=Object.getOwnPropertyDescriptor(origins,String(index));if(!property||!property.enumerable||!('value' in property)||!httpsOrigin(property.value)||property.value.length>2048)return;captured.push(property.value);}
  if(new Set(captured).size!==captured.length)return;return Object.freeze({schemaVersion:2,expectedDraftRevision:revision as number,allowedOrigins:Object.freeze(captured)});
 }
 async function publishPaidJourneyCustomerFieldDraft(tenantId:string,flowId:string,input:PaidJourneyCustomerFieldPublishInput):Promise<PaidJourneyCustomerFieldPublicationReceipt>{
  const {tenant,flow,actor}=journeyAuthority(tenantId,flowId);
  const parsed=journeyFieldPublishInput(input);if(!parsed)throw new PublicationError('not_sent','Check the saved journey revision and exact Checkout origins.');
  const draft=journeyFieldDrafts.get(tenant);
  if(draft?.actor!==actor||draft.generation!==generation||!['loaded','saved'].includes(draft.state.phase)||!('revision' in draft.state)||draft.state.flowId!==flow||draft.state.revision!==parsed.expectedDraftRevision)throw new PublicationError('not_sent','Load or save the current journey revision before explicit publication.');
  const body=JSON.stringify({schemaVersion:2,expectedDraftRevision:parsed.expectedDraftRevision,allowedOrigins:[...parsed.allowedOrigins]}),current=generation,credential=token!;
  const attempt={actor,flowId:flow,draftRevision:parsed.expectedDraftRevision,generation:current};journeyFieldPublicationAttempts.set(tenant,attempt);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-customer-field-flows/'+flow+'/publish?tenantId='+encodeURIComponent(tenant),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body});value=await response.json();}catch{throw new PublicationError('unknown','Journey publication may have committed. Do not repeat or replace this write.');}
   if(current!==generation||journeyFieldPublicationAttempts.get(tenant)!==attempt||response.redirected)throw new PublicationError('unknown','Journey publication cannot be verified in this session. Do not repeat it.');
   const codes:Record<string,number>={INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
   if(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&Object.hasOwn(codes,value.code)&&response.status===codes[value.code]){
    journeyFieldPublicationAttempts.delete(tenant);journeyFieldPublications.set(tenant,{actor,generation:current,state:{phase:'conflict',flowId:flow,draftRevision:attempt.draftRevision}});journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:'conflict',flowId:flow}});
    if(value.code==='UNAUTHENTICATED')signOut();throw new PublicationError('rejected','Journey publication was rejected. Recheck owner access and load the current saved revision.');
   }
   const d=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(d,['schemaVersion','tenantId','flowId','draftRevision','versionId','installationId','renderSchemaVersion','replayed'])||d.schemaVersion!==2||d.tenantId!==tenant||d.flowId!==flow||d.draftRevision!==attempt.draftRevision||!uuid(d.versionId)||d.versionId!==d.versionId.toLowerCase()||!uuid(d.installationId)||d.installationId!==d.installationId.toLowerCase()||d.renderSchemaVersion!==9||typeof d.replayed!=='boolean')throw new PublicationError('unknown','Journey publication receipt could not be verified. Do not repeat or replace this write.');
   const receipt=Object.freeze({...d}) as unknown as PaidJourneyCustomerFieldPublicationReceipt;journeyFieldPublicationAttempts.delete(tenant);journeyFieldPublications.set(tenant,{actor,generation:current,state:{phase:'published',flowId:flow,draftRevision:receipt.draftRevision,receipt}});return receipt;
  }catch(error){if(journeyFieldPublicationAttempts.get(tenant)===attempt){attempt.generation=-1;}throw error;}
 }
 /** Owner verification reads never reconcile any uncertain publication/save writer. */
 async function readPaidJourneyCustomerFieldOwnerPublication(tenantId:string,flowId:string,options:{signal?:AbortSignal}={}):Promise<PaidJourneyCustomerFieldOwnerPublication>{
  if(!(exact(options,[])||exact(options,['signal']))||(options.signal!==undefined&&!(options.signal instanceof AbortSignal))||options.signal?.aborted)throw new PublicationError('not_sent','Use only an optional cancellation signal for owner publication verification.');
  if(!bookingApiOrigin||!token||!userId||!uuid(tenantId)||!uuid(flowId))throw new PublicationError('not_sent','Sign in and choose a valid business and journey publication.');
  const tenant=tenantId.toLowerCase(),flow=flowId.toLowerCase(),current=generation,credential=token,sequence=++journeyFieldOwnerReadSequence,signal=options.signal;let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/paid-journey-customer-field-flows/'+flow+'/publication?tenantId='+encodeURIComponent(tenant),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`},...(signal?{signal}:{})});value=await response.json();}catch{throw new PublicationError('not_sent','The owner publication could not be read. No writer was reconciled or retried.');}
  if(current===generation&&sequence===journeyFieldOwnerReadSequence&&!signal?.aborted&&!response.redirected&&response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED')signOut();
  if(current!==generation||sequence!==journeyFieldOwnerReadSequence||signal?.aborted||response.redirected||response.status!==200||!exact(value,['ok','data'])||value.ok!==true)throw new PublicationError('not_sent','The owner publication could not be verified in this context. No writer was reconciled.');
  const data=value.data;
  if(!exact(data,['schemaVersion','tenantId','flowId','draftRevision','versionId','installationId','renderSchemaVersion','allowedOrigins','render'])||data.schemaVersion!==2||data.tenantId!==tenant||data.flowId!==flow||!draftRevision(data.draftRevision)||!uuid(data.versionId)||data.versionId!==data.versionId.toLowerCase()||!uuid(data.installationId)||data.installationId!==data.installationId.toLowerCase()||data.renderSchemaVersion!==9||!Array.isArray(data.allowedOrigins)||data.allowedOrigins.length<1||data.allowedOrigins.length>20||new Set(data.allowedOrigins).size!==data.allowedOrigins.length||data.allowedOrigins.some(o=>!httpsOrigin(o)||o.length>2048))throw new PublicationError('not_sent','The owner publication receipt is incompatible. No writer was reconciled.');
  const parsed=PaidJourneyCustomerFieldRender.safeParse(data.render);
  if(!parsed.success||parsed.data.versionId!==data.versionId)throw new PublicationError('not_sent','The immutable published journey does not match its receipt. No writer was reconciled.');
  return Object.freeze({schemaVersion:2,tenantId:tenant,flowId:flow,draftRevision:data.draftRevision as number,versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:9,allowedOrigins:Object.freeze([...data.allowedOrigins]) as readonly string[],render:parsed.data});
 }
 function journeyFieldContext(tenantId:string,flowId:string){
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(flowId))throw new PaidJourneyDraftError('not_sent','Sign in and choose a valid business and conditional journey draft.');
  return{tenant:tenantId.toLowerCase(),flow:flowId.toLowerCase(),actor:userId.toLowerCase(),current:generation,credential:token};
 }
 function paidJourneyCustomerFieldDraftState(tenantId:string):PaidJourneyCustomerFieldDraftState{
  if(!uuid(tenantId))return fail('Invalid business selection.');if(!token||!userId)return{phase:'ready'};const tenant=tenantId.toLowerCase(),actor=userId.toLowerCase(),attempt=journeyFieldAttempts.get(tenant);
  if(attempt?.actor===actor){const entry=journeyFieldDrafts.get(tenant);return attempt.generation===generation&&entry?.generation===generation&&entry.state.phase==='saving'?{phase:'saving',flowId:attempt.flowId}:{phase:'unverified',flowId:attempt.flowId};}
  const entry=journeyFieldDrafts.get(tenant);return entry?.actor===actor&&entry.generation===generation?immutableDetailing(structuredClone(entry.state)):{phase:'ready'};
 }
 function journeyFieldDraft(value:unknown,tenant:string,flow:string):PaidJourneyCustomerFieldOwnerDraft|undefined{
  if(!exact(value,['schemaVersion','tenantId','flowId','serviceId','revision','form'])||value.schemaVersion!==2||value.tenantId!==tenant||value.flowId!==flow||!uuid(value.serviceId)||value.serviceId!==value.serviceId.toLowerCase()||!draftRevision(value.revision))return;
  const form=PaidJourneyCustomerFieldForm.safeParse(value.form);if(!form.success)return;
  return immutableDetailing({schemaVersion:2,tenantId:tenant,flowId:flow,serviceId:value.serviceId,revision:value.revision as number,form:form.data});
 }
 /** A GET can inspect current owner data, never settle or replace an uncertain write. */
 async function loadPaidJourneyCustomerFieldDraft(tenantId:string,flowId:string):Promise<PaidJourneyCustomerFieldOwnerDraft>{
  const {tenant,flow,actor,current,credential}=journeyFieldContext(tenantId,flowId),attempt=journeyFieldAttempts.get(tenant),previous=journeyFieldDrafts.get(tenant);
  if(attempt&&(attempt.actor!==actor||attempt.flowId!==flow))throw new PaidJourneyDraftError('not_sent','Only this actor may inspect the exact frozen conditional journey draft.');
  if(previous?.actor===actor&&previous.generation===current&&['loading','saving'].includes(previous.state.phase))throw new PaidJourneyDraftError('not_sent','A conditional journey draft operation is already pending.');
  const entry={actor,generation:current,state:{phase:'loading' as const,flowId:flow}};journeyFieldDrafts.set(tenant,entry);
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-customer-field-flows/'+flow+'/draft?tenantId='+encodeURIComponent(tenant),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PaidJourneyDraftError('unknown','The conditional journey draft could not be read. No save was reconciled.');}
   if(current!==generation||journeyFieldDrafts.get(tenant)!==entry||response.redirected)throw new PaidJourneyDraftError('unknown','The conditional journey draft read cannot be accepted after the context changed.');
   const error=journeyError(response,value);if(error)throw error;
   const draft=response.status===200&&exact(value,['ok','data'])&&value.ok===true?journeyFieldDraft(value.data,tenant,flow):undefined;if(!draft)throw new PaidJourneyDraftError('unknown','The conditional journey draft response could not be verified.');
   const publication=journeyFieldPublications.get(tenant);
   // A known rejection requires fresh authoring context. An unknown attempt is
   // deliberately never released, including by this successful draft read.
   if(!journeyFieldPublicationAttempts.has(tenant)&&publication?.actor===actor&&publication.generation===current&&publication.state.phase==='conflict'&&publication.state.flowId===flow)journeyFieldPublications.delete(tenant);
   journeyFieldDrafts.set(tenant,{actor,generation:current,state:attempt?{phase:'unverified',flowId:flow}:{phase:'loaded',flowId:flow,revision:draft.revision,draft}});return draft;
  }catch(error){if(current===generation&&journeyFieldDrafts.get(tenant)===entry)journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:attempt?'unverified':'conflict',flowId:flow}});throw error;}
 }
 async function savePaidJourneyCustomerFieldDraft(tenantId:string,flowId:string,input:PaidJourneyCustomerFieldDraftInput):Promise<PaidJourneyCustomerFieldDraftReceipt>{
  const {tenant,flow,actor,current,credential}=journeyFieldContext(tenantId,flowId);journeyAuthority(tenant,flow);
  const parsed=exact(input,['schemaVersion','serviceId','expectedRevision','form'])&&input.schemaVersion===2?PaidJourneyCustomerFieldForm.safeParse(input.form):undefined;
  if(!parsed?.success||!uuid(input.serviceId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new PaidJourneyDraftError('not_sent','Check conditional journey identity, revision and bound fields.');
  const previous=journeyFieldDrafts.get(tenant),state=previous?.actor===actor&&previous.generation===current?previous.state:undefined;
  if(state?(state.phase!=='loaded'&&state.phase!=='saved'||state.flowId!==flow||state.revision!==input.expectedRevision):input.expectedRevision!==0)throw new PaidJourneyDraftError('not_sent','Load the current conditional journey draft before saving; never replace an uncertain save.');
  const body=JSON.stringify({schemaVersion:2,serviceId:input.serviceId.toLowerCase(),expectedRevision:input.expectedRevision,form:parsed.data}),attempt={actor,flowId:flow,expectedRevision:input.expectedRevision,generation:current};journeyFieldAttempts.set(tenant,attempt);journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:'saving',flowId:flow}});
  try{
   let response:Response,value:unknown;try{response=await transport(bookingApiOrigin!+'/api/paid-journey-customer-field-flows/'+flow+'/draft?tenantId='+encodeURIComponent(tenant),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body});value=await response.json();}catch{throw new PaidJourneyDraftError('unknown','Conditional journey save may have committed. Do not retry or replace the write.');}
   if(current!==generation||journeyFieldAttempts.get(tenant)!==attempt||response.redirected)throw new PaidJourneyDraftError('unknown','Conditional journey save cannot be verified after the context changed.');
   const error=journeyError(response,value);if(error)throw error;
   const data=response.status===200&&exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(!exact(data,['schemaVersion','tenantId','flowId','revision'])||data.schemaVersion!==2||data.tenantId!==tenant||data.flowId!==flow||!draftRevision(data.revision)||data.revision!==attempt.expectedRevision+1)throw new PaidJourneyDraftError('unknown','Conditional journey save receipt could not be verified. Do not repeat or replace it.');
   const receipt=immutableDetailing({...data}) as unknown as PaidJourneyCustomerFieldDraftReceipt;journeyFieldAttempts.delete(tenant);journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:'saved',flowId:flow,revision:receipt.revision}});return receipt;
  }catch(error){if(journeyFieldAttempts.get(tenant)===attempt){if(error instanceof PaidJourneyDraftError&&['rejected','conflict'].includes(error.delivery)){journeyFieldAttempts.delete(tenant);if(current===generation)journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:'conflict',flowId:flow}});}else if(current===generation)journeyFieldDrafts.set(tenant,{actor,generation:current,state:{phase:'unverified',flowId:flow}});}throw error;}
 }
 async function loadPaidJourneyDraft(tenantId:string,flowId:string):Promise<PaidJourneyOwnerDraft>{
  const {tenant,flow,actor}=journeyAuthority(tenantId,flowId),previous=journeyDrafts.get(tenant),current=generation,credential=token!;
  if(previous?.actor===actor&&previous.state.phase==='unverified')throw new PaidJourneyDraftError('not_sent','This journey outcome remains unverified. A draft read cannot authorize replacing an uncertain save.');
  const entry={actor,state:{phase:'loading' as const,flowId:flow}};journeyDrafts.set(tenant,entry);
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-journey-flows/'+flow+'/draft?tenantId='+encodeURIComponent(tenant),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new PaidJourneyDraftError('unknown','The journey draft could not be read. No save or publication was authorized.');}
   if(current!==generation||journeyDrafts.get(tenant)!==entry)throw new PaidJourneyDraftError('unknown','The session changed. The journey read cannot be accepted here.');
   const error=journeyError(response,value);if(error)throw error;
   const draft=response.status===200&&exact(value,['ok','data'])&&value.ok===true?journeyDraft(value.data,tenant,flow):undefined;
   if(!draft)throw new PaidJourneyDraftError('unknown','The journey draft response could not be verified. No writer was authorized.');
   journeyDrafts.set(tenant,{actor,state:{phase:'loaded',flowId:flow,revision:draft.revision,draft}});return draft;
  }catch(error){if(current===generation&&journeyDrafts.get(tenant)===entry){journeyDrafts.set(tenant,{actor,state:{phase:'conflict',flowId:flow}});}throw error;}
 }
 async function savePaidJourneyDraft(tenantId:string,flowId:string,input:PaidJourneyDraftInput):Promise<PaidJourneyDraftReceipt>{
  const {tenant,flow,actor}=journeyAuthority(tenantId,flowId);
  const parsed=exact(input,['schemaVersion','expectedRevision','serviceId','name','presentation','journey'])&&input.schemaVersion===1?PaidJourney.safeParse(input.journey):undefined;
  if(!parsed?.success||!uuid(input.serviceId)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>200||!presentation(input.presentation)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new PaidJourneyDraftError('not_sent','Check the journey draft identity, revision, name, design and stage order.');
  const previous=journeyDrafts.get(tenant),state=previous?.actor===actor?previous.state:undefined;
  if(state?(state.phase!=='loaded'&&state.phase!=='saved'||state.flowId!==flow||state.revision!==input.expectedRevision):input.expectedRevision!==0)throw new PaidJourneyDraftError('not_sent','Load the current journey revision before saving. An uncertain save cannot be repeated or replaced.');
  const requested={schemaVersion:1,expectedRevision:input.expectedRevision,serviceId:input.serviceId.toLowerCase(),name:input.name.trim(),presentation:{...input.presentation},journey:parsed.data},body=JSON.stringify(requested),current=generation,credential=token!;
  const attempt={actor,flowId:flow,expectedRevision:input.expectedRevision};journeyAttempts.set(tenant,attempt);journeyDrafts.set(tenant,{actor,state:{phase:'saving',flowId:flow}});
  try{
   let response:Response,value:unknown;
   try{response=await transport(bookingApiOrigin!+'/api/paid-journey-flows/'+flow+'/draft?tenantId='+encodeURIComponent(tenant),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body});value=await response.json();}catch{throw new PaidJourneyDraftError('unknown','Journey save status is unverified. Do not repeat or replace the save.');}
   if(current!==generation||journeyAttempts.get(tenant)!==attempt)throw new PaidJourneyDraftError('unknown','The session changed. Journey save status remains unverified; do not repeat it.');
   const error=journeyError(response,value);if(error)throw error;
   const data=exact(value,['ok','data'])&&value.ok===true?value.data:undefined;
   if(response.status!==200||!exact(data,['schemaVersion','tenantId','flowId','revision'])||data.schemaVersion!==1||data.tenantId!==tenant||data.flowId!==flow||!draftRevision(data.revision)||data.revision!==attempt.expectedRevision+1)throw new PaidJourneyDraftError('unknown','The journey save receipt could not be verified. Do not repeat or replace the save.');
   const receipt=Object.freeze({...data}) as unknown as PaidJourneyDraftReceipt;journeyAttempts.delete(tenant);journeyDrafts.set(tenant,{actor,state:{phase:'saved',flowId:flow,revision:receipt.revision}});return receipt;
  }catch(error){
   if(journeyAttempts.get(tenant)===attempt){if(error instanceof PaidJourneyDraftError&&(error.delivery==='rejected'||error.delivery==='conflict')){journeyAttempts.delete(tenant);if(current===generation){if(error.delivery==='conflict')journeyDrafts.set(tenant,{actor,state:{phase:'conflict',flowId:flow}});else if(previous?.actor===actor)journeyDrafts.set(tenant,previous);else journeyDrafts.delete(tenant);}}else journeyDrafts.set(tenant,{actor,state:{phase:'unverified',flowId:flow}});}
   throw error;
  }
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
 async function readBookingFormAnswers(tenantId:string,bookingId:string,signal?:AbortSignal):Promise<OwnerBookingFormAnswers>{
  if(!token||!userId||!bookingApiOrigin)throw new BookingFormAnswersError('UNAUTHENTICATED','Sign in with the configured booking service.');
  if(!uuid(tenantId)||!uuid(bookingId))throw new BookingFormAnswersError('INVALID_REQUEST','Select a valid business and booking.');
  tenantId=tenantId.toLowerCase();bookingId=bookingId.toLowerCase();const at=generation,actor=userId,credential=token,controller=new AbortController();
  const current=()=>at===generation&&actor===userId&&credential===token;
  let timedOut=false;const deadline=setTimeout(()=>{timedOut=true;controller.abort();},15000);
  const aborted=()=>new BookingFormAnswersError(!current()?'STALE_CONTEXT':timedOut?'UNVERIFIED':'ABORTED',!current()?'The signed-in account changed. Refresh this booking again.':timedOut?'Saved form answers could not be verified.':'Saved-answer loading was cancelled.');
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();bookingAnswerReads.add(controller);
  // Race only these GET/body reads; never change the uncertain-outcome semantics of booking writers.
  async function wait<T>(value:Promise<T>):Promise<T>{
   let stop!:()=>void;const cancelled=new Promise<never>((_resolve,reject)=>{stop=()=>reject(aborted());controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();});
   try{return await Promise.race([value,cancelled]);}finally{controller.signal.removeEventListener('abort',stop);}
  }
  const ensure=()=>{if(!current())throw new BookingFormAnswersError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');if(controller.signal.aborted)throw aborted();};
  const readOptions={method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal} as const;
  try{
   ensure();let response=await wait(transport(base.origin+`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,{...readOptions,headers:{apikey:config.publishableKey,Authorization:`Bearer ${credential}`}}));ensure();
   if(response.status===401){signOut();throw new BookingFormAnswersError('UNAUTHENTICATED','Please sign in again before loading saved answers.');}
   if(!response.ok)throw new BookingFormAnswersError('UNVERIFIED','Fresh owner membership could not be verified.');
   const memberships=rows(await wait(response.json()));ensure();
   if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(row=>String(row.tenant_id).toLowerCase()===tenantId&&row.role==='BUSINESS_OWNER'))throw new BookingFormAnswersError('FORBIDDEN','Only an authenticated owner of this business can load saved answers.');
   response=await wait(transport(bookingApiOrigin+'/api/booking-form-answers?tenantId='+encodeURIComponent(tenantId)+'&bookingId='+encodeURIComponent(bookingId),{...readOptions,headers:{Authorization:`Bearer ${credential}`}}));ensure();
   if(response.status===401){signOut();throw new BookingFormAnswersError('UNAUTHENTICATED','Please sign in again before loading saved answers.');}
   const value:unknown=await wait(response.json());ensure();
   if(response.status===200&&exact(value,['ok','data'])&&value.ok===true){const result=OwnerBookingFormAnswers.safeParse(value.data);if(result.success&&result.data.tenantId===tenantId&&result.data.bookingId===bookingId){for(const answer of result.data.answers)Object.freeze(answer);Object.freeze(result.data.answers);if(result.data.provenance)Object.freeze(result.data.provenance);return Object.freeze(result.data);}}
   if(exact(value,['ok','code'])&&value.ok===false){
    if(response.status===403&&value.code==='FORBIDDEN')throw new BookingFormAnswersError('FORBIDDEN','Only an authenticated owner of this business can load saved answers.');
    if(response.status===404&&value.code==='NOT_AVAILABLE')throw new BookingFormAnswersError('NOT_AVAILABLE','Saved form answers are unavailable for this booking.');
    if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new BookingFormAnswersError('UNSUPPORTED_CONFIG','Saved form answers are unavailable in this workspace.');
   }
   throw new BookingFormAnswersError('UNVERIFIED','Saved form answers could not be verified.');
  }catch(error){if(error instanceof BookingFormAnswersError)throw error;if(!current()||controller.signal.aborted)throw aborted();throw new BookingFormAnswersError('UNVERIFIED','Saved form answers could not be verified.');}
  finally{clearTimeout(deadline);signal?.removeEventListener('abort',cancel);bookingAnswerReads.delete(controller);}
 }
 async function readConfirmationReceiptStatus(tenantId:string,bookingId:string):Promise<ConfirmationReceiptStatus>{
  if(!token||!userId||!bookingApiOrigin)throw new ConfirmationReceiptStatusError('UNAUTHENTICATED','Sign in with the configured notification service.');
  if(!uuid(tenantId)||!uuid(bookingId))throw new ConfirmationReceiptStatusError('INVALID_REQUEST','Select a valid business and booking.');
  tenantId=tenantId.toLowerCase();bookingId=bookingId.toLowerCase();const at=generation,actor=userId,credential=token;
  const current=()=>at===generation&&actor===userId&&credential===token;
  let memberships:Record<string,unknown>[];
  try{memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));}catch{if(!current())throw new ConfirmationReceiptStatusError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');throw new ConfirmationReceiptStatusError('UNVERIFIED','Fresh owner membership could not be verified.');}
  if(!current())throw new ConfirmationReceiptStatusError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(row=>String(row.tenant_id).toLowerCase()===tenantId&&row.role==='BUSINESS_OWNER'))throw new ConfirmationReceiptStatusError('FORBIDDEN','Fresh owner membership for this exact business is required.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/confirmation-receipts?tenantId='+encodeURIComponent(tenantId)+'&bookingId='+encodeURIComponent(bookingId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});}catch{throw new ConfirmationReceiptStatusError('UNVERIFIED','Receipt recording status could not be verified.');}
  if(!current())throw new ConfirmationReceiptStatusError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(response.status===401){signOut();throw new ConfirmationReceiptStatusError('UNAUTHENTICATED','Please sign in again before checking recorded receipts.');}
  try{value=await response.json();}catch{throw new ConfirmationReceiptStatusError('UNVERIFIED','Receipt recording status could not be verified.');}
  if(!current())throw new ConfirmationReceiptStatusError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(response.status===200&&exact(value,['ok','data'])&&value.ok===true){const receipt=ConfirmationReceiptStatus.safeParse(value.data);if(receipt.success&&receipt.data.tenantId===tenantId&&receipt.data.bookingId===bookingId)return receipt.data;}
  if(exact(value,['ok','code'])&&value.ok===false){
   if(response.status===403&&value.code==='FORBIDDEN')throw new ConfirmationReceiptStatusError('FORBIDDEN','Only an authorized owner can check recorded receipts.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new ConfirmationReceiptStatusError('NOT_AVAILABLE','Receipt recording status is unavailable for this booking.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new ConfirmationReceiptStatusError('UNSUPPORTED_CONFIG','Receipt recording checks are unavailable in this workspace.');
  }
  throw new ConfirmationReceiptStatusError('UNVERIFIED','Receipt recording status could not be verified.');
 }
 async function readConfirmationReceiptHistory(tenantId:string,bookingId:string):Promise<ConfirmationReceiptHistory>{
  if(!token||!userId||!bookingApiOrigin)throw new ConfirmationReceiptHistoryError('UNAUTHENTICATED','Sign in with the configured notification service.');
  if(!uuid(tenantId)||!uuid(bookingId))throw new ConfirmationReceiptHistoryError('INVALID_REQUEST','Select a valid business and booking.');
  tenantId=tenantId.toLowerCase();bookingId=bookingId.toLowerCase();const at=generation,actor=userId,credential=token;
  const current=()=>at===generation&&actor===userId&&credential===token;
  let memberships:Record<string,unknown>[];
  try{memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));}catch{if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');throw new ConfirmationReceiptHistoryError('UNVERIFIED','Fresh owner membership could not be verified.');}
  if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(row=>String(row.tenant_id).toLowerCase()===tenantId&&row.role==='BUSINESS_OWNER'))throw new ConfirmationReceiptHistoryError('FORBIDDEN','Fresh owner membership for this exact business is required.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/confirmation-receipt-history?tenantId='+encodeURIComponent(tenantId)+'&bookingId='+encodeURIComponent(bookingId),{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});}catch{if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');throw new ConfirmationReceiptHistoryError('UNVERIFIED','Receipt history could not be verified.');}
  if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(response.status===401){signOut();throw new ConfirmationReceiptHistoryError('UNAUTHENTICATED','Please sign in again before checking recorded receipts.');}
  try{value=await response.json();}catch{if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');throw new ConfirmationReceiptHistoryError('UNVERIFIED','Receipt history could not be verified.');}
  if(!current())throw new ConfirmationReceiptHistoryError('STALE_CONTEXT','The signed-in account changed. Refresh this booking again.');
  if(response.status===200&&exact(value,['ok','data'])&&value.ok===true){const receipt=ConfirmationReceiptHistory.safeParse(value.data);if(receipt.success&&receipt.data.tenantId===tenantId&&receipt.data.bookingId===bookingId){for(const row of receipt.data.receipts)Object.freeze(row);Object.freeze(receipt.data.receipts);return Object.freeze(receipt.data);}}
  if(exact(value,['ok','code'])&&value.ok===false){
   if(response.status===403&&value.code==='FORBIDDEN')throw new ConfirmationReceiptHistoryError('FORBIDDEN','Only an authorized owner can check recorded receipts.');
   if(response.status===404&&value.code==='NOT_AVAILABLE')throw new ConfirmationReceiptHistoryError('NOT_AVAILABLE','Receipt history is unavailable for this booking.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new ConfirmationReceiptHistoryError('UNSUPPORTED_CONFIG','Receipt history checks are unavailable in this workspace.');
  }
  throw new ConfirmationReceiptHistoryError('UNVERIFIED','Receipt history could not be verified.');
 }
 async function notificationPlannerOperation(tenantId:string,input?:SaveNotificationPlannerConfig):Promise<NotificationPlannerReceipt|null>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId))throw new NotificationPlannerError('not_sent','Sign in and select a verified business.');
  tenantId=tenantId.toLowerCase();const parsed=input===undefined?undefined:SaveNotificationPlannerConfig.safeParse(input);
  if(parsed&&!parsed.success||parsed?.success&&parsed.data.config.tenantId!==tenantId)throw new NotificationPlannerError('not_sent','The planner configuration must be valid and belong to this exact business.');
  if(parsed?.success&&(conditionalRollbackAttempts.size>0||offerLocked()||conditionalPublicationAttempts.size>0||uncertainConditionalDrafts.size>0||fieldRollbackAttempts.size>0||customerPublicationAttempts.size>0))throw new NotificationPlannerError('not_sent','Resolve pending business actions before saving notification settings.');
  const frozen=parsed?.success?parsed.data:undefined,body=frozen?JSON.stringify(frozen):undefined,at=generation,actor=userId,credential=token;
  const current=()=>at===generation&&actor===userId&&credential===token;
  let memberships:Record<string,unknown>[];
  try{memberships=rows(await request(`/rest/v1/tenant_members?select=tenant_id,role&user_id=eq.${tenant(actor)}`,'GET',undefined,true));}catch{throw new NotificationPlannerError('not_sent','Fresh owner membership could not be verified.');}
  if(!current())throw new NotificationPlannerError('not_sent','The signed-in account changed. Load this business again.');
  if(!memberships.every(row=>exact(row,['tenant_id','role'])&&uuid(row.tenant_id)&&typeof row.role==='string')||!memberships.some(row=>String(row.tenant_id).toLowerCase()===tenantId&&row.role==='BUSINESS_OWNER'))throw new NotificationPlannerError('not_sent','Fresh owner membership for this exact business is required.');
  let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/notification-planner-config?tenantId='+encodeURIComponent(tenantId),{method:frozen?'POST':'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,...(frozen?{'Content-Type':'application/json'}:{})},...(frozen?{body}:{})});}catch{throw new NotificationPlannerError(frozen?'unknown':'not_sent',frozen?'Save outcome is unverified. Explicitly read the current configuration; do not repeat the old revision.':'Notification settings could not be read.');}
  if(!current())throw new NotificationPlannerError(frozen?'unknown':'not_sent','The signed-in account changed. No planner receipt was accepted.');
  if(response.status===401){signOut();throw new NotificationPlannerError(frozen?'unknown':'not_sent','Please sign in again before checking notification settings.');}
  try{value=await response.json();}catch{throw new NotificationPlannerError(frozen?'unknown':'not_sent','The notification planner receipt could not be verified.');}
  if(!current())throw new NotificationPlannerError(frozen?'unknown':'not_sent','The signed-in account changed. No planner receipt was accepted.');
  if(exact(value,['ok','code'])&&value.ok===false){
   if(response.status===409&&value.code==='CONFLICT')throw new NotificationPlannerError('conflict','The saved revision changed. Explicitly load current settings before reviewing another save.');
   if(response.status===422&&value.code==='UNSUPPORTED_CONFIG')throw new NotificationPlannerError('unavailable','Notification planner configuration is unavailable in this workspace.');
   if([400,403,404].includes(response.status)&&['INVALID_REQUEST','FORBIDDEN','NOT_AVAILABLE'].includes(String(value.code)))throw new NotificationPlannerError('rejected','The notification planner request was rejected.');
  }
  if(response.status===200&&exact(value,['ok','data'])&&value.ok===true){
   if(!frozen&&value.data===null)return null;
   const receipt=NotificationPlannerReceipt.safeParse(value.data);
   if(receipt.success&&receipt.data.tenantId===tenantId&&(!frozen||receipt.data.revision===frozen.expectedRevision+1&&JSON.stringify(receipt.data.config)===JSON.stringify(frozen.config)))return receipt.data;
  }
  throw new NotificationPlannerError(frozen?'unknown':'not_sent','The notification planner receipt could not be verified.');
 }
 async function readNotificationPlannerConfig(tenantId:string):Promise<NotificationPlannerReceipt|null>{return notificationPlannerOperation(tenantId);}
 async function saveNotificationPlannerConfig(tenantId:string,input:SaveNotificationPlannerConfig):Promise<NotificationPlannerReceipt>{if(!SaveNotificationPlannerConfig.safeParse(input).success)throw new NotificationPlannerError('not_sent','Invalid notification planner save.');return (await notificationPlannerOperation(tenantId,input))!;}
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
  if(detailingSchedulingLocked()||uncertainOffers.size>0||uncertainScheduling.size>0||[...uncertainDetailing.values()].some(entry=>entry.actor!==actor||entry.tenantId!==tenantId)||[...detailingOffers.entries()].some(([id,state])=>id!==tenantId&&state.phase!=='created')||profileInitializationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||schedulingLocked()||businessCreationLocked()||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase()))||[...offers.values()].some(state=>state.phase!=='created'))throw new BusinessOnboardingError('not_sent','Resolve pending or uncertain business, draft, publication or rollback actions first.');
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
 async function readDetailingOfferInContext(tenantId:string,serviceId:string,expectedTimezone?:string):Promise<DetailingOfferReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(serviceId))throw new BusinessOnboardingError('not_sent','Sign in and select a valid detailing business and service.');
  const at=generation,credential=token,actor=userId,context=await detailingOfferContext(tenantId);
  if(expectedTimezone!==undefined&&context.timezone!==expectedTimezone)throw new BusinessOnboardingError('not_sent','The reviewed timezone no longer matches the current business.');
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed.');let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/detailing-offers/'+serviceId.toLowerCase()+'?tenantId='+context.tenantId,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`}});value=await response.json();}catch{throw new BusinessOnboardingError('not_sent','Detailing catalog read remains unverified.');}
  if(at!==generation||actor!==userId)throw new BusinessOnboardingError('not_sent','The signed-in account changed.');
  if(response.status===401){signOut();throw new BusinessOnboardingError('not_sent','Please sign in again.');}
  const parsed=response.status===200&&exact(value,['ok','data'])&&value.ok===true?DetailingOfferReceipt.safeParse(value.data):undefined;
  if(!parsed?.success||parsed.data.tenantId!==context.tenantId||parsed.data.service.id!==serviceId.toLowerCase()||parsed.data.service.currency!==context.currency)throw new BusinessOnboardingError('not_sent','The current detailing catalog receipt could not be verified.');
  return immutableDetailing(parsed.data);
 }
 async function readDetailingOffer(tenantId:string,serviceId:string):Promise<DetailingOfferReceipt>{return readDetailingOfferInContext(tenantId,serviceId);}
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
 async function ownerDetailingScheduling(tenantId:string,serviceId:string,input:CreateDetailingScheduling):Promise<DetailingSchedulingReceipt>{
  if(!token||!userId||!bookingApiOrigin||!uuid(tenantId)||!uuid(serviceId))throw new BusinessOnboardingError('not_sent','Sign in and select the verified owner-created offer.');
  tenantId=tenantId.toLowerCase();serviceId=serviceId.toLowerCase();const parsed=CreateDetailingScheduling.safeParse(input);if(!parsed.success)throw new BusinessOnboardingError('not_sent','Check same-day hours, sorted unique weekdays, fixed capacity and bounded policy.');
  const offer=detailingOffers.get(tenantId);if(offer?.phase!=='created'||offer.receipt.service.id!==serviceId)throw new BusinessOnboardingError('not_sent','A verified owner-created offer receipt is required.');
  if(parsed.data.windows.some(window=>window.endMinute-window.startMinute<offer.receipt.service.durationMinutes))throw new BusinessOnboardingError('not_sent','Each same-day window must fit the verified offer duration.');
  const body=Object.freeze({...parsed.data,windows:Object.freeze(parsed.data.windows.map(window=>Object.freeze({...window}))),policy:Object.freeze({...parsed.data.policy})}) as unknown as CreateDetailingScheduling;
  const key=tenantId+':'+serviceId,actor=userId.toLowerCase(),at=generation,credential=token,serialized=schedulingBody(body),prior=detailingScheduling.get(key),binding=detailingSchedulingAttempts.get(body.idempotencyKey);
  if(binding&&(binding.actor!==actor||binding.tenantId!==tenantId||binding.serviceId!==serviceId||binding.body!==serialized))throw new BusinessOnboardingError('not_sent','This scheduling key is bound to its original account, business, offer and reviewed settings.');
  if(prior&&prior.phase!=='unknown')throw new BusinessOnboardingError('not_sent','Scheduling is already pending or configured for this session offer.');
  if(prior?.phase==='unknown'&&schedulingBody(prior.attempt)!==serialized)throw new BusinessOnboardingError('not_sent','The uncertain scheduling attempt is locked to its original key and unchanged settings.');
  if(uncertainDetailing.size>0||[...detailingOffers.values()].some(state=>state.phase!=='created')||[...uncertainDetailingScheduling.values()].some(entry=>entry.actor!==actor||entry.tenantId!==tenantId||entry.serviceId!==serviceId)||uncertainScheduling.size>0||schedulingLocked()||profileInitializationLocked()||(fieldRollbackAttempts.size>0||conditionalRollbackAttempts.size>0)||businessCreationLocked()||[...offers.values()].some(state=>state.phase!=='created')||[...rollbacks.values()].some(state=>state.phase==='rolling_back'||state.phase==='unknown')||[...publications.keys(),...ownerDrafts.keys(),...savedDraftPublications.keys(),...customerPublications.keys(),...[...customerPublicationAttempts.values()].map(attempt=>attempt.tenantId),...[...conditionalPublicationAttempts.values()].map(attempt=>attempt.tenantId),...uncertainConditionalDrafts.keys()].some(id=>writerUncertain(id.toLowerCase()))||[...detailingScheduling.entries()].some(([id,state])=>id!==key&&state.phase!=='configured'))throw new BusinessOnboardingError('not_sent','Resolve uncertain offers, drafts, publications, rollbacks or other scheduling before this action.');
  detailingSchedulingAttempts.set(body.idempotencyKey,{actor,tenantId,serviceId,body:serialized});detailingScheduling.set(key,{phase:'checking',attempt:body});
  try{const context=await detailingOfferContext(tenantId);if(context.timezone!==body.timezone)throw new BusinessOnboardingError('not_sent','The reviewed timezone no longer matches the current business.');const current=await readDetailingOfferInContext(tenantId,serviceId,body.timezone);if(JSON.stringify(current)!==JSON.stringify(offer.receipt))throw new BusinessOnboardingError('not_sent','The original detailing catalog receipt no longer matches current server configuration.');if(at!==generation||actor!==userId?.toLowerCase())throw new BusinessOnboardingError('not_sent','The account changed before sending scheduling.');}catch(error){if(at===generation){if(prior)detailingScheduling.set(key,prior);else detailingScheduling.delete(key);}throw error;}
  detailingScheduling.set(key,{phase:'creating',attempt:body});uncertainDetailingScheduling.set(actor+':'+key,{actor,tenantId,serviceId,attempt:body,offer});let response:Response,value:unknown;
  try{response=await transport(bookingApiOrigin+'/api/catalog/detailing-offers/'+serviceId+'/scheduling?tenantId='+encodeURIComponent(tenantId),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:serialized});value=await response.json();}catch{if(at===generation)detailingScheduling.set(key,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Scheduling creation is unverified. Retry only the same account, business, offer, key and settings.');}
  if(at!==generation||actor!==userId?.toLowerCase())throw new BusinessOnboardingError('unknown','The account changed. This scheduling outcome cannot be verified here.');
  const result=response.status===200&&exact(value,['ok','data'])&&value.ok===true?DetailingSchedulingReceipt.safeParse(value.data):undefined;
  if(result?.success&&result.data.tenantId===tenantId&&result.data.serviceId===serviceId&&detailingSchedulingReceiptMatches(result.data,body)){const receipt=result.data;uncertainDetailingScheduling.delete(actor+':'+key);detailingScheduling.set(key,{phase:'configured',attempt:body,receipt:JSON.parse(JSON.stringify(receipt)) as DetailingSchedulingReceipt});return JSON.parse(JSON.stringify(receipt)) as DetailingSchedulingReceipt;}
  if(response.status===401&&exact(value,['ok','code'])&&value.ok===false&&value.code==='UNAUTHENTICATED'){signOut();throw new BusinessOnboardingError('unknown','Sign in with the same account to check the frozen scheduling attempt.');}
  const codes:Record<string,number>={INVALID_REQUEST:400,FORBIDDEN:403,NOT_AVAILABLE:404,CONFLICT:409,UNSUPPORTED_CONFIG:422,RATE_LIMITED:429};
  if(!prior&&exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string'&&response.status===codes[value.code]){uncertainDetailingScheduling.delete(actor+':'+key);detailingScheduling.delete(key);throw new BusinessOnboardingError(value.code==='UNSUPPORTED_CONFIG'?'unavailable':'rejected',value.code==='UNSUPPORTED_CONFIG'?'Scheduling authoring is unavailable. The server staging capability is disabled.':'Scheduling was rejected. Check current owner access, hours and existing configuration.');}
  detailingScheduling.set(key,{phase:'unknown',attempt:body});throw new BusinessOnboardingError('unknown','Scheduling remains unverified. This response does not prove an earlier attempt failed. Keep the frozen key and settings.');
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
  paidJourneyVersionHistory,rollbackPaidJourney,paidJourneyRollbackState,publishPaidJourneyDraft,readPaidJourneyRender,loadPaidJourneyCustomerFieldRender,readPaidJourneyOwnerPublication,issuePaidJourneySession,readPaidJourneyAvailability,holdPaidJourneySlot,recoverPaidJourneyHold,paidJourneyHoldState,mockPayPaidJourney,paidJourneyPaymentState,paidJourneyPublicationState,
  /** Opaque local auth epoch for dropping read snapshots; grants no identity or writer authority. */
  authContextRevision():number{return generation;},
  publishPaidJourneyCustomerFieldDraft,readPaidJourneyCustomerFieldOwnerPublication,paidJourneyCustomerFieldPublicationState,savePaidJourneyCustomerFieldDraft,loadPaidJourneyCustomerFieldDraft,paidJourneyCustomerFieldDraftState,savePaidJourneyDraft,loadPaidJourneyDraft,
  paidJourneyDraftState(tenantId:string):PaidJourneyDraftState{if(!uuid(tenantId))return fail('Invalid business selection.');const key=tenantId.toLowerCase(),attempt=journeyAttempts.get(key),entry=journeyDrafts.get(key);if(attempt){if(attempt.actor!==userId?.toLowerCase())return {phase:'ready'};return {phase:entry?.state.phase==='saving'?'saving':'unverified',flowId:attempt.flowId};}if(!entry||entry.actor!==userId?.toLowerCase())return {phase:'ready'};return immutableDetailing(JSON.parse(JSON.stringify(entry.state))) as PaidJourneyDraftState;},
  createBusiness,businessProfile,initializeBusinessProfile,businessProfileInitializationState,
  businessProfileInitializationLocked:profileInitializationLocked,
  ownerDetailingScheduling,
  detailingSchedulingState(tenantId:string,serviceId:string):DetailingSchedulingState {const state=detailingScheduling.get(tenantId.toLowerCase()+':'+serviceId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as DetailingSchedulingState:{phase:'ready'};},
  readBookingFormAnswers,
  readConfirmationReceiptStatus,
  readConfirmationReceiptHistory,
  readNotificationPlannerConfig,saveNotificationPlannerConfig,
  ownerBusinessContext,simpleOfferContext,createSimpleOffer,createOfferScheduling,detailingOfferContext,createDetailingOffer,readDetailingOffer,
  detailingOfferState(tenantId:string):DetailingOfferState {if(!uuid(tenantId))return fail('Invalid business selection.');const state=detailingOffers.get(tenantId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as DetailingOfferState:{phase:'ready'};},
  offerSchedulingState(tenantId:string,serviceId:string):OfferSchedulingState {const state=scheduling.get(tenantId.toLowerCase()+':'+serviceId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as OfferSchedulingState:{phase:'ready'};},
  simpleOfferState(tenantId:string):SimpleOfferState {const state=offers.get(tenantId.toLowerCase());return state?JSON.parse(JSON.stringify(state)) as SimpleOfferState:{phase:'ready'};},
  simpleOfferLocked:()=>conditionalRollbackAttempts.size>0||offerLocked()||conditionalPublicationAttempts.size>0||uncertainConditionalDrafts.size>0,
  simpleOfferRecoveryTenant():string|undefined {return [...uncertainDetailingScheduling.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...uncertainDetailing.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...conditionalRollbackAttempts.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...uncertainConditionalDrafts.entries()].find(([,entry])=>entry.actor===userId?.toLowerCase())?.[0]??[...conditionalPublicationAttempts.values()].find(entry=>entry.actor===userId?.toLowerCase())?.tenantId??[...profileInitializations.entries()].find(([,entry])=>entry.actor===userId&&entry.state.phase==='unknown')?.[0]??[...offers.entries()].find(([,state])=>state.phase==='unknown')?.[0]??[...scheduling.entries()].find(([,state])=>state.phase==='unknown')?.[0].split(':')[0];},
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



export * from './detailing-customer';
