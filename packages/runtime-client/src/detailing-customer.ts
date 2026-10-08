import {z} from 'zod';
import {DetailingCatalogRender} from '@lumin/workflow';
import {DetailingQuoteInput,DetailingQuoteReceipt,DetailingAvailabilityQuery,DetailingAvailabilityReceipt,DetailingReservationInput,DetailingRequestReceipt,DetailingHoldReceipt} from '@lumin/contracts';

export class DetailingCustomerError extends Error {
 constructor(readonly code:string,readonly definite=false){super(code==='UNAUTHENTICATED'?'Your session expired. Contact the business if a request or reservation was attempted.':code==='CONFLICT'?'The saved request, reservation or test payment could not be verified. Check this same attempt before continuing.':'The Detailing service could not be verified. Try again.');}
}
const Session=z.object({sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime({offset:true}),render:DetailingCatalogRender}).strict();
export type DetailingCustomerSession=z.infer<typeof Session>;
const Failure=z.object({ok:z.literal(false),code:z.enum(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','UNSUPPORTED_CONFIG','INTERNAL_ERROR','RATE_LIMITED'])}).strict();
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const FinancialIdentity=z.object({schemaVersion:z.literal(1),versionId:z.string().uuid(),installationId:z.string().uuid(),serviceId:z.string().uuid(),bookingId:z.string().uuid(),provider:z.literal('staging_mock'),simulated:z.literal(true)}).strict();
export const DetailingCustomerPaymentReadiness=z.discriminatedUnion('state',[
 FinancialIdentity.extend({state:z.literal('draft'),canPay:z.literal(true),canConfirm:z.literal(false)}).strict(),
 FinancialIdentity.extend({state:z.literal('confirmed'),canPay:z.literal(false),canConfirm:z.literal(true)}).strict()
]);
export type DetailingCustomerPaymentReadiness=z.infer<typeof DetailingCustomerPaymentReadiness>;
export const DetailingCustomerPaymentReceipt=FinancialIdentity.extend({paymentId:z.string().uuid(),state:z.literal('confirmed'),replayed:z.boolean()}).strict();
export type DetailingCustomerPaymentReceipt=z.infer<typeof DetailingCustomerPaymentReceipt>;
type FinancialPending='readiness_pending'|'payment_pending'|'confirmation_pending';
type Context={installationId:string;session:DetailingCustomerSession;quote?:DetailingQuoteReceipt;availability?:DetailingAvailabilityReceipt};
type Attempt={base:string;context:Context;body:DetailingReservationInput;request?:DetailingRequestReceipt;hold?:DetailingHoldReceipt;pending:boolean;unknown:boolean;holdUnknown:boolean;financialPending?:FinancialPending;financialOwner?:symbol;paymentAttempted?:boolean;paymentUnknown?:boolean;readiness?:DetailingCustomerPaymentReadiness;payment?:DetailingCustomerPaymentReceipt};
// Page-lifetime memory fences remounts and origin changes after ambiguous writes.
const attempts=new Map<string,Attempt>();
export type DetailingCustomerOperation={phase:'ready'|'request_pending'|'request_unknown'|'saved'|'hold_pending'|'hold_unknown'|'held'|FinancialPending|'payment_ready'|'payment_unknown'|'confirmed';readiness?:DetailingCustomerPaymentReadiness;payment?:DetailingCustomerPaymentReceipt;body?:DetailingReservationInput;request?:DetailingRequestReceipt;hold?:DetailingHoldReceipt};
const financialFence=()=>[...attempts.values()].find(a=>a.paymentUnknown||a.financialPending==='payment_pending'||a.financialPending==='confirmation_pending');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameSelection=(a:DetailingQuoteInput,b:DetailingQuoteInput)=>a.packageId===b.packageId&&a.vehicleId===b.vehicleId&&a.locationId===b.locationId&&a.addonIds.length===b.addonIds.length&&a.addonIds.every(id=>b.addonIds.includes(id));
/** Tokens stay in this private client and never enter a URL or persistent storage. */
export function createDetailingCustomerClient(base:string,localHarness=false,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(base);}catch{throw new DetailingCustomerError('INVALID_REQUEST');}
 if(url.origin!==base||url.username||url.password||!(url.protocol==='https:'||(localHarness&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new DetailingCustomerError('INVALID_REQUEST');
 const clientIdentity=Symbol();
 let generation=0,choiceGeneration=0,slotGeneration=0,context:Context|undefined,installationId:string|undefined;
 const fail=(code='INTERNAL_ERROR'):never=>{throw new DetailingCustomerError(code);};
 function current(){if(!context||Date.parse(context.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');const fence=financialFence();if(fence&&fence!==attempts.get(context.installationId))return fail('CONFLICT');return context;}
 async function call<T>(path:string,schema:z.ZodType<T>,body?:unknown,token?:string):Promise<T>{
  const at=generation;let response:Response,value:unknown;
  try{response=await fetcher(base+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});value=await response.json();}catch{return fail();}
  if(at!==generation)return fail('UNAUTHENTICATED');
  if(!response.ok){const error=Failure.safeParse(value);throw new DetailingCustomerError(error.success?error.data.code:'INTERNAL_ERROR',error.success&&response.status<500);}
  const result=z.object({ok:z.literal(true),data:schema}).strict().safeParse(value);if(!result.success)return fail();return schema.parse(result.data.data);
 }
 function bound(r:{versionId:string;installationId:string;serviceId:string;expiresAt:string},c:NonNullable<typeof context>){
  if(context!==c||Date.parse(c.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');
  if(r.versionId!==c.session.render.versionId||r.installationId!==c.installationId||r.serviceId!==c.session.render.serviceId||Date.parse(r.expiresAt)<=Date.now()||Date.parse(r.expiresAt)>Date.parse(c.session.expiresAt))return fail();
 }
 function financialAttempt(){const c=current(),a=attempts.get(c.installationId);if(!a||a.base!==base||a.context!==c||!a.request||!a.hold||a.pending)return fail('CONFLICT');if(a.financialOwner!==undefined&&a.financialOwner!==clientIdentity)return fail('UNAUTHENTICATED');a.financialOwner=clientIdentity;return{c,a};}
 function financialBound(r:{versionId:string;installationId:string;serviceId:string;bookingId:string},c:Context,a:Attempt){
  if(context!==c||a.financialOwner!==clientIdentity||Date.parse(c.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');
  const request=a.request!,hold=a.hold!;if(r.versionId!==request.versionId||r.installationId!==request.installationId||r.serviceId!==request.serviceId||r.bookingId!==request.bookingId||r.versionId!==c.session.render.versionId||r.installationId!==c.installationId||r.serviceId!==c.session.render.serviceId||hold.versionId!==r.versionId||hold.installationId!==r.installationId||hold.serviceId!==r.serviceId||hold.bookingId!==r.bookingId)return fail();
 }
 async function financialWrite(kind:'mock-payment'|'confirm'){
  const {c,a}=financialAttempt(),proof=a.readiness;
  if(!proof||(kind==='mock-payment'?(proof.state!=='draft'||!proof.canPay||a.holdUnknown||Date.parse(a.hold!.expiresAt)<=Date.now()):proof.state!=='confirmed'||!proof.canConfirm))return fail('CONFLICT');
  financialBound(proof,c,a);a.readiness=undefined;a.pending=true;a.financialPending=kind==='mock-payment'?'payment_pending':'confirmation_pending';a.paymentAttempted=true;
  try{const receipt=await call('/api/detailing-flow-sessions/'+kind,DetailingCustomerPaymentReceipt,{},c.session.sessionToken);financialBound(receipt,c,a);
   if(a.payment&&(receipt.paymentId!==a.payment.paymentId||!receipt.replayed))return fail();if(kind==='confirm'&&!receipt.replayed)return fail();
   a.payment=structuredClone(receipt);a.paymentUnknown=false;return receipt;
  }catch(e){a.paymentUnknown=true;throw e;}finally{a.pending=false;a.financialPending=undefined;}
 }
 return {
  invalidate(){generation++;choiceGeneration++;slotGeneration++;if(installationId){const a=attempts.get(installationId);if(a&&(a.financialOwner===undefined||a.financialOwner===clientIdentity))a.readiness=undefined;}context=undefined;},
  operation():DetailingCustomerOperation{const a=installationId?attempts.get(installationId):undefined;if(!a)return{phase:'ready'};if(a.readiness&&(Date.parse(a.context.session.expiresAt)<=Date.now()||(a.readiness.state==='draft'&&(!a.hold||Date.parse(a.hold.expiresAt)<=Date.now()))))a.readiness=undefined;return structuredClone({phase:a.pending?(a.financialPending??(a.request?'hold_pending':'request_pending')):a.paymentUnknown?'payment_unknown':a.payment?'confirmed':a.readiness?.state==='draft'?'payment_ready':a.holdUnknown?'hold_unknown':a.hold?'held':a.request?'saved':'request_unknown',body:a.body,...(a.request?{request:a.request}:{}),...(a.hold?{hold:a.hold}:{}),...(a.readiness?{readiness:a.readiness}:{}),...(a.payment?{payment:a.payment}:{})}) as DetailingCustomerOperation;},
  clearSelection(){if(financialFence()||(installationId&&attempts.has(installationId)))return fail('CONFLICT');choiceGeneration++;slotGeneration++;if(context){context.quote=undefined;context.availability=undefined;}},
  clearAvailability(){if(financialFence()||(installationId&&attempts.has(installationId)))return fail('CONFLICT');slotGeneration++;if(context)context.availability=undefined;},
  async session(installation:string){const id=uuid.safeParse(installation);if(!id.success)return fail('INVALID_REQUEST');const fence=financialFence();if(fence&&(fence.context.installationId!==id.data||fence.base!==base))return fail('CONFLICT');installationId=id.data;const at=++generation;context=undefined;
   const prior=attempts.get(id.data);if(prior){if(prior.base!==base)return fail('CONFLICT');context=prior.context;prior.financialOwner=clientIdentity;prior.readiness=undefined;if(prior.hold)prior.holdUnknown=true;return structuredClone(prior.context.session);}
   const value=await call('/api/detailing-installations/'+id.data+'/sessions',Session,{});if(at!==generation||Date.parse(value.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');context={installationId:id.data,session:structuredClone(value)};return value;},
  async quote(input:DetailingQuoteInput){const c=current(),parsed=DetailingQuoteInput.safeParse(input);if(!parsed.success)return fail('INVALID_REQUEST');const b=parsed.data,cat=c.session.render.catalog;
   if(attempts.has(c.installationId))return fail('CONFLICT');const at=++choiceGeneration;slotGeneration++;c.quote=undefined;c.availability=undefined;
   if(!cat.packages.some(p=>p.id===b.packageId)||!cat.vehicles.some(v=>v.id===b.vehicleId)||b.addonIds.some(id=>!cat.addons.some(a=>a.id===id))||(cat.locations.length?!cat.locations.some(l=>l.id===b.locationId):b.locationId!==undefined))return fail('INVALID_REQUEST');
   const receipt=await call('/api/detailing-flow-sessions/quote',DetailingQuoteReceipt,b,c.session.sessionToken);bound(receipt,c);if(at!==choiceGeneration)return fail('CONFLICT');
   if(!sameSelection(receipt.selection,b)||receipt.pricing.total.currency!==cat.currency)return fail();c.quote=structuredClone(receipt);return receipt;
  },
  async availability(input:DetailingAvailabilityQuery){const c=current(),parsed=DetailingAvailabilityQuery.safeParse(input);if(!parsed.success)return fail('INVALID_REQUEST');const q=parsed.data;
   if(attempts.has(c.installationId))return fail('CONFLICT');const at=++slotGeneration;c.availability=undefined;
   const receipt=await call('/api/detailing-flow-sessions/availability?from='+encodeURIComponent(q.from)+'&to='+encodeURIComponent(q.to),DetailingAvailabilityReceipt,undefined,c.session.sessionToken);bound(receipt,c);if(at!==slotGeneration)return fail('CONFLICT');
   if(receipt.durationMinutes!==c.session.render.catalog.durationMinutes||receipt.slots.some(s=>Date.parse(s.start)<Date.parse(q.from)||Date.parse(s.end)>Date.parse(q.to)))return fail();c.availability=structuredClone(receipt);return receipt;
  },
  async request(input:DetailingReservationInput){const c=current(),parsed=DetailingReservationInput.safeParse(input);if(!parsed.success)return fail('INVALID_REQUEST');let a=attempts.get(c.installationId);const body=parsed.data;
   if(a){if(a.base!==base||a.context!==c||a.pending||a.paymentAttempted||!same(a.body,body))return fail('CONFLICT');if(a.request)return structuredClone(a.request);}
   else{if(!c.quote||!c.availability||Date.parse(c.quote.expiresAt)<=Date.now()||Date.parse(c.availability.expiresAt)<=Date.now()||!sameSelection(body.selection,c.quote.selection)||!c.availability.slots.some(s=>s.start===body.requestedStart&&Date.parse(s.start)>Date.now()))return fail('INVALID_REQUEST');a={base,context:c,body:structuredClone(body),pending:false,unknown:false,holdUnknown:false};attempts.set(c.installationId,a);}
   const attempt=a;attempt.pending=true;try{const receipt=await call('/api/detailing-flow-sessions/request',DetailingRequestReceipt,attempt.body,c.session.sessionToken);
    if(context!==c||Date.parse(c.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');
    const selected=c.availability?.slots.find(s=>s.start===attempt.body.requestedStart);
    if(receipt.versionId!==c.session.render.versionId||receipt.installationId!==c.installationId||receipt.serviceId!==c.session.render.serviceId||!sameSelection(receipt.selection,attempt.body.selection)||!same(receipt.pricing,c.quote?.pricing)||receipt.slot.start!==attempt.body.requestedStart||receipt.slot.end!==selected?.end)return fail();
    attempt.request=structuredClone(receipt);attempt.unknown=false;return receipt;
   }catch(e){if(e instanceof DetailingCustomerError&&e.definite&&!attempt.unknown){attempts.delete(c.installationId);}else attempt.unknown=true;throw e;}finally{attempt.pending=false;}
  },
  async paymentReadiness(){const {c,a}=financialAttempt();if(a.holdUnknown&&!a.paymentAttempted)return fail('CONFLICT');a.readiness=undefined;a.pending=true;a.financialPending='readiness_pending';
   try{const receipt=await call('/api/detailing-flow-sessions/payment-readiness',DetailingCustomerPaymentReadiness,undefined,c.session.sessionToken);financialBound(receipt,c,a);if(a.payment&&receipt.state!=='confirmed')return fail();a.readiness=structuredClone(receipt);if(receipt.state==='confirmed'&&!a.payment){a.paymentAttempted=true;a.paymentUnknown=true;}return receipt;}finally{a.pending=false;a.financialPending=undefined;}
  },
  mockPayment:()=>financialWrite('mock-payment'),
  confirm:()=>financialWrite('confirm'),
  async hold(){const c=current(),a=attempts.get(c.installationId);if(!a||a.base!==base||a.context!==c||!a.request||a.pending||(a.paymentAttempted&&(a.payment||a.readiness?.state!=='draft')))return fail('CONFLICT');a.readiness=undefined;if(a.hold&&Date.parse(a.hold.expiresAt)<=Date.now())return fail('CONFLICT');a.pending=true;
   try{const receipt=await call('/api/detailing-flow-sessions/hold',DetailingHoldReceipt,{},c.session.sessionToken);
    if(context!==c||Date.parse(c.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');
    if(receipt.versionId!==a.request.versionId||receipt.installationId!==a.request.installationId||receipt.serviceId!==a.request.serviceId||receipt.bookingId!==a.request.bookingId||Date.parse(receipt.expiresAt)<=Date.now()||(a.hold&&!same(a.hold,receipt)))return fail();
    a.hold=structuredClone(receipt);a.holdUnknown=false;return receipt;
   }catch(e){if(!(e instanceof DetailingCustomerError&&e.definite)||a.holdUnknown)a.holdUnknown=true;throw e;}finally{a.pending=false;}
  }
 };
}
export type DetailingCustomerClient=ReturnType<typeof createDetailingCustomerClient>;
