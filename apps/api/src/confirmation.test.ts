import {afterEach,describe,it,expect,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import {createBookingConfirmation,type BookingConfirmation} from './confirmation';
import {FlowError} from './repository';
const actor='a4200000-0000-4000-8000-000000000001',tenant='a4200000-0000-4000-8000-000000000002',booking='a4200000-0000-4000-8000-000000000003',foreign='b4200000-0000-4000-8000-000000000002',origin='https://portal.example.test';
let server:Server;
afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function setup(confirmation?:BookingConfirmation){server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[origin],customerOrigins:[],authenticateOwner:async t=>t==='owner-token-123456'?actor:null,...(confirmation?{confirmation}:{})});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;return(body:unknown,t=tenant,token='owner-token-123456')=>fetch(`${base}/api/bookings/confirm?tenantId=${t}`,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});}
describe('fail-closed authenticated booking confirmation',()=>{
 it('denies by default without claiming a confirmed state',async()=>{const post=await setup();const response=await post({bookingId:booking});expect(response.status).toBe(422);expect(await response.json()).toEqual({ok:false,code:'UNSUPPORTED_CONFIG'});});
 it('authenticates before invoking the boundary',async()=>{const confirm=vi.fn<BookingConfirmation>();const post=await setup(confirm);expect((await post({bookingId:booking},tenant,'invalid-token-123456')).status).toBe(401);expect(confirm).not.toHaveBeenCalled();});
 it('rejects caller-controlled payment, confirmation and authority fields',async()=>{const confirm=vi.fn<BookingConfirmation>();const post=await setup(confirm);for(const extra of [{confirmed:true},{state:'confirmed'},{paymentState:'succeeded'},{paymentId:foreign},{provider:'mock'},{tenantId:foreign},{actorId:foreign},{serviceId:foreign},{capacity:100}])expect((await post({bookingId:booking,...extra})).status).toBe(400);expect(confirm).not.toHaveBeenCalled();});
 it('passes verified identity and rejects foreign tenant',async()=>{const confirm=vi.fn<BookingConfirmation>(async()=>{throw new FlowError('FORBIDDEN');});const post=await setup(confirm);const response=await post({bookingId:booking},foreign);expect(response.status).toBe(403);expect(confirm).toHaveBeenCalledWith(actor,foreign,booking);});
 it('cannot turn an unexpectedly resolving implementation into success',async()=>{const post=await setup((async()=>({confirmed:true})) as unknown as BookingConfirmation);const response=await post({bookingId:booking});expect(response.status).toBe(500);expect(await response.json()).toEqual({ok:false,code:'INTERNAL_ERROR'});});
});
describe('database confirmation gate',()=>{
 const payment='a4200000-0000-4000-8000-000000000004';
 const receipt={bookingId:booking,paymentId:payment,state:'confirmed',replayed:false};
 function harness(options:{member?:boolean;target?:boolean;payment?:string|null;receipt?:unknown;error?:string;lostBinding?:boolean}={}){const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql.startsWith('select t.id'))return{rows:options.member===false?[]:[{id:tenant}]};
  if(sql.includes('and payment_id=' )&&options.lostBinding)return{rows:[]};
  if(sql.startsWith('select id'))return{rows:options.target===false?[]:[{id:booking,payment_id:options.payment===undefined?payment:options.payment}]};
  if(sql.startsWith('select public.confirm')){if(options.error)throw Object.assign(Error('private database detail'),{code:options.error});return{rows:[{result:options.receipt??receipt}]};}
  return{rows:[]};});const release=vi.fn();return{query,release,confirm:createBookingConfirmation({connect:async()=>({query,release})} as never)};}
 it('derives the payment from authorized booking, validates then commits',async()=>{const h=harness();expect(await h.confirm(actor,tenant,booking)).toEqual(receipt);expect(h.query).toHaveBeenCalledWith(expect.stringContaining('for share of t,m'),[tenant,actor]);expect(h.query).toHaveBeenCalledWith('select public.confirm_succeeded_payment($1::uuid) result',[payment]);expect(h.query.mock.calls.at(-1)?.[0]).toBe('commit');expect(h.release).toHaveBeenCalledWith(false);});
 it('canonicalizes uppercase booking and persisted payment UUIDs',async()=>{const h=harness({payment:payment.toUpperCase(),receipt:{...receipt,bookingId:booking.toUpperCase(),paymentId:payment.toUpperCase()}});expect(await h.confirm(actor,tenant,booking.toUpperCase())).toEqual(receipt);expect(h.query).toHaveBeenCalledWith('select public.confirm_succeeded_payment($1::uuid) result',[payment]);});
 it('denies membership before reading booking',async()=>{const h=harness({member:false});await expect(h.confirm(actor,foreign,booking)).rejects.toMatchObject({code:'FORBIDDEN'});expect(h.query.mock.calls.some(c=>c[0].startsWith('select id'))).toBe(false);});
 it('does not disclose absent booking',async()=>{await expect(harness({target:false}).confirm(actor,tenant,booking)).rejects.toMatchObject({code:'NOT_AVAILABLE'});});
 it('fails closed without a linked payment or installed RPC',async()=>{for(const options of [{payment:null},{error:'42883'}])await expect(harness(options).confirm(actor,tenant,booking)).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});});
 it('rolls back invalid or substituted receipts before commit',async()=>{for(const bad of [{...receipt,bookingId:foreign},{...receipt,paymentId:foreign},{...receipt,state:'draft'},{...receipt,provider:'secret'},null]){const h=harness({receipt:bad===null?{}:bad});await expect(h.confirm(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(h.query.mock.calls.at(-1)?.[0]).toBe('rollback');expect(h.query.mock.calls.some(c=>c[0]==='commit')).toBe(false);}});
 it('rolls back if authorized tenant binding changes during RPC',async()=>{const h=harness({lostBinding:true});await expect(h.confirm(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT'});expect(h.query.mock.calls.at(-1)?.[0]).toBe('rollback');});
 it('redacts DB errors and maps authority rejection',async()=>{for(const [error,code] of [['22023','CONFLICT'],['40001','CONFLICT'],['XX000','INTERNAL_ERROR']])await expect(harness({error}).confirm(actor,tenant,booking)).rejects.toMatchObject({code,message:code});});
 it('returns a valid HTTP receipt and rejects substituted booking receipts',async()=>{const post=await setup(async()=>receipt as Awaited<ReturnType<BookingConfirmation>>);const response=await post({bookingId:booking.toUpperCase()});expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,data:{schemaVersion:1,...receipt}});expect((await post({bookingId:foreign})).status).toBe(500);});
});
