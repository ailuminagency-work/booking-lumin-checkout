import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRentalMockPaymentWriter,type RentalMockPaymentWriter} from './rental-mock-payment';
import type {Pool} from 'pg';

const actor='b2300000-0000-4000-8000-000000000001',tenant='b2300000-0000-4000-8000-000000000002',booking='b2300000-0000-4000-8000-000000000003',service='b2300000-0000-4000-8000-000000000004',resource='b2300000-0000-4000-8000-000000000005',payment='b2300000-0000-4000-8000-000000000006';
const start='2035-01-01T10:00:00.000Z',end='2035-01-01T13:00:00.000Z';
const rentalSelection={serviceId:service,itemQuantities:{},addonIds:[],answers:{},rentalPeriods:3};
const serviceRow={id:service,tenant_id:tenant,archetype:'rental',name:'Vehicle rental',description:'',currency:'USD',base_price:0,duration_minutes:60,tax_rate_bp:0,rental:{periodMinutes:60,pricePerPeriod:100,minPeriods:1,maxPeriods:8,depositAmount:500},active:true};
const linkRow={resource_id:resource,quantity_required:1,resource_tenant_id:tenant,resource_active:true,resource_capacity:1};
const reservationRow={resource_id:resource,tenant_id:tenant,status:'held',expires_at:'2035-01-01T14:00:00.000Z',slot_start:start,slot_end:end};
afterEach(()=>vi.restoreAllMocks());

function harness(opts:{member?:boolean;selection?:unknown;service?:unknown;links?:unknown[];reservations?:unknown[];paymentRows?:unknown[];confirm?:unknown;booking?:unknown}={}){
  const query=vi.fn(async(sql:string,params?:unknown[])=>{
    if(sql.startsWith('select t.id'))return{rows:opts.member===false?[]:[{id:tenant}]};
    if(sql.startsWith('select id,tenant_id,selection,pricing'))return{rows:opts.booking===null?[]:[opts.booking??{id:booking,tenant_id:tenant,selection:opts.selection??rentalSelection,pricing:{},payment_id:null,state:'draft',slot_start:start,slot_end:end}]};
    if(sql.startsWith('select s.id'))return{rows:opts.service===null?[]:[opts.service??serviceRow]};
    if(sql.startsWith('select sr.resource_id'))return{rows:opts.links??[linkRow]};
    if(sql.startsWith('select resource_id,tenant_id,status'))return{rows:opts.reservations??[reservationRow]};
    if(sql.startsWith('select id,tenant_id,booking_id'))return{rows:opts.paymentRows??[]};
    if(sql.startsWith('insert into public.payments'))return{rows:[{id:payment}]};
    if(sql.startsWith('select public.confirm_succeeded_payment'))return{rows:[{result:opts.confirm??{bookingId:booking,paymentId:payment,state:'confirmed',replayed:false}}]};
    return{rows:[]};
  });
  const release=vi.fn();
  const writer=createRentalMockPaymentWriter({connect:async()=>({query,release})} as never as Pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'});
  return{writer,query,release};
}

describe('staging rental mock payment authority',()=>{
  it('requires explicit staging fake-payment gates',async()=>{
    const connect=vi.fn();
    expect(()=>createRentalMockPaymentWriter({connect} as never as Pool, {BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'production'})).toThrow();
    await expect(createRentalMockPaymentWriter({connect} as never as Pool,{})(actor,tenant,booking)).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
    expect(connect).not.toHaveBeenCalled();
  });

  it('rechecks tenant membership before reading rental or reservation rows',async()=>{
    const h=harness({member:false});
    await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(h.query.mock.calls.some(([sql])=>String(sql).includes('resource_reservations'))).toBe(false);
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });

  it('rejects missing, expired and foreign resource holds before payment',async()=>{
    for(const reservations of [[],[{...reservationRow,expires_at:'2020-01-01T00:00:00.000Z'}],[{...reservationRow,tenant_id:'b2300000-0000-4000-8000-000000000099'}]]){
      const h=harness({reservations});
      await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT'});
      expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
      expect(h.query.mock.calls.some(([sql])=>String(sql).includes('confirm_succeeded_payment'))).toBe(false);
    }
  });

  it('rejects wrong archetype and invalid rental periods without financial side effects',async()=>{
    for(const selection of [{...rentalSelection,rentalPeriods:0},{serviceId:service,itemQuantities:{},addonIds:[],answers:{}},{...rentalSelection,addonIds:['client-addon']}]){
      const h=harness({selection,service:{...serviceRow,archetype:'simple'}});
      await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
      expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
    }
  });

  it('derives total plus deposit, persists staging_mock, then invokes atomic confirmation',async()=>{
    const h=harness();
    const receipt=await h.writer(actor,tenant,booking);
    expect(receipt).toEqual({bookingId:booking,paymentId:payment,state:'confirmed',replayed:false,provider:'staging_mock',simulated:true});
    const calls=h.query.mock.calls.map(([sql])=>String(sql));
    const insert=calls.findIndex(sql=>sql.startsWith('insert into public.payments'));
    const confirm=calls.findIndex(sql=>sql.includes('confirm_succeeded_payment'));
    expect(insert).toBeGreaterThan(-1);expect(confirm).toBeGreaterThan(insert);
    expect(h.query.mock.calls[insert]?.[1]).toEqual([tenant,booking,`staging_mock:${booking}`,800,'USD']);
    expect(h.query.mock.calls.some(([sql,params])=>String(sql).startsWith('update public.bookings set pricing')&&String(params).includes('300'))).toBe(true);
    expect(h.query.mock.calls.at(-1)).toEqual(['commit']);
  });

  it('fails closed on substituted confirmation and rolls back the persisted payment',async()=>{
    const h=harness({confirm:{bookingId:booking,paymentId:payment,state:'confirmed',replayed:false,provider:'stripe',simulated:false}});
    await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });

  it('maps unavailable authority and serialization races without leaking details',async()=>{
    const h=harness();h.query.mockImplementation(async(sql:string)=>{
      if(sql.includes('confirm_succeeded_payment'))throw Object.assign(new Error('private'),{code:'0A000'});
      if(sql.startsWith('select t.id'))return{rows:[{id:tenant}]};
      if(sql.startsWith('select id,tenant_id,selection,pricing'))return{rows:[{id:booking,tenant_id:tenant,selection:rentalSelection,pricing:{},payment_id:null,state:'draft',slot_start:start,slot_end:end}]};
      if(sql.startsWith('select s.id'))return{rows:[serviceRow]};if(sql.startsWith('select sr.resource_id'))return{rows:[linkRow]};if(sql.startsWith('select resource_id,tenant_id,status'))return{rows:[reservationRow]};if(sql.startsWith('select id,tenant_id,booking_id'))return{rows:[]};if(sql.startsWith('insert into public.payments'))return{rows:[{id:payment}]};return{rows:[]};
    });
    await expect(h.writer(actor,tenant,booking)).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });
});
