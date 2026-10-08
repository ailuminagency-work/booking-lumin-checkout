import type {Pool} from 'pg';
import {FlowError} from './repository';
import {PaidJourneyHoldReceipt,type PaidJourneyHoldReceipt as Receipt} from './paid-journey-hold';
export type PaidJourneyHoldReader=(hash:string,origin:string)=>Promise<Receipt>;
/** Service-only read RPC locks the linked hold; no creation or lifecycle writes. */
export function createPaidJourneyHoldReader(pool:Pool,clock=()=>new Date().toISOString()):PaidJourneyHoldReader{return async(hash,origin)=>{
 if(!/^[0-9a-f]{64}$/.test(hash))throw new FlowError('INVALID_REQUEST');
 const c=await pool.connect();let broken=false;
 try{
  await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
  const receipt=PaidJourneyHoldReceipt.parse((await c.query('select public.get_paid_journey_hold($1,$2) result',[hash,origin])).rows[0]?.result);
  const now=Date.parse(clock());if(!Number.isFinite(now)||!receipt.replayed||Date.parse(receipt.expiresAt)<=now||Date.parse(receipt.expiresAt)>now+301000)throw new FlowError('INTERNAL_ERROR');
  await c.query('commit');return receipt;
 }catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['40001','40P01','55P03','57014'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}
 finally{c.release(broken);}
};}
