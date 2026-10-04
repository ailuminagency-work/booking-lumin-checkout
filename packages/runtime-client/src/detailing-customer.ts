import {z} from 'zod';
import {DetailingCatalogRender} from '@lumin/workflow';
import {DetailingQuoteInput,DetailingQuoteReceipt,DetailingAvailabilityQuery,DetailingAvailabilityReceipt} from '@lumin/contracts';

export class DetailingCustomerError extends Error {
 constructor(readonly code:string){super(code==='UNAUTHENTICATED'?'Your session expired. Reload to start again.':'The Detailing service could not be verified. Try again.');}
}
const Session=z.object({sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime({offset:true}),render:DetailingCatalogRender}).strict();
export type DetailingCustomerSession=z.infer<typeof Session>;
const Failure=z.object({ok:z.literal(false),code:z.enum(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','UNSUPPORTED_CONFIG','INTERNAL_ERROR','RATE_LIMITED'])}).strict();
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
/** Tokens stay in this private client and never enter a URL or persistent storage. */
export function createDetailingCustomerClient(base:string,localHarness=false,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(base);}catch{throw new DetailingCustomerError('INVALID_REQUEST');}
 if(url.origin!==base||url.username||url.password||!(url.protocol==='https:'||(localHarness&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new DetailingCustomerError('INVALID_REQUEST');
 let generation=0,context:{installationId:string;session:DetailingCustomerSession}|undefined;
 const fail=(code='INTERNAL_ERROR'):never=>{throw new DetailingCustomerError(code);};
 function current(){if(!context||Date.parse(context.session.expiresAt)<=Date.now()){context=undefined;return fail('UNAUTHENTICATED');}return context;}
 async function call<T>(path:string,schema:z.ZodType<T>,body?:unknown,token?:string):Promise<T>{
  const at=generation;let response:Response,value:unknown;
  try{response=await fetcher(base+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});value=await response.json();}catch{return fail();}
  if(at!==generation)return fail('UNAUTHENTICATED');
  if(!response.ok){const error=Failure.safeParse(value);return fail(error.success?error.data.code:'INTERNAL_ERROR');}
  const result=z.object({ok:z.literal(true),data:schema}).strict().safeParse(value);if(!result.success)return fail();return schema.parse(result.data.data);
 }
 function bound(r:{versionId:string;installationId:string;serviceId:string;expiresAt:string},c:NonNullable<typeof context>){
  if(context!==c||Date.parse(c.session.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');
  if(r.versionId!==c.session.render.versionId||r.installationId!==c.installationId||r.serviceId!==c.session.render.serviceId||Date.parse(r.expiresAt)<=Date.now()||Date.parse(r.expiresAt)>Date.parse(c.session.expiresAt))return fail();
 }
 return {
  invalidate(){generation++;context=undefined;},
  async session(installation:string){const id=uuid.safeParse(installation);if(!id.success)return fail('INVALID_REQUEST');const at=++generation;context=undefined;const value=await call('/api/detailing-installations/'+id.data+'/sessions',Session,{});if(at!==generation||Date.parse(value.expiresAt)<=Date.now())return fail('UNAUTHENTICATED');context={installationId:id.data,session:structuredClone(value)};return value;},
  async quote(input:DetailingQuoteInput){const c=current(),parsed=DetailingQuoteInput.safeParse(input);if(!parsed.success)return fail('INVALID_REQUEST');const b=parsed.data,cat=c.session.render.catalog;
   if(!cat.packages.some(p=>p.id===b.packageId)||!cat.vehicles.some(v=>v.id===b.vehicleId)||b.addonIds.some(id=>!cat.addons.some(a=>a.id===id))||(cat.locations.length?!cat.locations.some(l=>l.id===b.locationId):b.locationId!==undefined))return fail('INVALID_REQUEST');
   const receipt=await call('/api/detailing-flow-sessions/quote',DetailingQuoteReceipt,b,c.session.sessionToken);bound(receipt,c);
   if(receipt.selection.packageId!==b.packageId||receipt.selection.vehicleId!==b.vehicleId||receipt.selection.locationId!==b.locationId||receipt.selection.addonIds.length!==b.addonIds.length||receipt.selection.addonIds.some(id=>!b.addonIds.includes(id))||receipt.pricing.total.currency!==cat.currency)return fail();return receipt;
  },
  async availability(input:DetailingAvailabilityQuery){const c=current(),parsed=DetailingAvailabilityQuery.safeParse(input);if(!parsed.success)return fail('INVALID_REQUEST');const q=parsed.data;
   const receipt=await call('/api/detailing-flow-sessions/availability?from='+encodeURIComponent(q.from)+'&to='+encodeURIComponent(q.to),DetailingAvailabilityReceipt,undefined,c.session.sessionToken);bound(receipt,c);
   if(receipt.durationMinutes!==c.session.render.catalog.durationMinutes||receipt.slots.some(s=>Date.parse(s.start)<Date.parse(q.from)||Date.parse(s.end)>Date.parse(q.to)))return fail();return receipt;
  }
 };
}
export type DetailingCustomerClient=ReturnType<typeof createDetailingCustomerClient>;
