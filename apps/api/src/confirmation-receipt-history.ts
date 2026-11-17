import {ConfirmationReceiptHistory} from '@lumin/contracts';
export {ConfirmationReceiptHistory} from '@lumin/contracts';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
export type ConfirmationReceiptHistoryReader=(authenticatedActorId:string,tenantId:string,bookingId:string)=>Promise<ConfirmationReceiptHistory>;
const tenantRow=z.object({id:uuid,status:z.literal('active')}).strict();
const ownerRow=z.object({tenant_id:uuid,user_id:uuid,role:z.literal('BUSINESS_OWNER')}).strict();
const bookingRow=z.object({id:uuid,tenant_id:uuid}).strict();

function errorCode(error:unknown):FlowError{
 if(error instanceof FlowError)return error;
 const code=(error as {code?:unknown}|null)?.code;
 return new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':['40001','40P01','55P03','57014'].includes(String(code))?'CONFLICT':'INTERNAL_ERROR');
}
/** Actor MUST come from fresh server authentication, never request JSON. Uses the
 * existing flow_actor authorization/lock order without widening its EXEC grant.
 * FOR SHARE locks fence tenant suspension, owner changes and booking removal
 * until this read commits. Repeatable read keeps receipt history on one
 * snapshot. Only fixed SELECTs are issued; no raw ledger access or queue effects. UTC projection preserves stored microseconds. */
export function createConfirmationReceiptHistoryReader(pool:Pool):ConfirmationReceiptHistoryReader{return async(actorId,tenantId,bookingId)=>{
 const actor=uuid.safeParse(actorId),tenant=uuid.safeParse(tenantId),booking=uuid.safeParse(bookingId);
 if(!actor.success||!tenant.success||!booking.success)throw new FlowError('INVALID_REQUEST');
 let client:PoolClient|undefined;let broken=false;
 try{
  client=await pool.connect();await client.query('begin isolation level repeatable read');
  await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const tenants=await client.query("select id,status from public.tenants where id=$1::uuid and status='active' for share",[tenant.data]);
  if(tenants.rows.length===0)throw new FlowError('FORBIDDEN');
  const t=tenantRow.safeParse(tenants.rows[0]);if(tenants.rows.length!==1||!t.success||t.data.id!==tenant.data)throw new FlowError('INTERNAL_ERROR');
  const owners=await client.query("select tenant_id,user_id,role from public.tenant_members where tenant_id=$1::uuid and user_id=$2::uuid and role='BUSINESS_OWNER' for share",[tenant.data,actor.data]);
  if(owners.rows.length===0)throw new FlowError('FORBIDDEN');
  const member=ownerRow.safeParse(owners.rows[0]);if(owners.rows.length!==1||!member.success||member.data.tenant_id!==tenant.data||member.data.user_id!==actor.data)throw new FlowError('INTERNAL_ERROR');
  const bookings=await client.query('select id,tenant_id from public.bookings where tenant_id=$1::uuid and id=$2::uuid for share',[tenant.data,booking.data]);
  if(bookings.rows.length===0)throw new FlowError('NOT_AVAILABLE');
  const b=bookingRow.safeParse(bookings.rows[0]);if(bookings.rows.length!==1||!b.success||b.data.id!==booking.data||b.data.tenant_id!==tenant.data)throw new FlowError('INTERNAL_ERROR');
  const result=await client.query(`select channel,to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "recordedAt" from public.outbox_confirmation_receipt_history($1::uuid,$2::uuid) order by case channel when 'email' then 0 else 1 end`,[tenant.data,booking.data]);
  const parsed=ConfirmationReceiptHistory.safeParse({schemaVersion:1,tenantId:tenant.data,bookingId:booking.data,receipts:result.rows});
  if(!parsed.success)throw new FlowError('INTERNAL_ERROR');
  const receipt=parsed.data;
  await client.query('commit');return receipt;
 }catch(error){try{await client?.query('rollback');}catch{broken=true;}throw errorCode(error);}
 finally{client?.release(broken);}
};}
