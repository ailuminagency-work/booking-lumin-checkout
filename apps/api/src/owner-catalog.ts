import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {CreateSimpleOffer,SimpleOfferReceipt} from '@lumin/contracts';
import {FlowError} from './repository';
export function catalogAuthoringEnabled(env:Record<string,string|undefined>):boolean{return env.BOOKING_LUMIN_ENV==='staging'&&env.BOOKING_LUMIN_CATALOG_AUTHORING==='1';}
const Uuid=z.string().uuid().transform(s=>s.toLowerCase());
export type SimpleOfferCreator=(actor:string,tenant:string,input:CreateSimpleOffer)=>Promise<SimpleOfferReceipt>;
export function createSimpleOfferCreator(pool:Pool):SimpleOfferCreator{return async(actor,tenant,input)=>{
 const ids=z.tuple([Uuid,Uuid]).safeParse([actor,tenant]),body=CreateSimpleOffer.safeParse(input);if(!ids.success||!body.success)throw new FlowError('INVALID_REQUEST');[actor,tenant]=ids.data;
 const client=await pool.connect();let broken=false;
 try{await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
  const b=body.data,result=await client.query('select public.create_housekeeping_simple_offer($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint,$7::text,$8::integer,$9::text) as result',[actor,tenant,randomUUID(),b.name,b.description,b.price.amount,b.price.currency,b.durationMinutes,b.idempotencyKey]);
  const receipt=SimpleOfferReceipt.safeParse(result.rows[0]?.result);
  if(result.rows.length!==1||!receipt.success||receipt.data.tenantId!==tenant||receipt.data.service.name!==b.name||receipt.data.service.description!==b.description||receipt.data.service.price.amount!==b.price.amount||receipt.data.service.price.currency!==b.price.currency||receipt.data.service.durationMinutes!==b.durationMinutes)throw new FlowError('INTERNAL_ERROR');
  await client.query('commit');return receipt.data;
 }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{client.release(broken);}
};}
