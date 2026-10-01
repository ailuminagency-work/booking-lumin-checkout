import {afterEach,describe,expect,it,vi} from 'vitest';
import {createFlowHttpServer} from './http';
import {RentalMockPaymentReceipt} from './rental-mock-payment';
import {FlowError} from './repository';

const actor='b2300000-0000-4000-8000-000000000001',tenant='b2300000-0000-4000-8000-000000000002',booking='b2300000-0000-4000-8000-000000000003';
const token='rental-http-owner-token-123';
let server:ReturnType<typeof createFlowHttpServer>|undefined;
afterEach(async()=>{if(server){await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined;}});

async function setup(writer= (async(_actor:string,requestedTenant:string,requestedBooking:string)=>{if(requestedTenant!==tenant)throw new FlowError('NOT_AVAILABLE');return{bookingId:requestedBooking,paymentId:'b2300000-0000-4000-8000-000000000004',state:'confirmed' as const,replayed:false,provider:'staging_mock' as const,simulated:true as const};})){ 
 const rentalMockPayment=vi.fn(writer);
 server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},rentalMockPayment,ownerOrigins:['https://portal.example.test'],customerOrigins:[],authenticateOwner:async credential=>credential===token?actor:null});
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 return{rentalMockPayment,request:async(body:unknown,query=`tenantId=${tenant}`)=>fetch(`http://127.0.0.1:${(server!.address() as {port:number}).port}/api/bookings/rental-mock-payment?${query}`,{method:'POST',headers:{origin:'https://portal.example.test',authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})};
}

describe('rental mock-payment HTTP contract',()=>{
 it('accepts bookingId-only input and returns a versioned receipt',async()=>{
  const h=await setup();const response=await h.request({bookingId:booking});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,data:{schemaVersion:1,...RentalMockPaymentReceipt.parse({bookingId:booking,paymentId:'b2300000-0000-4000-8000-000000000004',state:'confirmed',replayed:false,provider:'staging_mock',simulated:true})}});
  expect(h.rentalMockPayment).toHaveBeenCalledWith(actor,tenant,booking);
 });
 it('rejects client financial or provider fields and foreign tenant context',async()=>{
  const h=await setup();
  expect((await h.request({bookingId:booking,amount:1})).status).toBe(400);
  expect((await h.request({bookingId:booking},`tenantId=b2300000-0000-4000-8000-000000000099`)).status).toBe(404);
  expect(h.rentalMockPayment).not.toHaveBeenCalled();
 });
 it('maps a writer fail-closed result without widening the route',async()=>{
  const h=await setup(async()=>{throw new FlowError('UNSUPPORTED_CONFIG');});
  expect((await h.request({bookingId:booking})).status).toBe(422);
 });
});
