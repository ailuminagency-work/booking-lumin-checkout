import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourneyCustomerFieldRender,validatePaidJourneyCustomerFieldSnapshotAgainstServerCatalog} from '@lumin/workflow';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value;}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length);
const Revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const PublishPaidJourneyCustomerFieldDraft=z.object({schemaVersion:z.literal(2),expectedDraftRevision:Revision,allowedOrigins:Origins}).strict();
export const PaidJourneyCustomerFieldPublicationReceipt=z.object({schemaVersion:z.literal(2),tenantId:Uuid,flowId:Uuid,draftRevision:Revision,versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(9),replayed:z.boolean()}).strict();
export const PaidJourneyCustomerFieldOwnerPublication=PaidJourneyCustomerFieldPublicationReceipt.omit({replayed:true}).extend({allowedOrigins:Origins,render:PaidJourneyCustomerFieldRender}).strict().refine(value=>value.versionId===value.render.versionId);
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Owner-only authoring. SQL independently pins and verifies the current server
 * catalog; publication cannot grant customer/session or financial capability. */
export function createPaidJourneyCustomerFieldPublicationOperations(pool:Pool,configuration:{configuredCustomerOrigins:readonly string[]}){
 const approved=Origins.parse([...configuration.configuredCustomerOrigins]);
 async function operation(actor:string,tenant:string,flow:string,input?:z.infer<typeof PublishPaidJourneyCustomerFieldDraft>,version?:string,installation?:string,writing=false){
  if(![actor,tenant,flow].every(value=>Uuid.safeParse(value).success))throw new FlowError('INVALID_REQUEST');
  const parsed=writing?PublishPaidJourneyCustomerFieldDraft.safeParse(input):undefined;
  if(parsed&&!parsed.success||writing&&(!Uuid.safeParse(version).success||!Uuid.safeParse(installation).success))throw new FlowError('INVALID_REQUEST');
  const body=parsed?.success?parsed.data:undefined;
  if(body&&!body.allowedOrigins.every(origin=>approved.includes(origin)))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   let receipt:z.infer<typeof PaidJourneyCustomerFieldPublicationReceipt>|undefined;
   if(body){
    const result=await client.query('select public.publish_paid_journey_customer_field_draft($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::uuid,$6::uuid,$7::jsonb,$8::jsonb) result',[actor,tenant,flow,body.expectedDraftRevision,version,installation,JSON.stringify(body.allowedOrigins),JSON.stringify(approved)]);
    const value=PaidJourneyCustomerFieldPublicationReceipt.safeParse(result.rows[0]?.result);
    if(result.rows.length!==1||!value.success||value.data.tenantId!==tenant||value.data.flowId!==flow||value.data.draftRevision!==body.expectedDraftRevision||!value.data.replayed&&(value.data.versionId!==version||value.data.installationId!==installation))throw new FlowError('INTERNAL_ERROR');receipt=value.data;
   }
   const result=await client.query('select public.get_paid_journey_customer_field_owner_publication($1::uuid,$2::uuid,$3::uuid) result',[actor,tenant,flow]);
   const owner=PaidJourneyCustomerFieldOwnerPublication.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!owner.success||owner.data.tenantId!==tenant||owner.data.flowId!==flow||!owner.data.allowedOrigins.every(origin=>approved.includes(origin))||receipt&&(owner.data.versionId!==receipt.versionId||owner.data.installationId!==receipt.installationId||owner.data.draftRevision!==receipt.draftRevision||JSON.stringify(owner.data.allowedOrigins)!==JSON.stringify(body!.allowedOrigins)))throw new FlowError('INTERNAL_ERROR');
   // The owner RPC has independently compared this immutable service to the
   // locked catalog before returning. Do not trust a caller-provided service.
   const {versionId:_,...snapshot}=owner.data.render;validatePaidJourneyCustomerFieldSnapshotAgainstServerCatalog(snapshot,owner.data.render.service);
   await client.query('commit');return receipt??owner.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 }
 return{publish:(actor:string,tenant:string,flow:string,input:z.infer<typeof PublishPaidJourneyCustomerFieldDraft>,versionId:string,installationId:string)=>operation(actor,tenant,flow,input,versionId,installationId,true) as Promise<z.infer<typeof PaidJourneyCustomerFieldPublicationReceipt>>,read:(actor:string,tenant:string,flow:string)=>operation(actor,tenant,flow) as Promise<z.infer<typeof PaidJourneyCustomerFieldOwnerPublication>>};
}
