import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRentalMockPaymentWriter} from './rental-mock-payment';
import type {Pool} from 'pg';

const actor='b2300000-0000-4000-8000-000000000001',tenant='b2300000-0000-4000-8000-000000000002',booking='b2300000-0000-4000-8000-000000000003',service='b2300000-0000-4000-8000-000000000004',resource='b2300000-0000-4000-8000-000000000005';
const start='2035-01-01T10:00:00.000Z',end='2035-01-01T13:00:00.000Z';
const rentalSelection={serviceId:service,itemQuantities:{},addonIds:[],answers:{},rentalPeriods:3};
const serviceRow={id:service,tenant_id:tenant,archetype:'rental',name:'Vehicle rental',description:'',currency:'USD',base_price:0,duration_minutes:60,tax_rate_bp:0,rental:{periodMinutes:60,pricePerPeriod:100,minPeriods:1,maxPeriods:8,depositAmount:500},active:true};
const linkRow={resource_id:resource,quantity_required:1,resource_tenant_id:tenant,resource_active:true,resource_capacity:1};
const reservationRow={resource_id:resource,tenant_id:tenant,status:'held',unexpired:true,required_quantity:1,reservation_quantity:1,resource_capacity:1};
afterEach(()=>vi.restoreAllMocks());

function harness(opts:{member?:boolean;selection?:unknown;service?:unknown;links?:unknown[];reservations?:unknown[];booking?:unknown}={}){
  const query=vi.fn(async(sql:string)=>{
    if(sql.startsWith('select t.id'))return{rows:opts.member===false?[]:[{id:tenant}]};
    if(sql.startsWith('select id,tenant_id,selection,pricing'))return{rows:opts.booking===null?[]:[opts.booking??{id:'b2300000-0000-4000-8000-000000000003',tenant_id:tenant,selection:opts.selection??rentalSelection,pricing:{},payment_id:null,state:'draft',slot_start:start,slot_end:end}]};
    if(sql.startsWith('select s.id'))return{rows:opts.service===null?[]:[opts.service??serviceRow]};
    if(sql.startsWith('select sr.resource_id'))return{rows:opts.links??[linkRow]};
    if(sql.startsWith('select rr.resource_id'))return{rows:opts.reservations??[reservationRow]};
    return{rows:[]};
  });
  const release=vi.fn();
  const writer=createRentalMockPaymentWriter({connect:async()=>({query,release})} as never as Pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'staging'});
  return{writer,query,release};
}

describe('staging rental mock payment authority',()=>{
  it('requires explicit staging fake-payment gates',async()=>{
    const connect=vi.fn();
    expect(()=>createRentalMockPaymentWriter({connect} as never as Pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'production'})).toThrow();
    await expect(createRentalMockPaymentWriter({connect} as never as Pool,{})(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
    expect(connect).not.toHaveBeenCalled();
  });

  it('rechecks tenant membership before reading rental or reservation rows',async()=>{
    const h=harness({member:false});
    await expect(h.writer(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(h.query.mock.calls.some(([sql])=>String(sql).includes('resource_reservations'))).toBe(false);
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });

  it('rejects missing, expired and foreign resource holds before payment',async()=>{
    for(const reservations of [[],[{...reservationRow,unexpired:false}],[{...reservationRow,tenant_id:'b2300000-0000-4000-8000-000000000099'}]]){
      const h=harness({reservations});
      await expect(h.writer(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'CONFLICT'});
      expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
      expect(h.query.mock.calls.some(([sql])=>String(sql).includes('confirm_succeeded_payment'))).toBe(false);
    }
  });

  it('rejects wrong archetype and invalid rental periods without financial side effects',async()=>{
    for(const selection of [{...rentalSelection,rentalPeriods:0},{serviceId:service,itemQuantities:{},addonIds:[],answers:{}},{...rentalSelection,addonIds:['client-addon']}]){
      const h=harness({selection,service:{...serviceRow,archetype:'simple'}});
      await expect(h.writer(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
      expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
    }
  });

  it('validates server-derived total plus deposit, then fails closed before payment while resource authority is unsupported',async()=>{
    const h=harness();
    await expect(h.writer(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});
    const calls=h.query.mock.calls.map(([sql])=>String(sql));
    expect(calls.findIndex(sql=>sql.startsWith('insert into public.payments'))).toBe(-1);
    expect(calls.findIndex(sql=>sql.includes('confirm_succeeded_payment'))).toBe(-1);
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });

  it('rejects consumed reservations until future authority handles replay coherently',async()=>{
    const h=harness({reservations:[{...reservationRow,status:'consumed'}]});
    await expect(h.writer(actor,tenant,'b2300000-0000-4000-8000-000000000003')).rejects.toMatchObject({code:'CONFLICT'});
    expect(h.query.mock.calls.some(([sql])=>String(sql).startsWith('insert into public.payments'))).toBe(false);
    expect(h.query.mock.calls.at(-1)).toEqual(['rollback']);
  });
});
