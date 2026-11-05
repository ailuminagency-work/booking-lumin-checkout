import type {Pool} from 'pg';
import {z} from 'zod';
import {PaidJourneyCustomerFieldRender} from '@lumin/workflow';
import {FlowError} from './repository';
const Uuid=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value;}catch{return false;}});
const Origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length);
function failure(error:unknown):FlowError{if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':code==='22023'?'INVALID_REQUEST':'INTERNAL_ERROR');}
/** Immutable public presentation only. This reader grants no session or writer capability. */
export function createPaidJourneyCustomerFieldPublicReader(pool:Pool,configuredCustomerOrigins:readonly string[]){
 const approved=Origins.parse([...configuredCustomerOrigins]);
 return async(installationId:string,origin:string):Promise<z.infer<typeof PaidJourneyCustomerFieldRender>>=>{
  if(!Uuid.safeParse(installationId).success||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');
  if(!approved.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{
   await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=await client.query('select public.get_paid_journey_customer_field_render($1::uuid,$2::text) result',[installationId,origin]);
   const render=PaidJourneyCustomerFieldRender.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!render.success)throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return render.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}
