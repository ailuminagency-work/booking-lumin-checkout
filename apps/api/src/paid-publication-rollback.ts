import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
const Uuid=z.string().uuid().transform(s=>s.toLowerCase());
export const PaidRollbackInput=z.object({expectedCurrentVersionId:Uuid,targetVersionId:Uuid}).strict();
export const PaidRollbackReceipt=z.object({flowId:Uuid,versionId:Uuid,installationId:Uuid,renderSchemaVersion:z.literal(3),hostedPath:z.string()}).strict().refine(r=>r.hostedPath===`/checkout/flow/${r.installationId}`);
export type PaidPublicationRollback=(actor:string,tenant:string,flow:string,input:z.infer<typeof PaidRollbackInput>)=>Promise<z.infer<typeof PaidRollbackReceipt>>;
/** Explicit current-pointer CAS only. A lost response never makes retry safe. */
export function createPaidPublicationRollback(pool:Pool,approvedOrigins:readonly string[]):PaidPublicationRollback{return async(actor,tenant,flow,input)=>{
 const identifiers=z.tuple([Uuid,Uuid,Uuid]).safeParse([actor,tenant,flow]),body=PaidRollbackInput.safeParse(input);
 if(!identifiers.success||!body.success)throw new FlowError('INVALID_REQUEST');
 [actor,tenant,flow]=identifiers.data;
 const client=await pool.connect();let broken=false;
 try{
  await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const result=await client.query('select public.rollback_paid_simple_publication($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb) as result',[actor,tenant,flow,body.data.expectedCurrentVersionId,body.data.targetVersionId,JSON.stringify(approvedOrigins)]);
  const receipt=PaidRollbackReceipt.safeParse(result.rows[0]?.result);
  if(result.rows.length!==1||!receipt.success||receipt.data.flowId!==flow||receipt.data.versionId!==body.data.targetVersionId)throw new FlowError('INTERNAL_ERROR');
  await client.query('commit');return receipt.data;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}finally{client.release(broken);}
};}
