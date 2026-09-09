import { z } from "zod";
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
export const RpcResults={
 flow_owner_services:z.object({services:z.array(ServiceRender).max(100)}).strict(),
 flow_owner_list:z.object({flows:z.array(z.object({flowId:Uuid,name:z.string(),status:z.enum(["draft","active","archived"]),revision:Version,serviceId:Uuid.nullable(),publishedVersionId:Uuid.nullable()}).strict()).max(100)}).strict(),
 flow_owner_draft:Draft,
 flow_owner_requests:z.object({requests:z.array(z.object({id:Uuid,reference:z.string().min(1).max(100),state:z.literal("draft"),slotStart:z.string(),createdAt:z.string()}).strict()).max(100)}).strict(),
 save_bound_flow_draft:z.object({flowId:Uuid,revision:Version}).strict(),
 publish_bound_flow:z.object({versionId:Uuid,installationId:Uuid}).strict(),
 issue_flow_session:z.object({expiresAt:z.string().datetime({offset:true}),render:Render}).strict(),
 submit_flow_request:z.object({reference:z.string().min(1).max(100),state:z.literal("draft"),confirmed:z.literal(false)}).strict(),
};
export type FlowRpc=keyof typeof RpcResults;
