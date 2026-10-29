import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourneyCustomerFieldForm} from '@lumin/workflow';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
export const SavePaidJourneyCustomerFieldDraft=z.object({schemaVersion:z.literal(2),serviceId:Uuid,expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),form:PaidJourneyCustomerFieldForm}).strict();
export const PaidJourneyCustomerFieldDraftReceipt=z.object({schemaVersion:z.literal(2),tenantId:Uuid,flowId:Uuid,revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict();
export const PaidJourneyCustomerFieldDraft=PaidJourneyCustomerFieldDraftReceipt.extend({serviceId:Uuid,form:PaidJourneyCustomerFieldForm}).strict();
export type PaidJourneyCustomerFieldDraftReader=(actor:string,tenant:string,flow:string)=>Promise<z.infer<typeof PaidJourneyCustomerFieldDraft>>;
export type PaidJourneyCustomerFieldDraftWriter=(actor:string,tenant:string,flow:string,input:z.infer<typeof SavePaidJourneyCustomerFieldDraft>)=>Promise<z.infer<typeof PaidJourneyCustomerFieldDraftReceipt>>;
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Authoring-only RPCs. Unknown commits are never retried or reconciled here. */
export function createPaidJourneyCustomerFieldDraftOperations(pool:Pool):{read:PaidJourneyCustomerFieldDraftReader;save:PaidJourneyCustomerFieldDraftWriter}{
 async function operation(actor:string,tenant:string,flow:string,input?:z.infer<typeof SavePaidJourneyCustomerFieldDraft>,writing=false){
  if(![actor,tenant,flow].every(value=>Uuid.safeParse(value).success))throw new FlowError('INVALID_REQUEST');
  const parsedInput=writing?SavePaidJourneyCustomerFieldDraft.safeParse(input):undefined;
  if(parsedInput&&!parsedInput.success)throw new FlowError('INVALID_REQUEST');
  const value=parsedInput?.success?parsedInput.data:undefined;
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=value===undefined?await client.query('select public.get_paid_journey_customer_field_draft($1::uuid,$2::uuid,$3::uuid) result',[actor,tenant,flow]):await client.query('select public.save_paid_journey_customer_field_draft($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::jsonb) result',[actor,tenant,flow,value.serviceId,value.expectedRevision,JSON.stringify(value.form)]);
   const parsed=value===undefined?PaidJourneyCustomerFieldDraft.safeParse(result.rows[0]?.result):PaidJourneyCustomerFieldDraftReceipt.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!parsed.success||parsed.data.tenantId!==tenant||parsed.data.flowId!==flow||(value!==undefined&&parsed.data.revision!==value.expectedRevision+1))throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return parsed.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 }
 return{read:(actor,tenant,flow)=>operation(actor,tenant,flow) as ReturnType<PaidJourneyCustomerFieldDraftReader>,save:(actor,tenant,flow,input)=>operation(actor,tenant,flow,input,true) as ReturnType<PaidJourneyCustomerFieldDraftWriter>};
}
