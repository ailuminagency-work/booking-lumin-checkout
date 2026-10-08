import {CustomerDraftFields,CustomerDraftTextField} from '@lumin/contracts';
import {z} from 'zod';
import {PaidSimplePublication,PaidSimpleService} from './paidPublication';

/** Single-line informational text must be representable in PostgreSQL JSONB.
 * Length uses UTF-16 units, matching the persisted draft maxLength contract. */
export function validCustomerFieldText(value:string):boolean{
 if(/[\u0000-\u001f\u007f-\u009f]/.test(value))return false;
 for(let i=0;i<value.length;i++){
  const unit=value.charCodeAt(i);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
  else if(unit>=0xdc00&&unit<=0xdfff)return false;
 }
 return true;
}

/** V5 pins additional customer information separately from catalog selections.
 * This contract does not enable publishing, submit a request, or price answers. */
export const PaidCustomerFieldRender=z.object({
 versionId:z.string().uuid(),renderSchemaVersion:z.literal(5),
 submissionMode:z.literal('paid_customer_field_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),
 service:PaidSimpleService,publication:PaidSimplePublication,
 customerFields:CustomerDraftFields.refine(fields=>fields.every(field=>validCustomerFieldText(field.label)),'Invalid field label encoding'),
}).strict();
export type PaidCustomerFieldRender=z.infer<typeof PaidCustomerFieldRender>;
export const isPaidCustomerFieldRender=(value:unknown):value is PaidCustomerFieldRender=>PaidCustomerFieldRender.safeParse(value).success;

/** Only syntactic bounds here. The installed immutable definitions must also be
 * passed to validatePaidCustomerFieldAnswers before accepting a request. */
export const CustomerFieldAnswers=z.record(CustomerDraftTextField.shape.id,z.string().max(1000).refine(validCustomerFieldText,'Invalid customer text'))
 .refine(answers=>Object.keys(answers).length<=10,'Too many customer answers');
export type CustomerFieldAnswers=z.infer<typeof CustomerFieldAnswers>;

/** Returns exact provided values in publication field order. Optional omission
 * is preserved; whitespace is never silently trimmed into a different answer.
 * No service, tenant, price, or permission fields are produced. */
export function validatePaidCustomerFieldAnswers(renderInput:unknown,answersInput:unknown):CustomerFieldAnswers{
 const render=PaidCustomerFieldRender.parse(renderInput),answers=CustomerFieldAnswers.parse(answersInput);
 const fields=new Map(render.customerFields.map(field=>[field.id,field]));
 if(Object.keys(answers).some(id=>!fields.has(id)))throw Error('INVALID_CUSTOMER_ANSWER');
 const ordered:CustomerFieldAnswers={};
 for(const field of render.customerFields){
  const present=Object.prototype.hasOwnProperty.call(answers,field.id),value=answers[field.id];
  if(!present){if(field.required)throw Error('INVALID_CUSTOMER_ANSWER');continue;}
  if(value===undefined||value.length>field.maxLength||(field.required&&value.trim().length===0))throw Error('INVALID_CUSTOMER_ANSWER');
  ordered[field.id]=value;
 }
 return ordered;
}
