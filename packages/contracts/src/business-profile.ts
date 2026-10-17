import {z} from "zod";
import {CurrencyCode} from "./money";
export const BusinessType=z.enum(["HOUSEKEEPING","AUTO_DETAILING","VEHICLE_RENTAL","EQUIPMENT_RENTAL","EVENT_RENTAL","JUNK_REMOVAL"]);
export type BusinessType=z.infer<typeof BusinessType>;
/** A named IANA zone; offsets and ambiguous timezone abbreviations are excluded. */
export const BusinessTimezone=z.string().max(100).regex(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/).refine(zone=>{try{new Intl.DateTimeFormat("en",{timeZone:zone});return true;}catch{return false;}},"Unknown IANA timezone");
export const CreateBusiness=z.object({name:z.string().min(1).max(200).refine(s=>s===s.trim()),slug:z.string().min(2).max(100).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),timezone:BusinessTimezone,currency:CurrencyCode,businessType:BusinessType,idempotencyKey:z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/)}).strict();
export type CreateBusiness=z.infer<typeof CreateBusiness>;
export const InitializeBusinessProfile=CreateBusiness.pick({businessType:true,idempotencyKey:true}).strict();
export type InitializeBusinessProfile=z.infer<typeof InitializeBusinessProfile>;
export const BusinessProfile=z.object({schemaVersion:z.literal(1),tenantId:z.string().uuid().transform(s=>s.toLowerCase()),businessType:BusinessType,templateVersion:z.literal(1)}).strict();
export type BusinessProfile=z.infer<typeof BusinessProfile>;
