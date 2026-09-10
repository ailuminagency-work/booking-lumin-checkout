/** Pure installation protocol v1. No registered deployment, controller or API is activated here. */
export const INSTALLATION_LIMITS=Object.freeze({protocolVersion:1,policyBytes:16384,messageBytes:1024,maxParentOrigins:20,maxInstances:8,initialHeight:640,minHeight:320,maxHeight:1600,handshakeMs:5000,initRetryMs:500,maxInitSends:10,policyFetchMs:2000,maxPendingInit:1,maxInitPerWindow:10,initWindowMs:5000,maxResizePerSecond:4,policyRefreshMs:30000});
export type InstallationMode='hosted'|'iframe';
export type InstallationProfile=Readonly<{profileVersion:string;rendererOrigin:string;apiOrigin:string;portalOrigin:string;loaderUrl:string}>;
export type InstallationPolicy=Readonly<{schemaVersion:1;installationId:string;mode:InstallationMode;deploymentProfileVersion:string;rendererOrigin:string;apiOrigin:string;loaderUrl:string;currentVersionId:string;targetRevision:number;policyRevision:number;allowedParentOrigins:readonly string[];enabled:boolean}>;
export type InstallationMessage=Readonly<{type:'lumin:init'|'lumin:ready';protocolVersion:1;installationId:string;instanceId:string}>|Readonly<{type:'lumin:resize';protocolVersion:1;installationId:string;instanceId:string;height:number}>;
export type InstallationOutput=Readonly<{kind:'hosted';url:string}>|Readonly<{kind:'iframe_loader';url:string;loaderUrl:string;html:string;requiresCompanionController:true}>;
export class InstallationContractError extends Error{constructor(){super('INVALID_INSTALLATION_CONTRACT');this.name='InstallationContractError';}}
const fail=():never=>{throw new InstallationContractError();};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROFILE=/^[a-z][a-z0-9-]{0,63}$/;
const LOADER=/^\/assets\/booking-lumin-loader\.[0-9a-f]{64}\.js$/;
const encoder=new TextEncoder();
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(value===null||typeof value!=='object')return fail();
 const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return fail();
 const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return fail();
 const result:Record<string,unknown>=Object.create(null);
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!d.enumerable||!('value'in d))return fail();result[key]=d.value;}
 return result;
}
function list(value:unknown,max:number):unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return fail();
 const length=Object.getOwnPropertyDescriptor(value,'length');if(!length||!('value'in length)||!Number.isInteger(length.value)||length.value<0||length.value>max)return fail();
 if(Reflect.ownKeys(value).length!==length.value+1)return fail();
 const out:unknown[]=[];for(let i=0;i<length.value;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!d.enumerable||!('value'in d))return fail();out.push(d.value);}return out;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))return fail();return value;}
