import {z} from 'zod';
import {CreateDetailingOffer} from './detailing-catalog';
import {PriceBreakdown} from './pricing';
const Id=z.string().uuid().transform(s=>s.toLowerCase());
const Revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const DetailingPresentation=z.object({accentColor:z.enum(['#4f46e5','#0e7490','#0f766e','#2563eb','#be123c']),layout:z.enum(['stacked','compact'])}).strict();
/** Menu rates describe the pinned owner catalog. They are never a checkout quote. */
export const DetailingCatalog=CreateDetailingOffer.innerType().omit({idempotencyKey:true}).strict().refine(c=>CreateDetailingOffer.safeParse({...c,idempotencyKey:'catalog-validation-0001'}).success);
export const SaveDetailingDraft=z.object({expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),serviceId:Id,name:CreateDetailingOffer.innerType().shape.name,presentation:DetailingPresentation}).strict();
export type SaveDetailingDraft=z.infer<typeof SaveDetailingDraft>;
export const DetailingDraft=SaveDetailingDraft.omit({expectedRevision:true}).extend({schemaVersion:z.literal(1),businessType:z.literal('AUTO_DETAILING'),flowId:Id,revision:Revision}).strict();
export type DetailingDraft=z.infer<typeof DetailingDraft>;
export const PublishDetailingDraft=z.object({expectedDraftRevision:Revision,allowedOrigins:z.array(z.string().max(2048).refine(s=>{try{const u=new URL(s);return u.protocol==='https:'&&u.origin===s;}catch{return false;}})).min(1).max(20).refine(a=>new Set(a).size===a.length)}).strict();
export type PublishDetailingDraft=z.infer<typeof PublishDetailingDraft>;
export const DetailingPublicationReceipt=z.object({flowId:Id,draftRevision:Revision,publication:z.object({versionId:Id,installationId:Id,renderSchemaVersion:z.literal(7),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`)}).strict();
export type DetailingPublicationReceipt=z.infer<typeof DetailingPublicationReceipt>;

const CatalogKey=CreateDetailingOffer.innerType().shape.packages.element.shape.id;
export const DetailingQuoteInput=z.object({packageId:CatalogKey,vehicleId:CatalogKey,addonIds:z.array(CatalogKey).max(5).refine(a=>new Set(a).size===a.length),locationId:CatalogKey.optional()}).strict();
export type DetailingQuoteInput=z.infer<typeof DetailingQuoteInput>;

const StrictMoney=PriceBreakdown.shape.total.strict();
const QuotePricing=PriceBreakdown.extend({lines:z.array(PriceBreakdown.shape.lines.element.extend({amount:StrictMoney,quantity:z.number().int().safe().min(1)}).strict()).max(20),subtotal:StrictMoney,tax:StrictMoney,deposit:StrictMoney,total:StrictMoney}).strict();
export const DetailingQuoteReceipt=z.object({schemaVersion:z.literal(1),versionId:Id,installationId:Id,serviceId:Id,expiresAt:z.string().datetime({offset:true}),pricingModel:z.literal('package_subtotal_vehicle_multiplier'),selection:DetailingQuoteInput,pricing:QuotePricing,bookingMode:z.literal('unavailable'),paymentMode:z.literal('unavailable')}).strict().refine(r=>r.pricing.tax.amount===0&&r.pricing.deposit.amount===0&&r.pricing.total.amount===r.pricing.subtotal.amount&&[r.pricing.subtotal,r.pricing.tax,r.pricing.deposit,...r.pricing.lines.map(l=>l.amount)].every(m=>m.currency===r.pricing.total.currency)&&r.pricing.lines.reduce((sum,l)=>sum+l.amount.amount*l.quantity,0)===r.pricing.subtotal.amount);
export type DetailingQuoteReceipt=z.infer<typeof DetailingQuoteReceipt>;
