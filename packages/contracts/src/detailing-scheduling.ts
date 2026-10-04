import {z} from "zod";
import {CreateOfferScheduling,OfferSchedulingReceipt,schedulingReceiptMatches} from "./owner-scheduling";
/** Explicit fixed-capacity schedule; no workers or resource allocator. */
export const CreateDetailingScheduling=CreateOfferScheduling;
export type CreateDetailingScheduling=z.infer<typeof CreateDetailingScheduling>;
export const DetailingSchedulingReceipt=OfferSchedulingReceipt.innerType().extend({businessType:z.literal('AUTO_DETAILING')}).refine(r=>new Set([r.policy.id,...r.windows.map(w=>w.id)]).size===r.windows.length+1);
export type DetailingSchedulingReceipt=z.infer<typeof DetailingSchedulingReceipt>;
export function detailingSchedulingReceiptMatches(receipt:DetailingSchedulingReceipt,input:CreateDetailingScheduling):boolean{return schedulingReceiptMatches(receipt,input);}
