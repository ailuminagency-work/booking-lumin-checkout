import {Pool} from 'pg';
import {performance} from 'node:perf_hooks';
import {copyPlanningInput,parsePlanningReceipt,planningExpiryMicroseconds,type FailureCode,type PlanningAllocationOutcome} from './planning-allocation-contracts';
export type {PlanningActorContext,PlanningAllocationRequest,PlanningAllocationReceipt,PlanningAllocationOutcome} from './planning-allocation-contracts';
export interface PlanningClient{query(text:string,values?:unknown[]):Promise<any>;release(error?:Error):void;on(event:string,listener:(...args:any[])=>void):any;removeListener(event:string,listener:(...args:any[])=>void):any;}
export interface PlanningPool{connect():Promise<PlanningClient>;end():Promise<void>;on(event:string,listener:(...args:any[])=>void):any;removeListener(event:string,listener:(...args:any[])=>void):any;}
export interface PlanningClock{monotonic():number;wall():number;setTimer(callback:()=>void,ms:number):unknown;clearTimer(handle:unknown):void;}
export interface PlanningAllocationRepository{allocate(actorContext:unknown,request:unknown,options?:{signal?:AbortSignal}):Promise<PlanningAllocationOutcome>;close():Promise<void>;}
const realClock:PlanningClock={monotonic:()=>performance.now(),wall:()=>Date.now(),setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:h=>clearTimeout(h as ReturnType<typeof setTimeout>)};
const SQL='SELECT public.allocate_planning_group($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result';
const pairs:Record<string,FailureCode>={
 '22023/ALLOCATION_INVALID':'INVALID_REQUEST','42501/FORBIDDEN':'FORBIDDEN','P0002/ALLOCATION_NOT_FOUND':'NOT_FOUND','0A000/ALLOCATION_UNSUPPORTED_SCHEDULE':'UNSUPPORTED_SCHEDULE','54000/ALLOCATION_LIMIT':'LIMIT_EXCEEDED','40001/ALLOCATION_GENERATION_CONFLICT':'GENERATION_CONFLICT','40001/ALLOCATION_EVIDENCE_CHANGED':'EVIDENCE_CHANGED','P0001/ALLOCATION_UNAVAILABLE':'UNAVAILABLE','55000/ALLOCATION_CORRUPT':'CORRUPT_STATE','55000/ALLOCATION_PROTOCOL':'PROTOCOL_ERROR','57014/ALLOCATION_DEADLINE':'DEADLINE'};
