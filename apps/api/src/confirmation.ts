import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';

export const ConfirmationInput=z.object({bookingId:z.string().uuid()}).strict();
export type BookingConfirmation=(actor:string,tenant:string,booking:string)=>Promise<never>;
/** Confirmation stays unavailable until a durable, atomic payment/hold authority
 * exists. The in-memory mock provider is not evidence of a settled DB payment.
 * This boundary authorizes the target without writing financial or booking state. */
export function createBookingConfirmation(pool:Pool):BookingConfirmation{return async(actor,tenant,booking)=>{
 const client=await pool.connect();let broken=false;
 try{
  await client.query('begin read only');
  await client.query("set local statement_timeout='5s'");
  await client.query('set local role service_role');
  const membership=await client.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in('BUSINESS_OWNER','BUSINESS_STAFF')`,[tenant,actor]);
  if(!membership.rows.length)throw new FlowError('FORBIDDEN');
  const target=await client.query(`select id from public.bookings where id=$1::uuid and tenant_id=$2::uuid`,[booking,tenant]);
  if(!target.rows.length)throw new FlowError('NOT_AVAILABLE');
  throw new FlowError('UNSUPPORTED_CONFIG');
 }catch(error){
  try{await client.query('rollback');}catch{broken=true;}
  if(error instanceof FlowError)throw error;
  throw new FlowError('INTERNAL_ERROR');
 }finally{client.release(broken);}
};}
