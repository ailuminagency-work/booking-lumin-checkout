import {z} from 'zod';
import {PaidSimpleService} from './paidPublication';
const Key=z.string().min(1).max(100).refine(s=>!['__proto__','prototype','constructor'].includes(s));
export const PaidOptionQuestion=z.object({id:Key,prompt:z.string().min(1).max(500),kind:z.literal('single_choice'),required:z.literal(true),choices:z.array(z.object({id:Key,label:z.string().min(1).max(200)}).strict()).min(2).max(10)}).strict().refine(q=>new Set(q.choices.map(c=>c.id)).size===q.choices.length);
export const PaidOptionService=PaidSimpleService.extend({questions:z.tuple([PaidOptionQuestion])}).strict();
/** V4 explicitly supports one catalog-pinned, required, price-neutral choice. */
export const PaidOptionRender=z.object({versionId:z.string().uuid(),renderSchemaVersion:z.literal(4),submissionMode:z.literal('paid_option_request'),paymentMode:z.literal('staging_mock'),simulated:z.literal(true),service:PaidOptionService}).strict();
export type PaidOptionRender=z.infer<typeof PaidOptionRender>;
export const isPaidOptionRender=(v:unknown):v is PaidOptionRender=>PaidOptionRender.safeParse(v).success;
export const PaidOptionSelection=z.object({serviceId:z.string().uuid(),answers:z.record(Key,z.object({choiceIds:z.tuple([Key])}).strict()).refine(a=>Object.keys(a).length===1)}).strict();
export function validatePaidOptionAnswers(serviceInput:unknown,answers:unknown){const service=PaidOptionService.parse(serviceInput),q=service.questions[0];const selection=PaidOptionSelection.parse({serviceId:service.id,answers});if(Object.keys(selection.answers)[0]!==q.id||!q.choices.some(c=>c.id===selection.answers[q.id]!.choiceIds[0]))throw new Error('INVALID_ANSWER');return selection;}
