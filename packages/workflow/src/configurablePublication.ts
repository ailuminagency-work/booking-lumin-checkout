import { z } from "zod";
import { QuestionChoice, ServiceQuestion } from "@lumin/contracts";
import { evaluate } from "./conditions";
import type { Answers } from "./types";
import type { DeepReadonly } from "./publication";

const Key=z.string().min(1).max(100).refine(k=>!["__proto__","constructor","prototype"].includes(k));
const Text=z.string().min(1).max(500);
const Quantity=z.number().int().min(0).max(10000);
// No recursion through untrusted accessors/prototypes, and bounded work before Zod.
function bounded(value:unknown):unknown {
 const pending=[value];const seen=new Set<object>();let size=0,nodes=0;
 while(pending.length){const v=pending.pop();if(++nodes>10000)throw new ConfigurablePublicationError("CONFIG_BUDGET");
  if(typeof v==="string")size+=v.length;
  if(v&&typeof v==="object"){
   if(seen.has(v)||(Array.isArray(v)?Object.getPrototypeOf(v)!==Array.prototype:Object.getPrototypeOf(v)!==Object.prototype))throw new ConfigurablePublicationError("INVALID_CONFIG");seen.add(v);
   if(Array.isArray(v)&&v.length>10000)throw new ConfigurablePublicationError("CONFIG_BUDGET");
   const keys=Reflect.ownKeys(v);
   if(keys.length>10001)throw new ConfigurablePublicationError("CONFIG_BUDGET");
   if(Array.isArray(v)&&keys.length!==v.length+1)throw new ConfigurablePublicationError("INVALID_CONFIG");
   for(const key of keys){
    if(typeof key!=="string")throw new ConfigurablePublicationError("INVALID_CONFIG");
    if(Array.isArray(v)&&key==="length")continue;
    size+=key.length;const d=Object.getOwnPropertyDescriptor(v,key);
    if(!d||!("value"in d)||!d.enumerable||(Array.isArray(v)&&! /^(0|[1-9][0-9]*)$/.test(key)))throw new ConfigurablePublicationError("INVALID_CONFIG");
    pending.push(d.value);if(pending.length+nodes>10000)throw new ConfigurablePublicationError("CONFIG_BUDGET");
   }
  }
  if(size>65536)throw new ConfigurablePublicationError("CONFIG_BUDGET");
 }
 return value;
}
const Choice=QuestionChoice.pick({id:true,label:true}).extend({id:Key,label:z.string().min(1).max(200)}).strict();
const Field=ServiceQuestion.pick({id:true,prompt:true,kind:true,required:true,choices:true,minQty:true,maxQty:true}).extend({id:Key,prompt:Text,required:z.boolean(),choices:z.array(Choice).max(50),minQty:Quantity.optional(),maxQty:Quantity.optional()}).strict().superRefine((q,ctx)=>{
 if(new Set(q.choices.map(c=>c.id)).size!==q.choices.length)ctx.addIssue({code:"custom",message:"Duplicate choice"});
 if(q.kind==="quantity"?(q.choices.length>0||q.minQty===undefined||q.maxQty===undefined||q.minQty>q.maxQty):(q.choices.length===0||q.minQty!==undefined||q.maxQty!==undefined))ctx.addIssue({code:"custom",message:"Invalid field bounds"});
});
export const ConfigurableCatalog=z.object({id:z.string().uuid(),name:z.string().min(1).max(200),durationMinutes:z.number().int().min(5).max(1440),questions:z.array(Field).min(1).max(50)}).strict().superRefine((s,ctx)=>{if(new Set(s.questions.map(q=>q.id)).size!==s.questions.length)ctx.addIssue({code:"custom",message:"Duplicate field"});});
export type ConfigurableCatalog=z.infer<typeof ConfigurableCatalog>;
export const ConfigurableVisibility=z.object({field:Key,op:z.enum(["eq","includes"]),value:Key}).strict();
const Step=z.object({key:Key,questionKey:Key,kind:z.literal("question"),required:z.boolean(),visibleWhen:ConfigurableVisibility.optional()}).strict();
const Overrides=z.object({prompt:Text.optional(),choiceLabels:z.record(Key,z.string().min(1).max(200)).optional(),minQty:Quantity.optional(),maxQty:Quantity.optional()}).strict();
export const ConfigurableAuthoringV2=z.object({authoringVersion:z.literal(2),config:z.object({key:z.string().min(1).max(200),steps:z.array(Step).min(1).max(50)}).strict(),questionOverrides:z.record(Key,Overrides)}).strict();
export type ConfigurableAuthoringV2=z.infer<typeof ConfigurableAuthoringV2>;
/** service.questions.required preserves the trusted catalog floor; renderer required state comes from each visible config step.required. */
export interface ConfigurableSnapshotV2 {renderSchemaVersion:2;config:ConfigurableAuthoringV2["config"];service:ConfigurableCatalog;submissionMode:"unconfirmed_request"}
export class ConfigurablePublicationError extends Error {
 constructor(readonly code:"INVALID_CONFIG"|"CONFIG_BUDGET"|"REQUIRED_FLOOR"|"INVALID_OVERRIDE"|"INVALID_DEPENDENCY"|"INVALID_ANSWER"|"HIDDEN_ANSWER"|"MISSING_REQUIRED"){super(code);}
}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(bounded(value));}catch(e){if(e instanceof ConfigurablePublicationError)throw e;throw new ConfigurablePublicationError("INVALID_CONFIG");}}
function freeze<T>(v:T):DeepReadonly<T>{if(v&&typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v as DeepReadonly<T>;}
/** Caller supplies a trusted current catalog; validation is NOT ownership/auth.
 * Returns copied effective fields; never writes catalog or changes a V1 schema.
 */
export function normalizeConfigurablePublication(catalogInput:unknown,authoringInput:unknown):DeepReadonly<{authoring:ConfigurableAuthoringV2;snapshot:ConfigurableSnapshotV2}>{
 const catalog=parse(ConfigurableCatalog,catalogInput),authoring=parse(ConfigurableAuthoringV2,authoringInput);
 const fields=new Map(catalog.questions.map(q=>[q.id,q]));const steps=authoring.config.steps;
 if(new Set(steps.map(s=>s.key)).size!==steps.length||new Set(steps.map(s=>s.questionKey)).size!==steps.length||steps.some(s=>!fields.has(s.questionKey)))throw new ConfigurablePublicationError("INVALID_CONFIG");
 for(const q of catalog.questions)if(q.required){const step=steps.find(s=>s.questionKey===q.id);if(!step||!step.required||step.visibleWhen)throw new ConfigurablePublicationError("REQUIRED_FLOOR");}
 for(const key of Object.keys(authoring.questionOverrides))if(!steps.some(s=>s.questionKey===key))throw new ConfigurablePublicationError("INVALID_OVERRIDE");
 steps.forEach((s,i)=>{if(!s.visibleWhen)return;const c=s.visibleWhen;const sourceIndex=steps.findIndex(x=>x.questionKey===c.field);const source=steps[sourceIndex];const q=fields.get(c.field);
  if(sourceIndex<0||sourceIndex>=i||source?.visibleWhen||!q||q.kind!==(c.op==="eq"?"single_choice":"multi_choice")||!q.choices.some(x=>x.id===c.value))throw new ConfigurablePublicationError("INVALID_DEPENDENCY");
 });
 const effective=steps.map(s=>{
  const q=fields.get(s.questionKey)!;const override=authoring.questionOverrides[q.id]??{};
  if(override.choiceLabels&&Object.keys(override.choiceLabels).some(key=>!q.choices.some(c=>c.id===key)))throw new ConfigurablePublicationError("INVALID_OVERRIDE");
  if(q.kind!=="quantity"&&(override.minQty!==undefined||override.maxQty!==undefined)||q.kind==="quantity"&&override.choiceLabels!==undefined)throw new ConfigurablePublicationError("INVALID_OVERRIDE");
  const min=override.minQty??q.minQty,max=override.maxQty??q.maxQty;
  if(q.kind==="quantity"&&(min!<q.minQty!||max!>q.maxQty!||min!>max!))throw new ConfigurablePublicationError("INVALID_OVERRIDE");
  return {...q,prompt:override.prompt??q.prompt,choices:q.choices.map(c=>({id:c.id,label:override.choiceLabels?.[c.id]??c.label})),...(q.kind==="quantity"?{minQty:min,maxQty:max}:{})};
 });
 // Deterministic key insertion order for fixtures; SQL compares JSON structurally.
 const overrides=Object.fromEntries(Object.entries(authoring.questionOverrides).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,o])=>[key,{...(o.prompt!==undefined?{prompt:o.prompt}:{}),...(o.choiceLabels?{choiceLabels:Object.fromEntries(Object.entries(o.choiceLabels).sort(([a],[b])=>a<b?-1:a>b?1:0))}:{}),...(o.minQty!==undefined?{minQty:o.minQty}:{}),...(o.maxQty!==undefined?{maxQty:o.maxQty}:{})}]));
 return freeze({authoring:{...authoring,questionOverrides:overrides},snapshot:{renderSchemaVersion:2 as const,config:authoring.config,service:{...catalog,questions:effective},submissionMode:"unconfirmed_request" as const}});
}
const Answer=z.union([z.object({quantity:Quantity}).strict(),z.object({choiceIds:z.array(Key).min(1).max(50)}).strict()]);
/** Strict server parity function. Hidden/omitted answers reject; UI must remove
 * stale answers after upstream changes before sending a request. Snapshot must
 * come from authorized immutable storage, not the request body.
 */
