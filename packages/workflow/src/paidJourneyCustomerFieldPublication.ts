import {z} from 'zod';
import {ConditionalCustomerFields,ConditionalCustomerTextField,canonicalizeConditionalCustomerFieldAnswers,resolveConditionalCustomerFieldVisibility} from '@lumin/contracts';
import {PaidJourney,validatePaidJourney} from './paidJourney';
import {PaidSimpleService,PaidSimplePresentation} from './paidPublication';
import {validCustomerFieldText} from './paidCustomerFieldPublication';

type Immutable<T>=T extends readonly (infer Item)[]?readonly Immutable<Item>[]:T extends object?{readonly [Key in keyof T]:Immutable<T[Key]>}:T;
function immutable<T>(value:T):Immutable<T>{if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value as Immutable<T>;}
const bounded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length<=24576;
/** Reject executable property access and non-JSON identity before Zod reads
 * values. Input parsing must not run getters or accept inherited definitions. */
const DataOnly=z.custom<unknown>(input=>{
 const seen=new Set<object>();let count=0;
 const visit=(value:unknown,depth:number):boolean=>{
  if(++count>2048||depth>24)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(!value||typeof value!=='object'||seen.has(value))return false;
  const prototype=Object.getPrototypeOf(value);if(Array.isArray(value)?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)return false;
  seen.add(value);
  for(const key of Reflect.ownKeys(value)){if(Array.isArray(value)&&key==='length')continue;const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!descriptor||!descriptor.enumerable||!('value' in descriptor)||!visit(descriptor.value,depth+1))return false;}
  seen.delete(value);return true;
 };return visit(input,0);
},'Expected plain data-only JSON.');
const canonicalUuid=z.string().uuid().refine(value=>value===value.toLowerCase(),'Expected a canonical published identity.');
const Service=PaidSimpleService.refine(service=>service.id===service.id.toLowerCase()&&service.name.trim().length>0&&validCustomerFieldText(service.name),'Invalid pinned service identity or name.');
const FieldBinding=z.object({fieldId:ConditionalCustomerTextField.shape.id,stageId:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)}).strict();

/** Authoring structure only. Bind each immutable informational field exactly
 * once, in declared field order and forward journey order. No priced effects. */
export const PaidJourneyCustomerFieldForm=DataOnly.pipe(z.object({
 name:z.string().min(1).max(200).refine(value=>value===value.trim()&&validCustomerFieldText(value),'Invalid published form name.'),
 presentation:PaidSimplePresentation,journey:PaidJourney,customerFields:ConditionalCustomerFields,
 fieldBindings:z.array(FieldBinding).max(10),
}).strict().superRefine((form,ctx)=>{
 const fail=(message:string)=>ctx.addIssue({code:'custom',message});
 if(form.fieldBindings.length!==form.customerFields.length)fail('Every declared field requires exactly one stage binding.');
 const stages=new Map(form.journey.stages.map((stage,index)=>[stage.id,{stage,index}])),positions=new Map<string,number>(),boundStages=new Set<string>();let previous=-1;
 for(const [index,binding] of form.fieldBindings.entries()){
  if(binding.fieldId!==form.customerFields[index]?.id||positions.has(binding.fieldId))fail('Bindings must match unique declared fields in their declared order.');
  const selected=stages.get(binding.stageId);
  if(!selected||!selected.stage.enabled||!['information','informational'].includes(selected.stage.kind)){fail('Fields require an enabled customer information stage.');continue;}
  if(selected.index<previous)fail('Bound field order cannot run backwards through the journey.');previous=selected.index;positions.set(binding.fieldId,selected.index);boundStages.add(binding.stageId);
 }
 for(const stage of form.journey.stages)if(stage.kind==='informational'&&stage.enabled&&!boundStages.has(stage.id))fail('Enabled informational stages require real immutable field definitions.');
 for(const field of form.customerFields)if(field.when){const source=positions.get(field.when.fieldId),dependent=positions.get(field.id);if(source===undefined||dependent===undefined||source>dependent)fail('A condition source must be scheduled before or with its dependent field.');}
 if(!bounded(form))fail('Form JSON exceeds its bounded size.');
})).transform(immutable);
export type PaidJourneyCustomerFieldForm=z.infer<typeof PaidJourneyCustomerFieldForm>;
const shape={renderSchemaVersion:z.literal(9),submissionMode:z.literal('paid_journey_customer_field_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),service:Service,form:PaidJourneyCustomerFieldForm};

/** Additive V9 snapshot. Parsing pins definitions and presentation but confers
 * no publication, reservation, pricing, eligibility or payment capability. */
export const PaidJourneyCustomerFieldPublicationSnapshot=DataOnly.pipe(z.object(shape).strict().refine(bounded,'Publication JSON exceeds its bounded size.')).transform(immutable);
export type PaidJourneyCustomerFieldPublicationSnapshot=z.infer<typeof PaidJourneyCustomerFieldPublicationSnapshot>;
export const PaidJourneyCustomerFieldRender=DataOnly.pipe(z.object({...shape,versionId:canonicalUuid}).strict().refine(bounded,'Render JSON exceeds its bounded size.')).transform(immutable);
export type PaidJourneyCustomerFieldRender=z.infer<typeof PaidJourneyCustomerFieldRender>;

/** Server-only comparison: independently load the compatible simple catalog.
 * Owner definitions and customer answers can never establish trusted prices. */
export function validatePaidJourneyCustomerFieldSnapshotAgainstServerCatalog(value:unknown,trustedServerService:unknown):PaidJourneyCustomerFieldPublicationSnapshot{
 const trusted=Service.parse(trustedServerService),snapshot=PaidJourneyCustomerFieldPublicationSnapshot.parse(value),service=snapshot.service;
 if(service.id!==trusted.id||service.name!==trusted.name||service.durationMinutes!==trusted.durationMinutes||service.price.amount!==trusted.price.amount||service.price.currency!==trusted.price.currency)throw Error('Published service does not match the trusted server catalog.');
 const required=new Set(snapshot.form.customerFields.filter(field=>field.required).map(field=>snapshot.form.fieldBindings.find(binding=>binding.fieldId===field.id)!.stageId).filter(id=>id!=='information'));
 validatePaidJourney(snapshot.form.journey,{optionsRequired:false,requiredInformationalStageIds:[...required]});return snapshot;
}
/** Definitions must come from the immutable server-loaded V9 render. Hidden,
 * unknown and authority-bearing answers fail; exact text/order are preserved. */
export function validatePaidJourneyCustomerFieldAnswers(renderInput:unknown,answersInput:unknown):Readonly<Record<string,string>>{
 const render=PaidJourneyCustomerFieldRender.parse(renderInput);
 return Object.freeze(canonicalizeConditionalCustomerFieldAnswers({schemaVersion:3,customerFields:render.form.customerFields},answersInput));
}
/** Partial preview values permit editing only. No submission capability. */
export function resolvePaidJourneyCustomerFieldVisibility(renderInput:unknown,answersInput:unknown):readonly string[]{
 const render=PaidJourneyCustomerFieldRender.parse(renderInput);
 return Object.freeze(resolveConditionalCustomerFieldVisibility({schemaVersion:3,customerFields:render.form.customerFields},answersInput));
}
