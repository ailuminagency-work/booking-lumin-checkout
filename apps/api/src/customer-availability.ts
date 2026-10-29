import type {Pool} from 'pg';
import {z} from 'zod';
import {FlowError,readAvailabilitySlots,type AvailabilityReader} from './repository';

const Scope=z.object({tenantId:z.string().uuid(),serviceId:z.string().uuid(),timezone:z.string().min(1),durationMinutes:z.number().int().positive()}).strict();
export type CustomerAvailabilityReader=(tokenHash:string,origin:string,from:string,to:string)=>ReturnType<AvailabilityReader>;
/** Capability validation and scheduling reads share a transaction and row locks. */
export function createCustomerAvailabilityReader(pool:Pool,clock=()=>new Date().toISOString()):CustomerAvailabilityReader {
 return async(hash,origin,from,to)=>{
  const c=await pool.connect();let broken=false;
  try {
   await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   // SQL locks policy/resource bindings while excluding planning allocation.
   const scope=Scope.parse((await c.query('select public.customer_flow_availability_scope($1,$2) scope',[hash,origin])).rows[0]?.scope);
   const result=await readAvailabilitySlots(c,scope.tenantId,scope.serviceId,{timezone:scope.timezone,duration_minutes:scope.durationMinutes},from,to,clock);
   // Recheck expiry after bounded scheduling reads, before releasing capability locks.
   await c.query('select public.customer_flow_availability_scope($1,$2)',[hash,origin]);
   await c.query('commit');return result;
  } catch(error) {
   try {await c.query('rollback');} catch {broken=true;}
   if(error instanceof FlowError)throw error;
   const code=(error as {code?:string})?.code;
   throw new FlowError(code==='42501'?'FORBIDDEN':code==='0A000'?'UNSUPPORTED_CONFIG':code==='55P03'||code==='57014'?'CONFLICT':'INTERNAL_ERROR');
  } finally {c.release(broken);}
 };
}
