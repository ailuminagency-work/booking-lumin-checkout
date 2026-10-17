import {z} from "zod";
import {BusinessTimezone} from "./business-profile";
const Id=z.string().uuid().transform(s=>s.toLowerCase());
const Window=z.object({weekday:z.number().int().min(0).max(6),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(1).max(1440),capacity:z.literal(1)}).strict();
const validWindow=(w:z.infer<typeof Window>)=>w.endMinute>w.startMinute;
const sorted=(windows:readonly z.infer<typeof Window>[])=>windows.every((w,i)=>i===0||w.weekday>windows[i-1]!.weekday);
const Policy=z.object({leadTimeMinutes:z.number().int().min(0).max(10080),horizonDays:z.number().int().min(1).max(30),slotIntervalMinutes:z.union([z.literal(15),z.literal(30),z.literal(60)])}).strict();
export const CreateOfferScheduling=z.object({timezone:BusinessTimezone,windows:z.array(Window.refine(validWindow)).min(1).max(7).refine(sorted),policy:Policy,idempotencyKey:z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/)}).strict();
export type CreateOfferScheduling=z.infer<typeof CreateOfferScheduling>;
export const OfferSchedulingReceipt=z.object({schemaVersion:z.literal(1),tenantId:Id,serviceId:Id,timezone:BusinessTimezone,windows:z.array(Window.extend({id:Id}).refine(validWindow)).min(1).max(7).refine(sorted),policy:Policy.extend({id:Id})}).strict().refine(r=>new Set([r.policy.id,...r.windows.map(w=>w.id)]).size===r.windows.length+1);
export type OfferSchedulingReceipt=z.infer<typeof OfferSchedulingReceipt>;
/** Receipt identity is additional evidence; authored settings must match exactly. */
export function schedulingReceiptMatches(receipt:OfferSchedulingReceipt,input:CreateOfferScheduling):boolean{return receipt.timezone===input.timezone&&receipt.windows.length===input.windows.length&&receipt.windows.every((w,i)=>{const b=input.windows[i]!;return w.weekday===b.weekday&&w.startMinute===b.startMinute&&w.endMinute===b.endMinute&&w.capacity===b.capacity;})&&receipt.policy.leadTimeMinutes===input.policy.leadTimeMinutes&&receipt.policy.horizonDays===input.policy.horizonDays&&receipt.policy.slotIntervalMinutes===input.policy.slotIntervalMinutes;}
