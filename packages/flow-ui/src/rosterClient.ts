import {z} from 'zod';
import {parseRosterSnapshot,RosterWorkerInput,RosterCrewInput,RosterMemberInput,RosterEligibilityInput,RosterShiftInput,RosterProvisionReceipt,RosterEntityReceipt,RosterMemberReceipt,RosterEligibilityReceipt} from '@lumin/contracts';
export type {RosterSnapshot} from '@lumin/contracts';
const codes=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','INTERNAL_ERROR','RATE_LIMITED','ROSTER_NOT_INITIALIZED','ROSTER_TOO_LARGE','ROSTER_UNSUPPORTED_TIME'] as const;
const messages={INVALID_REQUEST:'Check the roster fields.',UNAUTHENTICATED:'Sign in again to view this roster.',FORBIDDEN:'An active business owner account is required.',CONFLICT:'The roster changed. Refresh and review before saving again.',NOT_AVAILABLE:'This roster item is unavailable.',INTERNAL_ERROR:'The roster request could not be completed.',RATE_LIMITED:'Wait before trying again.',ROSTER_NOT_INITIALIZED:'Set up a roster for this business.',ROSTER_TOO_LARGE:'This roster exceeds the supported size. Editing is unavailable.',ROSTER_UNSUPPORTED_TIME:'A recorded shift date cannot be displayed safely. Editing is unavailable.'};
export class RosterError extends Error{constructor(readonly code:typeof codes[number]){super(messages[code]);}}
export function createRosterClient(base:string,localHarness=false,fetcher:typeof fetch=fetch){
 let url:URL;try{url=new URL(base);}catch{throw new RosterError('INVALID_REQUEST');}
 if(url.origin!==base||url.username||url.password||!(url.protocol==='https:'||(localHarness&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new RosterError('INVALID_REQUEST');
 let generation=0;
 const active=new Set<()=>void>();
 const uuid=(value:string)=>{const result=z.string().uuid().safeParse(value);if(!result.success)throw new RosterError('INVALID_REQUEST');return result.data;};
 const tenant=(value:string)=>'?tenantId='+encodeURIComponent(uuid(value));
 function input<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new RosterError('INVALID_REQUEST');return result.data;}
 async function call(path:string,token:string,body?:unknown):Promise<unknown>{
  const at=generation;
  const controller=new AbortController();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let stopped:'UNAUTHENTICATED'|'INTERNAL_ERROR'|undefined;
  let finished=false,cancelStarted=false;
  let rejectStopped!:(error:RosterError)=>void;
  const interrupted=new Promise<never>((_,reject)=>{rejectStopped=reject;});
  void interrupted.catch(()=>undefined);
  function cancelReader(){if(!reader||cancelStarted)return;cancelStarted=true;try{void reader.cancel().catch(()=>undefined);}catch{/* Cleanup cannot mask the public error. */}}
  function stop(code:'UNAUTHENTICATED'|'INTERNAL_ERROR'){
   if(finished||stopped)return;stopped=code;rejectStopped(new RosterError(code));controller.abort();cancelReader();
  }
  const invalidate=()=>stop('UNAUTHENTICATED');
  active.add(invalidate);
  const deadline=Date.now()+15000;
  const timer=setTimeout(()=>stop('INTERNAL_ERROR'),15000);
  function check(){if(stopped)throw new RosterError(stopped);if(at!==generation)stop('UNAUTHENTICATED');if(Date.now()>=deadline)stop('INTERNAL_ERROR');if(stopped)throw new RosterError(stopped);}
  try{
   if(!token||/[\r\n]/.test(token))throw new RosterError('UNAUTHENTICATED');
   const fetching=Promise.resolve(fetcher(base+path,{signal:controller.signal,method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body===undefined?{}:{body:JSON.stringify(body)})})).then(response=>{
    if(stopped||finished){try{void response.body?.cancel().catch(()=>undefined);}catch{/* Ignore late adapter cleanup. */}}
    return response;
   });
   const response=await Promise.race([fetching,interrupted]);
   check();
   if(!response.body)throw new RosterError('INTERNAL_ERROR');
   reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
   try{for(;;){check();const part=await Promise.race([reader.read(),interrupted]);check();if(part.done)break;size+=part.value.byteLength;if(size>525312)throw new RosterError('INTERNAL_ERROR');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{cancelReader();try{reader.releaseLock();}catch{/* A native read may still be pending. */}}
   check();
   const value:unknown=JSON.parse(text);
   const failure=z.object({ok:z.literal(false),code:z.enum(codes)}).strict().safeParse(value);if(failure.success)throw new RosterError(failure.data.code);
   const success=z.object({ok:z.literal(true),data:z.unknown()}).strict().safeParse(value);if(!response.ok||!success.success||!Object.hasOwn(success.data,'data'))throw new RosterError('INTERNAL_ERROR');check();return success.data.data;
  }catch(e){if(stopped)throw new RosterError(stopped);if(at!==generation)throw new RosterError('UNAUTHENTICATED');if(e instanceof RosterError)throw e;throw new RosterError('INTERNAL_ERROR');}
  finally{finished=true;clearTimeout(timer);active.delete(invalidate);cancelReader();}
 }
 async function receipt<T extends {rosterVersion:number}>(path:string,token:string,body:{expectedRosterVersion:number},schema:z.ZodType<T>,match:(value:T)=>boolean){const value=schema.safeParse(await call(path,token,body));if(!value.success||value.data.rosterVersion!==body.expectedRosterVersion+1||!match(value.data))throw new RosterError('INTERNAL_ERROR');return value.data;}
 return {invalidate(){generation++;for(const invalidate of active)invalidate();},
  async snapshot(token:string,id:string){const value=await call('/api/roster'+tenant(id),token);try{return parseRosterSnapshot(value);}catch{throw new RosterError('INTERNAL_ERROR');}},
  async provision(token:string,id:string){const value=RosterProvisionReceipt.safeParse(await call('/api/roster/provision'+tenant(id),token,{}));if(!value.success)throw new RosterError('INTERNAL_ERROR');return value.data;},
  worker(token:string,id:string,workerId:string|null,value:z.infer<typeof RosterWorkerInput>){const body=input(RosterWorkerInput,value);return receipt('/api/roster/workers'+(workerId?'/'+uuid(workerId):'')+tenant(id),token,body,RosterEntityReceipt,r=>!workerId||r.entityId.toLowerCase()===workerId.toLowerCase());},
  crew(token:string,id:string,crewId:string|null,value:z.infer<typeof RosterCrewInput>){const body=input(RosterCrewInput,value);return receipt('/api/roster/crews'+(crewId?'/'+uuid(crewId):'')+tenant(id),token,body,RosterEntityReceipt,r=>!crewId||r.entityId.toLowerCase()===crewId.toLowerCase());},
  shift(token:string,id:string,shiftId:string|null,value:z.infer<typeof RosterShiftInput>){
   const body=input(RosterShiftInput,value);
   const path='/api/roster/shifts'+(shiftId===null?'':'/'+uuid(shiftId))+tenant(id);
   return receipt(path,token,body,RosterEntityReceipt,r=>shiftId===null||r.entityId.toLowerCase()===shiftId.toLowerCase());
  },
  member(token:string,id:string,crewId:string,value:z.infer<typeof RosterMemberInput>){const body=input(RosterMemberInput,value);return receipt('/api/roster/crews/'+uuid(crewId)+'/members'+tenant(id),token,body,RosterMemberReceipt,r=>r.crewId.toLowerCase()===crewId.toLowerCase()&&r.workerId.toLowerCase()===body.workerId.toLowerCase()&&r.present===body.present);},
  eligibility(token:string,id:string,value:z.infer<typeof RosterEligibilityInput>){const body=input(RosterEligibilityInput,value);return receipt('/api/roster/eligibility'+tenant(id),token,body,RosterEligibilityReceipt,r=>r.workerId.toLowerCase()===body.workerId.toLowerCase()&&r.serviceId.toLowerCase()===body.serviceId.toLowerCase()&&r.active===body.active);}
 };
}
