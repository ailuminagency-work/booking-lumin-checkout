import {ConditionalCustomerFields,canonicalizeConditionalCustomerFieldAnswers} from '@lumin/contracts';
import {z} from 'zod';
import {PaidSimplePublication,PaidSimpleService} from './paidPublication';

/** V6 is informational only. It must not be accepted by a legacy V5 route. */
export const PaidConditionalCustomerFieldRender=z.object({
 versionId:z.string().uuid(),renderSchemaVersion:z.literal(6),
 submissionMode:z.literal('paid_conditional_customer_field_request'),
 paymentMode:z.literal('staging_mock'),simulated:z.literal(true),
 service:PaidSimpleService,publication:PaidSimplePublication,
 customerFields:ConditionalCustomerFields,
}).strict();
export type PaidConditionalCustomerFieldRender=z.infer<typeof PaidConditionalCustomerFieldRender>;
export const isPaidConditionalCustomerFieldRender=(input:unknown):input is PaidConditionalCustomerFieldRender=>PaidConditionalCustomerFieldRender.safeParse(input).success;

/** Validate using the immutable server-loaded render, never client definitions.
 * Return exact values in pinned order; hidden answers fail rather than disappear. */
export function validatePaidConditionalCustomerFieldAnswers(renderInput:unknown,answersInput:unknown):Record<string,string>{
 const render=PaidConditionalCustomerFieldRender.parse(renderInput);
 return canonicalizeConditionalCustomerFieldAnswers({schemaVersion:3,customerFields:render.customerFields},answersInput);
}
