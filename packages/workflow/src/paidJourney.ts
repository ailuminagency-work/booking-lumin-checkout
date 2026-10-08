import {z} from 'zod';
import {validCustomerFieldText} from './paidCustomerFieldPublication';

const Identifier=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).refine(value=>!['constructor','prototype','__proto__','hasOwnProperty','toString'].includes(value));
const Label=z.string().min(1).max(80).refine(value=>value.trim().length>0&&validCustomerFieldText(value));
const PrimaryKind=z.enum(['service','options','schedule','information','review_payment','confirmation']);
const Primary=z.object({id:PrimaryKind,kind:PrimaryKind,label:Label,enabled:z.boolean()}).strict().superRefine((stage,ctx)=>{
 if(stage.id!==stage.kind)ctx.addIssue({code:'custom',message:'Primary stage identity must match its kind.'});
 if(stage.kind!=='options'&&!stage.enabled)ctx.addIssue({code:'custom',message:'Mandatory stages cannot be disabled.'});
});
const Informational=z.object({id:Identifier.refine(id=>id.startsWith('informational_')),kind:z.literal('informational'),label:Label,enabled:z.boolean()}).strict();

/** Structural authoring schema only. Publishing additionally requires trusted,
 * server-derived requirements through validatePaidJourney. Never widen V3–V6. */
export const PaidJourney=z.object({schemaVersion:z.literal(1),stages:z.array(z.union([Primary,Informational])).min(6).max(16)}).strict().superRefine((journey,ctx)=>{
 const stages=journey.stages,ids=stages.map(stage=>stage.id);
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(new Set(ids).size!==ids.length)fail('Stage identities must be unique.');
 for(const kind of PrimaryKind.options)if(stages.filter(stage=>stage.kind===kind).length!==1)fail('Every primary stage must appear exactly once.');
 const position=(kind:string)=>stages.findIndex(stage=>stage.kind===kind);
 if(position('service')!==0||position('confirmation')!==stages.length-1)fail('Service must be first and confirmation terminal.');
 if(position('options')<=position('service')||position('options')>=Math.min(position('schedule'),position('information')))fail('Options must precede scheduling and customer information.');
 if(position('review_payment')<=Math.max(position('schedule'),position('information')))fail('Scheduling and customer information must precede review/payment.');
 if(stages.some((stage,index)=>stage.kind==='informational'&&(index<=position('options')||index>=position('review_payment'))))fail('Owner information belongs between options and review/payment.');
 if(new TextEncoder().encode(JSON.stringify(journey)).length>8192)fail('Journey JSON exceeds its bounded size.');
});
export type PaidJourney=z.infer<typeof PaidJourney>;

/** Obtained from pinned catalog/answer/consent definitions, never owner input.
 * An omitted or malformed requirement context is rejected, not inferred safe. */
const Requirements=z.object({optionsRequired:z.boolean(),requiredInformationalStageIds:z.array(Identifier.refine(id=>id.startsWith('informational_'))).max(10)}).strict();
export type PaidJourneyRequirements=z.infer<typeof Requirements>;
export type PaidJourneySnapshot=Readonly<{schemaVersion:1;stages:readonly Readonly<PaidJourney['stages'][number]>[]}>;

/** Presentation ordering grants no request, hold, payment or confirmation
 * capability. Runtime authority gates must remain independent of stage order. */
export function validatePaidJourney(input:unknown,trustedRequirements:PaidJourneyRequirements):PaidJourneySnapshot{
 const requirements=Requirements.parse(trustedRequirements),journey=PaidJourney.parse(input);
 if(new Set(requirements.requiredInformationalStageIds).size!==requirements.requiredInformationalStageIds.length)throw new Error('Duplicate trusted stage requirement.');
 if(requirements.optionsRequired&&!journey.stages.find(stage=>stage.kind==='options')!.enabled)throw new Error('Catalog options cannot be disabled.');
 for(const id of requirements.requiredInformationalStageIds)if(!journey.stages.some(stage=>stage.kind==='informational'&&stage.id===id&&stage.enabled))throw new Error('Required informational or consent stage is missing or disabled.');
 return Object.freeze({schemaVersion:1 as const,stages:Object.freeze(journey.stages.map(stage=>Object.freeze(stage)))});
}
