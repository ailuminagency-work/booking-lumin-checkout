import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { createModeContracts, ModeInputError, modeCommand, modeRecord, safeModeError, type ModeMethod, type ModeFailureCode, type WithheldReason, type OutcomeFor, type ResultMap, type MutationOutcome, type ReadOutcome } from './mode-installation-contracts';
import type { InstallationProfile } from '@lumin/contracts';
export type * from './mode-installation-contracts';
export interface ModeClient {query(text:string,values?:unknown[]):Promise<any>;release(error?:Error):void;on(event:string,listener:(...args:any[])=>void):any;removeListener(event:string,listener:(...args:any[])=>void):any;}
export interface ModePool {connect():Promise<ModeClient>;end():Promise<void>;on(event:string,listener:(...args:any[])=>void):any;removeListener(event:string,listener:(...args:any[])=>void):any;}
export interface ModeClock {monotonic():number;setTimer(callback:()=>void,ms:number):unknown;clearTimer(handle:unknown):void;}
export interface ModeOptions {signal?:AbortSignal;}
export interface ModeInstallationRepository {
 publish(actor:unknown,request:unknown,options?:ModeOptions):Promise<MutationOutcome<ResultMap['publish']>>;
 install(actor:unknown,request:unknown,options?:ModeOptions):Promise<MutationOutcome<ResultMap['install']>>;
 applyVersion(actor:unknown,request:unknown,options?:ModeOptions):Promise<MutationOutcome<ResultMap['applyVersion']>>;
 updatePolicy(actor:unknown,request:unknown,options?:ModeOptions):Promise<MutationOutcome<ResultMap['updatePolicy']>>;
 publicPolicy(request:unknown,options?:ModeOptions):Promise<ReadOutcome<ResultMap['publicPolicy']>>;
 ownerInstallations(actor:unknown,request:unknown,options?:ModeOptions):Promise<ReadOutcome<ResultMap['ownerInstallations']>>;
 ownerHistory(actor:unknown,request:unknown,options?:ModeOptions):Promise<ReadOutcome<ResultMap['ownerHistory']>>;
 ownerOperation(actor:unknown,request:unknown,options?:ModeOptions):Promise<ReadOutcome<ResultMap['ownerOperation']>>;
 close():Promise<void>;
}
const stringify=JSON.stringify;
const clockDefault:ModeClock={monotonic:()=>performance.now(),setTimer:(f,ms)=>setTimeout(f,ms),clearTimer:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
const abortedGetter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!;
const addEvent=EventTarget.prototype.addEventListener,removeEvent=EventTarget.prototype.removeEventListener;
// The native signal is a trusted server-created capability; brand checks do not attest unmodified internals.
function signalOption(options:unknown):AbortSignal|undefined{
 let record:Record<string,unknown>;try{record=modeRecord(options,[]);return undefined;}catch{record=modeRecord(options,['signal']);}
 const s=record.signal;if(s===null||typeof s!=='object'||types.isProxy(s))throw new ModeInputError();abortedGetter.call(s);return s as AbortSignal;
}
const SQL:Record<ModeMethod,string>={
 publish:'SELECT public.mode_publish_flow($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text) AS result',
 install:'SELECT public.mode_install_flow($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb,$9::text) AS result',
 applyVersion:'SELECT public.mode_apply_flow_version($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::uuid,$7::uuid,$8::text) AS result',
 updatePolicy:'SELECT public.mode_update_flow_policy($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::boolean,$7::jsonb,$8::text) AS result',
 publicPolicy:'SELECT public.mode_public_installation_policy($1::uuid) AS result',
 ownerInstallations:'SELECT public.mode_owner_installations($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer) AS result',
 ownerHistory:'SELECT public.mode_owner_installation_history($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::integer) AS result',
 ownerOperation:'SELECT public.mode_owner_operation($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) AS result'};
const mutation=(m:ModeMethod)=>['publish','install','applyVersion','updatePolicy'].includes(m);
function parameters(m:ModeMethod,a:string|undefined,r:any):unknown[]{
 const scope=[a,r.tenantId,r.flowId];
 switch(m){
  case'publish':return [...scope,r.expectedDraftRevision,r.idempotencyKey];
  case'install':return [...scope,r.versionId,r.expectedPublishedVersionId,r.mode,r.deploymentProfileVersion,stringify(r.allowedParentOrigins),r.idempotencyKey];
  case'applyVersion':return [...scope,r.installationId,r.expectedTargetRevision,r.expectedCurrentVersionId,r.newVersionId,r.idempotencyKey];
  case'updatePolicy':return [...scope,r.installationId,r.expectedPolicyRevision,r.enabled,stringify(r.allowedParentOrigins),r.idempotencyKey];
  case'publicPolicy':return [r.installationId];
  case'ownerInstallations':return [...scope,r.afterId,r.limit];
  case'ownerHistory':return [...scope,r.installationId,r.beforeSequence,r.limit];
  case'ownerOperation':return [...scope,r.operation,r.idempotencyKey];
 }
}
function classify(method:ModeMethod,error:unknown):ModeFailureCode{
 const pair=safeModeError(error);if(!pair)return'INTERNAL_ERROR';const [code,label]=pair;
 if(code==='40P01')return'DEADLOCK';if(code==='55P03')return'LOCK_TIMEOUT';if(code==='57014')return'SERVER_TIMEOUT';
 if(code==='42501'&&label==='FORBIDDEN'&&method!=='publicPolicy')return'FORBIDDEN';
 if(code==='22023'&&label==='MODE_INVALID_REQUEST')return'INVALID_REQUEST';
 if(code==='P0002'&&label==='MODE_UNAVAILABLE')return'UNAVAILABLE';
 if(code==='22023'&&['MODE_INVALID_ORIGINS','MODE_INVALID_DISTRIBUTION'].includes(label)&&['install','updatePolicy'].includes(method))return'INVALID_REQUEST';
 if(code==='40001'&&label==='MODE_CONFLICT'&&mutation(method))return'CONFLICT';
 if(code==='54000'&&label==='MODE_REVISION_EXHAUSTED'&&['applyVersion','updatePolicy'].includes(method))return'LIMIT_EXCEEDED';
 if(code==='0A000'&&label==='MODE_UNSUPPORTED'&&mutation(method))return'UNSUPPORTED';
 if(code==='54000'&&label==='MODE_RESPONSE_TOO_LARGE'&&['publicPolicy','ownerInstallations','ownerHistory'].includes(method))return'LIMIT_EXCEEDED';
 if(method==='publish'){
  if(code==='P0002'&&label==='SERVICE_UNAVAILABLE')return'UNAVAILABLE';
  if(code==='0A000'&&['UNSUPPORTED_CHOICE','UNSUPPORTED_CHOICES','UNSUPPORTED_QUANTITY','UNSUPPORTED_QUESTION','UNSUPPORTED_QUESTION_COUNT','UNSUPPORTED_SERVICE','UNSUPPORTED_CONFIG','CONFIGURABLE_NAMESPACE_REQUIRED'].includes(label))return'UNSUPPORTED';
  if(code==='22023'&&['CONFIG_BUDGET','INVALID_CONFIG','INVALID_DEPENDENCY','INVALID_OVERRIDE','REQUIRED_FLOOR'].includes(label))return'INVALID_REQUEST';
 }
 return'INTERNAL_ERROR';
}
/** Trusted controlled-driver seam only; never public/browser application configuration. */
export function __createModeInstallationRepositoryForTests({pool,clock=clockDefault,profiles}:{pool:ModePool;clock?:ModeClock;profiles:unknown}):ModeInstallationRepository{
 const contracts=createModeContracts(profiles);let closed=false,closing:Promise<void>|undefined;
 const active=new Set<()=>void>();pool.on('error',()=>{});
 function invoke<M extends ModeMethod>(method:M,actorInput:unknown,input:unknown,options:unknown={}):Promise<OutcomeFor<M>>{
  let entry:number;try{entry=clock.monotonic();if(!Number.isFinite(entry)||entry<0)throw Error();}catch{return Promise.resolve(Object.freeze({kind:'failed',code:'CLOCK_UNAVAILABLE',transaction:'not_started',backendMayStillRun:false}) as OutcomeFor<M>);}
  return new Promise(resolve=>{
   let phase:'acquiring'|'acquired'|'transaction'|'committing'|'committed'='acquiring';let settled=false,disposed=false,beginSent=false,lastMono=entry;
   let client:ModeClient|undefined,signal:AbortSignal|undefined,totalTimer:unknown,acquisitionTimer:unknown;
   const failed=(code:ModeFailureCode)=>({kind:'failed',code,transaction:beginSent?'no_commit_submitted':'not_started',backendMayStillRun:beginSent});
   const uncertain=()=>mutation(method)?{kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'EXPLICIT_OWNER_OPERATION'}:{kind:'completion_uncertain',code:'READ_COMPLETION_UNCERTAIN',data:null,backendMayStillRun:true};
   const onEnd=()=>{client?.removeListener('error',onError);client?.removeListener('end',onEnd);};
   const dispose=(bad:boolean)=>{if(!client||disposed)return;disposed=true;if(bad){client.on('end',onEnd);try{client.release(Error('MODE_INSTALLATION_CONNECTION_DISCARDED'));}catch{/* Conservative outcome remains; never double-release. */}}else{client.removeListener('error',onError);client.release();}};
   const finish=(outcome:unknown,bad=true)=>{if(settled)return;settled=true;clock.clearTimer(totalTimer);clock.clearTimer(acquisitionTimer);if(signal)removeEvent.call(signal,'abort',onAbort);active.delete(onClose);try{dispose(bad);}catch{/* A known completion stays known if release fails. */}resolve(Object.freeze(outcome) as OutcomeFor<M>);};
   const stop=(reason:WithheldReason|'ACQUISITION_TIMEOUT')=>{
    if(settled)return;
    if(phase==='committed'){const why=reason==='ACQUISITION_TIMEOUT'?'DEADLINE':reason;finish(mutation(method)?{kind:'committed',delivery:'withheld',receipt:null,reason:why}:{kind:'completed',delivery:'withheld',data:null,reason:why});}
    else if(phase==='committing')finish(uncertain());else finish(failed(reason));
   };
   const onError=()=>stop('CONNECTION_FAILED'),onAbort=()=>stop('ABORTED'),onClose=()=>stop('CLOSED');
   const sample=()=>{const n=clock.monotonic();if(!Number.isFinite(n)||n<lastMono||!Number.isSafeInteger(Math.ceil(n-entry)))throw Error('CLOCK_UNAVAILABLE');lastMono=n;return n;};
   const guard=()=>{if(settled)return false;try{sample();if(closed){stop('CLOSED');return false;}if(signal&&abortedGetter.call(signal)){stop('ABORTED');return false;}if(lastMono-entry>=10000){stop('DEADLINE');return false;}if(phase==='acquiring'&&lastMono-entry>=3000){stop('ACQUISITION_TIMEOUT');return false;}}catch{stop('CLOCK_UNAVAILABLE');return false;}return true;};
   active.add(onClose);
   if(closed){stop('CLOSED');return;}
   try{const elapsed=sample()-entry;totalTimer=clock.setTimer(()=>stop('DEADLINE'),Math.max(0,10000-elapsed));acquisitionTimer=clock.setTimer(()=>{if(phase==='acquiring')stop('ACQUISITION_TIMEOUT');},Math.max(0,3000-elapsed));}catch{stop('CLOCK_UNAVAILABLE');return;}
   let copied:ReturnType<typeof contracts.copyInput<M>>;
   try{copied=contracts.copyInput(method,actorInput,input);signal=signalOption(options);if(signal)addEvent.call(signal,'abort',onAbort,{once:true});}
   catch(error){if(guard())finish(failed(error instanceof ModeInputError?error.failure:'INVALID_REQUEST'));return;}
   if(!guard())return;if(lastMono-entry>=3000){stop('ACQUISITION_TIMEOUT');return;}
   void(async()=>{
    try{
     let acquired:ModeClient;try{acquired=await pool.connect();}catch{if(guard())finish(failed('CONNECTION_FAILED'));return;}
     client=acquired;client.on('error',onError);if(settled){dispose(true);return;}
     if(!guard())return;if(lastMono-entry>=3000){stop('ACQUISITION_TIMEOUT');return;}clock.clearTimer(acquisitionTimer);phase='acquired';
     const command=async(text:string,tag:string,values?:unknown[])=>{if(!guard())return undefined;if(text==='BEGIN ISOLATION LEVEL READ COMMITTED'){beginSent=true;phase='transaction';}const value=await client!.query(text,values);if(!guard())return undefined;if(modeCommand(value)!==tag)throw Error('INVALID_COMMAND_TAG');return value;};
     if(!await command('BEGIN ISOLATION LEVEL READ COMMITTED','BEGIN'))return;
     for(const text of ["SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'","SET LOCAL ROLE service_role"]){if(!await command(text,'SET'))return;}
     const raw=await command(SQL[method],'SELECT',parameters(method,copied.actor?.userId,copied.request));if(!raw)return;
     let data:ResultMap[M];try{data=contracts.parseResult(method,raw,copied);}catch{if(guard())finish(failed('INTERNAL_ERROR'));return;}
     if(!guard())return;if(!await command('SET CONSTRAINTS ALL IMMEDIATE','SET'))return;if(!guard())return;
     phase='committing';const acknowledgement=await client.query('COMMIT');if(settled)return;
     const tag=modeCommand(acknowledgement);
     if(tag==='ROLLBACK'){finish({kind:'failed',code:'INTERNAL_ERROR',transaction:'rolled_back',backendMayStillRun:false});return;}
     if(tag!=='COMMIT'){finish(uncertain());return;}
     phase='committed';if(!guard())return;
     finish(mutation(method)?{kind:'committed',delivery:'receipt',receipt:data}:{kind:'completed',delivery:'data',data},false);
    }catch(error){if(settled)return;if(phase==='committing')finish(uncertain());else if(guard())finish(failed(classify(method,error)));}
   })();
  });
 }
 return Object.freeze({
  publish:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('publish',a,r,o),install:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('install',a,r,o),applyVersion:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('applyVersion',a,r,o),updatePolicy:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('updatePolicy',a,r,o),publicPolicy:(r:unknown,o?:ModeOptions)=>invoke('publicPolicy',undefined,r,o),ownerInstallations:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('ownerInstallations',a,r,o),ownerHistory:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('ownerHistory',a,r,o),ownerOperation:(a:unknown,r:unknown,o?:ModeOptions)=>invoke('ownerOperation',a,r,o),
  close(){if(closing)return closing;closed=true;for(const stop of [...active])stop();closing=new Promise<void>(resolve=>{let done=false,timer:unknown;const complete=()=>{if(done)return;done=true;clock.clearTimer(timer);resolve();};timer=clock.setTimer(complete,10000);try{Promise.resolve(pool.end()).then(complete,complete);}catch{complete();}});return closing;}
 });
}
export function createLocalModeInstallationRepository(config:unknown={profiles:[]}):ModeInstallationRepository{
 const c=modeRecord(config,['profiles']);createModeContracts(c.profiles);
 const env=process.env,host=env.PGHOST,port=env.PGPORT,database=env.PGDATABASE,password=env.PGPASSWORD??'';
 if(env.LOCAL_HARNESS!=='1'||env.FLOW_TEST_DISPOSABLE!=='1'||env.MODE_INSTALLATIONS_TEST_DISPOSABLE!=='1'||!['127.0.0.1','localhost'].includes(host??'')||!port||!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535||env.PGUSER!=='postgres'||!database||database.length>63||!/^lumin_installation_s1_transport_[a-z0-9_]+$/.test(database)||!['','postgres'].includes(password)||['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'].some(k=>Boolean(env[k])))throw Error('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
 // Fixed function prevents pg empty-string coercion to null and default pgpass fallback.
 const passwordCallback=()=>password;
 const pool=new Pool({host,port:Number(port),user:'postgres',database,password:passwordCallback,ssl:false,pipeline:false,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:5000,statement_timeout:5000,lock_timeout:5000,idle_in_transaction_session_timeout:1000,query_timeout:0,application_name:'mode-installation-local-transport'});
 return __createModeInstallationRepositoryForTests({pool,profiles:c.profiles});
}
