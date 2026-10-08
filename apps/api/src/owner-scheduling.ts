import type {Pool} from 'pg';
import {z} from 'zod';
import {CreateOfferScheduling,OfferSchedulingReceipt,schedulingReceiptMatches} from '@lumin/contracts';
import {FlowError} from './repository';
export function schedulingAuthoringEnabled(env:Record<string,string|undefined>):boolean{return env.BOOKING_LUMIN_ENV==='staging'&&env.BOOKING_LUMIN_SCHEDULING_AUTHORING==='1';}
const Uuid=z.string().uuid().transform(s=>s.toLowerCase());
export type OfferSchedulingCreator=(actor:string,tenant:string,service:string,input:CreateOfferScheduling)=>Promise<OfferSchedulingReceipt>;
export function createOfferSchedulingCreator(pool:Pool):OfferSchedulingCreator{return async(actor,tenant,service,input)=>{
 const ids=z.tuple([Uuid,Uuid,Uuid]).safeParse([actor,tenant,service]),body=CreateOfferScheduling.safeParse(input);if(!ids.success||!body.success)throw new FlowError('INVALID_REQUEST');[actor,tenant,service]=ids.data;
 const client=await pool.connect();let broken=false;
 try{await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');const b=body.data;
  const result=await client.query('select public.create_housekeeping_offer_scheduling($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::integer,$7::integer,$8::integer,$9::text) as result',[actor,tenant,service,b.timezone,JSON.stringify(b.windows),b.policy.leadTimeMinutes,b.policy.horizonDays,b.policy.slotIntervalMinutes,b.idempotencyKey]);
  const receipt=OfferSchedulingReceipt.safeParse(result.rows[0]?.result);if(result.rows.length!==1||!receipt.success||receipt.data.tenantId!==tenant||receipt.data.serviceId!==service||!schedulingReceiptMatches(receipt.data,b))throw new FlowError('INTERNAL_ERROR');await client.query('commit');return receipt.data;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{client.release(broken);}
};}
