import {z} from 'zod';
import {PaidJourneyRender} from '@lumin/workflow';
const Uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const Origin=z.string().max(2048).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v;}catch{return false;}});
export const PaidJourneyOwnerPublication=z.object({schemaVersion:z.literal(1),tenantId:Uuid,flowId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(8),allowedOrigins:z.array(Origin).min(1).max(20).refine(v=>new Set(v).size===v.length),render:PaidJourneyRender}).strict().refine(v=>v.render.versionId===v.versionId);
