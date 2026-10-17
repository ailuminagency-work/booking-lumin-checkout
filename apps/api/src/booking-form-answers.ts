import {OwnerBookingFormAnswers} from '@lumin/contracts';
import type {Pool} from 'pg';
import {Uuid} from './contracts';
import {FlowError} from './repository';
export {OwnerBookingFormAnswers} from '@lumin/contracts';
export type BookingFormAnswersReader=(actor:string,tenant:string,booking:string)=>Promise<OwnerBookingFormAnswers>;
/** Only the narrow owner RPC can see private saved request provenance. */
export function createBookingFormAnswersReader(pool:Pool):BookingFormAnswersReader{return async(actor,tenant,booking)=>{
 if(![actor,tenant,booking].every(id=>Uuid.safeParse(id).success))throw new FlowError('INVALID_REQUEST');
 actor=actor.toLowerCase();tenant=tenant.toLowerCase();booking=booking.toLowerCase();const client=await pool.connect();let broken=false;
 try{
  await client.query('begin isolation level repeatable read');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const result=await client.query('select public.owner_booking_form_answers($1::uuid,$2::uuid,$3::uuid) as result',[actor,tenant,booking]);
  const parsed=OwnerBookingFormAnswers.safeParse(result.rows[0]?.result);
  if(result.rows.length!==1||!parsed.success||parsed.data.tenantId!==tenant||parsed.data.bookingId!==booking)throw new FlowError('NOT_AVAILABLE');
  await client.query('commit');return parsed.data;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='42883'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014'].includes(String(code))?'CONFLICT':'INTERNAL_ERROR');}finally{client.release(broken);}
};}
