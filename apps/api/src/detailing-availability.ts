import {isDeepStrictEqual} from 'node:util';
import type {Pool} from 'pg';
import {z} from 'zod';
import {DetailingAvailabilityQuery,DetailingAvailabilityReceipt,DetailingOfferReceipt,DetailingSchedulingReceipt,PublishDetailingDraft,buildDetailingService} from '@lumin/contracts';
import {DetailingCatalogRender} from '@lumin/workflow';
import {FlowError,readAvailabilitySlots} from './repository';

const Context=z.object({service:DetailingOfferReceipt.innerType().shape.service,catalog:DetailingCatalogRender.shape.catalog,
 scheduling:DetailingSchedulingReceipt,render:DetailingCatalogRender,installationId:z.string().uuid(),expiresAt:z.string().datetime({offset:true})}).strict();
export type DetailingAvailabilityReader=(hash:string,origin:string,query:DetailingAvailabilityQuery)=>Promise<DetailingAvailabilityReceipt>;
export function createDetailingAvailabilityReader(pool:Pool,approvedInput:readonly string[],clock=()=>Date.now()):DetailingAvailabilityReader{
 const approved=PublishDetailingDraft.shape.allowedOrigins.parse([...approvedInput]);
 return async(hash,origin,input)=>{
  const query=DetailingAvailabilityQuery.safeParse(input);
  if(!query.success||!/^[0-9a-f]{64}$/.test(hash)||!approved.includes(origin))throw new FlowError('INVALID_REQUEST');
  const c=await pool.connect();let broken=false;
  try{
   await c.query('begin isolation level read committed');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');
   const resolve=async()=>{
    const result=await c.query('select public.resolve_detailing_flow_session($1::text,$2::text,$3::jsonb) result',[hash,origin,JSON.stringify(approved)]);
    const parsed=Context.safeParse(result.rows.length===1?result.rows[0]?.result:undefined);
    if(!parsed.success)throw new FlowError('INTERNAL_ERROR');const r=parsed.data;
    if(r.service.id!==r.render.serviceId||r.scheduling.serviceId!==r.service.id||r.scheduling.tenantId!==r.service.tenantId||!isDeepStrictEqual(r.catalog,r.render.catalog)||!isDeepStrictEqual(buildDetailingService(r.service.id,r.service.tenantId,{...r.catalog,idempotencyKey:'catalog-validation-0001'}),r.service)||Date.parse(r.expiresAt)<=clock())throw new FlowError('FORBIDDEN');
    return r;
   };
   const r=await resolve();
   const availability=await readAvailabilitySlots(c,r.service.tenantId,r.service.id,{timezone:r.scheduling.timezone,duration_minutes:r.service.durationMinutes},query.data.from,query.data.to,()=>new Date(clock()).toISOString());
   if(availability.serviceId!==r.service.id||availability.durationMinutes!==r.service.durationMinutes||availability.slots.some(s=>Date.parse(s.start)<Date.parse(query.data.from)||Date.parse(s.end)>Date.parse(query.data.to)))throw new FlowError('INTERNAL_ERROR');
   const receipt=DetailingAvailabilityReceipt.safeParse({schemaVersion:1,versionId:r.render.versionId,installationId:r.installationId,serviceId:r.service.id,expiresAt:r.expiresAt,durationMinutes:r.service.durationMinutes,timezone:r.scheduling.timezone,slots:availability.slots});
   if(!receipt.success)throw new FlowError('INTERNAL_ERROR');
   if(!isDeepStrictEqual(await resolve(),r))throw new FlowError('CONFLICT');
   await c.query('commit');return receipt.data;
  }catch(e){try{await c.query('rollback');}catch{broken=true;}if(e instanceof FlowError)throw e;const code=(e as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='0A000'?'UNSUPPORTED_CONFIG':['55P03','57014','40P01','40001'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{c.release(broken);}
 };
}

