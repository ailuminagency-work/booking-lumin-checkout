import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourneyCustomerFieldRender} from '@lumin/workflow';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{return new URL(value).protocol==='https:'&&new URL(value).origin===value&&!value.includes('*');}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length);
export const PaidJourneyCustomerFieldSessionResult=z.object({schemaVersion:z.literal(2),installationId:Uuid,expiresAt:z.string().datetime({offset:true}),render:PaidJourneyCustomerFieldRender}).strict();
export function paidJourneyCustomerFieldSessionExpiryValid(value:{expiresAt:string},now:number){const expiry=Date.parse(value.expiresAt);return Number.isFinite(now)&&Number.isFinite(expiry)&&expiry>now&&expiry<=now+15*60000+1000;}
export type PaidJourneyCustomerFieldSessionIssuer=(installationId:string,tokenHash:string,origin:string)=>Promise<z.infer<typeof PaidJourneyCustomerFieldSessionResult>>;
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Issues presentation-only V9 session receipts. Never accepts token plaintext or customer data. */
export function createPaidJourneyCustomerFieldSessionIssuer(pool:Pool,configuredCustomerOrigins:readonly string[]):PaidJourneyCustomerFieldSessionIssuer{
 const approved=Origins.parse([...configuredCustomerOrigins]);
 return async(installationId,tokenHash,origin)=>{
  if(!Uuid.safeParse(installationId).success||typeof tokenHash!=='string'||! /^[0-9a-f]{64}$/.test(tokenHash)||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');
  if(!approved.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=await client.query('select public.issue_paid_journey_customer_field_session($1::uuid,$2::text,$3::text) result',[installationId,tokenHash,origin]);
   const receipt=PaidJourneyCustomerFieldSessionResult.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!receipt.success||receipt.data.installationId!==installationId||!paidJourneyCustomerFieldSessionExpiryValid(receipt.data,Date.now()))throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return receipt.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}
