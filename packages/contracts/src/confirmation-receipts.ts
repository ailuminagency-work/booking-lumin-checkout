import {z} from 'zod';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const channel=(name:'email'|'sms')=>z.object({channel:z.literal(name),receiptRecorded:z.boolean()}).strict();
/** Receipt existence only. Not send status, delivery proof, provider identity or a timestamp. */
export const ConfirmationReceiptStatus=z.object({schemaVersion:z.literal(1),tenantId:uuid,bookingId:uuid,channels:z.tuple([channel('email'),channel('sms')])}).strict();
export type ConfirmationReceiptStatus=z.infer<typeof ConfirmationReceiptStatus>;