export function validateConfigurableAnswers(snapshotInput:unknown,answersInput:unknown):DeepReadonly<Record<string,{quantity:number}|{choiceIds:string[]}>>{
 const shape=z.object({renderSchemaVersion:z.literal(2),config:ConfigurableAuthoringV2.shape.config,service:ConfigurableCatalog,submissionMode:z.literal("unconfirmed_request")}).strict();
 const raw=parse(shape,snapshotInput);
 const snapshot=normalizeConfigurablePublication(raw.service,{authoringVersion:2,config:raw.config,questionOverrides:{}}).snapshot;
 let answers:Record<string,z.infer<typeof Answer>>;try{answers=z.record(Key,Answer).parse(bounded(answersInput));}catch{throw new ConfigurablePublicationError("INVALID_ANSWER");}
 const known=new Set(snapshot.config.steps.map(s=>s.questionKey));if(Object.keys(answers).some(k=>!known.has(k)))throw new ConfigurablePublicationError("INVALID_ANSWER");
 const flattened:Answers={};const normalized:Record<string,z.infer<typeof Answer>>={};
 for(const step of snapshot.config.steps){const q=snapshot.service.questions.find(q=>q.id===step.questionKey)!;const a=answers[q.id];
  const visible=!step.visibleWhen||evaluate(step.visibleWhen,flattened);if(!visible){if(a!==undefined)throw new ConfigurablePublicationError("HIDDEN_ANSWER");continue;}
  if(a===undefined){if(step.required)throw new ConfigurablePublicationError("MISSING_REQUIRED");continue;}
  if(q.kind==="quantity"){
   if(!("quantity"in a)||a.quantity<q.minQty!||a.quantity>q.maxQty!)throw new ConfigurablePublicationError("INVALID_ANSWER");normalized[q.id]={quantity:a.quantity};flattened[q.id]=a.quantity;
  }else{
   if(!("choiceIds"in a)||new Set(a.choiceIds).size!==a.choiceIds.length||(q.kind==="single_choice"&&a.choiceIds.length!==1)||a.choiceIds.some(id=>!q.choices.some(c=>c.id===id)))throw new ConfigurablePublicationError("INVALID_ANSWER");
   const ids=q.choices.filter(c=>a.choiceIds.includes(c.id)).map(c=>c.id);normalized[q.id]={choiceIds:ids};flattened[q.id]=q.kind==="single_choice"?ids[0]:ids;
  }
 }
 return freeze(normalized);
}
