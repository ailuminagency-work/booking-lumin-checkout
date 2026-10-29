import type {Pool} from 'pg';
import {PaidSimpleDraftList,Uuid} from './contracts';
import type {z} from 'zod';
import {FlowError} from './repository';
export type PaidDraftListReader=(actor:string,tenant:string)=>Promise<z.infer<typeof PaidSimpleDraftList>>;
/** Fixed read RPC only. Private table grants remain closed. Existing owner and
 * service checks take share locks, so this repeatable-read transaction permits
 * locks but performs no data writes. Discovery never grants save/publish retry. */
export function createPaidDraftListReader(pool:Pool):PaidDraftListReader{return async(actor,tenant)=>{
 if(![actor,tenant].every(v=>Uuid.safeParse(v).success))throw new FlowError('INVALID_REQUEST');
 const client=await pool.connect();
 try{
  await client.query('begin isolation level repeatable read');
  await client.query('set local role service_role');
  const result=await client.query('select public.owner_paid_simple_drafts($1::uuid,$2::uuid) as result',[actor,tenant]);
  const parsed=PaidSimpleDraftList.safeParse(result.rows[0]?.result);
  if(result.rows.length!==1||!parsed.success)throw new FlowError('INTERNAL_ERROR');
  await client.query('commit');return parsed.data;
 }catch(error){
  await client.query('rollback').catch(()=>{});
  if(error instanceof FlowError)throw error;
  const code=(error as {code?:unknown})?.code;
  throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':'INTERNAL_ERROR');
 }finally{client.release();}
};}
