import {z} from 'zod';
import {ConfigurableAuthoringV2,ConfigurableCatalog,normalizeConfigurablePublication,validateConfigurableAnswers} from '@lumin/workflow';
import {type Answers,PinnedRender} from './types';
export {ConfigurableAuthoringV2,normalizeConfigurablePublication};
export const ConfigurableDraft=z.object({flowId:z.string().uuid(),revision:z.number().int().positive(),serviceId:z.string().uuid(),name:z.string(),authoring:ConfigurableAuthoringV2,effectiveService:ConfigurableCatalog}).strict();
export const ConfigurableRender=z.object({versionId:z.string().uuid(),renderSchemaVersion:z.literal(2),config:ConfigurableAuthoringV2.shape.config,service:ConfigurableCatalog,submissionMode:z.literal('unconfirmed_request')}).strict().superRefine((v,ctx)=>{try{normalizeConfigurablePublication(v.service,{authoringVersion:2,config:v.config,questionOverrides:{}});}catch{ctx.addIssue({code:'custom',message:'Invalid configuration'});}});
export type ConfigurableRender=z.infer<typeof ConfigurableRender>;
export const SessionRender=z.union([PinnedRender,ConfigurableRender]);
export type SessionRender=z.infer<typeof SessionRender>;
export const isConfigurable=(render:SessionRender):render is ConfigurableRender=>'renderSchemaVersion' in render&&render.renderSchemaVersion===2;
export function visibleSteps(render:ConfigurableRender,answers:Answers){return render.config.steps.filter(step=>{const rule=step.visibleWhen;if(!rule)return true;const a=Object.hasOwn(answers,rule.field)?answers[rule.field]:undefined;return rule.op==='eq'?a?.choiceIds?.length===1&&a.choiceIds[0]===rule.value:a?.choiceIds?.includes(rule.value)===true;});}
export function clearHiddenAnswers(render:ConfigurableRender,answers:Answers):Answers{const visible=new Set(visibleSteps(render,answers).map(s=>s.questionKey));return Object.fromEntries(Object.entries(answers).filter(([key])=>visible.has(key)));}
export function canonicalConfigurableAnswers(render:ConfigurableRender,answers:Answers):Answers{const {versionId:_,...snapshot}=render;return structuredClone(validateConfigurableAnswers(snapshot,{...answers})) as Answers;}
