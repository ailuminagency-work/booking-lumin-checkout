import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourney,PaidSimplePresentation} from '@lumin/workflow';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(v=>v===v.toLowerCase());
const Revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const Installation=z.object({versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(8),hostedPath:z.string()}).strict().refine(v=>v.hostedPath===`/checkout/flow/${v.installationId}`);
export const PaidJourneyHistory=z.object({schemaVersion:z.literal(1),tenantId:Uuid,flowId:Uuid,versions:z.array(z.object({versionId:Uuid,draftRevision:Revision,name:z.string().min(1).max(200),journey:PaidJourney,presentation:PaidSimplePresentation,current:z.boolean(),publication:Installation.nullable()}).strict().refine(v=>v.publication===null||v.publication.versionId===v.versionId)).min(1).max(50)}).strict().refine(h=>h.versions.filter(v=>v.current).length===1&&new Set(h.versions.map(v=>v.versionId)).size===h.versions.length&&h.versions.every((v,i)=>i===0||h.versions[i-1]!.draftRevision>v.draftRevision));
export const PaidJourneyRollbackInput=z.object({expectedCurrentVersionId:Uuid,targetVersionId:Uuid}).strict().refine(v=>v.expectedCurrentVersionId!==v.targetVersionId);
export const PaidJourneyRollbackReceipt=z.object({schemaVersion:z.literal(1),tenantId:Uuid,flowId:Uuid,draftRevision:Revision,versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(8),hostedPath:z.string()}).strict().refine(v=>v.hostedPath===`/checkout/flow/${v.installationId}`);
export type PaidJourneyHistoryReader=(actor:string,tenant:string,flow:string)=>Promise<z.infer<typeof PaidJourneyHistory>>;
export type PaidJourneyRollback=(actor:string,tenant:string,flow:string,input:z.infer<typeof PaidJourneyRollbackInput>)=>Promise<z.infer<typeof PaidJourneyRollbackReceipt>>;
const Origin=z.string().max(2048).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v;}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(v=>new Set(v).size===v.length);
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Only explicit owner operations. Rollback uncertainty must never trigger a silent retry. */
export function createPaidJourneyHistoryRollback(pool:Pool,approvedOrigins:readonly string[]):{history:PaidJourneyHistoryReader;rollback:PaidJourneyRollback}{
 const origins=Origins.parse([...approvedOrigins]);
 async function operation(actor:string,tenant:string,flow:string,input?:z.infer<typeof PaidJourneyRollbackInput>){
  if(![actor,tenant,flow].every(v=>Uuid.safeParse(v).success)||(input!==undefined&&!PaidJourneyRollbackInput.safeParse(input).success))throw new FlowError('INVALID_REQUEST');
  const client=await pool.connect();let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=input===undefined?await client.query('select public.owner_paid_journey_version_history($1::uuid,$2::uuid,$3::uuid,$4::jsonb) result',[actor,tenant,flow,JSON.stringify(origins)]):await client.query('select public.rollback_paid_journey_publication($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb) result',[actor,tenant,flow,input.expectedCurrentVersionId,input.targetVersionId,JSON.stringify(origins)]);
   const parsed=input===undefined?PaidJourneyHistory.safeParse(result.rows[0]?.result):PaidJourneyRollbackReceipt.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!parsed.success||parsed.data.tenantId!==tenant||parsed.data.flowId!==flow||(input!==undefined&&('versionId' in parsed.data?parsed.data.versionId:null)!==input.targetVersionId))throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return parsed.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 }
 return{history:(actor,tenant,flow)=>operation(actor,tenant,flow) as Promise<z.infer<typeof PaidJourneyHistory>>,rollback:(actor,tenant,flow,input)=>operation(actor,tenant,flow,input) as Promise<z.infer<typeof PaidJourneyRollbackReceipt>>};
}
