import {PaidJourneyHoldInput,PaidJourneyHoldReceipt,type PaidJourneyHoldWriter} from './paid-journey-hold';
import {PaidJourneyAvailabilityQuery,PaidJourneyAvailabilityReceipt,type PaidJourneyAvailabilityReader} from './paid-journey-availability';
import {paidJourneySessionExpiryValid} from './paid-journey-session';
import {PublishPaidJourneyDraft} from './paid-journey-publication';
import {SavePaidJourneyDraft} from './paid-journey-draft';
import {OwnerBookingFormAnswers,type BookingFormAnswersReader} from './booking-form-answers';
import {NotificationPlannerReceipt,SaveNotificationPlannerConfig,type NotificationPlannerConfigApi} from './notification-planner-config';
import {ConfirmationReceiptStatus,type ConfirmationReceiptStatusReader} from './confirmation-receipt-status';
import {ConfirmationReceiptHistory,type ConfirmationReceiptHistoryReader} from './confirmation-receipt-history';
import {DetailingPaymentReceipt,DetailingPaymentReadiness,type DetailingPaymentApi} from './detailing-payment';
import {DetailingReservationInput,DetailingRequestReceipt,DetailingHoldReceipt} from '@lumin/contracts';
import type {DetailingReservationApi} from './detailing-reservation';
import {DetailingAvailabilityQuery,DetailingAvailabilityReceipt} from '@lumin/contracts';
import type {DetailingAvailabilityReader} from './detailing-availability';
import {SaveDetailingDraft,DetailingDraft,PublishDetailingDraft,DetailingPublicationReceipt,DetailingQuoteInput} from '@lumin/contracts';
import {DetailingSessionResult,DetailingQuoteReceipt,type DetailingPublicationApi} from './detailing-publication';
import {CreateDetailingOffer,DetailingOfferReceipt,buildDetailingService} from '@lumin/contracts';
import {isDeepStrictEqual} from 'node:util';
import type {DetailingOfferCreator,DetailingOfferReader} from './detailing-catalog';
import {ConditionalCustomerFieldVersionHistory,type ConditionalCustomerFieldVersionHistoryReader} from './conditional-customer-field-version-history';
import {ConditionalCustomerFieldRollbackInput,ConditionalCustomerFieldRollbackReceipt,type ConditionalCustomerFieldRollback} from './conditional-customer-field-rollback';
import {ConditionalCustomerFieldRollbackReadReceipt,type ConditionalCustomerFieldRollbackReceiptReader} from './conditional-customer-field-rollback-receipt';
import {ConditionalCustomerFieldInstallHealth,type ConditionalCustomerFieldInstallHealthReader} from './conditional-customer-field-install-health';
import {ConditionalCustomerFieldPublicationReceipt,type ConditionalCustomerFieldPublicationReader} from './conditional-customer-field-publication-reader';
import type {BusinessProfileInitializer} from './existing-business-profile';
import {InitializeBusinessProfile} from '@lumin/contracts';
import {attachRequestId} from './request-id';
import {readReleaseMetadata,serveReleaseMetadata,type ReleaseEnvironment} from './release-metadata';
import {CustomerFieldRollbackReadReceipt,type CustomerFieldRollbackReceiptReader} from './customer-field-rollback-receipt';
import {CustomerFieldRollbackInput,CustomerFieldRollbackReceipt,type CustomerFieldRollback} from './customer-field-rollback';
import {CustomerFieldVersionHistory,type CustomerFieldVersionHistoryReader} from './customer-field-version-history';
import {CustomerFieldInstallHealth} from '@lumin/contracts';
import type {CustomerFieldInstallHealthReader} from './customer-field-install-health';
import {PaidInstallHealth} from '@lumin/contracts';
import {CustomerFieldPublicationReceipt,type CustomerFieldPublicationReader} from './customer-field-publication-reader';
import type {PaidInstallHealthReader} from './paid-install-health';
import {CreateOfferScheduling,OfferSchedulingReceipt,schedulingReceiptMatches} from '@lumin/contracts';
import type {OfferSchedulingCreator} from './owner-scheduling';
import {CreateDetailingScheduling,DetailingSchedulingReceipt,detailingSchedulingReceiptMatches} from '@lumin/contracts';
import type {DetailingSchedulingCreator} from './detailing-scheduling';
import {CreateSimpleOffer,SimpleOfferReceipt} from '@lumin/contracts';
import type {SimpleOfferCreator} from './owner-catalog';
import {BusinessProfile,CreateBusiness} from '@lumin/contracts';
import type {BusinessCreator,BusinessProfileReader} from './business';
import {PaidRollbackInput,PaidRollbackReceipt,type PaidPublicationRollback} from './paid-publication-rollback';
import {PaidVersionHistory,type PaidVersionHistoryReader} from './paid-version-history-reader';
import {type PaidDraftListReader} from './paid-draft-list-reader';
import {PaidPublicationList,PaidPublicationReceipt,type PaidPublicationReader,type PaidPublicationListReader} from './paid-publication-reader';
import {type CustomerConfirmation,type CustomerMockPayment} from './customer-payment';
import {MockPaymentInput,MockPaymentReceipt,type MockPaymentWriter} from './mock-payment';
import {RentalMockPaymentInput,RentalMockPaymentReceipt,type RentalMockPaymentWriter} from './rental-mock-payment';
import {DraftInput,DraftReceipt,type DraftWriter} from './draft';
import { ConfirmationInput,ConfirmationReceipt,type BookingConfirmation } from './confirmation';
import { HoldInput,HoldReceipt,type ReservationWriter } from './reservation';
import type {CustomerHoldWriter} from './customer-hold';
import type {CustomerAvailabilityReader} from './customer-availability';
import { handleRosterRoute } from "./roster-http";
import { createServer,type IncomingMessage,type ServerResponse } from "node:http";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import { z } from "zod";
import { normalizeConfigurablePublication } from "@lumin/workflow";
import { ConditionalCustomerFieldRequestInput,SavePaidConditionalCustomerFieldDraft,CustomerFieldRequestInput,PublishPaidOption,PaidSimpleDraftList,Uuid,PublishPaidSimpleDraft,SavePaidCustomerFieldDraft,SavePaidSimpleDraft,PublishPaidSimple,SaveConfigurableDraft,postgresV2Strings,SaveDraft,PublishDraft,RequestInput,RpcResults,type FlowRpc } from "./contracts";
import { FlowError,type FlowCode,type FlowRepository,type TenantProfileReader,type AvailabilityReader } from "./repository";
const statuses:Record<FlowCode,number>={ROSTER_NOT_INITIALIZED:409,ROSTER_TOO_LARGE:422,ROSTER_UNSUPPORTED_TIME:422,INVALID_REQUEST:400,UNAUTHENTICATED:401,FORBIDDEN:403,CONFLICT:409,NOT_AVAILABLE:404,UNSUPPORTED_CONFIG:422,INTERNAL_ERROR:500,RATE_LIMITED:429};
export interface FlowHttpOptions{
 notificationAuthoring?:boolean;
 notificationPlannerConfig?:NotificationPlannerConfigApi;
 bookingFormAnswers?:BookingFormAnswersReader;
 confirmationReceiptStatus?:ConfirmationReceiptStatusReader;
 confirmationReceiptHistory?:ConfirmationReceiptHistoryReader;
 detailingOfferCreate?:DetailingOfferCreator;
 detailingOfferRead?:DetailingOfferReader;
 releaseEnvironment?:ReleaseEnvironment;
 repository:FlowRepository;
 detailingPublication?:boolean;
 detailingPaymentApi?:DetailingPaymentApi;
 detailingReservationApi?:DetailingReservationApi;
 detailingAvailability?:DetailingAvailabilityReader;
 detailingPublicationApi?:DetailingPublicationApi;
 schedulingAuthoring?:boolean;
 offerSchedulingCreate?:OfferSchedulingCreator;
 detailingSchedulingCreate?:DetailingSchedulingCreator;
 catalogAuthoring?:boolean;
 simpleOfferCreate?:SimpleOfferCreator;
 businessOnboarding?:boolean;
 businessProfileInitialize?:BusinessProfileInitializer;
 businessCreate?:BusinessCreator;
 businessProfile?:BusinessProfileReader;
 tenantProfile?:TenantProfileReader;
 availability?:AvailabilityReader;
 customerAvailability?:CustomerAvailabilityReader;
 customerHold?:CustomerHoldWriter;
 customerConfirmation?:CustomerConfirmation;
 customerMockPayment?:CustomerMockPayment;
 /** Explicit staging test-publication gate; owner identity remains required. */
 paidSimplePublication?:boolean;
 /** Versioned journey authoring only; off until a coherent release enables it. */
 paidJourneyDrafts?:boolean;
 /** Separate V8 publication/read capability. No customer session issuance. */
 paidJourneyPublication?:boolean;
 /** Dedicated V8 sessions only; no booking or financial capabilities. */
 paidJourneySessions?:boolean;
 paidJourneyAvailability?:PaidJourneyAvailabilityReader;
 paidJourneyHold?:PaidJourneyHoldWriter;
 paidPublication?:PaidPublicationReader;
 paidCustomerFieldPublication?:CustomerFieldPublicationReader;
 paidConditionalCustomerFieldPublication?:ConditionalCustomerFieldPublicationReader;
 paidPublications?:PaidPublicationListReader;
 paidDrafts?:PaidDraftListReader;
 paidVersionHistory?:PaidVersionHistoryReader;
 paidCustomerFieldVersionHistory?:CustomerFieldVersionHistoryReader;
 paidConditionalCustomerFieldVersionHistory?:ConditionalCustomerFieldVersionHistoryReader;
 paidInstallHealth?:PaidInstallHealthReader;
 customerFieldInstallHealth?:CustomerFieldInstallHealthReader;
 conditionalCustomerFieldInstallHealth?:ConditionalCustomerFieldInstallHealthReader;
 paidRollback?:PaidPublicationRollback;
 paidCustomerFieldRollback?:CustomerFieldRollback;
 paidConditionalCustomerFieldRollback?:ConditionalCustomerFieldRollback;
 paidCustomerFieldRollbackReceipt?:CustomerFieldRollbackReceiptReader;
 paidConditionalCustomerFieldRollbackReceipt?:ConditionalCustomerFieldRollbackReceiptReader;
 reservation?:ReservationWriter;
 confirmation?:BookingConfirmation;
 draft?:DraftWriter;
 mockPayment?:MockPaymentWriter;
 rentalMockPayment?:RentalMockPaymentWriter;
 /** Fresh verified user identity only. SQL rechecks current tenant membership. */
 authenticateOwner?:(credential:string)=>Promise<string|null>;
 ownerOrigins:readonly string[];
 customerOrigins:readonly string[];
 now?:()=>number;
 /** When true, accept connections from non-loopback peers (a trusted platform
  *  proxy terminating TLS in front of the service, e.g. Render). Defaults to
  *  false so the local harness and integration tests stay loopback-only.
  *  The production entrypoint (src/main.ts) is the only caller that sets it. */
 trustProxy?:boolean;
}
function bearer(req:IncomingMessage){const h=req.headers.authorization;if(typeof h!=="string"||!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(h))throw new FlowError("UNAUTHENTICATED");return h.slice(7);}
export const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");
function send(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});res.end(JSON.stringify(value));}
function jsonBody(req:IncomingMessage):Promise<unknown>{
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers["content-type"]??""))throw new FlowError("INVALID_REQUEST");
 return new Promise((resolve,reject)=>{let bytes=0;const chunks:Buffer[]=[];let failed=false;
  req.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32768){if(!failed){failed=true;reject(new FlowError("INVALID_REQUEST"));}return;}if(!failed)chunks.push(chunk);});
  req.on("end",()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{reject(new FlowError("INVALID_REQUEST"));}});
  req.on("error",()=>reject(new FlowError("INVALID_REQUEST")));req.on("aborted",()=>reject(new FlowError("INVALID_REQUEST")));
 });
}
function originHeader(req:IncomingMessage,allowed:readonly string[]){const value=req.headers.origin;if(typeof value!=="string"||!allowed.includes(value))throw new FlowError("FORBIDDEN");return value;}
/** Local harness HTTP only. Production needs a separately reviewed TLS/auth composition. */
export function createFlowHttpServer(options:FlowHttpOptions){
 const releaseMetadata=readReleaseMetadata(options.releaseEnvironment??{});
 const ownerOrigins=[...options.ownerOrigins],customerOrigins=[...options.customerOrigins];
 const trustProxy=options.trustProxy===true;
 const now=options.now??Date.now;const limits=new Map<string,{start:number;count:number}>();
 const server=createServer({maxHeaderSize:16384},async(req,res)=>{
  attachRequestId(req,res);
  try{
   const address=req.socket.remoteAddress??"";if(!trustProxy&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(address))throw new FlowError("FORBIDDEN");
   const instant=now();let rate=limits.get(address);if(!rate||instant-rate.start>=60000){rate={start:instant,count:0};limits.set(address,rate);}if(++rate.count>120)throw new FlowError("RATE_LIMITED");
   const url=new URL(req.url??"/","http://127.0.0.1");
   if(serveReleaseMetadata(req,res,url.pathname,releaseMetadata))return;
   if(url.pathname==="/health"&&req.method==="GET"){send(res,200,{ok:true,data:{mode:"LOCAL_HARNESS",providerConnections:false}});return;}
   const customer=url.pathname.startsWith('/api/paid-journey-flow-sessions/')||url.pathname.startsWith('/api/paid-journey-installations/')||url.pathname.startsWith("/api/detailing-installations/")||url.pathname.startsWith("/api/detailing-flow-sessions/")||url.pathname.startsWith("/api/installations/")||url.pathname.startsWith("/api/flow-sessions/");
   const origin=originHeader(req,customer?customerOrigins:ownerOrigins);
   res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");
   if(req.method==="OPTIONS"){
    if(!["GET","POST"].includes(req.headers["access-control-request-method"]??""))throw new FlowError("FORBIDDEN");
    const requested=(req.headers["access-control-request-headers"]??"").toLowerCase().split(",").map(x=>x.trim()).filter(Boolean);
    if(requested.some(x=>!["content-type","authorization"].includes(x)))throw new FlowError("FORBIDDEN");
    res.writeHead(204,{"Access-Control-Allow-Methods":"GET, POST","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"60"});res.end();return;
   }
   const owner=async()=>{if(!options.authenticateOwner)throw new FlowError("UNAUTHENTICATED");let id:unknown;try{id=await options.authenticateOwner(bearer(req));}catch{throw new FlowError("UNAUTHENTICATED");}if(!Uuid.safeParse(id).success)throw new FlowError("UNAUTHENTICATED");return id as string;};
   const call=async(name:FlowRpc,params:readonly unknown[])=>{const value=await options.repository.call(name,params);try{return RpcResults[name].parse(value);}catch{throw new FlowError("INTERNAL_ERROR");}};
   if(customer){
    if(url.pathname==='/api/paid-journey-flow-sessions/hold'){
     if(!options.paidJourneySessions||!options.paidJourneyHold)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='POST'||[...url.searchParams].length)throw new FlowError('INVALID_REQUEST');
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     const input=PaidJourneyHoldInput.parse(await jsonBody(req));
     const output=PaidJourneyHoldReceipt.safeParse(await options.paidJourneyHold(tokenHash(token),origin,input));
     if(!output.success||output.data.slot.start!==input.requestedStart||Date.parse(output.data.expiresAt)<=now()||Date.parse(output.data.expiresAt)>now()+5*60000+1000)throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data:output.data});return;
    }
    if(url.pathname==='/api/paid-journey-flow-sessions/availability'){
     if(!options.paidJourneySessions||!options.paidJourneyAvailability)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='GET'||[...url.searchParams.keys()].some(k=>k!=='from'&&k!=='to')||url.searchParams.getAll('from').length!==1||url.searchParams.getAll('to').length!==1||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
     const query=PaidJourneyAvailabilityQuery.parse({from:url.searchParams.get('from'),to:url.searchParams.get('to')});
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     const result=PaidJourneyAvailabilityReceipt.safeParse(await options.paidJourneyAvailability(tokenHash(token),origin,query));
     if(!result.success||result.data.slots.some(s=>Date.parse(s.start)<Date.parse(query.from)||Date.parse(s.end)>Date.parse(query.to)))throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data:result.data});return;
    }
    const journeySession=url.pathname.match(/^\/api\/paid-journey-installations\/([^/]+)\/sessions$/);
    if(journeySession){
     if(!options.paidJourneySessions)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='POST')throw new FlowError('NOT_AVAILABLE');
     if([...url.searchParams].length)throw new FlowError('INVALID_REQUEST');
     z.object({}).strict().parse(await jsonBody(req));const installation=Uuid.parse(journeySession[1]).toLowerCase(),sessionToken=randomBytes(32).toString('base64url');
     const data=RpcResults.issue_paid_journey_session.parse(await call('issue_paid_journey_session',[installation,tokenHash(sessionToken),origin]));
     if(data.installationId!==installation||!paidJourneySessionExpiryValid(data,now()))throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data:{schemaVersion:1,expiresAt:data.expiresAt,render:data.render,sessionToken}});return;
    }
    const journeyRender=url.pathname.match(/^\/api\/paid-journey-installations\/([^/]+)\/render$/);
    if(journeyRender){
     if(!options.paidJourneyPublication)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='GET')throw new FlowError('NOT_AVAILABLE');
     if([...url.searchParams].length||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
     const installation=Uuid.parse(journeyRender[1]).toLowerCase();
     const data=await call('get_paid_journey_render',[installation,origin]);
     send(res,200,{ok:true,data});return;
    }
    if(url.pathname==='/api/detailing-flow-sessions/availability'){
     if(!options.detailingPublication||!options.detailingAvailability)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='GET'||[...url.searchParams.keys()].some(k=>k!=='from'&&k!=='to')||url.searchParams.getAll('from').length!==1||url.searchParams.getAll('to').length!==1)throw new FlowError('INVALID_REQUEST');
     const query=DetailingAvailabilityQuery.parse({from:url.searchParams.get('from'),to:url.searchParams.get('to')});
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     const data=DetailingAvailabilityReceipt.safeParse(await options.detailingAvailability(tokenHash(token),origin,query));
     if(!data.success||data.data.slots.some(s=>Date.parse(s.start)<Date.parse(query.from)||Date.parse(s.end)>Date.parse(query.to)))throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data:data.data});return;
    }
    if(url.pathname==='/api/detailing-flow-sessions/payment-readiness'){
     if(!options.detailingPublication||!options.detailingPaymentApi)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='GET'||url.search||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     const data=DetailingPaymentReadiness.safeParse(await options.detailingPaymentApi.readiness(tokenHash(token),origin));if(!data.success)throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data:data.data});return;
    }
    if(req.method==='POST'&&['/api/detailing-flow-sessions/mock-payment','/api/detailing-flow-sessions/confirm'].includes(url.pathname)){
     if(!options.detailingPublication||!options.detailingPaymentApi)throw new FlowError('UNSUPPORTED_CONFIG');
     if(url.search)throw new FlowError('INVALID_REQUEST');
     const origin=req.headers.origin;if(typeof origin!=='string'||!options.customerOrigins.includes(origin))throw new FlowError('FORBIDDEN');
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     z.object({}).strict().parse(await jsonBody(req));
     const value=await (url.pathname.endsWith('/mock-payment')?options.detailingPaymentApi.mockPayment:options.detailingPaymentApi.confirm)(tokenHash(token),origin),data=DetailingPaymentReceipt.safeParse(value);if(!data.success)throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data:data.data});return;
    }
    if(url.pathname==='/api/detailing-flow-sessions/request'||url.pathname==='/api/detailing-flow-sessions/hold'){
     if(!options.detailingPublication||!options.detailingReservationApi)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='POST'||[...url.searchParams].length)throw new FlowError('INVALID_REQUEST');
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');
     if(url.pathname.endsWith('/request')){const body=DetailingReservationInput.parse(await jsonBody(req));const data=DetailingRequestReceipt.safeParse(await options.detailingReservationApi.request(tokenHash(token),origin,body));if(!data.success||data.data.slot.start!==body.requestedStart||data.data.selection.packageId!==body.selection.packageId||data.data.selection.vehicleId!==body.selection.vehicleId||data.data.selection.locationId!==body.selection.locationId||data.data.selection.addonIds.length!==body.selection.addonIds.length||data.data.selection.addonIds.some(id=>!body.selection.addonIds.includes(id)))throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data:data.data});return;}
     z.object({}).strict().parse(await jsonBody(req));const data=DetailingHoldReceipt.safeParse(await options.detailingReservationApi.hold(tokenHash(token),origin));if(!data.success)throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data:data.data});return;
    }
    if(url.pathname.startsWith('/api/detailing-')){
     if(!options.detailingPublication||!options.detailingPublicationApi)throw new FlowError('UNSUPPORTED_CONFIG');
     if(req.method!=='POST'||[...url.searchParams].length)throw new FlowError('INVALID_REQUEST');
     const installation=url.pathname.match(/^\/api\/detailing-installations\/([^/]+)\/sessions$/);
     if(installation){const id=Uuid.parse(installation[1]).toLowerCase();z.object({}).strict().parse(await jsonBody(req));const sessionToken=randomBytes(32).toString('base64url'),data=DetailingSessionResult.parse(await options.detailingPublicationApi.session(id,tokenHash(sessionToken),origin));send(res,200,{ok:true,data:{...data,sessionToken}});return;}
     if(url.pathname==='/api/detailing-flow-sessions/quote'){const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('UNAUTHENTICATED');const body=DetailingQuoteInput.parse(await jsonBody(req)),data=DetailingQuoteReceipt.parse(await options.detailingPublicationApi.quote(tokenHash(token),origin,body));if(data.selection.packageId!==body.packageId||data.selection.vehicleId!==body.vehicleId||data.selection.locationId!==body.locationId||data.selection.addonIds.length!==body.addonIds.length||data.selection.addonIds.some(id=>!body.addonIds.includes(id)))throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data});return;}
     throw new FlowError('NOT_AVAILABLE');
    }
    if(url.pathname==="/api/flow-sessions/availability"){
     if(req.method!=="GET"||!options.customerAvailability)throw new FlowError("NOT_AVAILABLE");
     if([...url.searchParams.keys()].some(k=>k!=="from"&&k!=="to")||url.searchParams.getAll("from").length!==1||url.searchParams.getAll("to").length!==1)throw new FlowError("INVALID_REQUEST");
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError("UNAUTHENTICATED");
     const from=z.string().datetime({offset:true}).parse(url.searchParams.get("from"));
     const to=z.string().datetime({offset:true}).parse(url.searchParams.get("to"));
     const range=Date.parse(to)-Date.parse(from);if(!Number.isFinite(range)||range<=0||range>7*86400000)throw new FlowError("INVALID_REQUEST");
     const data=await options.customerAvailability(tokenHash(token),origin,new Date(from).toISOString(),new Date(to).toISOString());
     if(!data)throw new FlowError("NOT_AVAILABLE");
     send(res,200,{ok:true,data:{schemaVersion:1,...data}});return;
    }
    if([...url.searchParams].length||req.method!=="POST")throw new FlowError("INVALID_REQUEST");
    const match=url.pathname.match(/^\/api\/installations\/([^/]+)\/sessions$/);
    if(match){const id=Uuid.parse(match[1]);z.object({}).strict().parse(await jsonBody(req));
     const sessionToken=randomBytes(32).toString("base64url");const data=RpcResults.issue_flow_session.parse(await call("issue_flow_session",[id,tokenHash(sessionToken),origin]));send(res,200,{ok:true,data:{...data,sessionToken}});return;
    }
    if(url.pathname==="/api/flow-sessions/confirm"||url.pathname==="/api/flow-sessions/mock-payment"){
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError("UNAUTHENTICATED");
     z.object({}).strict().parse(await jsonBody(req));
     const mock=url.pathname.endsWith('/mock-payment');
     const writer=mock?options.customerMockPayment:options.customerConfirmation;
     if(!writer)throw new FlowError("UNSUPPORTED_CONFIG");
     const raw=await writer(tokenHash(token),origin);
     const data=mock?MockPaymentReceipt.parse(raw):ConfirmationReceipt.parse(raw);
     send(res,200,{ok:true,data:{schemaVersion:1,...data}});return;
    }
    if(url.pathname==="/api/flow-sessions/hold"){
     if(!options.customerHold)throw new FlowError("NOT_AVAILABLE");
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError("UNAUTHENTICATED");
     z.object({}).strict().parse(await jsonBody(req));
     const data=HoldReceipt.parse(await options.customerHold(tokenHash(token),origin));
     send(res,200,{ok:true,data:{schemaVersion:1,...data}});return;
    }
    if(url.pathname==="/api/flow-sessions/request"){
     const token=bearer(req);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError("UNAUTHENTICATED");
     const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
     if(raw&&typeof raw==='object'&&Object.hasOwn(raw,'schemaVersion')){
      if((raw as {schemaVersion?:unknown}).schemaVersion===3){const body=ConditionalCustomerFieldRequestInput.parse(raw);const data=await call('submit_conditional_customer_field_request',[tokenHash(token),origin,body.idempotencyKey,body.customerAnswers,body.customer,body.requestedStart]);send(res,200,{ok:true,data});return;}
      const body=CustomerFieldRequestInput.parse(raw);const data=await call("submit_customer_field_request",[tokenHash(token),origin,body.idempotencyKey,body.customerAnswers,body.customer,body.requestedStart]);send(res,200,{ok:true,data});return;
     }
     const body=RequestInput.parse(raw);const data=await call("submit_flow_request",[tokenHash(token),origin,body.idempotencyKey,body.answers,body.customer,body.requestedStart]);send(res,200,{ok:true,data});return;
    }throw new FlowError("NOT_AVAILABLE");
   }
   const actor=await owner();
   if(url.pathname==="/api/businesses"){
    if(!options.businessOnboarding||!options.businessCreate)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    if([...url.searchParams].length)throw new FlowError("INVALID_REQUEST");
    const body=CreateBusiness.parse(await jsonBody(req)),result=BusinessProfile.safeParse(await options.businessCreate(actor,body));
    if(!result.success||result.data.businessType!==body.businessType)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   const allowed=url.pathname==="/api/availability"?["tenantId","serviceId","from","to"]:['/api/confirmation-receipts','/api/confirmation-receipt-history','/api/booking-form-answers'].includes(url.pathname)?['tenantId','bookingId']:["tenantId"];
   if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||url.searchParams.getAll("tenantId").length!==1)throw new FlowError("INVALID_REQUEST");
   const tenant=Uuid.parse(url.searchParams.get("tenantId"));
   const journeyOwnerPublication=url.pathname.match(/^\/api\/paid-journey-flows\/([^/]+)\/publication$/);
   if(journeyOwnerPublication){
    if(!options.paidJourneyPublication)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET')throw new FlowError('NOT_AVAILABLE');
    if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
    const flow=Uuid.parse(journeyOwnerPublication[1]).toLowerCase(),data=RpcResults.get_paid_journey_owner_publication.parse(await call('get_paid_journey_owner_publication',[actor,tenant.toLowerCase(),flow]));
    if(data.tenantId!==tenant.toLowerCase()||data.flowId!==flow||data.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data});return;
   }

   if(url.pathname==='/api/booking-form-answers'){
    if(!options.bookingFormAnswers)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET'||url.searchParams.getAll('bookingId').length!==1||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
    const tenantId=tenant.toLowerCase(),bookingId=Uuid.parse(url.searchParams.get('bookingId')).toLowerCase();
    const result=OwnerBookingFormAnswers.safeParse(await options.bookingFormAnswers(actor,tenantId,bookingId));
    if(!result.success||result.data.tenantId!==tenantId||result.data.bookingId!==bookingId)throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==='/api/confirmation-receipt-history'){
    if(!options.notificationAuthoring||!options.confirmationReceiptHistory)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET'||url.searchParams.getAll('bookingId').length!==1||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
    const tenantId=tenant.toLowerCase(),bookingId=Uuid.parse(url.searchParams.get('bookingId')).toLowerCase();
    const result=ConfirmationReceiptHistory.safeParse(await options.confirmationReceiptHistory(actor,tenantId,bookingId));
    if(!result.success||result.data.tenantId!==tenantId||result.data.bookingId!==bookingId)throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==='/api/confirmation-receipts'){
    if(!options.notificationAuthoring||!options.confirmationReceiptStatus)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET'||url.searchParams.getAll('bookingId').length!==1||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
    const tenantId=tenant.toLowerCase(),bookingId=Uuid.parse(url.searchParams.get('bookingId')).toLowerCase();
    const result=ConfirmationReceiptStatus.safeParse(await options.confirmationReceiptStatus(actor,tenantId,bookingId));
    if(!result.success||result.data.tenantId!==tenantId||result.data.bookingId!==bookingId)throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==='/api/notification-planner-config'){
    if(!options.notificationAuthoring||!options.notificationPlannerConfig)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET'&&req.method!=='POST')throw new FlowError('INVALID_REQUEST');
    const tenantId=tenant.toLowerCase();
    if(req.method==='GET'){
     if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
     const value=await options.notificationPlannerConfig.read(actor,tenantId);
     if(value===null){send(res,200,{ok:true,data:null});return;}
     const result=NotificationPlannerReceipt.safeParse(value);
     if(!result.success||result.data.tenantId!==tenantId)throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data:result.data});return;
    }
    const body=SaveNotificationPlannerConfig.parse(await jsonBody(req));
    if(body.config.tenantId!==tenantId)throw new FlowError('INVALID_REQUEST');
    const result=NotificationPlannerReceipt.safeParse(await options.notificationPlannerConfig.save(actor,tenantId,body));
    if(!result.success||result.data.tenantId!==tenantId||result.data.revision!==body.expectedRevision+1||!isDeepStrictEqual(result.data.config,body.config))throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==="/api/bookings/mock-payment"){
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=MockPaymentInput.parse(await jsonBody(req));
    if(!options.mockPayment)throw new FlowError("UNSUPPORTED_CONFIG");
    const receipt=MockPaymentReceipt.safeParse(await options.mockPayment(actor,tenant,body.bookingId));
    if(!receipt.success||receipt.data.bookingId!==body.bookingId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{schemaVersion:1,...receipt.data}});return;
   }
   if(url.pathname==="/api/bookings/rental-mock-payment"){
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=RentalMockPaymentInput.parse(await jsonBody(req));
    if(!options.rentalMockPayment)throw new FlowError("UNSUPPORTED_CONFIG");
    const receipt=RentalMockPaymentReceipt.safeParse(await options.rentalMockPayment(actor,tenant,body.bookingId));
    if(!receipt.success||receipt.data.bookingId!==body.bookingId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{schemaVersion:1,...receipt.data}});return;
   }
   if(url.pathname==="/api/bookings/draft"){
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=DraftInput.parse(await jsonBody(req));
    if(!options.draft)throw new FlowError("UNSUPPORTED_CONFIG");
    const receipt=DraftReceipt.safeParse(await options.draft(actor,tenant,body));
    if(!receipt.success)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{schemaVersion:1,...receipt.data}});return;
   }
   if(url.pathname==="/api/bookings/confirm"){
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=ConfirmationInput.parse(await jsonBody(req));
    if(!options.confirmation)throw new FlowError("UNSUPPORTED_CONFIG");
    const result=ConfirmationReceipt.safeParse(await options.confirmation(actor,tenant,body.bookingId));
    if(!result.success||result.data.bookingId!==body.bookingId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{schemaVersion:1,...result.data}});return;
   }
   if(url.pathname==="/api/reservations/hold"){
    if(req.method!=="POST"||!options.reservation)throw new FlowError("NOT_AVAILABLE");
    const body=HoldInput.parse(await jsonBody(req));
    const data=HoldReceipt.parse(await options.reservation(actor,tenant,body.bookingId));
    if(data.bookingId!==body.bookingId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{schemaVersion:1,...data}});return;
   }
   const detailingFlow=url.pathname.match(/^\/api\/detailing-flows\/([^/]+)\/(draft|publish-draft|publication)$/);
   if(detailingFlow){
    if(!options.detailingPublication||!options.detailingPublicationApi)throw new FlowError('UNSUPPORTED_CONFIG');
    const flow=Uuid.parse(detailingFlow[1]).toLowerCase(),kind=detailingFlow[2],api=options.detailingPublicationApi;
    if(kind==='draft'){if(req.method==='GET'){const data=DetailingDraft.parse(await api.read(actor,tenant,flow));if(data.flowId!==flow)throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data});return;}if(req.method!=='POST')throw new FlowError('NOT_AVAILABLE');const body=SaveDetailingDraft.parse(await jsonBody(req)),data=DetailingDraft.parse(await api.save(actor,tenant,flow,body));if(data.flowId!==flow||data.revision!==body.expectedRevision+1||data.serviceId!==body.serviceId||data.name!==body.name||!isDeepStrictEqual(data.presentation,body.presentation))throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data});return;}
    let data;if(kind==='publication'){if(req.method!=='GET')throw new FlowError('NOT_AVAILABLE');data=DetailingPublicationReceipt.parse(await api.recover(actor,tenant,flow));}else{if(req.method!=='POST')throw new FlowError('NOT_AVAILABLE');const body=PublishDetailingDraft.parse(await jsonBody(req));if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError('FORBIDDEN');data=DetailingPublicationReceipt.parse(await api.publish(actor,tenant,flow,body));if(data.draftRevision!==body.expectedDraftRevision)throw new FlowError('INTERNAL_ERROR');}if(data.flowId!==flow)throw new FlowError('INTERNAL_ERROR');send(res,200,{ok:true,data});return;
   }
   const detailingSchedule=url.pathname.match(/^\/api\/catalog\/detailing-offers\/([^/]+)\/scheduling$/);
   if(detailingSchedule){
    if(!options.schedulingAuthoring||!options.detailingSchedulingCreate)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const service=Uuid.parse(detailingSchedule[1]).toLowerCase(),body=CreateDetailingScheduling.parse(await jsonBody(req)),result=DetailingSchedulingReceipt.safeParse(await options.detailingSchedulingCreate(actor,tenant,service,body));
    if(!result.success||result.data.tenantId!==tenant.toLowerCase()||result.data.serviceId!==service||!detailingSchedulingReceiptMatches(result.data,body))throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   const scheduling=url.pathname.match(/^\/api\/catalog\/simple-offers\/([^/]+)\/scheduling$/);
   if(scheduling){
    if(!options.schedulingAuthoring||!options.offerSchedulingCreate)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const service=Uuid.parse(scheduling[1]).toLowerCase(),body=CreateOfferScheduling.parse(await jsonBody(req)),result=OfferSchedulingReceipt.safeParse(await options.offerSchedulingCreate(actor,tenant,service,body));
    if(!result.success||result.data.tenantId!==tenant.toLowerCase()||result.data.serviceId!==service||!schedulingReceiptMatches(result.data,body))throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   const detailing=url.pathname.match(/^\/api\/catalog\/detailing-offers(?:\/([^/]+))?$/);
   if(detailing){
    if(!options.catalogAuthoring)throw new FlowError("UNSUPPORTED_CONFIG");
    if(detailing[1]){if(req.method!=="GET"||!options.detailingOfferRead)throw new FlowError("NOT_AVAILABLE");const service=Uuid.parse(detailing[1]).toLowerCase(),receipt=DetailingOfferReceipt.safeParse(await options.detailingOfferRead(actor,tenant,service));if(!receipt.success||receipt.data.tenantId!==tenant.toLowerCase()||receipt.data.service.id!==service)throw new FlowError("INTERNAL_ERROR");send(res,200,{ok:true,data:receipt.data});return;}
    if(req.method!=="POST"||!options.detailingOfferCreate)throw new FlowError("NOT_AVAILABLE");const body=CreateDetailingOffer.parse(await jsonBody(req)),receipt=DetailingOfferReceipt.safeParse(await options.detailingOfferCreate(actor,tenant,body));if(!receipt.success||receipt.data.tenantId!==tenant.toLowerCase()||!isDeepStrictEqual(receipt.data.service,buildDetailingService(receipt.data.service.id,tenant.toLowerCase(),body)))throw new FlowError("INTERNAL_ERROR");send(res,200,{ok:true,data:receipt.data});return;
   }
   if(url.pathname==="/api/catalog/simple-offers"){
    if(!options.catalogAuthoring||!options.simpleOfferCreate)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=CreateSimpleOffer.parse(await jsonBody(req)),result=SimpleOfferReceipt.safeParse(await options.simpleOfferCreate(actor,tenant,body));
    if(!result.success||result.data.tenantId!==tenant.toLowerCase()||result.data.service.name!==body.name||result.data.service.description!==body.description||result.data.service.price.amount!==body.price.amount||result.data.service.price.currency!==body.price.currency||result.data.service.durationMinutes!==body.durationMinutes)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==="/api/business-profile/initialize"){
    if(!options.businessOnboarding||!options.businessProfileInitialize)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const body=InitializeBusinessProfile.parse(await jsonBody(req));
    const result=BusinessProfile.safeParse(await options.businessProfileInitialize(actor,tenant,body));
    if(!result.success||result.data.tenantId!==tenant.toLowerCase()||result.data.businessType!==body.businessType)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==="/api/business-profile"){
    if(!options.businessOnboarding||!options.businessProfile)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const result=BusinessProfile.safeParse(await options.businessProfile(actor,tenant));
    if(!result.success||result.data.tenantId!==tenant.toLowerCase())throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   if(url.pathname==="/api/profile"){
    if(req.method!=="GET"||!options.tenantProfile)throw new FlowError("NOT_AVAILABLE");
    const profile=await options.tenantProfile(actor,tenant);
    if(!profile)throw new FlowError("NOT_AVAILABLE");
    send(res,200,{ok:true,data:{schemaVersion:1,profile}});return;
   }
   if(url.pathname==="/api/availability"){
    if(req.method!=="GET"||!options.availability)throw new FlowError("NOT_AVAILABLE");
    const service=Uuid.parse(url.searchParams.get("serviceId"));
    const from=z.string().datetime({offset:true}).parse(url.searchParams.get("from"));
    const to=z.string().datetime({offset:true}).parse(url.searchParams.get("to"));
    if(new Date(from).getTime()>=new Date(to).getTime())throw new FlowError("INVALID_REQUEST");
    const data=await options.availability(actor,tenant,service,new Date(from).toISOString(),new Date(to).toISOString());
    if(!data)throw new FlowError("NOT_AVAILABLE");
    send(res,200,{ok:true,data:{schemaVersion:1,...data}});return;
   }
   if(url.pathname==="/api/roster"||url.pathname.startsWith("/api/roster/")){
    const data=await handleRosterRoute(req,url.pathname,actor,tenant,call,()=>jsonBody(req));send(res,200,{ok:true,data});return;
   }
   if(url.pathname==="/api/paid-simple-drafts"){
    if(!options.paidSimplePublication||!options.paidDrafts)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const result=PaidSimpleDraftList.safeParse(await options.paidDrafts(actor,tenant));
    if(!result.success)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   const journeyPublish=url.pathname.match(/^\/api\/paid-journey-flows\/([^/]+)\/publish-draft$/);
   if(journeyPublish){
    if(!options.paidJourneyPublication)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='POST')throw new FlowError('NOT_AVAILABLE');
    const flow=Uuid.parse(journeyPublish[1]).toLowerCase(),targetTenant=tenant.toLowerCase();
    const body=PublishPaidJourneyDraft.parse(await jsonBody(req));
    if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError('FORBIDDEN');
    const version=randomUUID(),installation=randomUUID();
    const data=RpcResults.publish_paid_journey_draft.parse(await call('publish_paid_journey_draft',[actor,targetTenant,flow,body.expectedDraftRevision,version,installation,body.allowedOrigins,customerOrigins]));
    if(data.tenantId!==targetTenant||data.flowId!==flow||data.draftRevision!==body.expectedDraftRevision||(!data.replayed&&(data.versionId!==version||data.installationId!==installation)))throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data});return;
   }
   const journeyDraft=url.pathname.match(/^\/api\/paid-journey-flows\/([^/]+)\/draft$/);
   if(journeyDraft){
    if(!options.paidJourneyDrafts)throw new FlowError('UNSUPPORTED_CONFIG');
    const flow=Uuid.parse(journeyDraft[1]).toLowerCase(),targetTenant=tenant.toLowerCase();
    if(req.method==='GET'){
     if(req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))throw new FlowError('INVALID_REQUEST');
     const data=RpcResults.get_paid_journey_draft.parse(await call('get_paid_journey_draft',[actor,targetTenant,flow]));
     if(data.flowId!==flow||data.tenantId!==targetTenant)throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data});return;
    }
    if(req.method==='POST'){
     const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError('INVALID_REQUEST');
     const body=SavePaidJourneyDraft.parse(raw),data=RpcResults.save_paid_journey_draft.parse(await call('save_paid_journey_draft',[actor,targetTenant,flow,body.serviceId.toLowerCase(),body.expectedRevision,body.name,body.presentation,body.journey]));
     if(data.flowId!==flow||data.tenantId!==targetTenant||data.revision!==body.expectedRevision+1)throw new FlowError('INTERNAL_ERROR');
     send(res,200,{ok:true,data});return;
    }
    throw new FlowError('NOT_AVAILABLE');
   }
   const paidDraft=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/draft$/);
   if(paidDraft){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    const flow=Uuid.parse(paidDraft[1]);
    if(req.method==="GET"){send(res,200,{ok:true,data:await call("get_paid_simple_draft",[actor,tenant,flow])});return;}
    if(req.method==="POST"){
     const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
     if(raw&&typeof raw==='object'&&'schemaVersion' in raw){
      if((raw as {schemaVersion?:unknown}).schemaVersion===3){const body=SavePaidConditionalCustomerFieldDraft.parse(raw);const data=await call('save_paid_conditional_customer_field_draft',[actor,tenant,flow,body.serviceId,body.expectedRevision,body.name,body.presentation.accentColor,body.presentation.layout,body.customerFields]);send(res,200,{ok:true,data});return;}
      const body=SavePaidCustomerFieldDraft.parse(raw);
      const data=await call("save_paid_customer_field_draft",[actor,tenant,flow,body.serviceId,body.expectedRevision,body.name,body.presentation.accentColor,body.presentation.layout,body.customerFields]);
      send(res,200,{ok:true,data});return;
     }
     const body=SavePaidSimpleDraft.parse(raw);
     const data=await call("save_paid_simple_draft",[actor,tenant,flow,body.serviceId,body.expectedRevision,body.name,body.presentation.accentColor,body.presentation.layout]);
     send(res,200,{ok:true,data});return;
    }throw new FlowError("NOT_AVAILABLE");
   }
   if(url.pathname==="/api/paid-simple-flows"){
    if(!options.paidSimplePublication||!options.paidPublications)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const existing=await options.paidPublications(actor,tenant);
    if(!existing)throw new FlowError("FORBIDDEN");
    const result=PaidPublicationList.safeParse(existing);if(!result.success)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:result.data});return;
   }
   const conditionalFieldRollbackReceipt=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/rollback-receipt$/);
   if(conditionalFieldRollbackReceipt){
    if(!options.paidSimplePublication||!options.paidConditionalCustomerFieldRollbackReceipt)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(conditionalFieldRollbackReceipt[1]);const parsed=ConditionalCustomerFieldRollbackReadReceipt.safeParse(await options.paidConditionalCustomerFieldRollbackReceipt(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const customerFieldRollbackReceipt=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/rollback-receipt$/);
   if(customerFieldRollbackReceipt){
    if(!options.paidSimplePublication||!options.paidCustomerFieldRollbackReceipt)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(customerFieldRollbackReceipt[1]);const parsed=CustomerFieldRollbackReadReceipt.safeParse(await options.paidCustomerFieldRollbackReceipt(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const conditionalFieldRollback=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/rollback$/);
   if(conditionalFieldRollback){
    if(!options.paidSimplePublication||!options.paidConditionalCustomerFieldRollback)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(conditionalFieldRollback[1]).toLowerCase(),body=ConditionalCustomerFieldRollbackInput.parse(await jsonBody(req));
    const parsed=ConditionalCustomerFieldRollbackReceipt.safeParse(await options.paidConditionalCustomerFieldRollback(actor,tenant,flow,body));
    if(!parsed.success||parsed.data.flowId!==flow||parsed.data.versionId!==body.targetVersionId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const customerFieldRollback=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/rollback$/);
   if(customerFieldRollback){
    if(!options.paidSimplePublication||!options.paidCustomerFieldRollback)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(customerFieldRollback[1]).toLowerCase(),body=CustomerFieldRollbackInput.parse(await jsonBody(req));
    const parsed=CustomerFieldRollbackReceipt.safeParse(await options.paidCustomerFieldRollback(actor,tenant,flow,body));
    if(!parsed.success||parsed.data.flowId!==flow||parsed.data.versionId!==body.targetVersionId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const rollback=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/rollback$/);
   if(rollback){
    if(!options.paidSimplePublication||!options.paidRollback)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(rollback[1]).toLowerCase(),body=PaidRollbackInput.parse(await jsonBody(req));
    const parsed=PaidRollbackReceipt.safeParse(await options.paidRollback(actor,tenant,flow,body));
    if(!parsed.success||parsed.data.flowId!==flow||parsed.data.versionId!==body.targetVersionId)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const conditionalFieldHealth=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/health$/);
   if(conditionalFieldHealth){
    if(!options.paidSimplePublication||!options.conditionalCustomerFieldInstallHealth)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(conditionalFieldHealth[1]),parsed=ConditionalCustomerFieldInstallHealth.safeParse(await options.conditionalCustomerFieldInstallHealth(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const customerFieldHealth=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/health$/);
   if(customerFieldHealth){
    if(!options.paidSimplePublication||!options.customerFieldInstallHealth)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(customerFieldHealth[1]),parsed=CustomerFieldInstallHealth.safeParse(await options.customerFieldInstallHealth(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const installHealth=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/health$/);
   if(installHealth){
    if(!options.paidSimplePublication||!options.paidInstallHealth)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(installHealth[1]),parsed=PaidInstallHealth.safeParse(await options.paidInstallHealth(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const conditionalFieldHistory=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/versions$/);
   if(conditionalFieldHistory){
    if(!options.paidSimplePublication||!options.paidConditionalCustomerFieldVersionHistory)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(conditionalFieldHistory[1]);const parsed=ConditionalCustomerFieldVersionHistory.safeParse(await options.paidConditionalCustomerFieldVersionHistory(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const customerFieldHistory=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/versions$/);
   if(customerFieldHistory){
    if(!options.paidSimplePublication||!options.paidCustomerFieldVersionHistory)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(customerFieldHistory[1]);const parsed=CustomerFieldVersionHistory.safeParse(await options.paidCustomerFieldVersionHistory(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const versionHistory=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/versions$/);
   if(versionHistory){
    if(!options.paidSimplePublication||!options.paidVersionHistory)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(versionHistory[1]);const parsed=PaidVersionHistory.safeParse(await options.paidVersionHistory(actor,tenant,flow));
    if(!parsed.success||parsed.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:parsed.data});return;
   }
   const recovery=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/publication$/);
   if(recovery){
    if(!options.paidSimplePublication||!options.paidPublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(recovery[1]);
    const existing=await options.paidPublication(actor,tenant,flow);
    if(!existing)throw new FlowError("NOT_AVAILABLE");
    const receipt=PaidPublicationReceipt.safeParse(existing);
    if(!receipt.success)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:receipt.data});return;
   }
   const customerFieldRecovery=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/publication$/);
   if(customerFieldRecovery){
    if(!options.paidSimplePublication||!options.paidCustomerFieldPublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="GET")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(customerFieldRecovery[1]).toLowerCase(),existing=await options.paidCustomerFieldPublication(actor,tenant,flow);
    if(!existing)throw new FlowError("NOT_AVAILABLE");
    const receipt=CustomerFieldPublicationReceipt.safeParse(existing);
    if(!receipt.success||receipt.data.flowId!==flow)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:receipt.data});return;
   }
   const conditionalRecovery=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/publication$/);
   if(conditionalRecovery){
    if(!options.paidSimplePublication||!options.paidConditionalCustomerFieldPublication)throw new FlowError('UNSUPPORTED_CONFIG');
    if(req.method!=='GET')throw new FlowError('NOT_AVAILABLE');
    const flow=Uuid.parse(conditionalRecovery[1]).toLowerCase(),result=await options.paidConditionalCustomerFieldPublication(actor,tenant,flow);
    if(!result)throw new FlowError('NOT_AVAILABLE');
    const receipt=ConditionalCustomerFieldPublicationReceipt.safeParse(result);if(!receipt.success||receipt.data.flowId!==flow)throw new FlowError('INTERNAL_ERROR');
    send(res,200,{ok:true,data:receipt.data});return;
   }
   const publishConditionalFields=url.pathname.match(/^\/api\/paid-conditional-customer-field-flows\/([^/]+)\/publish-draft$/);
   if(publishConditionalFields){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(publishConditionalFields[1]);const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
    const body=PublishPaidSimpleDraft.parse(raw);if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_paid_conditional_customer_field_draft.parse(await call("publish_paid_conditional_customer_field_draft",[actor,tenant,flow,body.expectedDraftRevision,randomUUID(),randomUUID(),body.allowedOrigins]));
    if(data.flowId!==flow||data.draftRevision!==body.expectedDraftRevision)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{flowId:data.flowId,draftRevision:data.draftRevision,publication:{versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:6,hostedPath:`/checkout/flow/${data.installationId}`}}});return;
   }
   const publishCustomerFields=url.pathname.match(/^\/api\/paid-customer-field-flows\/([^/]+)\/publish-draft$/);
   if(publishCustomerFields){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(publishCustomerFields[1]);const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
    const body=PublishPaidSimpleDraft.parse(raw);if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_paid_customer_field_draft.parse(await call("publish_paid_customer_field_draft",[actor,tenant,flow,body.expectedDraftRevision,randomUUID(),randomUUID(),body.allowedOrigins]));
    if(data.flowId!==flow||data.draftRevision!==body.expectedDraftRevision)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{flowId:data.flowId,draftRevision:data.draftRevision,publication:{versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:5,hostedPath:`/checkout/flow/${data.installationId}`}}});return;
   }
   const publishSaved=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/publish-draft$/);
   if(publishSaved){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(publishSaved[1]);const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
    const body=PublishPaidSimpleDraft.parse(raw);if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_paid_simple_draft.parse(await call("publish_paid_simple_draft",[actor,tenant,flow,body.expectedDraftRevision,randomUUID(),randomUUID(),body.allowedOrigins]));
    if(data.flowId!==flow||data.draftRevision!==body.expectedDraftRevision)throw new FlowError("INTERNAL_ERROR");
    send(res,200,{ok:true,data:{flowId:data.flowId,draftRevision:data.draftRevision,publication:{versionId:data.versionId,installationId:data.installationId,renderSchemaVersion:3,hostedPath:`/checkout/flow/${data.installationId}`}}});return;
   }
   const paidOption=url.pathname.match(/^\/api\/paid-option-flows\/([^/]+)\/publish$/);
   if(paidOption){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(paidOption[1]);const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
    const body=PublishPaidOption.parse(raw);if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_paid_option_flow.parse(await call("publish_paid_option_flow",[actor,tenant,flow,body.serviceId,body.name,randomUUID(),randomUUID(),body.allowedOrigins]));
    send(res,200,{ok:true,data:{...data,hostedPath:`/checkout/flow/${data.installationId}`}});return;
   }
   const paid=url.pathname.match(/^\/api\/paid-simple-flows\/([^/]+)\/publish$/);
   if(paid){
    if(!options.paidSimplePublication)throw new FlowError("UNSUPPORTED_CONFIG");
    if(req.method!=="POST")throw new FlowError("NOT_AVAILABLE");
    const flow=Uuid.parse(paid[1]);const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");
    const body=PublishPaidSimple.parse(raw);if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_paid_simple_flow.parse(await call("publish_paid_simple_flow",[actor,tenant,flow,body.serviceId,body.name,randomUUID(),randomUUID(),body.allowedOrigins]));
    send(res,200,{ok:true,data:{...data,hostedPath:`/checkout/flow/${data.installationId}`}});return;
   }
   const lists:Record<string,FlowRpc>={"/api/configurable-flows":"flow_owner_configurable_list","/api/services":"flow_owner_services","/api/flows":"flow_owner_list","/api/requests":"flow_owner_requests"};
   if(req.method==="GET"&&Object.hasOwn(lists,url.pathname)){send(res,200,{ok:true,data:await call(lists[url.pathname]!,[actor,tenant])});return;}
   const configurable=url.pathname.match(/^\/api\/configurable-flows\/([^/]+)\/(draft|publish)$/);
   if(configurable){
    const flow=Uuid.parse(configurable[1]);
    if(configurable[2]==="draft"&&req.method==="GET"){send(res,200,{ok:true,data:await call("get_configurable_flow_draft",[actor,tenant,flow])});return;}
    if(configurable[2]==="draft"&&req.method==="POST"){
     const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");const b=SaveConfigurableDraft.parse(raw);
     const catalog=RpcResults.flow_owner_services.parse(await call("flow_owner_services",[actor,tenant])).services.find(s=>s.id===b.serviceId);if(!catalog)throw new FlowError("NOT_AVAILABLE");
     let authoring;try{authoring=normalizeConfigurablePublication(catalog,b.authoring).authoring;}catch{throw new FlowError("UNSUPPORTED_CONFIG");}
     send(res,200,{ok:true,data:await call("save_configurable_flow_draft",[actor,tenant,flow,b.serviceId,b.expectedRevision,b.name,authoring])});return;
    }
    if(configurable[2]==="publish"&&req.method==="POST"){
     const raw=await jsonBody(req);if(!postgresV2Strings(raw))throw new FlowError("INVALID_REQUEST");const b=PublishDraft.parse(raw);if(b.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
     const data=RpcResults.publish_configurable_flow.parse(await call("publish_configurable_flow",[actor,tenant,flow,b.expectedRevision,randomUUID(),randomUUID(),b.allowedOrigins]));send(res,200,{ok:true,data:{...data,hostedPath:`/checkout/flow/${data.installationId}`}});return;
    }throw new FlowError("NOT_AVAILABLE");
   }
   const match=url.pathname.match(/^\/api\/flows\/([^/]+)\/(draft|publish)$/);if(!match)throw new FlowError("NOT_AVAILABLE");const flow=Uuid.parse(match[1]);
   if(match[2]==="draft"&&req.method==="GET"){send(res,200,{ok:true,data:await call("flow_owner_draft",[actor,tenant,flow])});return;}
   if(match[2]==="draft"&&req.method==="POST"){
    const raw=await jsonBody(req);const body=SaveDraft.safeParse(raw);if(!body.success)throw new FlowError("INVALID_REQUEST");
    const b=body.data;send(res,200,{ok:true,data:await call("save_bound_flow_draft",[actor,tenant,flow,b.serviceId,b.expectedRevision,b.name,b.config])});return;
   }
   if(match[2]==="publish"&&req.method==="POST"){
    const body=PublishDraft.parse(await jsonBody(req));if(body.allowedOrigins.some(o=>!customerOrigins.includes(o)))throw new FlowError("FORBIDDEN");
    const data=RpcResults.publish_bound_flow.parse(await call("publish_bound_flow",[actor,tenant,flow,body.expectedRevision,randomUUID(),randomUUID(),body.allowedOrigins]));
    send(res,200,{ok:true,data:{...data,hostedPath:`/checkout/flow/${data.installationId}`}});return;
   }throw new FlowError("NOT_AVAILABLE");
  }catch(error){const code=error instanceof FlowError&&Object.hasOwn(statuses,error.code)?error.code:error instanceof z.ZodError?"INVALID_REQUEST":"INTERNAL_ERROR";if(!res.headersSent)send(res,statuses[code],{ok:false,code});else res.end();}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return server;
}
