import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {DetailingReservationInput,DetailingRequestReceipt,DetailingHoldReceipt,DetailingOfferReceipt,DetailingSchedulingReceipt,PublishDetailingDraft,buildDetailingService,Selection,Service} from '@lumin/contracts';
import {DetailingCatalogRender} from '@lumin/workflow';
import {createPricingEngine} from '@lumin/core';
import {FlowError,readAvailabilitySlots} from './repository';
import {reserveBookingInTransaction} from './reservation';
const Context=z.object({service:DetailingOfferReceipt.innerType().shape.service,catalog:DetailingCatalogRender.shape.catalog,scheduling:DetailingSchedulingReceipt,render:DetailingCatalogRender,installationId:z.string().uuid(),expiresAt:z.string().datetime({offset:true})}).strict();
const Target=z.object({context:Context,receipt:DetailingRequestReceipt}).strict();
export interface DetailingReservationApi{request(hash:string,origin:string,input:DetailingReservationInput):Promise<DetailingRequestReceipt>;hold(hash:string,origin:string):Promise<DetailingHoldReceipt>;}
export function createDetailingReservationApi(pool:Pool,approvedInput:readonly string[],clock=()=>Date.now()):DetailingReservationApi{
 const approved=PublishDetailingDraft.shape.allowedOrigins.parse([...approvedInput]);
 const credentials=(hash:string,origin:string)=>{if(!/^[0-9a-f]{64}$/.test(hash)||!approved.includes(origin))throw new FlowError('INVALID_REQUEST');};
 const check=(value:unknown)=>{const parsed=Context.safeParse(value);if(!parsed.success)throw new FlowError('INTERNAL_ERROR');const r=parsed.data;if(r.service.id!==r.render.serviceId||r.scheduling.serviceId!==r.service.id||r.scheduling.tenantId!==r.service.tenantId||!isDeepStrictEqual(r.catalog,r.render.catalog)||!isDeepStrictEqual(buildDetailingService(r.service.id,r.service.tenantId,{...r.catalog,idempotencyKey:'catalog-validation-0001'}),r.service)||Date.parse(r.expiresAt)<=clock())throw new FlowError('FORBIDDEN');return r;};
 const rpc=async(c:PoolClient,sql:string,args:unknown[])=>{const result=await c.query(sql,args);if(result.rows.length!==1)throw new FlowError('INTERNAL_ERROR');return result.rows[0]?.result;};
 const target=async(c:PoolClient,hash:string,origin:string)=>{const parsed=Target.safeParse(await rpc(c,'select public.detailing_reservation_target($1::text,$2::text,$3::jsonb) result',[hash,origin,JSON.stringify(approved)]));if(!parsed.success)throw new FlowError('INTERNAL_ERROR');const r=parsed.data;check(r.context);if(r.receipt.versionId!==r.context.render.versionId||r.receipt.installationId!==r.context.installationId||r.receipt.serviceId!==r.context.service.id||Date.parse(r.receipt.slot.end)-Date.parse(r.receipt.slot.start)!==r.context.service.durationMinutes*60000)throw new FlowError('INTERNAL_ERROR');return r;};
 const tx=async<T>(run:(c:PoolClient)=>Promise<T>)=>{const c=await pool.connect();let broken=false;try{await c.query('begin isolation level read committed');await c.query("set local statement_timeout='5s'");await c.query("set local lock_timeout='3s'");await c.query('set local role service_role');const r=await run(c);await c.query('commit');return r;}catch(error){try{await c.query('rollback');}catch{broken=true;}if(error instanceof FlowError)throw error;const code=(error as {code?:string}).code;throw new FlowError(code==='42501'?'FORBIDDEN':code==='P0002'?'NOT_AVAILABLE':code==='0A000'?'UNSUPPORTED_CONFIG':code==='22023'?'INVALID_REQUEST':['40001','40P01','55P03','57014','23505','23P01'].includes(code??'')?'CONFLICT':'INTERNAL_ERROR');}finally{c.release(broken);}};
 return{
  request:async(hash,origin,input)=>{credentials(hash,origin);const parsed=DetailingReservationInput.safeParse(input);if(!parsed.success)throw new FlowError('INVALID_REQUEST');const body=parsed.data;return tx(async c=>{
   const context=check(await rpc(c,'select public.detailing_reservation_context($1::text,$2::text,$3::jsonb) result',[hash,origin,JSON.stringify(approved)])),catalog=context.catalog,b=body.selection;
   if(!catalog.packages.some(p=>p.id===b.packageId)||!catalog.vehicles.some(v=>v.id===b.vehicleId)||b.addonIds.some(id=>!catalog.addons.some(a=>a.id===id))||(catalog.locations.length?!catalog.locations.some(l=>l.id===b.locationId):b.locationId!==undefined))throw new FlowError('INVALID_REQUEST');
   const choice={...b,addonIds:catalog.addons.filter(a=>b.addonIds.includes(a.id)).map(a=>a.id)},selection=Selection.parse({serviceId:context.service.id,addonIds:choice.addonIds,answers:{package:{choiceIds:[choice.packageId]},vehicle:{choiceIds:[choice.vehicleId]},...(choice.locationId?{location:{choiceIds:[choice.locationId]}}:{})}});
   let pricing;try{pricing=createPricingEngine().price(Service.parse(context.service),selection);}catch{throw new FlowError('INVALID_REQUEST');}
   const parsedReceipt=z.object({receipt:DetailingRequestReceipt,replayed:z.boolean()}).strict().safeParse(await rpc(c,'select public.submit_detailing_reservation($1::text,$2::text,$3::jsonb,$4::text,$5::jsonb,$6::jsonb,$7::timestamptz,$8::jsonb) result',[hash,origin,JSON.stringify(approved),body.idempotencyKey,JSON.stringify(choice),JSON.stringify(body.customer),body.requestedStart,JSON.stringify(pricing)]));
   if(!parsedReceipt.success)throw new FlowError('INTERNAL_ERROR');const receipt=parsedReceipt.data.receipt;
   if(receipt.serviceId!==context.service.id||receipt.versionId!==context.render.versionId||receipt.installationId!==context.installationId||receipt.slot.start!==body.requestedStart||!isDeepStrictEqual(receipt.selection,choice)||!isDeepStrictEqual(receipt.pricing,pricing))throw new FlowError('INTERNAL_ERROR');
   if(!parsedReceipt.data.replayed){
    const available=await readAvailabilitySlots(c,context.service.tenantId,context.service.id,{timezone:context.scheduling.timezone,duration_minutes:context.service.durationMinutes},receipt.slot.start,receipt.slot.end,()=>new Date(clock()).toISOString());
    if(!available.slots.some(s=>s.start===receipt.slot.start&&s.end===receipt.slot.end))throw new FlowError('NOT_AVAILABLE');
   }
   const final=await target(c,hash,origin);if(!isDeepStrictEqual(final.context,context)||!isDeepStrictEqual(final.receipt,receipt))throw new FlowError('CONFLICT');return receipt;
  });},
  hold:async(hash,origin)=>{credentials(hash,origin);return tx(async c=>{
   const before=await target(c,hash,origin),receipt=before.receipt;
   // A successful hold replay returns the original live tuple; expired/released holds never renew silently.
   const old=(await c.query('select status,expires_at from public.capacity_holds where booking_id=$1::uuid',[receipt.bookingId])).rows[0];
   if(old&&(old.status!=='active'||new Date(old.expires_at).getTime()<=clock()))throw new FlowError('CONFLICT');
   const reserved=await reserveBookingInTransaction(c,before.context.service.tenantId,receipt.bookingId,()=>new Date(clock()).toISOString(),receipt.serviceId);
   const final=await target(c,hash,origin);if(!isDeepStrictEqual(before,final)||reserved.bookingId!==receipt.bookingId)throw new FlowError('CONFLICT');
   const output=DetailingHoldReceipt.safeParse({schemaVersion:1,versionId:receipt.versionId,installationId:receipt.installationId,serviceId:receipt.serviceId,...reserved});if(!output.success)throw new FlowError('INTERNAL_ERROR');return output.data;
  });}
 };
}
