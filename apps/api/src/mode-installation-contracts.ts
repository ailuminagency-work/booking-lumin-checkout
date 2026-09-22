/** Server-only S1 local contracts. Native signals and driver/clock implementations are trusted capabilities. */
import { types } from 'node:util';
import { createInstallationContracts, parseInstallationOrigin, type InstallationProfile, type InstallationPolicy } from '@lumin/contracts';
const isProxy=types.isProxy, ownKeys=Reflect.ownKeys, descriptor=Object.getOwnPropertyDescriptor, prototype=Object.getPrototypeOf, array=Array.isArray, freeze=Object.freeze, stringify=JSON.stringify, byteLength=Buffer.byteLength.bind(Buffer);
export type ModeMethod='publish'|'install'|'applyVersion'|'updatePolicy'|'publicPolicy'|'ownerInstallations'|'ownerHistory'|'ownerOperation';
export type MutationMethod='publish'|'install'|'applyVersion'|'updatePolicy';
export type ModeActor=Readonly<{mode:'local_synthetic';userId:string}>;
export type Scope=Readonly<{tenantId:string;flowId:string}>;
export type PublishRequest=Scope&Readonly<{expectedDraftRevision:number;idempotencyKey:string}>;
export type InstallRequest=Scope&Readonly<{versionId:string;expectedPublishedVersionId:string;mode:'hosted'|'iframe';deploymentProfileVersion:string;allowedParentOrigins:readonly string[];idempotencyKey:string}>;
export type ApplyRequest=Scope&Readonly<{installationId:string;expectedTargetRevision:number;expectedCurrentVersionId:string;newVersionId:string;idempotencyKey:string}>;
export type PolicyRequest=Scope&Readonly<{installationId:string;expectedPolicyRevision:number;enabled:boolean;allowedParentOrigins:readonly string[];idempotencyKey:string}>;
export type PublicPolicyRequest=Readonly<{installationId:string}>;
export type InstallationsRequest=Scope&Readonly<{afterId:string|null;limit:number}>;
export type HistoryRequest=Scope&Readonly<{installationId:string;beforeSequence:number|null;limit:number}>;
export type OperationRequest=Scope&Readonly<{operation:'publish'|'install'|'apply'|'policy';idempotencyKey:string}>;
export type RequestMap={publish:PublishRequest;install:InstallRequest;applyVersion:ApplyRequest;updatePolicy:PolicyRequest;publicPolicy:PublicPolicyRequest;ownerInstallations:InstallationsRequest;ownerHistory:HistoryRequest;ownerOperation:OperationRequest};
type CommonReceipt=Readonly<{schemaVersion:1;actorId:string;flowId:string}>;
export type PublishReceipt=CommonReceipt&Readonly<{operation:'publish';versionId:string;sourceRevision:number;renderSchemaVersion:1|2}>;
export type InstallReceipt=CommonReceipt&Readonly<{operation:'install';installationId:string;mode:'hosted'|'iframe';deploymentProfileVersion:string;currentVersionId:string;targetRevision:1;policyRevision:1;enabled:true;allowedParentOrigins:readonly string[];changed:true}>;
export type ApplyReceipt=CommonReceipt&Readonly<{operation:'apply';installationId:string;previousVersionId:string;currentVersionId:string;targetRevision:number;policyRevision:number;changed:boolean}>;
export type PolicyReceipt=CommonReceipt&Readonly<{operation:'policy';installationId:string;currentVersionId:string;targetRevision:number;policyRevision:number;enabled:boolean;allowedParentOrigins:readonly string[];changed:boolean}>;
export type OperationReceipt=PublishReceipt|InstallReceipt|ApplyReceipt|PolicyReceipt;
export type InstallationRow=Readonly<{installationId:string;flowId:string;mode:'hosted'|'iframe';deploymentProfileVersion:string;currentVersionId:string;targetRevision:number;policyRevision:number;enabled:boolean;allowedParentOrigins:readonly string[]}>;
export type HistoryRow=Readonly<{sequence:number;operation:'install'|'apply'|'policy';currentVersionId:string;targetRevision:number;policyRevision:number;enabled:boolean;allowedParentOrigins:readonly string[]}>;
export type InstallationPage=Readonly<{installations:readonly InstallationRow[];nextCursor:string|null}>;
export type HistoryPage=Readonly<{history:readonly HistoryRow[];nextCursor:number|null}>;
export type ResultMap={publish:PublishReceipt;install:InstallReceipt;applyVersion:ApplyReceipt;updatePolicy:PolicyReceipt;publicPolicy:InstallationPolicy;ownerInstallations:InstallationPage;ownerHistory:HistoryPage;ownerOperation:OperationReceipt};
export type ModeFailureCode='INVALID_REQUEST'|'FORBIDDEN'|'CONFLICT'|'UNAVAILABLE'|'UNSUPPORTED'|'LIMIT_EXCEEDED'|'INTERNAL_ERROR'|'CONNECTION_FAILED'|'ACQUISITION_TIMEOUT'|'ABORTED'|'DEADLINE'|'CLOSED'|'CLOCK_UNAVAILABLE'|'SERVER_TIMEOUT'|'LOCK_TIMEOUT'|'DEADLOCK';
export type WithheldReason='ABORTED'|'DEADLINE'|'CLOCK_UNAVAILABLE'|'CLOSED'|'CONNECTION_FAILED';
export type ModeFailure=Readonly<{kind:'failed';code:ModeFailureCode;transaction:'not_started'|'no_commit_submitted'|'rolled_back';backendMayStillRun:boolean}>;
export type MutationOutcome<T>=Readonly<{kind:'committed';delivery:'receipt';receipt:T}>|Readonly<{kind:'committed';delivery:'withheld';receipt:null;reason:WithheldReason}>|ModeFailure|Readonly<{kind:'unknown_commit';code:'COMMIT_UNCERTAIN';receipt:null;reconciliation:'EXPLICIT_OWNER_OPERATION'}>;
export type ReadOutcome<T>=Readonly<{kind:'completed';delivery:'data';data:T}>|Readonly<{kind:'completed';delivery:'withheld';data:null;reason:WithheldReason}>|ModeFailure|Readonly<{kind:'completion_uncertain';code:'READ_COMPLETION_UNCERTAIN';data:null;backendMayStillRun:true}>;
export type OutcomeFor<M extends ModeMethod>=M extends MutationMethod?MutationOutcome<ResultMap[M]>:ReadOutcome<ResultMap[M]>;
export class ModeInputError extends Error { constructor(readonly failure: 'INVALID_REQUEST'|'LIMIT_EXCEEDED'='INVALID_REQUEST'){super(failure);} }
const invalid=():never=>{throw new ModeInputError();};
function requireValue(ok:unknown):asserts ok{if(!ok)invalid();}
export function modeRecord(value:unknown,keys:readonly string[]):Record<string,unknown>{
 requireValue(value!==null&&typeof value==='object'&&!isProxy(value)&&!array(value));
 requireValue(prototype(value)===Object.prototype||prototype(value)===null);
 const names=ownKeys(value);requireValue(names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)));
 const out:Record<string,unknown>=Object.create(null);
 for(const k of keys){const d=descriptor(value,k);requireValue(d&&'value'in d&&d.enumerable);out[k]=d.value;}
 return out;
}
type Bounds={depth:number;nodes:number;props:number;array:number;string:number;bytes:number};
const ACTOR:Bounds={depth:1,nodes:8,props:2,array:0,string:36,bytes:256};
const INPUT:Bounds={depth:4,nodes:128,props:16,array:20,string:512,bytes:16384};
const SINGLE:Bounds={depth:4,nodes:256,props:16,array:20,string:512,bytes:16384};
const PAGE:Bounds={depth:6,nodes:8192,props:16,array:100,string:512,bytes:1048576};
const REGISTRY:Bounds={depth:4,nodes:1024,props:8,array:64,string:512,bytes:131072};
function copy(value:unknown,bounds:Bounds):any{
 let nodes=0;const visited=new WeakSet<object>();
 const visit=(v:unknown,depth:number,field?:string):any=>{
  requireValue(++nodes<=bounds.nodes&&depth<=bounds.depth);
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){requireValue(Number.isFinite(v));return v;}
  if(typeof v==='string'){requireValue(v.length<=Math.min(bounds.string,field==='allowedParentOrigins'||['rendererOrigin','apiOrigin','portalOrigin'].includes(field??'')?300:bounds.string));return v;}
  requireValue(typeof v==='object'&&v!==null&&!isProxy(v)&&!visited.has(v));visited.add(v);
  const p=prototype(v);
  if(array(v)){
   requireValue(p===Array.prototype);const d=descriptor(v,'length');requireValue(d&&'value'in d&&Number.isSafeInteger(d.value)&&d.value>=0&&d.value<=Math.min(bounds.array,field==='allowedParentOrigins'?20:bounds.array));
   const len=d.value as number;requireValue(ownKeys(v).length===len+1);const out=[];
   for(let i=0;i<len;i++){const item=descriptor(v,String(i));requireValue(item&&'value'in item&&item.enumerable);out.push(visit(item.value,depth+1,field));}
   return freeze(out);
  }
  requireValue(p===Object.prototype||p===null);const keys=ownKeys(v);requireValue(keys.length<=bounds.props);
  const out:Record<string,unknown>=Object.create(null);
  for(const k of keys){requireValue(typeof k==='string');const d=descriptor(v,k);requireValue(d&&'value'in d&&d.enumerable);out[k]=visit(d.value,depth+1,k);}
  return freeze(out);
 };
 const result=visit(value,0);requireValue(byteLength(stringify(result),'utf8')<=bounds.bytes);return result;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY=/^[A-Za-z0-9_-]{16,128}$/;
