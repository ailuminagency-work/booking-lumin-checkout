import type {Pool} from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {PaidConditionalCustomerFieldRender} from '@lumin/workflow';
import {Uuid,Origin} from './contracts';
import {FlowError} from './repository';

const Count=z.number().int().min(0).max(1000000);
const Receipt=z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(6),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`);
/** V6 evidence only. Kept separate from the unchanged V5 shared contract. */
export const ConditionalCustomerFieldInstallHealth=z.object({
 schemaVersion:z.literal(1),flowId:Uuid,draftRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),versionId:Uuid,renderSchemaVersion:z.literal(6),status:z.enum(['unknown','degraded']),
 installation:z.object({status:z.enum(['available','unavailable']),receipt:Receipt.nullable()}).strict(),
 catalog:z.object({status:z.enum(['compatible','incompatible','unavailable'])}).strict(),
 customerEvidence:z.object({issuedSessionCount:Count,sessionCountCapped:z.boolean(),lastSuccessfulLoadAt:z.null(),loadEvidence:z.literal('unavailable'),confirmedStagingBookingCount:Count,bookingCountCapped:z.boolean(),lastConfirmedStagingBookingAt:z.string().datetime({offset:true}).nullable()}).strict(),
 testPayment:z.object({mode:z.literal('staging_mock'),simulated:z.literal(true),enabled:z.literal(true)}).strict(),
}).strict().superRefine((h,c)=>{
 const r=h.installation.receipt,e=h.customerEvidence;
 if((h.installation.status==='available')!==(r!==null)||r&&r.versionId!==h.versionId)c.addIssue({code:'custom',message:'Invalid installation binding'});
 if(h.status!==(r&&h.catalog.status==='compatible'?'unknown':'degraded'))c.addIssue({code:'custom',message:'Invalid evidence status'});
 if((e.confirmedStagingBookingCount===0)!==(e.lastConfirmedStagingBookingAt===null)||e.sessionCountCapped&&e.issuedSessionCount!==1000000||e.bookingCountCapped&&e.confirmedStagingBookingCount!==1000000||e.confirmedStagingBookingCount>e.issuedSessionCount)c.addIssue({code:'custom',message:'Invalid aggregate evidence'});
});
export type ConditionalCustomerFieldInstallHealth=z.infer<typeof ConditionalCustomerFieldInstallHealth>;
export type ConditionalCustomerFieldInstallHealthReader=(actor:string,tenant:string,flow:string)=>Promise<ConditionalCustomerFieldInstallHealth>;
const Installation=z.object({installationId:Uuid,allowedOrigins:z.array(Origin).min(1).max(20).refine(a=>new Set(a).size===a.length)}).strict();
const RawCount=z.number().int().min(0).max(1000001);
const Evidence=z.object({tenantId:Uuid,flowId:Uuid,versionId:Uuid,sourceRevision:z.string().regex(/^[1-9][0-9]*$/),renderSchemaVersion:z.literal(6),snapshot:PaidConditionalCustomerFieldRender.omit({versionId:true}),serviceId:Uuid,flowServiceId:Uuid,boundSnapshot:z.unknown(),config:z.unknown(),installations:z.array(z.unknown()).max(2),catalogStatus:z.enum(['available','incompatible','unavailable']),catalogSnapshot:z.unknown(),issuedSessionCount:RawCount,confirmedStagingBookingCount:RawCount,lastConfirmedStagingBookingAt:z.string().datetime({offset:true}).nullable()}).strict();

/** Fresh owner and private provenance are rechecked by a fixed read-only RPC.
 * Issuance cannot certify browser loads; no private customer values leave SQL. */
export function createConditionalCustomerFieldInstallHealthReader(pool:Pool,approvedOrigins:readonly string[]):ConditionalCustomerFieldInstallHealthReader{return async(actor,tenant,flow)=>{
 if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const raw=(await client.query('select public.owner_conditional_customer_field_install_health($1::uuid,$2::uuid,$3::uuid) as result',[actor,tenant,flow])).rows[0]?.result;
  const parsed=Evidence.safeParse(raw);if(!parsed.success)throw new FlowError('NOT_AVAILABLE');
  const row=parsed.data,snapshot=row.snapshot,revision=Number(row.sourceRevision);
  if(row.confirmedStagingBookingCount>row.issuedSessionCount||row.tenantId!==tenant||row.flowId!==flow||!Number.isSafeInteger(revision)||snapshot.publication.draftRevision!==revision||row.serviceId!==snapshot.service.id||row.flowServiceId!==row.serviceId||!isDeepStrictEqual(row.boundSnapshot,snapshot.service)||!isDeepStrictEqual(row.config,{key:'paid_conditional_customer_field',steps:[{key:'service',kind:'info',title:snapshot.service.name}]}))throw new FlowError('NOT_AVAILABLE');
  let receipt:ConditionalCustomerFieldInstallHealth['installation']['receipt']=null;
  if(row.installations.length===1){const i=Installation.safeParse(row.installations[0]);if(i.success&&i.data.allowedOrigins.every(o=>approvedOrigins.includes(o)))receipt={versionId:row.versionId,installationId:i.data.installationId,renderSchemaVersion:6,hostedPath:`/checkout/flow/${i.data.installationId}`};}
  const catalog=row.catalogStatus==='available'?(isDeepStrictEqual(row.catalogSnapshot,snapshot.service)?'compatible':'incompatible'):row.catalogStatus;
  const result=ConditionalCustomerFieldInstallHealth.safeParse({schemaVersion:1,flowId:flow,draftRevision:revision,versionId:row.versionId,renderSchemaVersion:6,status:receipt&&catalog==='compatible'?'unknown':'degraded',installation:{status:receipt?'available':'unavailable',receipt},catalog:{status:catalog},customerEvidence:{issuedSessionCount:Math.min(1000000,row.issuedSessionCount),sessionCountCapped:row.issuedSessionCount>1000000,lastSuccessfulLoadAt:null,loadEvidence:'unavailable',confirmedStagingBookingCount:Math.min(1000000,row.confirmedStagingBookingCount),bookingCountCapped:row.confirmedStagingBookingCount>1000000,lastConfirmedStagingBookingAt:row.lastConfirmedStagingBookingAt},testPayment:{mode:'staging_mock',simulated:true,enabled:true}});
  if(!result.success)throw new FlowError('NOT_AVAILABLE');await client.query('commit');return result.data;
 }catch(error){await client.query('rollback').catch(()=>{});if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':'INTERNAL_ERROR');}finally{client.release();}
};}
