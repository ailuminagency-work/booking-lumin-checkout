import {z} from 'zod';
const Uuid=z.string().uuid();
const Count=z.number().int().min(0).max(1000000);
const Receipt=z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.union([z.literal(3),z.literal(4)]),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`);
export const PaidInstallHealth=z.object({
 schemaVersion:z.literal(1),flowId:Uuid,versionId:Uuid,renderSchemaVersion:z.union([z.literal(3),z.literal(4)]),status:z.enum(['unknown','degraded']),
 installation:z.object({status:z.enum(['available','unavailable']),receipt:Receipt.nullable()}).strict(),
 catalog:z.object({status:z.enum(['compatible','incompatible','unavailable'])}).strict(),
 customerEvidence:z.object({issuedSessionCount:Count,sessionCountCapped:z.boolean(),lastSuccessfulLoadAt:z.null(),loadEvidence:z.literal('unavailable'),confirmedStagingBookingCount:Count,bookingCountCapped:z.boolean(),lastConfirmedStagingBookingAt:z.string().datetime({offset:true}).nullable()}).strict(),
 testPayment:z.object({mode:z.literal('staging_mock'),simulated:z.literal(true),enabled:z.literal(true)}).strict(),
}).strict().superRefine((h,c)=>{
 const r=h.installation.receipt,e=h.customerEvidence;
 if((h.installation.status==='available')!==(r!==null)||r&&(r.versionId!==h.versionId||r.renderSchemaVersion!==h.renderSchemaVersion))c.addIssue({code:'custom',message:'Invalid installation binding'});
 if(h.status!==(r&&h.catalog.status==='compatible'?'unknown':'degraded'))c.addIssue({code:'custom',message:'Invalid evidence status'});
 if((e.confirmedStagingBookingCount===0)!==(e.lastConfirmedStagingBookingAt===null)||e.sessionCountCapped&&e.issuedSessionCount!==1000000||e.bookingCountCapped&&e.confirmedStagingBookingCount!==1000000||e.confirmedStagingBookingCount>e.issuedSessionCount)c.addIssue({code:'custom',message:'Invalid aggregate evidence'});
});
export type PaidInstallHealth=z.infer<typeof PaidInstallHealth>;
