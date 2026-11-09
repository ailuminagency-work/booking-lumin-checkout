import {z} from 'zod';
import {CurrencyCode} from '@lumin/contracts';
/** V3 is a pinned staging test-payment contract, never a legacy question form. */
export const PaidSimpleService=z.object({id:z.string().uuid(),name:z.string().min(1).max(200),durationMinutes:z.number().int().min(5).max(1440),price:z.object({amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),currency:CurrencyCode}).strict()}).strict();
export const PaidSimplePresentation=z.object({accentColor:z.enum(['#4f46e5','#0e7490','#0f766e','#2563eb','#be123c']),layout:z.enum(['stacked','compact'])}).strict();
export const PaidSimplePublication=z.object({name:z.string().min(1).max(200),presentation:PaidSimplePresentation,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict();
export const PaidSimpleRender=z.object({versionId:z.string().uuid(),renderSchemaVersion:z.literal(3),submissionMode:z.literal('paid_service_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),service:PaidSimpleService,publication:PaidSimplePublication.optional()}).strict();
export type PaidSimpleRender=z.infer<typeof PaidSimpleRender>;
export const isPaidSimpleRender=(render:unknown):render is PaidSimpleRender=>PaidSimpleRender.safeParse(render).success;
