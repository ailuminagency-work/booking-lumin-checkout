import {z} from 'zod';
const reserved=new Set(['name','email','phone','address','service','service_id','tenant','tenant_id','role','price','total','tax','provider','payment','prototype','constructor','__proto__']);
/** Additional informational customer text only. Array position is persisted
 * authoring order; fixed required name/email and priced selections are separate. */
export const CustomerDraftTextField=z.object({
 id:z.string().regex(/^custom_[a-z][a-z0-9_]{0,40}$/).refine(s=>!reserved.has(s.slice(7)),'Reserved customer field'),
 kind:z.literal('text'),label:z.string().min(1).max(100).refine(s=>s===s.trim()&&!/[\u0000-\u001f\u007f-\u009f]/.test(s),'Invalid field label'),
 required:z.boolean(),maxLength:z.number().int().min(1).max(1000),
}).strict();
export type CustomerDraftTextField=z.infer<typeof CustomerDraftTextField>;
export const CustomerDraftFields=z.array(CustomerDraftTextField).max(10).refine(fields=>new Set(fields.map(f=>f.id)).size===fields.length,'Duplicate customer field');
export type CustomerDraftFields=z.infer<typeof CustomerDraftFields>;
