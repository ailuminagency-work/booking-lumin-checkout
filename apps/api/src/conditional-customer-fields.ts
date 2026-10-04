import {ConditionalCustomerFields,ConditionalCustomerFieldAnswers} from '@lumin/contracts';
import {validatePaidConditionalCustomerFieldAnswers} from '@lumin/workflow';
import {z} from 'zod';
import {RequestInput,SavePaidSimpleDraft,Uuid,postgresV2Strings} from './contracts';

/** Separate versioned boundaries. Existing RPCs/routes remain closed until the
 * matching database publication/session/provenance authority is installed. */
export const SavePaidConditionalCustomerFieldDraft=SavePaidSimpleDraft.extend({schemaVersion:z.literal(3),customerFields:ConditionalCustomerFields}).strict().refine(postgresV2Strings,'Invalid database text');
export type SavePaidConditionalCustomerFieldDraft=z.infer<typeof SavePaidConditionalCustomerFieldDraft>;
export const PaidConditionalCustomerFieldDraft=SavePaidSimpleDraft.omit({expectedRevision:true}).extend({
 schemaVersion:z.literal(3),customerFields:ConditionalCustomerFields,flowId:Uuid,
 revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict().refine(postgresV2Strings,'Invalid database text');
export const ConditionalCustomerFieldRequestInput=RequestInput.extend({
 schemaVersion:z.literal(3),answers:z.object({}).strict(),customerAnswers:ConditionalCustomerFieldAnswers,
}).strict().refine(postgresV2Strings,'Invalid database text');
export type ConditionalCustomerFieldRequestInput=z.infer<typeof ConditionalCustomerFieldRequestInput>;

/** The render argument is exclusively loaded by session authority. The request
 * cannot replace field definitions, service identity or monetary values. */
export function validateConditionalCustomerFieldRequest(pinnedRender:unknown,input:unknown):ConditionalCustomerFieldRequestInput{
 const request=ConditionalCustomerFieldRequestInput.parse(input);
 return{...request,customerAnswers:validatePaidConditionalCustomerFieldAnswers(pinnedRender,request.customerAnswers)};
}