function version(value:unknown):string{if(typeof value!=='string'||!PROFILE.test(value))return fail();return value;}
function revision(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)return fail();return value;}
function mode(value:unknown):InstallationMode{if(value!=='hosted'&&value!=='iframe')return fail();return value;}
function bounded(value:object,bytes:number):void{if(encoder.encode(JSON.stringify(value)).byteLength>bytes)fail();}
/** Reject normalized aliases instead of silently turning an entered URL into another origin. */
export function parseInstallationOrigin(value:unknown):string{
 if(typeof value!=='string'||value.length>2048)return fail();
 let u:URL;try{u=new URL(value);}catch{return fail();}
 if(u.protocol!=='https:'||u.origin!==value||u.username||u.password||!u.hostname||u.hostname.length>253||u.hostname.endsWith('.'))return fail();
 return value;
}
/** Syntax and topology validation only; registry membership is enforced by createInstallationContracts. */
export function parseInstallationProfile(value:unknown):InstallationProfile{
 const r=record(value,['profileVersion','rendererOrigin','apiOrigin','portalOrigin','loaderUrl']);
 const profileVersion=version(r.profileVersion),rendererOrigin=parseInstallationOrigin(r.rendererOrigin),apiOrigin=parseInstallationOrigin(r.apiOrigin),portalOrigin=parseInstallationOrigin(r.portalOrigin);
 if(new Set([rendererOrigin,apiOrigin,portalOrigin]).size!==3||typeof r.loaderUrl!=='string'||r.loaderUrl.length>4096)return fail();
 let loader:URL;try{loader=new URL(r.loaderUrl);}catch{return fail();}
 if(loader.origin!==rendererOrigin||loader.username||loader.password||loader.search||loader.hash||!LOADER.test(loader.pathname)||loader.href!==r.loaderUrl||r.loaderUrl!==rendererOrigin+loader.pathname)return fail();
 return Object.freeze({profileVersion,rendererOrigin,apiOrigin,portalOrigin,loaderUrl:r.loaderUrl});
}
export function parseInstallationRoute(value:unknown):Readonly<{mode:InstallationMode;installationId:string}>{
 if(typeof value!=='string')return fail();const m=/^\/(checkout|embed)\/flow\/([0-9a-f-]{36})$/.exec(value);if(!m)return fail();
 return Object.freeze({mode:m[1]==='checkout'?'hosted':'iframe',installationId:uuid(m[2])});
}
export function parseInstallationMessage(value:unknown):InstallationMessage{
 // Read the discriminator through its own data descriptor, never a getter.
 if(value===null||typeof value!=='object')return fail();const d=Object.getOwnPropertyDescriptor(value,'type');if(!d||!('value'in d))return fail();
 const resize=d.value==='lumin:resize';if(!resize&&d.value!=='lumin:init'&&d.value!=='lumin:ready')return fail();
 const r=record(value,resize?['type','protocolVersion','installationId','instanceId','height']:['type','protocolVersion','installationId','instanceId']);
 if(r.protocolVersion!==1||typeof r.instanceId!=='string'||!/^[0-9a-f]{32}$/.test(r.instanceId))return fail();
 const base={type:d.value as 'lumin:init'|'lumin:ready'|'lumin:resize',protocolVersion:1 as const,installationId:uuid(r.installationId),instanceId:r.instanceId};
 if(resize){if(typeof r.height!=='number'||!Number.isInteger(r.height)||r.height<320||r.height>1600)return fail();const out=Object.freeze({...base,type:'lumin:resize' as const,height:r.height});bounded(out,1024);return out;}
 const out=Object.freeze({...base,type:d.value as 'lumin:init'|'lumin:ready'});bounded(out,1024);return out;
}
function escapeAttribute(value:string):string{return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
/** Registry input comes only from trusted composition, never installation/HTTP request fields. */
export function createInstallationContracts(trustedProfiles:unknown){
 const profiles=list(trustedProfiles,64).map(parseInstallationProfile);
 const registry=new Map<string,InstallationProfile>();for(const profile of profiles){if(registry.has(profile.profileVersion))fail();registry.set(profile.profileVersion,profile);}
 function parsePolicy(value:unknown):InstallationPolicy{
  const r=record(value,['schemaVersion','installationId','mode','deploymentProfileVersion','rendererOrigin','apiOrigin','loaderUrl','currentVersionId','targetRevision','policyRevision','allowedParentOrigins','enabled']);
  const selected=registry.get(version(r.deploymentProfileVersion));if(!selected)return fail();
  const parsedMode=mode(r.mode);
  if(r.schemaVersion!==1||r.rendererOrigin!==selected.rendererOrigin||r.apiOrigin!==selected.apiOrigin||r.loaderUrl!==selected.loaderUrl||typeof r.enabled!=='boolean')return fail();
  const parents=list(r.allowedParentOrigins,20).map(parseInstallationOrigin);
  if(new Set(parents).size!==parents.length||(parsedMode==='hosted'?parents.length!==0:parents.length===0)||parents.some(p=>p===selected.rendererOrigin||p===selected.apiOrigin||p===selected.portalOrigin))return fail();
  const result=Object.freeze({schemaVersion:1 as const,installationId:uuid(r.installationId),mode:parsedMode,deploymentProfileVersion:selected.profileVersion,rendererOrigin:selected.rendererOrigin,apiOrigin:selected.apiOrigin,loaderUrl:selected.loaderUrl,currentVersionId:uuid(r.currentVersionId),targetRevision:revision(r.targetRevision),policyRevision:revision(r.policyRevision),allowedParentOrigins:Object.freeze(parents),enabled:r.enabled});
  bounded(result,16384);return result;
 }
 function composeInstall(value:unknown):InstallationOutput{
  const p=parsePolicy(value);if(!p.enabled)return fail();
  const url=p.rendererOrigin+(p.mode==='hosted'?'/checkout/flow/':'/embed/flow/')+p.installationId;
  if(p.mode==='hosted')return Object.freeze({kind:'hosted',url});
  // This snippet requires the approved loader/controller. It is never a bare iframe claim.
  const html=`<div data-booking-lumin-installation="${escapeAttribute(p.installationId)}" data-booking-lumin-height="640"></div>\n<script src="${escapeAttribute(p.loaderUrl)}" defer></script>`;
  if(encoder.encode(html).byteLength>8192)return fail();
  return Object.freeze({kind:'iframe_loader',url,loaderUrl:p.loaderUrl,html,requiresCompanionController:true});
 }
 return Object.freeze({parsePolicy,composeInstall});
}
