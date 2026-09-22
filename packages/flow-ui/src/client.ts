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
 return {invalidate(){generation++;},
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
