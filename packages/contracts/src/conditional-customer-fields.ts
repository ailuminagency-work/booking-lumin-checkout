import {z} from 'zod';
import {CustomerDraftTextField} from './customer-draft-fields';

function singleLineText(value:string):boolean{
 if(/[\u0000-\u001f\u007f-\u009f]/.test(value))return false;
 for(let i=0;i<value.length;i++){
  const unit=value.charCodeAt(i);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
  else if(unit>=0xdc00&&unit<=0xdfff)return false;
 }
 return true;
}
const additionalReserved=new Set(['amount','pricing','currency','discount','deposit','payment_id','booking_id','user_id','actor','actor_id','provider_state','payment_state']);
const FieldId=CustomerDraftTextField.shape.id.refine(id=>!additionalReserved.has(id.slice(7)),'Reserved customer field');
const Text=z.string().max(1000).refine(singleLineText,'Invalid customer text');

/** Informational text only. Conditions reference an earlier visible custom field,
 * with exact equality and no coercion, executable expression or authority input. */
export const ConditionalCustomerTextField=CustomerDraftTextField.extend({
 id:FieldId,
 label:CustomerDraftTextField.shape.label.refine(singleLineText,'Invalid field label encoding'),
 when:z.object({fieldId:FieldId,equals:Text.refine(value=>value.trim().length>0,'Empty condition')}).strict().optional(),
}).strict();
export type ConditionalCustomerTextField=z.infer<typeof ConditionalCustomerTextField>;
export const ConditionalCustomerFields=z.array(ConditionalCustomerTextField).max(10).superRefine((fields,ctx)=>{
 const earlier=new Map<string,ConditionalCustomerTextField>();
 for(const [index,field] of fields.entries()){
  if(earlier.has(field.id))ctx.addIssue({code:'custom',path:[index,'id'],message:'Duplicate customer field'});
  if(field.when){const source=earlier.get(field.when.fieldId);
   if(!source)ctx.addIssue({code:'custom',path:[index,'when','fieldId'],message:'Condition requires an earlier field'});
   else if(field.when.equals.length>source.maxLength)ctx.addIssue({code:'custom',path:[index,'when','equals'],message:'Condition exceeds source text bound'});
  }
  earlier.set(field.id,field);
 }
});
export type ConditionalCustomerFields=z.infer<typeof ConditionalCustomerFields>;
/** Explicit standalone V3 definition. This does not widen existing drafts or V5. */
export const ConditionalCustomerFieldConfiguration=z.object({schemaVersion:z.literal(3),customerFields:ConditionalCustomerFields}).strict();
export type ConditionalCustomerFieldConfiguration=z.infer<typeof ConditionalCustomerFieldConfiguration>;

const OwnAnswerObject=z.custom<Record<string,unknown>>(value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 if(prototype!==Object.prototype&&prototype!==null)return false;
 const keys=Reflect.ownKeys(value);
 return keys.length<=10&&keys.every(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return typeof key==='string'&&descriptor?.enumerable===true&&'value' in descriptor;});
},'Invalid customer answer object');
export const ConditionalCustomerFieldAnswers=OwnAnswerObject.pipe(z.record(FieldId,Text));
export type ConditionalCustomerFieldAnswers=z.infer<typeof ConditionalCustomerFieldAnswers>;

function evaluate(configurationInput:unknown,answersInput:unknown,requireComplete:boolean){
 const configuration=ConditionalCustomerFieldConfiguration.parse(configurationInput),answers=ConditionalCustomerFieldAnswers.parse(answersInput);
 const known=new Set(configuration.customerFields.map(field=>field.id));
 const invalid=()=>{throw Error('INVALID_CONDITIONAL_CUSTOMER_ANSWER');};
 if(Object.keys(answers).some(id=>!known.has(id)))invalid();
 const visibleFieldIds:string[]=[],visible=new Set<string>(),customerAnswers:ConditionalCustomerFieldAnswers={};
 for(const field of configuration.customerFields){
  const present=Object.hasOwn(answers,field.id),value=answers[field.id];
  const shown=!field.when||(visible.has(field.when.fieldId)&&Object.hasOwn(answers,field.when.fieldId)&&answers[field.when.fieldId]===field.when.equals);
  if(!shown){if(present)invalid();continue;}
  visible.add(field.id);visibleFieldIds.push(field.id);
  if(!present){if(requireComplete&&field.required)invalid();continue;}
  if(value===undefined||value.length>field.maxLength||(requireComplete&&field.required&&value.trim().length===0))invalid();
  customerAnswers[field.id]=value!;
 }
 return{visibleFieldIds,customerAnswers};
}
/** Partial values are allowed for editing. Unknown/hidden values remain rejected;
 * a hidden source never activates descendants. No requiredness is bypassed at submission. */
export function resolveConditionalCustomerFieldVisibility(configuration:unknown,answers:unknown):string[]{return evaluate(configuration,answers,false).visibleFieldIds;}
/** Enforces visible required fields and returns exact provided values in field
 * order. Hidden values are rejected, not silently stripped; optional omission remains. */
export function canonicalizeConditionalCustomerFieldAnswers(configuration:unknown,answers:unknown):ConditionalCustomerFieldAnswers{return evaluate(configuration,answers,true).customerAnswers;}
