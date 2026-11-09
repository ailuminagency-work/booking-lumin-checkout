import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
import {mockPaymentsEnabled} from './mock-payment';
const Id=z.string().uuid().refine(v=>v===v.toLowerCase());
export const PaidJourneyMockPaymentReceipt=z.object({schemaVersion:z.literal(1),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,paymentId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),state:z.literal('confirmed'),replayed:z.boolean(),provider:z.literal('staging_mock'),simulated:z.literal(true),amount:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().refine(r=>r.reference==='LMN-'+r.bookingId.replaceAll('-','').toUpperCase());
export type PaidJourneyMockPaymentWriter=(hash:string,origin:string)=>Promise<z.infer<typeof PaidJourneyMockPaymentReceipt>>;
/** Dedicated staging-only evidence; SQL derives pinned money and calls sole confirmation authority. */
export function createPaidJourneyMockPaymentWriter(pool:Pool,env:Record<string,string|undefined>):PaidJourneyMockPaymentWriter{
 const enabled=mockPaymentsEnabled(env);return async(hash,origin)=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');if(!/^[0-9a-f]{64}$/.test(hash))throw new FlowError('INVALID_REQUEST');
  const c=await pool.connect();let broken=false;
  try{await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   const receipt=PaidJourneyMockPaymentReceipt.parse((await c.query('select public.pay_paid_journey_mock($1,$2) result',[hash,origin])).rows[0]?.result);await c.query('commit');return receipt;
  }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','22023','23505'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{c.release(broken);}
 };
}
