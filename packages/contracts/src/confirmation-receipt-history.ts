import {z} from 'zod';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const recordedAt=z.string().min(20).max(27).datetime().refine(value=>Number.isFinite(Date.parse(value)),'Invalid recorded timestamp');
const receipt=z.object({channel:z.enum(['email','sms']),recordedAt}).strict();
/** Persisted successful-send receipt history only; no customer delivery or provider proof. */
export const ConfirmationReceiptHistory=z.object({
 schemaVersion:z.literal(1),tenantId:uuid,bookingId:uuid,
 receipts:z.array(receipt).max(2).refine(rows=>rows.length<2||(rows[0]!.channel==='email'&&rows[1]!.channel==='sms'),'Duplicate or noncanonical receipt order'),
}).strict();
export type ConfirmationReceiptHistory=z.infer<typeof ConfirmationReceiptHistory>;
