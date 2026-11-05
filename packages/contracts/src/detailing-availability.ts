import {z} from 'zod';
import {Slot} from './availability';
import {BusinessTimezone} from './business-profile';

const Instant=z.string().datetime().refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v);
const Id=z.string().uuid().regex(/^[0-9a-f-]+$/);
export const DetailingAvailabilityQuery=z.object({from:Instant,to:Instant}).strict().refine(q=>{
 const range=Date.parse(q.to)-Date.parse(q.from);
 return range>0&&range<=7*86400000;
});
export type DetailingAvailabilityQuery=z.infer<typeof DetailingAvailabilityQuery>;
export const DetailingAvailabilityReceipt=z.object({
 schemaVersion:z.literal(1),versionId:Id,installationId:Id,serviceId:Id,
 expiresAt:z.string().datetime({offset:true}),durationMinutes:z.number().int().min(5).max(1440),timezone:BusinessTimezone,
 slots:z.array(Slot.extend({start:Instant,end:Instant,remainingCapacity:z.literal(1)}).strict()).max(672),
}).strict().refine(r=>r.slots.every((s,i)=>Date.parse(s.end)-Date.parse(s.start)===r.durationMinutes*60000&&
 (i===0||Date.parse(r.slots[i-1]!.start)<Date.parse(s.start))));
export type DetailingAvailabilityReceipt=z.infer<typeof DetailingAvailabilityReceipt>;
