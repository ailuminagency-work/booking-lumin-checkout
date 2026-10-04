import {z} from 'zod';
import {Draft,FlowList,ServiceRender,type FlowConfig,type Answers} from './types';
import {ConfigurableDraft,ConfigurableAuthoringV2,SessionRender} from './configurable';
const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','UNSUPPORTED_CONFIG','INTERNAL_ERROR','RATE_LIMITED'] as const;
const messages={INVALID_REQUEST:'Check the form and try again.',UNAUTHENTICATED:'Your session is unavailable. Sign in again.',FORBIDDEN:'This account cannot perform this action.',CONFLICT:'The saved version changed. Refresh before trying again.',NOT_AVAILABLE:'This item is unavailable.',UNSUPPORTED_CONFIG:'This service or questionnaire is not supported yet.',INTERNAL_ERROR:'The request could not be completed.',RATE_LIMITED:'Too many requests. Wait before trying again.'};
export class FlowError extends Error{constructor(readonly code:typeof codes[number]){super(messages[code]);}}
export function createFlowClient(base:string,localHarness=false,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(base);}catch{throw new FlowError('INVALID_REQUEST');}
 if(url.origin!==base||url.username||url.password||!(url.protocol==='https:'||(localHarness&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new FlowError('INVALID_REQUEST');
 let generation=0;
 async function call<T>(path:string,schema:z.ZodType<T>,token?:string,body?:unknown):Promise<T>{
 const at=generation;let response:Response;let value:unknown;
 try{response=await fetcher(base+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});value=await response.json();}catch{throw new FlowError('INTERNAL_ERROR');}
 if(at!==generation)throw new FlowError('UNAUTHENTICATED');
 const failure=z.object({ok:z.literal(false),code:z.enum(codes)}).strict().safeParse(value);if(failure.success)throw new FlowError(failure.data.code);
 const parsed=z.object({ok:z.literal(true),data:schema}).strict().safeParse(value);if(!response.ok||!parsed.success)throw new FlowError('INTERNAL_ERROR');return schema.parse(parsed.data.data);
 }
 const tenant=(id:string)=>'?tenantId='+encodeURIComponent(z.string().uuid().parse(id));
 const uuid=(id:string)=>z.string().uuid().parse(id);
 async function availability(token:string,from:string,to:string){
  const instant=z.string().datetime({offset:true});
  const start=Date.parse(from),end=Date.parse(to);
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!instant.safeParse(from).success||!instant.safeParse(to).success||!Number.isFinite(end-start)||end<=start||end-start>7*86400000)throw new FlowError('INVALID_REQUEST');
  const schema=z.object({schemaVersion:z.literal(1),serviceId:z.string().uuid(),durationMinutes:z.number().int().min(5).max(1440),slots:z.array(z.object({start:instant,end:instant,remainingCapacity:z.number().int().positive()}).strict()).max(10080)}).strict().superRefine((value,ctx)=>{
   const seen=new Set<string>();
   for(const slot of value.slots){const a=Date.parse(slot.start),b=Date.parse(slot.end);if(!Number.isFinite(a)||!Number.isFinite(b)||a<start||a>end||b-a!==value.durationMinutes*60000||seen.has(new Date(a).toISOString()))ctx.addIssue({code:'custom',message:'Invalid availability'});else seen.add(new Date(a).toISOString());}
  });
  const value=await call('/api/flow-sessions/availability?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),schema,token);
  // The core includes a start exactly at `to`; a selected day is half-open.
  // Slots starting within the day may legitimately finish after midnight.
  return {...value,slots:value.slots.filter(slot=>Date.parse(slot.start)<end)};
 }
 return {invalidate(){generation++;},
 availability,
 hold:(token:string)=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('INVALID_REQUEST');
  return call('/api/flow-sessions/hold',z.object({schemaVersion:z.literal(1),bookingId:z.string().uuid(),holdId:z.string().uuid(),status:z.literal('active'),expiresAt:z.string().datetime({offset:true}).refine(value=>Number.isFinite(Date.parse(value)))}).strict(),token,{});
 },
 mockPayment:(token:string)=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new FlowError('INVALID_REQUEST');
  return call('/api/flow-sessions/mock-payment',z.object({schemaVersion:z.literal(1),bookingId:z.string().uuid(),paymentId:z.string().uuid(),state:z.literal('confirmed'),replayed:z.boolean(),provider:z.literal('staging_mock'),simulated:z.literal(true)}).strict(),token,{});
 },
 services:(token:string,id:string)=>call('/api/services'+tenant(id),z.object({services:z.array(ServiceRender).max(100)}).strict(),token),
 flows:(token:string,id:string)=>call('/api/flows'+tenant(id),FlowList,token),
 draft:(token:string,id:string,flow:string)=>call('/api/flows/'+uuid(flow)+'/draft'+tenant(id),Draft,token),
 save:(token:string,id:string,flow:string,body:{expectedRevision:number;serviceId:string;name:string;config:FlowConfig})=>call('/api/flows/'+uuid(flow)+'/draft'+tenant(id),z.object({flowId:z.string().uuid(),revision:z.number().int().positive()}).strict(),token,body),
 publish:(token:string,id:string,flow:string,body:{expectedRevision:number;allowedOrigins:string[]})=>call('/api/flows/'+uuid(flow)+'/publish'+tenant(id),z.object({versionId:z.string().uuid(),installationId:z.string().uuid(),hostedPath:z.string().regex(/^\/checkout\/flow\/[0-9a-f-]{36}$/i)}).strict(),token,body),
 configurableFlows:(token:string,id:string)=>call('/api/configurable-flows'+tenant(id),FlowList,token),
 configurableDraft:(token:string,id:string,flow:string)=>call('/api/configurable-flows/'+uuid(flow)+'/draft'+tenant(id),ConfigurableDraft,token),
 saveConfigurable:(token:string,id:string,flow:string,body:{expectedRevision:number;serviceId:string;name:string;authoring:ConfigurableAuthoringV2})=>call('/api/configurable-flows/'+uuid(flow)+'/draft'+tenant(id),z.object({flowId:z.string().uuid(),revision:z.number().int().positive(),authoringVersion:z.literal(2)}).strict(),token,body),
 publishConfigurable:(token:string,id:string,flow:string,body:{expectedRevision:number;allowedOrigins:string[]})=>call('/api/configurable-flows/'+uuid(flow)+'/publish'+tenant(id),z.object({versionId:z.string().uuid(),installationId:z.string().uuid(),renderSchemaVersion:z.literal(2),hostedPath:z.string().regex(/^\/checkout\/flow\/[0-9a-f-]{36}$/i)}).strict(),token,body),
 requests:(token:string,id:string)=>call('/api/requests'+tenant(id),z.object({requests:z.array(z.object({id:z.string().uuid(),reference:z.string(),state:z.literal('draft'),slotStart:z.string().datetime({offset:true}),createdAt:z.string().datetime({offset:true})}).strict()).max(100)}).strict(),token),
 session:(installation:string)=>call('/api/installations/'+uuid(installation)+'/sessions',z.object({sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime({offset:true}),render:SessionRender}).strict(),undefined,{}),
 submit:(token:string,body:{idempotencyKey:string;answers:Answers;customer:{name:string;email:string};requestedStart:string})=>call('/api/flow-sessions/request',z.object({reference:z.string(),state:z.literal('draft'),confirmed:z.literal(false)}).strict(),token,body)
 };
}
export type FlowClient=ReturnType<typeof createFlowClient>;
