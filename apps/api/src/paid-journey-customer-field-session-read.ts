import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourneyCustomerFieldRender} from '@lumin/workflow';
import {paidJourneyCustomerFieldSessionExpiryValid} from './paid-journey-customer-field-session';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!value.includes('*');}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length);
/** Internal metadata only. Never expose this result as a public session receipt. */
export const PaidJourneyCustomerFieldSessionContext=z.object({schemaVersion:z.literal(2),tenantId:Uuid,flowId:Uuid,versionId:Uuid,installationId:Uuid,serviceId:Uuid,publicationGeneration:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),expiresAt:z.string().datetime({offset:true}),render:PaidJourneyCustomerFieldRender}).strict().refine(value=>value.versionId===value.render.versionId&&value.serviceId===value.render.service.id);
export type PaidJourneyCustomerFieldSessionContext=z.infer<typeof PaidJourneyCustomerFieldSessionContext>;
export type PaidJourneyCustomerFieldSessionReader=(tokenHash:string,origin:string)=>Promise<PaidJourneyCustomerFieldSessionContext>;
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Resolves a hashed V9 session without modifying it or activating any writer. */
export function createPaidJourneyCustomerFieldSessionReader(pool:Pool,options:{configuredCustomerOrigins:readonly string[]}):PaidJourneyCustomerFieldSessionReader{
 const approved=Origins.parse([...options.configuredCustomerOrigins]);
 return async(tokenHash,origin)=>{
  if(typeof tokenHash!=='string'||! /^[0-9a-f]{64}$/.test(tokenHash)||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');
  if(!approved.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=await client.query('select public.resolve_paid_journey_customer_field_session($1::text,$2::text) result',[tokenHash,origin]);
   const parsed=PaidJourneyCustomerFieldSessionContext.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!parsed.success||!paidJourneyCustomerFieldSessionExpiryValid(parsed.data,Date.now()))throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return Object.freeze(parsed.data);
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}
