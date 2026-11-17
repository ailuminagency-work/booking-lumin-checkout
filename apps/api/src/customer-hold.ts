import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError} from './repository';
import {reserveBookingInTransaction,type HoldReceipt} from './reservation';
const Target=z.object({tenantId:z.string().uuid(),serviceId:z.string().uuid(),bookingId:z.string().uuid()}).strict();
export type CustomerHoldWriter=(tokenHash:string,origin:string)=>Promise<z.infer<typeof HoldReceipt>>;
/** Session capability and its persisted request provenance authorize this transaction only. */
export function createCustomerHoldWriter(pool:Pool,clock=()=>new Date().toISOString()):CustomerHoldWriter{return async(hash,origin)=>{
 const c=await pool.connect();let broken=false;
 try{
  await c.query('begin isolation level read committed');
  await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");
  await c.query('set local role service_role');
  const target=Target.parse((await c.query('select public.customer_flow_hold_target($1,$2) target',[hash,origin])).rows[0]?.target);
  await c.query('lock table public.services,public.availability_rules,public.availability_overrides,public.scheduling_policies in share mode');
  const receipt=await reserveBookingInTransaction(c,target.tenantId,target.bookingId,clock,target.serviceId);
  const rechecked=Target.parse((await c.query('select public.customer_flow_hold_target($1,$2) target',[hash,origin])).rows[0]?.target);
  if(JSON.stringify(rechecked)!==JSON.stringify(target))throw new FlowError('FORBIDDEN');
  await c.query('commit');return receipt;
 }catch(error){
  try{await c.query('rollback');}catch{broken=true;}
  if(error instanceof FlowError)throw error;
  const code=(error as {code?:string})?.code;
  throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':['40001','40P01','55P03','57014','23P01'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');
 }finally{c.release(broken);}
};}
