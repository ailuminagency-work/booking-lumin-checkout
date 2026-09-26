import {z} from 'zod';
import {Draft,FlowList,ServiceRender,type FlowConfig,type Answers} from './types';
import {ConfigurableDraft,ConfigurableAuthoringV2,SessionRender} from './configurable';
const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','UNSUPPORTED_CONFIG','INTERNAL_ERROR','RATE_LIMITED'] as const;
const messages={INVALID_REQUEST:'Check the form and try again.',UNAUTHENTICATED:'Your session is unavailable. Sign in again.',FORBIDDEN:'This account cannot perform this action.',CONFLICT:'The saved version changed. Refresh before trying again.',NOT_AVAILABLE:'This item is unavailable.',UNSUPPORTED_CONFIG:'This service or questionnaire is not supported yet.',INTERNAL_ERROR:'The request could not be completed.',RATE_LIMITED:'Too many requests. Wait before trying again.'};
// Only the session-issuance result has a documented 1 MiB inner contract.
// Leave room for its API envelope. Other endpoints, including service catalogs,
// have no proven output-byte ceiling and retain their existing JSON behavior.
const MAX_SESSION_RESPONSE_BYTES=2097152;
export class FlowError extends Error{constructor(readonly code:typeof codes[number]){super(messages[code]);}}
export function createFlowClient(base:string,localHarness=false,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(base);}catch{throw new FlowError('INVALID_REQUEST');}
 if(url.origin!==base||url.username||url.password||!(url.protocol==='https:'||(localHarness&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new FlowError('INVALID_REQUEST');
 let generation=0;
 const active=new Set<(code:'UNAUTHENTICATED'|'INTERNAL_ERROR')=>void>();
 function discardBody(response:Response){try{void response.body?.cancel().catch(()=>{});}catch{/* Body may already be locked or absent. */}}
 function call<T>(path:string,schema:z.ZodType<T>,token?:string,body?:unknown):Promise<T>{
  const at=generation,controller=new AbortController(),started=performance.now();
  const deadlineExceeded=()=>{try{const elapsed=performance.now()-started;return !Number.isFinite(elapsed)||elapsed<0||elapsed>=15000;}catch{return true;}};
  return new Promise<T>((resolve,reject)=>{
   let settled=false,response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   let timer:ReturnType<typeof setTimeout>;
   function finish(error?:FlowError,value?:T){
    if(settled)return;
    if(error?.code!=='UNAUTHENTICATED'&&deadlineExceeded())error=new FlowError('INTERNAL_ERROR');
    settled=true; // Claim settlement before cleanup can reenter invalidate().
    let cleanupFailed=false;
    try{clearTimeout(timer);}catch{cleanupFailed=true;}
    active.delete(cancel);
    if(error?.code!=='UNAUTHENTICATED'){
     if(at!==generation)error=new FlowError('UNAUTHENTICATED');
     else if(cleanupFailed||deadlineExceeded())error=new FlowError('INTERNAL_ERROR');
    }
    if(error){controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(response)discardBody(response);reject(error);}else resolve(value as T);
   }
   function cancel(code:'UNAUTHENTICATED'|'INTERNAL_ERROR'){finish(new FlowError(code));}
   active.add(cancel);
   timer=setTimeout(()=>cancel('INTERNAL_ERROR'),15000);
   void (async()=>{
    try{
     const next=await fetcher(base+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
     if(settled){discardBody(next);return;}response=next;
     if(deadlineExceeded()){cancel('INTERNAL_ERROR');return;}
     let value:unknown;
     if(path.startsWith('/api/installations/')&&path.endsWith('/sessions')){
      if(!next.body){cancel('INTERNAL_ERROR');return;}
      reader=next.body.getReader();const buffer=new Uint8Array(MAX_SESSION_RESPONSE_BYTES);
      let size=0,complete=false;
      try{
       for(;;){
        const part=await reader.read();
        if(settled||deadlineExceeded()||at!==generation){cancel(at!==generation?'UNAUTHENTICATED':'INTERNAL_ERROR');return;}
        if(part.done){complete=true;break;}
        // Browser/test realms can supply distinct constructors. Copy the raw
        // view bytes, not indexed elements that a DataView can spoof or lack.
        if(!ArrayBuffer.isView(part.value)||part.value.byteLength>MAX_SESSION_RESPONSE_BYTES-size){cancel('INTERNAL_ERROR');return;}
        const bytes=new Uint8Array(part.value.buffer,part.value.byteOffset,part.value.byteLength);
        buffer.set(bytes,size);size+=bytes.byteLength;
       }
      }finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
      value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size)));
     }else value=await next.json();
     if(settled)return;
     if(deadlineExceeded()){cancel('INTERNAL_ERROR');return;}
     if(at!==generation){cancel('UNAUTHENTICATED');return;}
     const failure=z.object({ok:z.literal(false),code:z.enum(codes)}).strict().safeParse(value);
     if(failure.success){finish(new FlowError(failure.data.code));return;}
     const parsed=z.object({ok:z.literal(true),data:schema}).strict().safeParse(value);
     if(!next.ok||!parsed.success){cancel('INTERNAL_ERROR');return;}
     finish(undefined,schema.parse(parsed.data.data));
    }catch{if(!settled)cancel(at!==generation?'UNAUTHENTICATED':'INTERNAL_ERROR');}
   })();
  });
 }
 const tenant=(id:string)=>'?tenantId='+encodeURIComponent(z.string().uuid().parse(id));
 const uuid=(id:string)=>z.string().uuid().parse(id);
 return {invalidate(){generation++;for(const cancel of [...active])cancel('UNAUTHENTICATED');},
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
