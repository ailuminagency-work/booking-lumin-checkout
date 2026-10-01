import {afterEach,describe,expect,it,vi} from 'vitest';
import {Service,Selection} from '@lumin/contracts';
import {createPricingEngine} from '@lumin/core';
import {createRentalMockPaymentWriter} from './rental-mock-payment';
import type {Pool} from 'pg';

const actor='b2300000-0000-4000-8000-000000000001',tenant='b2300000-0000-4000-8000-000000000002',booking='b2300000-0000-4000-8000-000000000003',serviceId='b2300000-0000-4000-8000-000000000004',resource='b2300000-0000-4000-8000-000000000005',paymentId='b2300000-0000-4000-8000-000000000006';
const slotStart='2035-01-01T10:00:00.000Z',slotEnd='2035-01-01T13:00:00.000Z';
const selection=Selection.parse({serviceId:serviceId,itemQuantities:{},addonIds:[],answers:{},rentalPeriods:3});
const serviceRow={id:serviceId,tenant_id:tenant,archetype:'rental',name:'Vehicle rental',description:'',currency:'USD',base_price:0,duration_minutes:60,tax_rate_bp:0,rental:{periodMinutes:60,pricePerPeriod:100,minPeriods:1,maxPeriods:8,depositAmount:500},active:true};
const service=Service.parse({id:serviceId,tenantId:tenant,archetype:'rental',name:'Vehicle rental',description:'',currency:'USD',basePrice:0,durationMinutes:60,taxRateBp:0,rental:serviceRow.rental,active:true,items:[],addons:[],questions:[]});
const pricing=createPricingEngine().price(service,selection),amount=pricing.total.amount+pricing.deposit.amount;
const baseBooking={id:booking,tenant_id:tenant,selection,pricing,payment_id:null,state:'draft',slot_start:slotStart,slot_end:slotEnd};
const link={resource_id:resource,quantity_required:1,resource_tenant_id:tenant,resource_active:true,resource_capacity:1};
const held={resource_id:resource,tenant_id:tenant,status:'held',unexpired:true,required_quantity:1,reservation_quantity:1,resource_capacity:1,slot_matches:true};
afterEach(()=>vi.restoreAllMocks());

function harness(opts:{booking?:unknown;payments?:unknown[];reservations?:unknown[]}={}){
 const inserted={id:paymentId};
 const query=vi.fn(async(sql:string)=>{
  if(sql.startsWith('select t.id'))return{rows:[{id:tenant}]};
  if(sql.startsWith('select * from public.payments'))return{rows:opts.payments??[]};
  if(sql.startsWith('select id,tenant_id,selection,pricing'))return{rows:[opts.booking??baseBooking]};
  if(sql.startsWith('select s.id'))return{rows:[serviceRow]};
  if(sql.startsWith('select sr.resource_id'))return{rows:[link]};
  if(sql.startsWith('select rr.resource_id'))return{rows:opts.reservations??[held]};
  if(sql.startsWith('insert into public.payments'))return{rows:[inserted]};
  if(sql.startsWith('select public.confirm_succeeded_payment'))return{rows:[{result:{bookingId:booking,paymentId,state:'confirmed',replayed:Boolean(opts.payments?.length)}}]};
  return{rows:[]};
 });
 const release=vi.fn();
 const writer=createRentalMockPaymentWriter({connect:async()=>({query,release})} as never as Pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'});
 return{writer,query,release};
}

describe('rental mock-payment writer authority',()=>{
 it('derives pricing, writes one staging payment, and invokes atomic confirmation',async()=>{
  const h=harness();const receipt=await h.writer(actor,tenant,booking);
  expect(receipt).toEqual({bookingId:booking,paymentId,state:'confirmed',replayed:false,provider:'staging_mock',simulated:true});
  expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(true);
  expect(h.query.mock.calls.some(([sql])=>String(sql).includes('confirm_succeeded_payment'))).toBe(true);
  const insert=h.query.mock.calls.find(([sql])=>String(sql).startsWith('insert into public.payments'))!;
  expect(insert[1]).toEqual([tenant,booking,`staging_mock:${booking}`,amount,'USD']);
  expect(h.query.mock.calls.at(-1)).toEqual(['commit']);
 });
 it('replays a consumed rental hold without a second payment',async()=>{
  const payment={id:paymentId,tenant_id:tenant,booking_id:booking,provider:'staging_mock',provider_intent_id:`staging_mock:${booking}`,state:'succeeded',amount,currency:'USD'};
  const h=harness({booking:{...baseBooking,pricing,payment_id:paymentId,state:'confirmed'},payments:[payment],reservations:[{...held,status:'consumed'}]});
  await expect(h.writer(actor,tenant,booking)).resolves.toMatchObject({replayed:true});
  expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
  expect(h.query.mock.calls.at(-1)).toEqual(['commit']);
 });
 it('rejects expired or foreign holds before any payment write',async()=>{
  for(const reservations of [[{...held,unexpired:false}],[{...held,tenant_id:'b2300000-0000-4000-8000-000000000099'}]]){
   const h=harness({reservations});await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT'});
   expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
  }
 });
});
