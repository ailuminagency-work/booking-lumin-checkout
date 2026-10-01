import type {Pool} from 'pg';
import {z} from 'zod';
import {Service,Selection} from '@lumin/contracts';
import {createPricingEngine} from '@lumin/core';
import {FlowError} from './repository';
const Uuid=z.string().uuid().transform(x=>x.toLowerCase());
const Text=(max:number)=>z.string().trim().min(1).max(max).refine(x=>!x.includes('\0'));
const Time=z.string().datetime({offset:true}).transform(x=>new Date(x).toISOString());
export const DraftInput=z.object({
 idempotencyKey:Text(128).refine(x=>x.length>=16),serviceId:Uuid,slotStart:Time,slotEnd:Time,
 selection:Selection.strict().optional(),
 customer:z.object({name:Text(200),email:z.string().trim().email().max(254),phone:Text(40).optional()}).strict(),
 address:z.object({line1:Text(300),line2:Text(300).optional(),city:Text(100),region:Text(100).optional(),postalCode:Text(30).optional(),country:Text(2).refine(x=>/^[A-Z]{2}$/.test(x))}).strict().optional(),
 notes:Text(4000).optional(),
}).strict().refine(x=>Date.parse(x.slotEnd)>Date.parse(x.slotStart));
export const DraftReceipt=z.object({bookingId:Uuid,reference:z.string().min(1).max(100),state:z.literal('draft')}).strict();
export type DraftWriter=(actor:string,tenant:string,input:z.infer<typeof DraftInput>)=>Promise<z.infer<typeof DraftReceipt>>;
type ServiceRow={id:string;tenant_id:string;archetype:string;name:string;description:string;currency:string;base_price:number|string;duration_minutes:number|string;tax_rate_bp:number|string;rental:unknown};
type ItemRow={item_key:string;name:string;description:string|null;unit_price:number|string;min_qty:number|string;max_qty:number|string};
type AddonRow={addon_key:string;name:string;description:string|null;price:number|string};
type QuestionRow={question_key:string;prompt:string;kind:string;required:boolean;choices:unknown;unit_price:number|string|null;min_qty:number|string|null;max_qty:number|string|null};
async function validateConfiguredSelection(c:{query:(sql:string,params?:unknown[])=>Promise<{rows:unknown[]}>},tenant:string,body:z.infer<typeof DraftInput>,selection:z.infer<typeof Selection>):Promise<void>{
 if(selection.serviceId!==body.serviceId)throw new FlowError('INVALID_REQUEST');
 const serviceRows=await c.query(`select id,tenant_id,archetype,name,description,currency,base_price,duration_minutes,tax_rate_bp,rental from public.services where id=$1::uuid and tenant_id=$2::uuid and active`,[body.serviceId,tenant]);
 const service=serviceRows.rows[0] as ServiceRow|undefined;if(!service)throw new FlowError('NOT_AVAILABLE');
 const items=(await c.query(`select item_key,name,description,unit_price,min_qty,max_qty from public.service_items where tenant_id=$1::uuid and service_id=$2::uuid order by sort_order,item_key`,[tenant,body.serviceId])).rows as ItemRow[];
 const addons=(await c.query(`select addon_key,name,description,price from public.service_addons where tenant_id=$1::uuid and service_id=$2::uuid order by sort_order,addon_key`,[tenant,body.serviceId])).rows as AddonRow[];
 const questions=(await c.query(`select question_key,prompt,kind,required,choices,unit_price,min_qty,max_qty from public.service_questions where tenant_id=$1::uuid and service_id=$2::uuid order by sort_order,question_key`,[tenant,body.serviceId])).rows as QuestionRow[];
 try{
  const config=Service.parse({id:service.id,tenantId:service.tenant_id,archetype:service.archetype,name:service.name,description:service.description,currency:service.currency,basePrice:Number(service.base_price),durationMinutes:Number(service.duration_minutes),taxRateBp:Number(service.tax_rate_bp),rental:service.rental??undefined,active:true,items:items.map(row=>({id:row.item_key,name:row.name,description:row.description??undefined,unitPrice:Number(row.unit_price),minQty:Number(row.min_qty),maxQty:Number(row.max_qty)})),addons:addons.map(row=>({id:row.addon_key,name:row.name,description:row.description??undefined,price:Number(row.price)})),questions:questions.map(row=>({id:row.question_key,prompt:row.prompt,kind:row.kind,required:row.required,choices:Array.isArray(row.choices)?row.choices:[],unitPrice:row.unit_price===null?undefined:Number(row.unit_price),minQty:row.min_qty===null?undefined:Number(row.min_qty),maxQty:row.max_qty===null?undefined:Number(row.max_qty)}))});
  createPricingEngine().price(config,selection);
 }catch(error){if(error instanceof FlowError)throw error;throw new FlowError('UNSUPPORTED_CONFIG');}
}
export function createDraftWriter(pool:Pool):DraftWriter{return async(actor,tenant,input)=>{
 const body=DraftInput.parse(input);const c=await pool.connect();let broken=false;
 try{
  await c.query('begin');await c.query("set local statement_timeout='5s'");await c.query('set local role service_role');
  const member=await c.query(`select t.id from public.tenants t join public.tenant_members m on m.tenant_id=t.id where t.id=$1::uuid and m.user_id=$2::uuid and t.status='active' and m.role in ('BUSINESS_OWNER','BUSINESS_STAFF') for share of t,m`,[tenant,actor]);
  if(member.rows.length!==1)throw new FlowError('FORBIDDEN');
  const service=await c.query('select id from public.services where id=$1::uuid and tenant_id=$2::uuid and active for share',[body.serviceId,tenant]);
  if(service.rows.length!==1)throw new FlowError('NOT_AVAILABLE');
  const selection=body.selection??Selection.parse({serviceId:body.serviceId});
  if(body.selection)await validateConfiguredSelection(c,tenant,body,selection);
  const rpcSelection=body.selection?selection:{serviceId:body.serviceId};
  const result=await c.query('select * from public.create_booking_draft($1::uuid,$2::text,$3::jsonb,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::text)',[tenant,body.idempotencyKey,JSON.stringify(rpcSelection),body.slotStart,body.slotEnd,JSON.stringify(body.customer),body.address?JSON.stringify(body.address):null,body.notes??null]);
  const parsed=z.array(z.object({booking_id:Uuid,reference:z.string().min(1).max(100)}).strict()).length(1).safeParse(result.rows);
  if(!parsed.success)throw new FlowError('INTERNAL_ERROR');
  const receipt=parsed.data[0]!;
  const bound=await c.query(`select id from public.bookings where id=$1::uuid and tenant_id=$2::uuid and reference=$3 and idempotency_key=$4 and selection=$5::jsonb and slot_start=$6::timestamptz and slot_end=$7::timestamptz and state='draft' and payment_id is null and pricing='{}'::jsonb for share`,[receipt.booking_id,tenant,receipt.reference,body.idempotencyKey,JSON.stringify(rpcSelection),body.slotStart,body.slotEnd]);
  if(bound.rows.length!==1)throw new FlowError('CONFLICT');
  await c.query('commit');return{bookingId:receipt.booking_id,reference:receipt.reference,state:'draft'};
 }catch(error){
  try{await c.query('rollback');}catch{broken=true;}
  if(error instanceof FlowError)throw error;
  const code=(error as {code?:string})?.code;
  if(code==='42883')throw new FlowError('UNSUPPORTED_CONFIG');
  if(code==='40001'||code==='40P01'||code==='23505'||code==='P0001')throw new FlowError('CONFLICT');
  throw new FlowError('INTERNAL_ERROR');
 }finally{c.release(broken);}
};}
