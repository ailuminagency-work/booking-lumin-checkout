import {validatePaidConditionalCustomerFieldAnswers} from '@lumin/workflow';
import {z} from 'zod';

export {SavePaidConditionalCustomerFieldDraft,PaidConditionalCustomerFieldDraft,ConditionalCustomerFieldRequestInput} from './contracts';
import {ConditionalCustomerFieldRequestInput} from './contracts';
export type ConditionalCustomerFieldRequestInput=z.infer<typeof ConditionalCustomerFieldRequestInput>;

/** The render argument is exclusively loaded by session authority. The request
 * cannot replace field definitions, service identity or monetary values. */
export function validateConditionalCustomerFieldRequest(pinnedRender:unknown,input:unknown):ConditionalCustomerFieldRequestInput{
 const request=ConditionalCustomerFieldRequestInput.parse(input);
 return{...request,customerAnswers:validatePaidConditionalCustomerFieldAnswers(pinnedRender,request.customerAnswers)};
}
