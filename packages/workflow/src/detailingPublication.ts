import {z} from 'zod';
import {DetailingCatalog,DetailingPresentation,SaveDetailingDraft} from '@lumin/contracts';
/** Explicit owner-published preview, with no request or financial authority. */
export const DetailingCatalogRender=z.object({versionId:z.string().uuid(),renderSchemaVersion:z.literal(7),businessType:z.literal('AUTO_DETAILING'),submissionMode:z.literal('detailing_quote'),bookingMode:z.literal('unavailable'),paymentMode:z.literal('unavailable'),pricingModel:z.literal('package_subtotal_vehicle_multiplier'),serviceId:z.string().uuid(),catalog:DetailingCatalog,publication:z.object({name:SaveDetailingDraft.shape.name,presentation:DetailingPresentation,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict()}).strict();
export type DetailingCatalogRender=z.infer<typeof DetailingCatalogRender>;
export const isDetailingCatalogRender=(value:unknown):value is DetailingCatalogRender=>DetailingCatalogRender.safeParse(value).success;
