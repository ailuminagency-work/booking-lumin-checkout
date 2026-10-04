import {z} from "zod";
import {CurrencyCode} from "./money";
const Name=z.string().min(1).max(200).refine(s=>s===s.trim());
const Price=z.object({amount:z.number().int().safe().min(1),currency:CurrencyCode}).strict();
const Duration=z.number().int().min(5).max(1440);
export const CreateSimpleOffer=z.object({name:Name,description:z.string().max(2000),price:Price,durationMinutes:Duration,idempotencyKey:z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/)}).strict();
export type CreateSimpleOffer=z.infer<typeof CreateSimpleOffer>;
export const SimpleOfferReceipt=z.object({schemaVersion:z.literal(1),tenantId:z.string().uuid().transform(s=>s.toLowerCase()),service:z.object({id:z.string().uuid().transform(s=>s.toLowerCase()),name:Name,description:z.string().max(2000),archetype:z.literal("simple"),price:Price,durationMinutes:Duration}).strict()}).strict();
export type SimpleOfferReceipt=z.infer<typeof SimpleOfferReceipt>;
