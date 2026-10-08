import {z} from 'zod';
import {PaidJourneyRender} from '@lumin/workflow';
const Uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const Origin=z.string().max(2048).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v;}catch{return false;}});
export const PublishPaidJourneyDraft=z.object({schemaVersion:z.literal(1),expectedDraftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),allowedOrigins:z.array(Origin).min(1).max(20).refine(v=>new Set(v).size===v.length)}).strict();
export const PaidJourneyPublicationReceipt=z.object({schemaVersion:z.literal(1),tenantId:Uuid,flowId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(8),replayed:z.boolean()}).strict();
export {PaidJourneyRender};
