import type {Pool} from 'pg';
import {BusinessProfile,InitializeBusinessProfile} from '@lumin/contracts';
import {z} from 'zod';
import {FlowError} from './repository';
export type BusinessProfileInitializer=(actor:string,tenant:string,input:InitializeBusinessProfile)=>Promise<BusinessProfile>;
const Uuid=z.string().uuid().transform(s=>s.toLowerCase());
/** One fixed owner-rechecked insert-only RPC. Existing profile reads never authorize replay. */
export function createBusinessProfileInitializer(pool:Pool):BusinessProfileInitializer{return async(actor,tenant,input)=>{
 const a=Uuid.safeParse(actor),t=Uuid.safeParse(tenant),b=InitializeBusinessProfile.safeParse(input);
 if(!a.success||!t.success||!b.success)throw new FlowError('INVALID_REQUEST');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
  const rows=(await c.query('select public.initialize_staging_business_profile($1::uuid,$2::uuid,$3::text,$4::text) as result',[a.data,t.data,b.data.businessType,b.data.idempotencyKey])).rows;
  const receipt=BusinessProfile.safeParse(rows[0]?.result);
  if(rows.length!==1||!receipt.success||receipt.data.tenantId!==t.data||receipt.data.businessType!==b.data.businessType)throw new FlowError('INTERNAL_ERROR');
  await c.query('commit');return receipt.data;
 }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;
  throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='22023'?'INVALID_REQUEST':['23505','40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');
 }finally{c.release(broken);}
};}
