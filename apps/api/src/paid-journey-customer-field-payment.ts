import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
import {mockPaymentsEnabled} from './mock-payment';
const Id=z.string().uuid().refine(value=>value===value.toLowerCase());
const Origin=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!value.includes('*');}catch{return false;}});
export const PaidJourneyCustomerFieldMockPaymentReceipt=z.object({schemaVersion:z.literal(2),versionId:Id,installationId:Id,serviceId:Id,bookingId:Id,paymentId:Id,reference:z.string().regex(/^LMN-[A-F0-9]{32}$/),state:z.literal('confirmed'),replayed:z.boolean(),provider:z.literal('staging_mock'),simulated:z.literal(true),realPayment:z.literal(false),productionMoney:z.literal(false),amount:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().refine(value=>value.reference==='LMN-'+value.bookingId.replaceAll('-','').toUpperCase());
export type PaidJourneyCustomerFieldMockPaymentReceipt=Readonly<z.infer<typeof PaidJourneyCustomerFieldMockPaymentReceipt>>;
export type PaidJourneyCustomerFieldMockPaymentWriter=(hash:string,origin:string)=>Promise<PaidJourneyCustomerFieldMockPaymentReceipt>;
function failure(error:unknown){if(error instanceof FlowError)return error;const code=(error as {code?:string})?.code;return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','22023','23505','23P01'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}
/** No customer money inputs. SQL derives immutable server price and invokes the unchanged sole confirmation writer. */
export function createPaidJourneyCustomerFieldMockPaymentWriter(pool:Pool,env:Record<string,string|undefined>,options:{configuredCustomerOrigins:readonly string[]}):PaidJourneyCustomerFieldMockPaymentWriter{
 const enabled=mockPaymentsEnabled(env),origins=z.array(Origin).min(1).max(20).refine(values=>new Set(values).size===values.length).parse([...options.configuredCustomerOrigins]);
 return async(hash,origin)=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');if(typeof hash!=='string'||! /^[0-9a-f]{64}$/.test(hash)||!Origin.safeParse(origin).success)throw new FlowError('INVALID_REQUEST');if(!origins.includes(origin))throw new FlowError('FORBIDDEN');
  let client;try{client=await pool.connect();}catch(error){throw failure(error);}let broken=false;
  try{await client.query('begin isolation level read committed');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=await client.query('select public.pay_paid_journey_customer_field_mock($1,$2) result',[hash,origin]);if(result.rows.length!==1)throw new FlowError('INTERNAL_ERROR');const receipt=PaidJourneyCustomerFieldMockPaymentReceipt.parse(result.rows[0]?.result);await client.query('commit');return Object.freeze(receipt);
  }catch(error){try{await client.query('rollback');}catch{broken=true;}throw failure(error);}finally{client.release(broken);}
 };
}
