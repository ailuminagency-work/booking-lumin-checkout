import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {createConfirmationReceiptHistoryReader} from './confirmation-receipt-history';
const id=(n:number)=>`68000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),booking=id(3),foreign=id(4);
const email={channel:'email',recordedAt:'2026-10-01T12:34:56.123456Z'},sms={channel:'sms',recordedAt:'2026-10-02T01:02:03.000000Z'};
type Rows={tenants:unknown[];owners:unknown[];bookings:unknown[];history:unknown[]};
function fixture(overrides:Partial<Rows>={}){
 const rows:Rows={tenants:[{id:tenant,status:'active'}],owners:[{tenant_id:tenant,user_id:actor,role:'BUSINESS_OWNER'}],bookings:[{id:booking,tenant_id:tenant}],history:[],...overrides};
 const query=vi.fn(async(sql:string,_args?:unknown[])=>({rows:sql.includes('from public.tenants')?rows.tenants:sql.includes('from public.tenant_members')?rows.owners:sql.includes('from public.bookings')?rows.bookings:sql.includes('outbox_confirmation_receipt_history')?rows.history:[]}));
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}));return{rows,query,release,connect,read:createConfirmationReceiptHistoryReader({connect} as unknown as Pool)};
}
it.each([[],[email],[sms],[email,sms]].map(history=>({history})))('returns only recorded historical rows without generating absent timestamps',async({history})=>{
 const f=fixture({history});expect(await f.read(actor,tenant,booking)).toEqual({schemaVersion:1,tenantId:tenant,bookingId:booking,receipts:history});
 expect(f.query).toHaveBeenLastCalledWith('commit');expect(f.release).toHaveBeenCalledWith(false);
});
it('locks fresh active tenant, exact owner and bound booking before one fixed metadata RPC snapshot',async()=>{
 const f=fixture();await f.read(actor,tenant,booking);const calls=f.query.mock.calls;
 expect(calls[0]![0]).toBe('begin isolation level repeatable read');expect(calls[1]![0]).toContain("statement_timeout='5s'");expect(calls[2]![0]).toContain("lock_timeout='3s'");expect(calls[3]![0]).toBe('set local role service_role');
 expect(calls[4]![1]).toEqual([tenant]);expect(calls[5]![1]).toEqual([tenant,actor]);expect(calls[6]![1]).toEqual([tenant,booking]);expect(calls[7]![1]).toEqual([tenant,booking]);
 for(const index of [4,5,6])expect(calls[index]![0]).toContain('for share');
 const sql=calls.map(([sql])=>sql).join('\n');expect(sql).toContain("status='active'");expect(sql).toContain("role='BUSINESS_OWNER'");expect(sql).toContain("recorded_at at time zone 'UTC'");expect(sql).toContain('SS.US');
 expect(sql).not.toMatch(/insert|update|delete|outbox_lease|outbox_ack|outbox_retry|confirmation_delivery_receipts|connection_secrets|now\(|clock_timestamp/i);
 expect(calls.filter(([sql])=>sql.includes('outbox_confirmation_receipt_history'))).toHaveLength(1);
});
it.each([{tenants:[]},{owners:[]}])('denies absent/inactive tenant or non-owner before any history access',async(change)=>{
 const f=fixture(change);await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.query.mock.calls.some(([sql])=>sql.includes('outbox_confirmation_receipt_history'))).toBe(false);expect(f.query).toHaveBeenLastCalledWith('rollback');
});
it('denies a foreign or missing booking before reading history',async()=>{const f=fixture({bookings:[]});await expect(f.read(actor,tenant,foreign)).rejects.toMatchObject({code:'NOT_AVAILABLE'});expect(f.query.mock.calls.some(([sql])=>sql.includes('outbox_confirmation_receipt_history'))).toBe(false);});
it('freshly rechecks ownership on every call after membership removal',async()=>{const f=fixture();await f.read(actor,tenant,booking);f.rows.owners=[];await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.connect).toHaveBeenCalledTimes(2);expect(f.query.mock.calls.filter(([sql])=>sql.includes('outbox_confirmation_receipt_history'))).toHaveLength(1);});
it.each([
 {tenants:[{id:foreign,status:'active'}]},{tenants:[{id:tenant,status:'suspended'}]},{tenants:[{id:tenant,status:'active',secret:'private'}]},{tenants:[{id:tenant,status:'active'},{id:tenant,status:'active'}]},
 {owners:[{tenant_id:foreign,user_id:actor,role:'BUSINESS_OWNER'}]},{owners:[{tenant_id:tenant,user_id:foreign,role:'BUSINESS_OWNER'}]},{owners:[{tenant_id:tenant,user_id:actor,role:'BUSINESS_STAFF'}]},{owners:[{tenant_id:tenant,user_id:actor,role:'BUSINESS_OWNER',token:'private'}]},
 {bookings:[{id:foreign,tenant_id:tenant}]},{bookings:[{id:booking,tenant_id:foreign}]},{bookings:[{id:booking,tenant_id:tenant,customerEmail:'private@example.test'}]},
 {history:[{...email,recordedAt:null}]},{history:[{...email,recordedAt:new Date()}]},{history:[{...email,recordedAt:'infinity'}]},{history:[{...email,recordedAt:'2026-02-30T12:34:56Z'}]},
 {history:[{...email,recipient:'private@example.test'}]},{history:[{...email,tenantId:foreign}]},{history:[{...email,channel:'push'}]},
 {history:[sms,email]},{history:[email,email]},{history:[email,sms,email]},
] as Partial<Rows>[])('fails closed on malformed, foreign, widened, duplicate or reordered adapter rows',async(change)=>{const f=fixture(change);await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});expect(f.query).toHaveBeenLastCalledWith('rollback');});
it.each(['40001','40P01','55P03','57014'])('withholds the response on authorization conflict/timeout %s',async(code)=>{
 const f=fixture();f.query.mockImplementation(async sql=>{if(sql.includes('tenant_members'))throw {code,message:'raw-private-detail'};return{rows:sql.includes('public.tenants')?f.rows.tenants:[]};});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT',message:'CONFLICT'});
});
it.each([['42501','FORBIDDEN'],['P0002','NOT_AVAILABLE'],['XX000','INTERNAL_ERROR']])('sanitizes RPC error %s to %s',async(code,expected)=>{
 const f=fixture();const original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args)=>{if(sql.includes('outbox_confirmation_receipt_history'))throw{code,message:'private-provider-payload'};return original(sql,args);});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:expected,message:expected});
});
it('rejects invalid identifiers before opening a connection',async()=>{const f=fixture();for(const values of [['invalid',tenant,booking],[actor,'invalid',booking],[actor,tenant,'invalid']])await expect(f.read(values[0]!,values[1]!,values[2]!)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(f.connect).not.toHaveBeenCalled();});
it('masks acquisition failures',async()=>{const f=fixture();f.connect.mockRejectedValue(Error('private-db-credential'));await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});expect(f.query).not.toHaveBeenCalled();});
it('does not return history when commit fails',async()=>{const f=fixture({history:[email]});const original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args)=>{if(sql==='commit')throw{code:'40001',message:'raw commit failure'};return original(sql,args);});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT'});expect(f.query).toHaveBeenLastCalledWith('rollback');});
it('discards the connection when rollback fails',async()=>{const f=fixture({history:[{...email,recordedAt:null}]});const original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,args)=>{if(sql==='rollback')throw Error('broken socket');return original(sql,args);});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(f.release).toHaveBeenCalledWith(true);});