const PROFILE=/^[a-z][a-z0-9-]{0,63}$/;
const MAX=Number.MAX_SAFE_INTEGER;
function uuid(v:unknown):asserts v is string{requireValue(typeof v==='string'&&v.length===36&&UUID.test(v));}
function revision(v:unknown):asserts v is number{requireValue(Number.isSafeInteger(v)&&Number(v)>=1);}
function bool(v:unknown):asserts v is boolean{requireValue(typeof v==='boolean');}
function same(a:unknown,b:unknown){requireValue(a===b);}
function origin(v:unknown):asserts v is string{
 requireValue(typeof v==='string'&&v.length<=300&&/^[\x00-\x7f]+$/.test(v));same(parseInstallationOrigin(v),v);
 const hostname=new URL(v).hostname;requireValue(!hostname.includes(':')&&!hostname.startsWith('['));
 const labels=hostname.split('.'),last=labels[labels.length-1]!;
 requireValue(labels.every(x=>!x.startsWith('xn--'))&&/[a-z]/.test(last)&&!/^0x[0-9a-f]*$/.test(last));
}
function parents(v:unknown,sorted:boolean):readonly string[]{
 requireValue(array(v)&&v.length<=20);for(const x of v)origin(x);
 requireValue(new Set(v).size===v.length&&byteLength(stringify(v),'utf8')<=8192);
 const ordered=[...v].sort();if(sorted)requireValue(v.every((x,i)=>x===ordered[i]));return freeze(ordered);
}
const fields:Record<ModeMethod,readonly string[]>={
 publish:['expectedDraftRevision','idempotencyKey'],install:['versionId','expectedPublishedVersionId','mode','deploymentProfileVersion','allowedParentOrigins','idempotencyKey'],applyVersion:['installationId','expectedTargetRevision','expectedCurrentVersionId','newVersionId','idempotencyKey'],updatePolicy:['installationId','expectedPolicyRevision','enabled','allowedParentOrigins','idempotencyKey'],publicPolicy:['installationId'],ownerInstallations:['afterId','limit'],ownerHistory:['installationId','beforeSequence','limit'],ownerOperation:['operation','idempotencyKey']};
