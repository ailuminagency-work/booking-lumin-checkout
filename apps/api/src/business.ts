import type {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {BusinessProfile,CreateBusiness} from '@lumin/contracts';
import {FlowError} from './repository';
export function businessOnboardingEnabled(env:Record<string,string|undefined>):boolean{return env.BOOKING_LUMIN_ENV==='staging'&&env.BOOKING_LUMIN_BUSINESS_ONBOARDING==='1';}
const Uuid=z.string().uuid().transform(s=>s.toLowerCase());
export type BusinessCreator=(actor:string,input:CreateBusiness)=>Promise<BusinessProfile>;
export type BusinessProfileReader=(actor:string,tenant:string)=>Promise<BusinessProfile>;
/** Fixed staging RPCs; no generic tenant, service, or financial writer. */
export function createBusinessApi(pool:Pool):{create:BusinessCreator;read:BusinessProfileReader}{
 async function run(actor:string,tenant:string|null,input:CreateBusiness|null):Promise<BusinessProfile>{
  const a=Uuid.safeParse(actor),t=tenant===null?null:Uuid.safeParse(tenant),body=input===null?null:CreateBusiness.safeParse(input);
  if(!a.success||(t&&!t.success)||(body&&!body.success))throw new FlowError('INVALID_REQUEST');
  const client=await pool.connect();let broken=false;
  try{await client.query('begin');await client.query("set local statement_timeout='5s'");await client.query("set local lock_timeout='3s'");await client.query('set local role service_role');
   const result=body?.success?await client.query('select public.create_staging_business($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text) as result',[a.data,randomUUID(),body.data.name,body.data.slug,body.data.timezone,body.data.currency,body.data.businessType,body.data.idempotencyKey]):await client.query('select public.owner_business_profile($1::uuid,$2::uuid) as result',[a.data,t?.success?t.data:null]);
   const profile=BusinessProfile.safeParse(result.rows[0]?.result);
   if(result.rows.length!==1||!profile.success||(t?.success&&profile.data.tenantId!==t.data)||(body?.success&&profile.data.businessType!==body.data.businessType))throw new FlowError('INTERNAL_ERROR');
   await client.query('commit');return profile.data;
  }catch(error){try{await client.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='22023'?'INVALID_REQUEST':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{client.release(broken);}
 }
 return{create:(actor,input)=>run(actor,null,input),read:(actor,tenant)=>run(actor,tenant,null)};
}
