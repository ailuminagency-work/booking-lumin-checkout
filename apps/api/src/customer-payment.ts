import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {ConfirmationReceipt} from './confirmation';
import {MockPaymentReceipt,mockPaymentInTransaction,mockPaymentsEnabled} from './mock-payment';
import {FlowError} from './repository';
const Target=z.object({tenantId:z.string().uuid(),serviceId:z.string().uuid(),bookingId:z.string().uuid(),paymentId:z.string().uuid().nullable()}).strict();
export type CustomerConfirmation=(hash:string,origin:string)=>Promise<z.infer<typeof ConfirmationReceipt>>;
export type CustomerMockPayment=(hash:string,origin:string)=>Promise<z.infer<typeof MockPaymentReceipt>>;
async function target(c:PoolClient,hash:string,origin:string){return Target.parse((await c.query('select public.customer_flow_payment_target($1,$2) target',[hash,origin])).rows[0]?.target);}
/** The existing SQL authority owns payment-first locking, hold consumption and state transition. */
async function transaction<T extends z.infer<typeof ConfirmationReceipt>>(pool:Pool,hash:string,origin:string,run:(c:PoolClient,t:z.infer<typeof Target>)=>Promise<T>):Promise<T>{
 const c=await pool.connect();let broken=false;
 try{
  await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
  // Acquire the existing planning prefix before capability reads; never lock a booking ahead of payment.
  await c.query('update public.bookings set payment_id=payment_id where false');
  const before=await target(c,hash,origin);const receipt=await run(c,before);
  const after=await target(c,hash,origin);
  if(before.tenantId!==after.tenantId||before.serviceId!==after.serviceId||before.bookingId!==after.bookingId||receipt.bookingId!==after.bookingId||receipt.paymentId!==after.paymentId)throw new FlowError('CONFLICT');
  await c.query('commit');return receipt;
 }catch(error){
  try{await c.query('rollback');}catch{broken=true;}
  if(error instanceof FlowError)throw error;
  const code=(error as {code?:string})?.code;
  throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':['42883','0A000'].includes(code??'')?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','22023','23505'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');
 }finally{c.release(broken);}
}
export function createCustomerConfirmation(pool:Pool):CustomerConfirmation{return(hash,origin)=>transaction(pool,hash,origin,async(c,t)=>{
 if(!t.paymentId)throw new FlowError('UNSUPPORTED_CONFIG');
 const raw=(await c.query('select public.confirm_succeeded_payment($1::uuid) result',[t.paymentId])).rows[0]?.result;
 const receipt=ConfirmationReceipt.safeParse(raw);
 if(!receipt.success||receipt.data.bookingId!==t.bookingId||receipt.data.paymentId!==t.paymentId)throw new FlowError('INTERNAL_ERROR');
 return receipt.data;
});}
/** Explicit test provider only; retains the existing positive-price, exact-simple-selection contract. */
export function createCustomerMockPayment(pool:Pool,env:Record<string,string|undefined>):CustomerMockPayment{
 const enabled=mockPaymentsEnabled(env);
 return async(hash,origin)=>{
  if(!enabled)throw new FlowError('UNSUPPORTED_CONFIG');
  return transaction(pool,hash,origin,(c,t)=>mockPaymentInTransaction(c,t.tenantId,t.bookingId));
 };
}