const receiptExtra:Record<string,readonly string[]>={publish:['versionId','sourceRevision','renderSchemaVersion'],install:['installationId','mode','deploymentProfileVersion','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins','changed'],apply:['installationId','previousVersionId','currentVersionId','targetRevision','policyRevision','changed'],policy:['installationId','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins','changed']};
const installationKeys=['installationId','flowId','mode','deploymentProfileVersion','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins'];
const historyKeys=['sequence','operation','currentVersionId','targetRevision','policyRevision','enabled','allowedParentOrigins'];
export type CopiedModeInput<M extends ModeMethod=ModeMethod>=Readonly<{actor:ModeActor|undefined;request:RequestMap[M]}>;
/** New immutable registry; never mutates the SQL registry or verifies unreturned SQL portal origin. */
export function createModeContracts(rawProfiles:unknown){
 const container=copy({profiles:rawProfiles},REGISTRY);const profiles=container.profiles;requireValue(array(profiles));
 const map=new Map<string,InstallationProfile>();
 for(const raw of profiles){const p=modeRecord(raw,['profileVersion','rendererOrigin','apiOrigin','portalOrigin','loaderUrl']);requireValue(typeof p.profileVersion==='string'&&PROFILE.test(p.profileVersion)&&!map.has(p.profileVersion));for(const k of ['rendererOrigin','apiOrigin','portalOrigin'])origin(p[k]);map.set(p.profileVersion,raw as InstallationProfile);}
 const trusted=createInstallationContracts(profiles as InstallationProfile[]);
 const member=(v:unknown)=>{requireValue(typeof v==='string'&&PROFILE.test(v));const p=map.get(v);requireValue(p);return p;};
 const distribution=(dto:Record<string,any>)=>{requireValue(dto.mode==='hosted'||dto.mode==='iframe');const p=member(dto.deploymentProfileVersion);const list=parents(dto.allowedParentOrigins,true);requireValue(dto.mode==='hosted'?list.length===0:list.length>=1);requireValue(list.every(x=>![p.rendererOrigin,p.apiOrigin,p.portalOrigin].includes(x)));};
 const commonVersion=(dto:Record<string,any>)=>{uuid(dto.currentVersionId);revision(dto.targetRevision);revision(dto.policyRevision);};
 function intrinsicReceipt(raw:any,operation:string,actor:ModeActor,flowId:string){
  requireValue(Object.hasOwn(receiptExtra,operation));const dto=modeRecord(raw,['schemaVersion','operation','actorId','flowId',...receiptExtra[operation]!]) as Record<string,any>;
  same(dto.schemaVersion,1);same(dto.operation,operation);same(dto.actorId,actor.userId);same(dto.flowId,flowId);
  if(operation==='publish'){uuid(dto.versionId);revision(dto.sourceRevision);requireValue(dto.renderSchemaVersion===1||dto.renderSchemaVersion===2);}
  else{uuid(dto.installationId);commonVersion(dto);bool(dto.changed);
   if(operation==='install'){distribution(dto);same(dto.targetRevision,1);same(dto.policyRevision,1);same(dto.enabled,true);same(dto.changed,true);}
   if(operation==='apply'){uuid(dto.previousVersionId);same(dto.changed,dto.previousVersionId!==dto.currentVersionId);if(dto.changed)requireValue(dto.targetRevision>=2);}
   if(operation==='policy'){bool(dto.enabled);parents(dto.allowedParentOrigins,true);if(dto.changed)requireValue(dto.policyRevision>=2);}
  }
  return raw;
 }
 return freeze({
  copyInput<M extends ModeMethod>(method:M,actorInput:unknown,input:unknown):CopiedModeInput<M>{
   if(method!=='publicPolicy'){const a=modeRecord(actorInput,['mode','userId']);same(a.mode,'local_synthetic');uuid(a.userId);copy(actorInput,ACTOR);}
   const envelope=copy(method==='publicPolicy'?{request:input}:{actor:actorInput,request:input},INPUT);
   let actor:ModeActor|undefined;
   if(method!=='publicPolicy'){const a=modeRecord(envelope.actor,['mode','userId']);same(a.mode,'local_synthetic');uuid(a.userId);requireValue(byteLength(stringify(envelope.actor),'utf8')<=256);actor=envelope.actor as ModeActor;}
   const r=modeRecord(envelope.request,[...(method==='publicPolicy'?[]:['tenantId','flowId']),...fields[method]]) as Record<string,any>;
   if(method!=='publicPolicy'){uuid(r.tenantId);uuid(r.flowId);}
   if('idempotencyKey'in r)requireValue(typeof r.idempotencyKey==='string'&&KEY.test(r.idempotencyKey));
   for(const k of ['installationId','versionId','expectedPublishedVersionId','expectedCurrentVersionId','newVersionId'])if(k in r)uuid(r[k]);
   for(const k of ['expectedDraftRevision','expectedTargetRevision','expectedPolicyRevision'])if(k in r)revision(r[k]);
   if('enabled'in r)bool(r.enabled);
   if('allowedParentOrigins'in r)r.allowedParentOrigins=parents(r.allowedParentOrigins,false);
   if(method==='install'){same(r.versionId,r.expectedPublishedVersionId);distribution(r);}
   if(method==='applyVersion'&&r.newVersionId!==r.expectedCurrentVersionId&&r.expectedTargetRevision===MAX)throw new ModeInputError('LIMIT_EXCEEDED');
   if('limit'in r){requireValue(Number.isInteger(r.limit)&&r.limit>=1&&r.limit<=100);}
   if(method==='ownerInstallations'&&r.afterId!==null)uuid(r.afterId);
   if(method==='ownerHistory'&&r.beforeSequence!==null)revision(r.beforeSequence);
   if(method==='ownerOperation')requireValue(['publish','install','apply','policy'].includes(r.operation));
   return freeze({actor,request:freeze(r) as RequestMap[M]});
  },
  parseResult<M extends ModeMethod>(method:M,result:unknown,input:CopiedModeInput<M>):ResultMap[M]{
   same(modeCommand(result),'SELECT');same(modeMetadata(result,'rowCount'),1);
   const rows=modeMetadata(result,'rows');requireValue(rows!==null&&typeof rows==='object'&&!isProxy(rows)&&array(rows));
   const length=descriptor(rows,'length');requireValue(prototype(rows)===Array.prototype&&length&&'value'in length&&length.value===1&&ownKeys(rows).length===2);
   const item=descriptor(rows,'0');requireValue(item&&'value'in item&&item.enumerable);const row=modeRecord(item.value,['result']);
   const raw=copy(row.result,method==='ownerInstallations'||method==='ownerHistory'?PAGE:SINGLE);
   const r=input.request as any,a=input.actor!;
   if(method==='publicPolicy'){const p=trusted.parsePolicy(raw);same(p.installationId,r.installationId);same(p.enabled,true);for(const k of ['rendererOrigin','apiOrigin'] as const)origin(p[k]);distribution(p);return raw as ResultMap[M];}
   if(method==='ownerInstallations'||method==='ownerHistory'){
    const name=method==='ownerInstallations'?'installations':'history',dto=modeRecord(raw,[name,'nextCursor']);const list=dto[name];requireValue(array(list)&&list.length<=r.limit);
    let previous:any=method==='ownerInstallations'?r.afterId:r.beforeSequence;
    for(const entry of list){const d=modeRecord(entry,method==='ownerInstallations'?installationKeys:historyKeys) as Record<string,any>;commonVersion(d);bool(d.enabled);parents(d.allowedParentOrigins,true);
     if(method==='ownerInstallations'){uuid(d.installationId);same(d.flowId,r.flowId);distribution(d);requireValue(previous===null||d.installationId>previous);previous=d.installationId;}
     else{revision(d.sequence);requireValue(['install','apply','policy'].includes(d.operation));requireValue((d.sequence===1)===(d.operation==='install'));if(d.operation==='install'){same(d.targetRevision,1);same(d.policyRevision,1);same(d.enabled,true);}if(d.operation==='apply')requireValue(d.targetRevision>=2);if(d.operation==='policy')requireValue(d.policyRevision>=2);same(BigInt(d.sequence),BigInt(d.targetRevision)+BigInt(d.policyRevision)-1n);requireValue(previous===null||d.sequence<previous);previous=d.sequence;}
    }
    if(dto.nextCursor!==null){if(method==='ownerInstallations')uuid(dto.nextCursor);else revision(dto.nextCursor);requireValue(list.length===r.limit&&list.length>0);same(dto.nextCursor,previous);}else if(list.length===0)same(dto.nextCursor,null);
   }else{
    const operation=method==='applyVersion'?'apply':method==='updatePolicy'?'policy':method==='ownerOperation'?r.operation:method;
    intrinsicReceipt(raw,operation,a,r.flowId);
    if(method==='publish')same(raw.sourceRevision,r.expectedDraftRevision);
    if(method==='install'){same(raw.currentVersionId,r.versionId);same(raw.mode,r.mode);same(raw.deploymentProfileVersion,r.deploymentProfileVersion);same(stringify(raw.allowedParentOrigins),stringify(r.allowedParentOrigins));}
    if(method==='applyVersion'){same(raw.installationId,r.installationId);same(raw.previousVersionId,r.expectedCurrentVersionId);same(raw.currentVersionId,r.newVersionId);same(raw.changed,r.newVersionId!==r.expectedCurrentVersionId);requireValue(!raw.changed||r.expectedTargetRevision<MAX);same(raw.targetRevision,r.expectedTargetRevision+(raw.changed?1:0));}
    if(method==='updatePolicy'){same(raw.installationId,r.installationId);same(raw.enabled,r.enabled);same(stringify(raw.allowedParentOrigins),stringify(r.allowedParentOrigins));requireValue(!raw.changed||r.expectedPolicyRevision<MAX);same(raw.policyRevision,r.expectedPolicyRevision+(raw.changed?1:0));}
   }
   return raw as ResultMap[M];
  }
 });
}
export function modeMetadata(result:unknown,key:'command'|'rowCount'|'rows'):unknown{
 requireValue(result!==null&&typeof result==='object'&&!isProxy(result)&&!array(result));const d=descriptor(result,key);requireValue(d&&'value'in d&&d.enumerable);return d.value;
}
export function modeCommand(result:unknown):string{const value=modeMetadata(result,'command');requireValue(typeof value==='string');return value;}
export function safeModeError(error:unknown):readonly[string,string]|undefined{
 if(error===null||typeof error!=='object'||isProxy(error))return;
 const c=descriptor(error,'code'),m=descriptor(error,'message');if(!c||!m||!('value'in c)||!('value'in m)||typeof c.value!=='string'||typeof m.value!=='string'||c.value.length>128||m.value.length>128)return;
 return [c.value,m.value];
}
