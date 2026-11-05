import {z} from 'zod';
import {PaidJourney,PaidSimplePresentation} from '@lumin/workflow';
const Uuid=z.string().uuid();
const Revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const SavePaidJourneyDraft=z.object({schemaVersion:z.literal(1),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),serviceId:Uuid,name:z.string().trim().min(1).max(200),presentation:PaidSimplePresentation,journey:PaidJourney}).strict();
export const PaidJourneyDraftReceipt=z.object({schemaVersion:z.literal(1),tenantId:Uuid,flowId:Uuid,revision:Revision}).strict();
export const PaidJourneyDraft=PaidJourneyDraftReceipt.extend({serviceId:Uuid,name:z.string().min(1).max(200).refine(name=>name===name.trim()),presentation:PaidSimplePresentation,journey:PaidJourney}).strict();
