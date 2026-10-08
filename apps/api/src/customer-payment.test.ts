import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Server} from 'node:http';
import {createFlowHttpServer,tokenHash} from './http';
import {createCustomerConfirmation,createCustomerMockPayment} from './customer-payment';
const tenant='36000000-0000-4000-8000-000000000002',service='36000000-0000-4000-8000-000000000003',booking='36000000-0000-4000-8000-000000000004',payment='36000000-0000-4000-8000-000000000005';
const origin='https://checkout.example.test',token='a'.repeat(43),receipt={bookingId:booking,paymentId:payment,state:'confirmed' as const,replayed:false};
let server:Server;afterEach(async()=>{server?.closeAllConnections();if(server)await new Promise<void>(r=>server.close(()=>r()));});
async function fixture(){
 const confirm=vi.fn(async()=>receipt),mock=vi.fn(async()=>({...receipt,provider:'staging_mock' as const,simulated:true as const})),owner=vi.fn(async()=>null);
 server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[],customerOrigins:[origin],authenticateOwner:owner,customerConfirmation:confirm,customerMockPayment:mock});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return{confirm,mock,owner,base:`http://127.0.0.1:${(server.address() as {port:number}).port}/api/flow-sessions/`};
}
describe('customer financial transport',()=>{
 it.each(['confirm','mock-payment'])('uses only hashed session bearer for %s',async route=>{const f=await fixture();const r=await fetch(f.base+route,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});expect(r.status).toBe(200);expect(route==='confirm'?f.confirm:f.mock).toHaveBeenCalledWith(tokenHash(token),origin);expect(f.owner).not.toHaveBeenCalled();if(route==='mock-payment')expect((await r.json()).data).toMatchObject({provider:'staging_mock',simulated:true});});
 it.each(['confirm','mock-payment'])('rejects injected financial/tenant identity for %s',async route=>{const f=await fixture();for(const body of [{bookingId:booking},{amount:1},{pricing:{}},{tenantId:tenant},{serviceId:service},{paymentId:payment},{state:'succeeded'},{provider:'stripe'},{actorId:booking},null,[]])expect((await fetch(f.base+route,{method:'POST',headers:{origin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})).status).toBe(400);expect(f.confirm).not.toHaveBeenCalled();expect(f.mock).not.toHaveBeenCalled();});
 it('rejects missing bearer, foreign origin and query authority',async()=>{const f=await fixture();const headers={origin,authorization:`Bearer ${token}`,'content-type':'application/json'};expect((await fetch(f.base+'confirm?tenantId=x',{method:'POST',headers,body:'{}'})).status).toBe(400);expect((await fetch(f.base+'confirm',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'})).status).toBe(401);expect((await fetch(f.base+'confirm',{method:'POST',headers:{...headers,origin:'https://evil.example'},body:'{}'})).status).toBe(403);expect(f.confirm).not.toHaveBeenCalled();});
});
function harness(options:{expiry?:boolean;payment?:null;badReceipt?:boolean}={}){
 let checks=0;const query=vi.fn(async(sql:string)=>{
  if(sql.includes('customer_flow_payment_target')){if(++checks===2&&options.expiry)throw Object.assign(Error('private SQL detail'),{code:'42501'});return{rows:[{target:{tenantId:tenant,serviceId:service,bookingId:booking,paymentId:options.payment===null?null:payment}}]};}
  if(sql.includes('confirm_succeeded_payment'))return{rows:[{result:options.badReceipt?{...receipt,bookingId:service}:receipt}]};return{rows:[]};
 });const connect=vi.fn(async()=>({query,release:vi.fn()}));return{query,connect,pool:{connect} as never};
}
describe('customer confirmation authority',()=>{
 it('uses persisted payment and rechecks scope before commit',async()=>{const h=harness();expect(await createCustomerConfirmation(h.pool)('a'.repeat(64),origin)).toEqual(receipt);expect(h.query).toHaveBeenCalledWith('select public.confirm_succeeded_payment($1::uuid) result',[payment]);expect(h.query.mock.calls.at(-1)?.[0]).toBe('commit');});
 it.each([{expiry:true},{badReceipt:true},{payment:null}])('rolls back unsafe authority %j',async options=>{const h=harness(options);await expect(createCustomerConfirmation(h.pool)('a'.repeat(64),origin)).rejects.toMatchObject({code:options.expiry?'FORBIDDEN':options.badReceipt?'INTERNAL_ERROR':'UNSUPPORTED_CONFIG'});expect(h.query.mock.calls.at(-1)?.[0]).toBe('rollback');expect(h.query.mock.calls.some(c=>c[0]==='commit')).toBe(false);});
 it('mock payments require explicit staging gate before connecting',async()=>{const h=harness();await expect(createCustomerMockPayment(h.pool,{})('a'.repeat(64),origin)).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'});expect(h.connect).not.toHaveBeenCalled();expect(()=>createCustomerMockPayment(h.pool,{BOOKING_LUMIN_FAKE_PAYMENTS:'1',BOOKING_LUMIN_ENV:'production'})).toThrow();});
});
