import {z} from 'zod';
import {CurrencyCode} from '@lumin/contracts';
/** V3 is a pinned staging test-payment contract, never a legacy question form. */
export const PaidSimpleService=z.object({id:z.string().uuid(),name:z.string().min(1).max(200),durationMinutes:z.number().int().min(5).max(1440),price:z.object({amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:CurrencyCode}).strict()}).strict();
export const PaidSimpleRender=z.object({versionId:z.string().uuid(),renderSchemaVersion:z.literal(3),submissionMode:z.literal('paid_service_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),service:PaidSimpleService}).strict();
export type PaidSimpleRender=z.infer<typeof PaidSimpleRender>;
export const isPaidSimpleRender=(render:unknown):render is PaidSimpleRender=>PaidSimpleRender.safeParse(render).success;
