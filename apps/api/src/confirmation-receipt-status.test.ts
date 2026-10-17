import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {ConfirmationReceiptStatus,createConfirmationReceiptStatusReader} from './confirmation-receipt-status';
const id=(n:number)=>`67000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),booking=id(3),foreign=id(4);
type Rows={tenants:unknown[];owners:unknown[];bookings:unknown[];flags:unknown[]};
function fixture(overrides:Partial<Rows>={}){
 const rows:Rows={tenants:[{id:tenant,status:'active'}],owners:[{tenant_id:tenant,user_id:actor,role:'BUSINESS_OWNER'}],bookings:[{id:booking,tenant_id:tenant}],flags:[{emailReceiptRecorded:false,smsReceiptRecorded:false}],...overrides};
 const query=vi.fn(async(sql:string,_args?:unknown[])=>({rows:sql.includes('from public.tenants')?rows.tenants:sql.includes('from public.tenant_members')?rows.owners:sql.includes('from public.bookings')?rows.bookings:sql.includes('outbox_confirmation_delivered')?rows.flags:[]}));
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}));return{rows,query,release,connect,read:createConfirmationReceiptStatusReader({connect} as unknown as Pool)};
}
it.each([[false,false],[true,false],[false,true],[true,true]])('returns strictly recorded receipt flags %s/%s without inventing delivery state',async(email,sms)=>{
 const f=fixture({flags:[{emailReceiptRecorded:email,smsReceiptRecorded:sms}]});const result=await f.read(actor,tenant,booking);
 expect(result).toEqual({schemaVersion:1,tenantId:tenant,bookingId:booking,channels:[{channel:'email',receiptRecorded:email},{channel:'sms',receiptRecorded:sms}]});
 expect(JSON.stringify(result)).not.toMatch(/sent|delivered|provider|simulated|timestamp|recipient/i);expect(f.query).toHaveBeenLastCalledWith('commit');expect(f.release).toHaveBeenCalledWith(false);
});
it('uses trusted owner/tenant/booking locks in authorization order and a single fixed per-channel snapshot query',async()=>{
 const f=fixture();await f.read(actor,tenant,booking);const calls=f.query.mock.calls;
 expect(calls[0]![0]).toBe('begin isolation level repeatable read');expect(calls[3]![0]).toBe('set local role service_role');
 expect(calls[4]![1]).toEqual([tenant]);expect(calls[5]![1]).toEqual([tenant,actor]);expect(calls[6]![1]).toEqual([tenant,booking]);expect(calls[7]![1]).toEqual([tenant,booking]);
 for(const index of [4,5,6])expect(calls[index]![0]).toContain('for share');
 const sql=calls.map(([sql])=>sql).join('\n');expect(sql).toContain("status='active'");expect(sql).toContain("role='BUSINESS_OWNER'");expect(sql).not.toMatch(/insert|update|delete|outbox_lease|outbox_ack|outbox_retry|confirmation_delivery_receipts|connection_secrets/i);
 expect(calls.filter(([sql])=>sql.includes('outbox_confirmation_delivered'))).toHaveLength(1);
});
it.each([{tenants:[]},{owners:[]}])('denies inactive/foreign tenant or absent/staff/worker ownership before receipt RPCs',async(change)=>{
 const f=fixture(change);await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.query.mock.calls.some(([sql])=>sql.includes('outbox_confirmation_delivered'))).toBe(false);expect(f.query).toHaveBeenLastCalledWith('rollback');
});
it('denies a foreign or missing booking before reading any receipt',async()=>{const f=fixture({bookings:[]});await expect(f.read(actor,tenant,foreign)).rejects.toMatchObject({code:'NOT_AVAILABLE'});expect(f.query.mock.calls.some(([sql])=>sql.includes('outbox_confirmation_delivered'))).toBe(false);});
it('never caches owner authorization across calls',async()=>{const f=fixture();await f.read(actor,tenant,booking);f.rows.owners=[];await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.connect).toHaveBeenCalledTimes(2);expect(f.query.mock.calls.filter(([sql])=>sql.includes('outbox_confirmation_delivered'))).toHaveLength(1);});
it.each([
 {tenants:[{id:foreign,status:'active'}]},{tenants:[{id:tenant,status:'suspended'}]},{tenants:[{id:tenant,status:'active',secret:'private'}]},
 {owners:[{tenant_id:foreign,user_id:actor,role:'BUSINESS_OWNER'}]},{owners:[{tenant_id:tenant,user_id:foreign,role:'BUSINESS_OWNER'}]},{owners:[{tenant_id:tenant,user_id:actor,role:'BUSINESS_STAFF'}]},
 {bookings:[{id:foreign,tenant_id:tenant}]},{bookings:[{id:booking,tenant_id:foreign}]},{bookings:[{id:booking,tenant_id:tenant,customerEmail:'private@example.test'}]},
 {flags:[]},{flags:[{emailReceiptRecorded:'true',smsReceiptRecorded:false}]},{flags:[{emailReceiptRecorded:true,smsReceiptRecorded:null}]},{flags:[{emailReceiptRecorded:true,smsReceiptRecorded:false,delivered:true}]},
 {flags:[{emailReceiptRecorded:false,smsReceiptRecorded:false},{emailReceiptRecorded:true,smsReceiptRecorded:true}]},
] as Partial<Rows>[])('fails closed on malformed, foreign, widened or ambiguous adapter rows',async(change)=>{const f=fixture(change);await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});expect(f.query).toHaveBeenLastCalledWith('rollback');});
it.each(['40001','40P01','55P03','57014'])('withholds the response when concurrent authorization changes or waits raise %s',async(code)=>{
 const f=fixture();f.query.mockImplementation(async sql=>{if(sql.includes('tenant_members'))throw {code,message:'raw-private-detail'};return{rows:sql.includes('public.tenants')?f.rows.tenants:[]};});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'CONFLICT',message:'CONFLICT'});expect(f.query.mock.calls.some(([sql])=>sql.includes('outbox_confirmation_delivered'))).toBe(false);
});
it('rejects invalid identifiers before opening a connection',async()=>{const f=fixture();for(const values of [['invalid',tenant,booking],[actor,'invalid',booking],[actor,tenant,'invalid']])await expect(f.read(values[0]!,values[1]!,values[2]!)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(f.connect).not.toHaveBeenCalled();});
it('masks acquisition failures without logging credentials or raw errors',async()=>{const f=fixture();f.connect.mockRejectedValue(Error('private-db-credential'));await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'INTERNAL_ERROR'});expect(f.query).not.toHaveBeenCalled();});
it('discards a client when rollback fails and never returns partial flags',async()=>{const f=fixture();f.query.mockImplementation(async sql=>{if(sql==='rollback')throw Error('broken socket');if(sql.includes('outbox_confirmation_delivered'))throw Error('private provider detail');return{rows:sql.includes('public.tenants')?f.rows.tenants:sql.includes('tenant_members')?f.rows.owners:sql.includes('public.bookings')?f.rows.bookings:[]};});await expect(f.read(actor,tenant,booking)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(f.release).toHaveBeenCalledWith(true);});
it('rejects widened result claims and noncanonical channel tuples',()=>{const value={schemaVersion:1,tenantId:tenant,bookingId:booking,channels:[{channel:'email',receiptRecorded:false},{channel:'sms',receiptRecorded:false}]};expect(ConfirmationReceiptStatus.safeParse(value).success).toBe(true);expect(ConfirmationReceiptStatus.safeParse({...value,delivered:true}).success).toBe(false);expect(ConfirmationReceiptStatus.safeParse({...value,channels:[value.channels[1],value.channels[0]]}).success).toBe(false);});
