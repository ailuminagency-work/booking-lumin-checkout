import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { ConfigurableAuthoringV2, ConfigurableCatalog, normalizeConfigurablePublication } from "@lumin/workflow";
export const Uuid=z.string().uuid();
const Key=z.string().min(1).max(100).refine(s=>!["__proto__","prototype","constructor"].includes(s),"Reserved field identifier");
const Version=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const BoundConfig=z.object({key:z.string().min(1).max(200),steps:z.array(z.object({key:Key,questionKey:Key,kind:z.literal("question").default("question"),required:z.boolean().default(false)}).strict()).min(1).max(50)}).strict().superRefine((c,ctx)=>{
 for(const key of ["key","questionKey"] as const)if(new Set(c.steps.map(s=>s[key])).size!==c.steps.length)ctx.addIssue({code:"custom",message:"Duplicate step reference"});
});
export const ServiceRender=z.object({id:Uuid,name:z.string().min(1).max(200),durationMinutes:z.number().int().min(5).max(1440),questions:z.array(z.object({id:Key,prompt:z.string().min(1).max(500),kind:z.enum(["single_choice","multi_choice","quantity"]),required:z.boolean(),choices:z.array(z.object({id:Key,label:z.string().min(1).max(200)}).strict()).max(50),minQty:z.number().int().min(0).max(10000).optional(),maxQty:z.number().int().min(0).max(10000).optional()}).strict()).min(1).max(50)}).strict();
export const Origin=z.string().max(2048).refine(s=>{try{const u=new URL(s);return u.protocol==="https:"&&u.origin===s;}catch{return false;}});
export const SaveDraft=z.object({expectedRevision:Version,serviceId:Uuid,name:z.string().trim().min(1).max(200),config:BoundConfig}).strict();
export const PublishDraft=z.object({expectedRevision:Version.refine(n=>n>0),allowedOrigins:z.array(Origin).min(1).max(20)}).strict();
export const RequestInput=z.object({idempotencyKey:z.string().min(16).max(128),answers:z.record(Key,z.union([z.object({quantity:z.number().int().min(0).max(10000)}).strict(),z.object({choiceIds:z.array(Key).max(50).refine(v=>new Set(v).size===v.length)}).strict()])).refine(v=>Object.keys(v).length<=50),customer:z.object({name:z.string().trim().min(1).max(200),email:z.string().trim().email().max(254)}).strict(),requestedStart:z.string().datetime({offset:true}).transform(s=>new Date(s).toISOString())}).strict();
const Draft=z.object({flowId:Uuid,name:z.string(),revision:Version,serviceId:Uuid,config:BoundConfig,service:ServiceRender}).strict();
const Render=z.object({versionId:Uuid,config:BoundConfig,service:ServiceRender}).strict();
// V2 is explicit; no permissive legacy fallback when a stored marker is present.
export const SaveConfigurableDraft=z.object({expectedRevision:Version,serviceId:Uuid,name:z.string().trim().min(1).max(200),authoring:ConfigurableAuthoringV2}).strict();
const ConfigurableRender=z.object({versionId:Uuid,renderSchemaVersion:z.literal(2),config:ConfigurableAuthoringV2.shape.config,service:ConfigurableCatalog,submissionMode:z.literal("unconfirmed_request")}).strict().superRefine((v,ctx)=>{
 try{const normalized=normalizeConfigurablePublication(v.service,{authoringVersion:2,config:v.config,questionOverrides:{}});if(!isDeepStrictEqual(normalized.snapshot.service,v.service))throw Error();}catch{ctx.addIssue({code:"custom",message:"Invalid pinned configuration"});}
});
const ConfigurableDraft=z.object({flowId:Uuid,name:z.string().min(1).max(200),revision:Version,serviceId:Uuid,authoring:ConfigurableAuthoringV2,effectiveService:ConfigurableCatalog}).strict().superRefine((v,ctx)=>{
 try{if(v.serviceId!==v.effectiveService.id)throw Error();const normalized=normalizeConfigurablePublication(v.effectiveService,v.authoring);if(!isDeepStrictEqual(normalized.snapshot.service,v.effectiveService))throw Error();}catch{ctx.addIssue({code:"custom",message:"Invalid effective configuration"});}
});
const FlowList=z.object({flows:z.array(z.object({flowId:Uuid,name:z.string(),status:z.enum(["draft","active","archived"]),revision:Version,serviceId:Uuid.nullable(),publishedVersionId:Uuid.nullable()}).strict()).max(100)}).strict();
/** PostgreSQL text/JSONB cannot represent NUL or isolated UTF-16 surrogates.
 * V2 HTTP boundary only; the pure JS contract has a broader string domain. */
export function postgresV2Strings(value:unknown):boolean{
 const pending=[value];while(pending.length){const v=pending.pop();if(typeof v==="string"){
  for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c===0)return false;if(c>=0xd800&&c<=0xdbff){const next=v.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}
 }else if(v&&typeof v==="object"){for(const [k,x] of Object.entries(v)){pending.push(k,x);}}}return true;
}
export const RpcResults={
 flow_owner_services:z.object({services:z.array(ServiceRender).max(100)}).strict(),
 flow_owner_list:FlowList,
 flow_owner_configurable_list:FlowList,
 get_configurable_flow_draft:ConfigurableDraft,
 save_configurable_flow_draft:z.object({flowId:Uuid,revision:Version,authoringVersion:z.literal(2)}).strict(),
 publish_configurable_flow:z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(2)}).strict(),
 flow_owner_draft:Draft,
 flow_owner_requests:z.object({requests:z.array(z.object({id:Uuid,reference:z.string().min(1).max(100),state:z.literal("draft"),slotStart:z.string(),createdAt:z.string()}).strict()).max(100)}).strict(),
 save_bound_flow_draft:z.object({flowId:Uuid,revision:Version}).strict(),
 publish_bound_flow:z.object({versionId:Uuid,installationId:Uuid}).strict(),
 issue_flow_session:z.object({expiresAt:z.string().datetime({offset:true}),render:z.union([Render,ConfigurableRender])}).strict(),
 submit_flow_request:z.object({reference:z.string().min(1).max(100),state:z.literal("draft"),confirmed:z.literal(false)}).strict(),
};
export type FlowRpc=keyof typeof RpcResults;
