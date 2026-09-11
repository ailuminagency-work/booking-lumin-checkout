import {z} from 'zod';
const id=z.string().uuid(),key=z.string().min(1).max(100);
export const Question=z.object({id:key,prompt:z.string().min(1).max(500),kind:z.enum(['single_choice','multi_choice','quantity']),required:z.boolean(),choices:z.array(z.object({id:key,label:z.string().min(1).max(200)}).strict()).max(50),minQty:z.number().int().min(0).max(10000).optional(),maxQty:z.number().int().min(0).max(10000).optional()}).strict();
export const ServiceRender=z.object({id,name:z.string().min(1),durationMinutes:z.number().int().min(5).max(1440),questions:z.array(Question).min(1).max(50)}).strict();
export type ServiceRender=z.infer<typeof ServiceRender>;
export const FlowConfig=z.object({key:z.string().min(1),steps:z.array(z.object({key:z.string().min(1),questionKey:key,kind:z.literal('question'),required:z.boolean()}).strict()).min(1).max(50)}).strict();
export type FlowConfig=z.infer<typeof FlowConfig>;
export const Draft=z.object({flowId:id,name:z.string(),revision:z.number().int().positive(),serviceId:id,config:FlowConfig,service:ServiceRender}).strict();
export type Draft=z.infer<typeof Draft>;
export const FlowList=z.object({flows:z.array(z.object({flowId:id,name:z.string(),status:z.string(),revision:z.number().int().nonnegative(),serviceId:id.nullable(),publishedVersionId:id.nullable()}).strict()).max(100)}).strict();
export type FlowList=z.infer<typeof FlowList>;
export const PinnedRender=z.object({versionId:id,config:FlowConfig,service:ServiceRender}).strict();
export type PinnedRender=z.infer<typeof PinnedRender>;
export type Answers=Record<string,{choiceIds?:string[];quantity?:number}>;
export function orderedQuestions(service:ServiceRender,config:FlowConfig){
 if(config.steps.length!==service.questions.length||new Set(config.steps.map(s=>s.questionKey)).size!==config.steps.length)throw Error('Invalid question configuration');
 return config.steps.map(step=>{const q=service.questions.find(q=>q.id===step.questionKey);if(!q||q.required!==step.required)throw Error('Invalid question configuration');return q;});
}
export function answersValid(service:ServiceRender,config:FlowConfig,answers:Answers){
 try{return orderedQuestions(service,config).every(q=>{const a=Object.hasOwn(answers,q.id)?answers[q.id]:undefined;if(!a)return !q.required;if(q.kind==='quantity')return Number.isInteger(a.quantity)&&a.quantity!>=(q.minQty??0)&&a.quantity!<=(q.maxQty??10000)&&a.choiceIds===undefined;const ids=a.choiceIds??[];return a.quantity===undefined&&(!q.required||ids.length>0)&&(q.kind!=='single_choice'||ids.length<=1)&&new Set(ids).size===ids.length&&ids.every(id=>q.choices.some(c=>c.id===id));})&&Object.keys(answers).every(id=>service.questions.some(q=>q.id===id));}catch{return false;}
}