function classify(error:unknown):FailureCode{
 const e=error as {code?:unknown;message?:unknown};
 if(typeof e?.code!=='string')return 'CONNECTION_FAILED';
 if(typeof e.message==='string'&&pairs[e.code+'/'+e.message])return pairs[e.code+'/'+e.message]!;
 return e.code==='40P01'?'DEADLOCK':e.code==='55P03'?'LOCK_TIMEOUT':e.code==='57014'?'SERVER_TIMEOUT':'INTERNAL_ERROR';
}
const unknownCommit=():PlanningAllocationOutcome=>Object.freeze({kind:'unknown_commit',code:'COMMIT_UNCERTAIN',receipt:null,reconciliation:'REAUTHORIZE_SAME_TARGET'});
/** Internal controlled-driver seam. Not application configuration or an HTTP API. */
export function __createPlanningAllocationRepositoryForTests(pool:PlanningPool,clock:PlanningClock=realClock):PlanningAllocationRepository{
 let closed=false;let closing:Promise<void>|undefined;
 const active=new Set<()=>void>();
 // Never log raw pg error data. Idle errors are already evicted by pg-pool.
 const idleError=()=>{};pool.on('error',idleError);
 return {
 allocate(actorContext,input,options={}){
  // Monotonic budget starts before input inspection or pool acquisition.
  let entry:number,wallEntry:number;
  try{entry=clock.monotonic();wallEntry=clock.wall();if(!Number.isFinite(entry)||entry<0||!Number.isSafeInteger(wallEntry))throw Error();}
  catch{return Promise.resolve(Object.freeze({kind:'failed',code:'INTERNAL_ERROR',transaction:'not_started',backendMayStillRun:false}));}
  return new Promise<PlanningAllocationOutcome>(resolve=>{
   let phase:'acquiring'|'acquired'|'in_transaction'|'committing'|'committed'='acquiring';
   let settled=false;let disposed=false;let client:PlanningClient|undefined;let beginSent=false;let lastMono=entry;
   let totalTimer:unknown;let acquisitionTimer:unknown;let signal:AbortSignal|undefined;
   const failed=(code:FailureCode):PlanningAllocationOutcome=>Object.freeze({kind:'failed',code,transaction:beginSent?'no_commit_submitted':'not_started',backendMayStillRun:beginSent});
   const endListener=()=>{client?.removeListener('error',clientError);client?.removeListener('end',endListener);};
   const dispose=(bad:boolean)=>{
    if(!client||disposed)return;disposed=true;
    if(bad){client.on('end',endListener);try{client.release(Error('PLANNING_CONNECTION_DISCARDED'));}catch{/* Outcome is already conservative; no second release. */}}
    else{client.removeListener('error',clientError);client.release();}
   };
   const finish=(outcome:PlanningAllocationOutcome,bad=true)=>{
    if(settled)return;settled=true;
    clock.clearTimer(totalTimer);clock.clearTimer(acquisitionTimer);signal?.removeEventListener('abort',onAbort);active.delete(onClose);
    try{dispose(bad);}catch{/* A committed result stays committed if release fails. */}
    resolve(Object.freeze(outcome));
   };
   const stop=(reason:'ABORTED'|'DEADLINE'|'CLOCK_UNAVAILABLE'|'ACQUISITION_TIMEOUT'|'CONNECTION_FAILED')=>{
    if(settled)return;
    if(phase==='committed')finish({kind:'committed',delivery:'withheld',receipt:null,reason:reason==='ABORTED'?'ABORTED':reason==='CLOCK_UNAVAILABLE'?'CLOCK_UNAVAILABLE':'DEADLINE'});
    else if(phase==='committing')finish(unknownCommit());
    else finish(failed(reason==='CLOCK_UNAVAILABLE'?'INTERNAL_ERROR':reason));
   };
   const clientError=()=>stop('CONNECTION_FAILED');
   const onAbort=()=>stop('ABORTED');const onClose=()=>stop('ABORTED');
   const sample=()=>{
    const mono=clock.monotonic(),wall=clock.wall();
    if(!Number.isFinite(mono)||mono<lastMono||!Number.isSafeInteger(wall)||!Number.isSafeInteger(Math.ceil((mono-entry)*1000)))throw Error('CLOCK_UNAVAILABLE');
    lastMono=mono;return {mono,wall};
   };
   const guard=()=>{
    if(settled)return false;
    try{const t=sample();if(signal?.aborted||closed){stop('ABORTED');return false;}if(t.mono-entry>=10000){stop('DEADLINE');return false;}}
    catch{stop('CLOCK_UNAVAILABLE');return false;}return true;
   };
   active.add(onClose);
   let elapsed:number;
   try{elapsed=sample().mono-entry;}catch{stop('CLOCK_UNAVAILABLE');return;}
   totalTimer=clock.setTimer(()=>stop('DEADLINE'),Math.max(0,10000-elapsed));
   acquisitionTimer=clock.setTimer(()=>{if(phase==='acquiring')stop('ACQUISITION_TIMEOUT');},Math.max(0,3000-elapsed));
   let actor:ReturnType<typeof copyPlanningInput>[0],request:ReturnType<typeof copyPlanningInput>[1];
   try{[actor,request]=copyPlanningInput(actorContext,input);signal=options.signal;}
   catch{finish(failed('INVALID_REQUEST'));return;}
   signal?.addEventListener('abort',onAbort,{once:true});
   if(!guard())return;
   if(lastMono-entry>=3000){stop('ACQUISITION_TIMEOUT');return;}
   // Consumed async body owns every connect/query result, even after terminal outcome.
   void (async()=>{
    try{
     const acquired=await pool.connect();client=acquired;client.on('error',clientError);
     if(settled){dispose(true);return;}
     if(!guard())return;
     if(lastMono-entry>=3000){stop('ACQUISITION_TIMEOUT');return;}
     clock.clearTimer(acquisitionTimer);phase='acquired';
     const command=async(text:string,tag:string,values?:unknown[])=>{
      if(!guard())return undefined;
      const value=await client!.query(text,values);
      if(!guard())return undefined;
      if(value?.command!==tag)throw Object.assign(Error('INVALID_COMMAND_TAG'),{code:'INTERNAL'});
      return value;
     };
     beginSent=true;phase='in_transaction';
     if(!await command('BEGIN ISOLATION LEVEL READ COMMITTED','BEGIN'))return;
     for(const text of ["SET LOCAL statement_timeout='5s'","SET LOCAL lock_timeout='5s'","SET LOCAL idle_in_transaction_session_timeout='1s'","SET LOCAL ROLE service_role"]){if(!await command(text,'SET'))return;}
     const raw=await command(SQL,'SELECT',[actor.userId,request.tenantId,request.bookingId,request.crewId,request.targetGeneration]);
     if(!raw)return;
     let receipt;
     try{receipt=parsePlanningReceipt(raw,request);}catch{finish(failed('INTERNAL_ERROR'));return;}
     if(!await command('SET CONSTRAINTS ALL IMMEDIATE','SET'))return;
     if(!guard())return;
     phase='committing';
     const acknowledgement=await client.query('COMMIT');
     if(settled)return;
     if(acknowledgement?.command==='ROLLBACK'){finish({kind:'failed',code:'INTERNAL_ERROR',transaction:'rolled_back',backendMayStillRun:false});return;}
     if(acknowledgement?.command!=='COMMIT'){finish(unknownCommit());return;}
     phase='committed';
     if(!guard())return;
     let comparison:bigint;
     try{const {mono,wall}=sample();comparison=BigInt(wall)*1000n;const floor=BigInt(wallEntry)*1000n+BigInt(Math.ceil((mono-entry)*1000));if(floor>comparison)comparison=floor;}
     catch{stop('CLOCK_UNAVAILABLE');return;}
     if(!guard())return;
     const published=Object.freeze({...receipt,usable:receipt.usable&&comparison<planningExpiryMicroseconds(receipt.expiresAt)});
     finish({kind:'committed',delivery:'receipt',receipt:published},false);
    }catch(error){
     if(settled)return;
     if(phase==='committing')finish(unknownCommit());
     else finish(failed(classify(error)));
    }
   })();
  });
 },
 close(){
  if(closing)return closing;closed=true;for(const stop of [...active])stop();
  closing=new Promise<void>(resolve=>{
   let done=false;let timer:unknown;
   const complete=()=>{if(done)return;done=true;clock.clearTimer(timer);resolve();};
   timer=clock.setTimer(complete,10000);
   // Retain the safe pool error listener through late driver shutdown.
   try{Promise.resolve(pool.end()).then(complete,complete);}catch{complete();}
  });return closing;
 }
 };
}
export function createLocalPlanningAllocationRepository():PlanningAllocationRepository{
 if(process.env.LOCAL_HARNESS!=='1'||process.env.FLOW_TEST_DISPOSABLE!=='1'||!['127.0.0.1','localhost'].includes(process.env.PGHOST??'')||!/^lumin_[a-z0-9_]+$/.test(process.env.PGDATABASE??''))throw Error('EXPLICIT_LOCAL_DISPOSABLE_REQUIRED');
 const pool=new Pool({pipeline:false,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:5000,statement_timeout:5000,lock_timeout:5000,idle_in_transaction_session_timeout:1000,query_timeout:0});
 return __createPlanningAllocationRepositoryForTests(pool);
}
