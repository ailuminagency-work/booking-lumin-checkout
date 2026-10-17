import {afterEach,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {request} from 'node:http';
import {createFlowHttpServer} from './http';
import {FlowError} from './repository';
const id=(n:number)=>`68000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),tenant=id(2),booking=id(3),origin='https://portal.example.test',token='verified-receipt-owner-token';
const receipt={schemaVersion:1,tenantId:tenant,bookingId:booking,receipts:[{channel:'email',recordedAt:'2026-10-01T12:34:56.123456Z'},{channel:'sms',recordedAt:'2026-10-01T12:35:56.123456Z'}]};
let server:Server;
afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
async function setup(value:unknown=receipt,enabled=true){
 const read=vi.fn(async()=>{if(value instanceof Error)throw value;return value as never;}),call=vi.fn();
 server=createFlowHttpServer({repository:{call},ownerOrigins:[origin],customerOrigins:['https://checkout.example.test'],authenticateOwner:async credential=>credential===token?actor:null,notificationAuthoring:enabled,confirmationReceiptHistory:read});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/confirmation-receipt-history`;
 const send=(method='GET',query=`tenantId=${tenant}&bookingId=${booking}`,credential:string|null=token,browserOrigin=origin)=>fetch(`${base}?${query}`,{method,headers:{origin:browserOrigin,...(credential===null?{}:{authorization:`Bearer ${credential}`})}});
 return {base,read,call,send};
}
it('returns only strict recorded-send history for exact authenticated actor and booking',async()=>{const f=await setup(),r=await f.send();expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,data:receipt});expect(f.read).toHaveBeenCalledExactlyOnceWith(actor,tenant,booking);expect(f.call).not.toHaveBeenCalled();});
it.each([null,'forged-owner-token','short'])('denies unverified credential %s before the reader',async credential=>{const f=await setup();expect((await f.send('GET',undefined,credential)).status).toBe(401);expect(f.read).not.toHaveBeenCalled();});
it.each(['https://checkout.example.test','https://evil.example.test','null'])('denies non-owner origin %s',async browserOrigin=>{const f=await setup();expect((await f.send('GET',undefined,token,browserOrigin)).status).toBe(403);expect(f.read).not.toHaveBeenCalled();});
it.each([`tenantId=${tenant}`,`bookingId=${booking}`,`tenantId=${tenant}&bookingId=wrong`,`tenantId=${tenant}&bookingId=${booking}&bookingId=${booking}`,`tenantId=${tenant}&tenantId=${tenant}&bookingId=${booking}`,`tenantId=${tenant}&bookingId=${booking}&actor=${actor}`])('rejects missing, ambiguous or widened query %s',async query=>{const f=await setup();expect((await f.send('GET',query)).status).toBe(400);expect(f.read).not.toHaveBeenCalled();});
it.each(['POST','PUT','DELETE'])('never writes or reads for unsupported method %s',async method=>{const f=await setup();expect((await f.send(method)).status).toBe(400);expect(f.read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();});
it.each([null,{...receipt,tenantId:actor},{...receipt,bookingId:actor},{...receipt,providerSecret:'private'},{...receipt,receipts:[{channel:'email',recordedAt:'not-a-timestamp'}]},{...receipt,receipts:[...receipt.receipts].reverse()}])('rejects widened or wrong-scope result %j',async value=>{const f=await setup(value),r=await f.send();expect(r.status).toBe(500);expect(await r.json()).toEqual({ok:false,code:'INTERNAL_ERROR'});});
it.each([['FORBIDDEN',403],['CONFLICT',409],['NOT_AVAILABLE',404]] as const)('retains reader denial %s without retry',async(code,status)=>{const f=await setup(new FlowError(code));expect((await f.send()).status).toBe(status);expect(f.read).toHaveBeenCalledTimes(1);});
it('redacts unexpected reader errors',async()=>{const f=await setup(new Error('private database password')),r=await f.send();expect(r.status).toBe(500);expect(await r.json()).toEqual({ok:false,code:'INTERNAL_ERROR'});});
it('disabled staging capability remains unavailable after authentication',async()=>{const f=await setup(receipt,false);expect((await f.send()).status).toBe(422);expect(f.read).not.toHaveBeenCalled();expect((await f.send('GET',undefined,null)).status).toBe(401);});
it('rejects a GET body before reading',async()=>{const f=await setup();const status=await new Promise<number>(resolve=>{const req=request(`${f.base}?tenantId=${tenant}&bookingId=${booking}`,{method:'GET',headers:{origin,authorization:`Bearer ${token}`,'content-length':'2'}},res=>{res.resume();resolve(res.statusCode!);});req.end('{}');});expect(status).toBe(400);expect(f.read).not.toHaveBeenCalled();});


it('returns empty persisted history without generating timestamps',async()=>{const f=await setup({...receipt,receipts:[]}),r=await f.send();expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,data:{...receipt,receipts:[]}});});
it('preserves a single SMS receipt and stored microseconds',async()=>{const value={...receipt,receipts:[receipt.receipts[1]]},f=await setup(value),r=await f.send();expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,data:value});});
it.each([
 {...receipt,receipts:[receipt.receipts[0],receipt.receipts[0]]},
 {...receipt,receipts:[{...receipt.receipts[0],recipient:'private@example.test'}]},
 {...receipt,receipts:[{channel:'email',recordedAt:'2026-10-01T12:34:56.1234567Z'}]},
 {...receipt,receipts:[{channel:'email',recordedAt:'2026-10-01T12:34:56+00:00'}]},
 {...receipt,receipts:[{channel:'email',recordedAt:'2026-02-30T12:34:56Z'}]},
 {...receipt,delivered:true}
])('rejects duplicate, invented-delivery or invalid timestamp claims %j',async value=>{const f=await setup(value),r=await f.send();expect(r.status).toBe(500);expect(await r.json()).toEqual({ok:false,code:'INTERNAL_ERROR'});expect(f.read).toHaveBeenCalledTimes(1);expect(f.call).not.toHaveBeenCalled();});
