import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {Uuid} from './contracts';
import {FlowError} from './repository';
const Timestamp=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
export const AttentionCursor=z.string().max(100).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const OwnerPaymentAttention=z.object({tenantId:Uuid,items:z.array(z.object({receiptId:Uuid,bookingId:Uuid,bookingReference:z.string().min(1).max(200).nullable(),reason:z.literal('late_success_after_failure'),recordedAt:Timestamp,conflictSeen:z.boolean()}).strict()).max(100),nextCursor:AttentionCursor.nullable()}).strict();
export type OwnerPaymentAttention=z.infer<typeof OwnerPaymentAttention>;
export type OwnerPaymentAttentionReader=(actor:string,selectedTenant:string,query:{limit:number;cursor:string|null})=>Promise<OwnerPaymentAttention>;
export function createOwnerPaymentAttentionReader(pool:Pool):OwnerPaymentAttentionReader{return async(actor,selectedTenant,query)=>{
 if(!Uuid.safeParse(actor).success||!Uuid.safeParse(selectedTenant).success||!Number.isInteger(query.limit)||query.limit<1||query.limit>100||query.cursor!==null&&!AttentionCursor.safeParse(query.cursor).success)throw new FlowError('INVALID_REQUEST');
 let c:PoolClient|undefined,broken=false;
 try{
  c=await pool.connect();await c.query('begin isolation level repeatable read');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
  // Derive the business from authenticated actor membership, never trust a URL tenant.
  const memberships=await c.query('select tenant_id from public.tenant_members where user_id=$1::uuid limit 2',[actor]);
  if(memberships.rows.length!==1||String(memberships.rows[0].tenant_id).toLowerCase()!==selectedTenant.toLowerCase())throw new FlowError('FORBIDDEN');
  const tenant=String(memberships.rows[0].tenant_id).toLowerCase();
  await c.query('select lumin.flow_actor($1::uuid,$2::uuid,false)',[actor,tenant]);
  const [before,id]=query.cursor?.split('|')??[null,null];
  const rows=await c.query('select payment_internal.list_payment_attention($1::uuid,$2::timestamptz,$3::uuid,$4::integer) data',[tenant,before,id,query.limit]);
  const parsed=OwnerPaymentAttention.safeParse(rows.rows[0]?.data);
  if(!parsed.success||parsed.data.tenantId!==tenant||parsed.data.items.length>query.limit)throw new FlowError('INTERNAL_ERROR');
  await c.query('commit');return parsed.data;
 }catch(error){try{await c?.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string})?.code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='22007'||code==='22008'?'INVALID_REQUEST':['40001','40P01','55P03','57014'].includes(String(code))?'CONFLICT':'INTERNAL_ERROR');}finally{c?.release(broken);}
};}
