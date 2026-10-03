import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';

const Uuid=z.string().uuid().transform(value=>value.toLowerCase());
export const ConfirmationInput=z.object({bookingId:Uuid}).strict();
export const ConfirmationReceipt=z.object({bookingId:Uuid,paymentId:Uuid,state:z.literal('confirmed'),replayed:z.boolean()}).strict();
export type BookingConfirmation=(actor:string,tenant:string,booking:string)=>Promise<z.infer<typeof ConfirmationReceipt>>;
/** Only persisted payment evidence can reach the atomic confirmation authority. */
export function createBookingConfirmation(pool:Pool):BookingConfirmation{return async(actor,tenant,booking)=>{
 const canonicalBooking=Uuid.safeParse(booking);
 if(!canonicalBooking.success)throw new FlowError('INVALID_REQUEST');
 booking=canonicalBooking.data;
 const client=await pool.connect();let broken=false;
 try{
  await client.query('begin');
  await client.query("set local statement_timeout='5s'");
  await client.query('set local role service_role');
  const membership=await client.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
  if(!membership.rows.length)throw new FlowError('FORBIDDEN');
  // Do not lock the booking ahead of the RPC's payment-first lock order.
  const target=await client.query(`select id,payment_id from public.bookings where id=$1::uuid and tenant_id=$2::uuid`,[booking,tenant]);
  if(!target.rows.length)throw new FlowError('NOT_AVAILABLE');
  let payment=target.rows[0].payment_id;
  if(payment===null)throw new FlowError('UNSUPPORTED_CONFIG');
  const canonicalPayment=Uuid.safeParse(payment);
  if(!canonicalPayment.success)throw new FlowError('INTERNAL_ERROR');
  payment=canonicalPayment.data;
  const result=await client.query('select public.confirm_succeeded_payment($1::uuid) result',[payment]);
  const parsed=ConfirmationReceipt.safeParse(result.rows[0]?.result);
  if(!parsed.success||parsed.data.bookingId!==booking||parsed.data.paymentId!==payment)throw new FlowError('INTERNAL_ERROR');
  const bound=await client.query('select id,payment_id from public.bookings where id=$1::uuid and tenant_id=$2::uuid and payment_id=$3::uuid for share',[booking,tenant,payment]);
  if(bound.rows.length!==1)throw new FlowError('CONFLICT');
  await client.query('commit');
  return parsed.data;
 }catch(error){
  try{await client.query('rollback');}catch{broken=true;}
  if(error instanceof FlowError)throw error;
  const code=(error as {code?:string})?.code;
  if(code==='42883'||code==='0A000')throw new FlowError('UNSUPPORTED_CONFIG');
  if(code==='42501')throw new FlowError('FORBIDDEN');
  if(code==='P0002')throw new FlowError('NOT_AVAILABLE');
  if(code==='40001'||code==='22023')throw new FlowError('CONFLICT');
  throw new FlowError('INTERNAL_ERROR');
 }finally{client.release(broken);}
};}
