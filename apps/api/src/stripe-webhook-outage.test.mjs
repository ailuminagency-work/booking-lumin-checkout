import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';

// Handler-boundary test: signature parsing is replaced by an already-verified
// event. Real signature crypto has its separate Edge tests; no provider is called.
const fixture=vi.hoisted(()=>({handler:null,lookup:null,event:null,from:vi.fn(),rpc:vi.fn(),parse:vi.fn(),db:vi.fn(),refund:vi.fn(),amount:vi.fn()}));
vi.mock('../../../supabase/functions/_shared/db.ts',()=>({
 serviceRoleClient:fixture.db,
 jsonResponse:(body,status=200)=>new Response(JSON.stringify(body),{status}),
 errorResponse:(code,message,status)=>new Response(JSON.stringify({error:{code,message}}),{status}),
}));
vi.mock('../../../supabase/functions/_shared/stripe.ts',()=>({
 createStripeClient:()=>({parseWebhook:fixture.parse}),
 interpretRefundEvent:fixture.refund,shouldIgnoreStalePaymentFailure:vi.fn(),webhookIntentAmount:fixture.amount,
}));
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();
 fixture.parse.mockImplementation(async()=>fixture.event);
 fixture.db.mockImplementation(()=>({from:fixture.from,rpc:fixture.rpc}));
 fixture.rpc.mockResolvedValue({data:{result:'RECORDED',full:false},error:null});
 fixture.amount.mockReturnValue(100);
 fixture.refund.mockReturnValue({refundedTotal:50,refundId:'re_fixture',isCumulative:false,isFullyRefunded:false});
 fixture.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>fixture.lookup};return q;});
 vi.stubGlobal('Deno',{env:{get:()=> 'test-only-placeholder'},serve:handler=>{fixture.handler=handler;}});
 await import('../../../supabase/functions/stripe-webhook/index.ts');
});
afterEach(()=>vi.unstubAllGlobals());
async function deliver(){return fixture.handler(new Request('http://localhost/webhook',{method:'POST',headers:{'Stripe-Signature':'fixture-verified-by-mock'},body:'{}'}));}
describe('Stripe webhook payment lookup outage',()=>{
 it.each(['payment_succeeded','payment_failed','refund_completed'])('does not acknowledge %s when payment read fails',async kind=>{
  fixture.event={kind,intentId:'pi_test_outage',raw:{}};
  fixture.lookup={data:null,error:{message:'private database detail'}};
  const response=await deliver();expect(response.status).toBe(500);
  expect(await response.json()).toEqual({error:{code:'PROVIDER_UNAVAILABLE',message:'payment lookup failed'}});
  expect(fixture.parse).toHaveBeenCalledTimes(1);expect(fixture.from).toHaveBeenCalledExactlyOnceWith('payments');expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it.each(['payment_succeeded','payment_failed','refund_completed'])('retries missing payment for %s without side effects',async kind=>{
  fixture.event={kind,intentId:'pi_test_missing',raw:{}};fixture.lookup={data:null,error:null};
  const response=await deliver();expect(response.status).toBe(503);
  expect(await response.json()).toEqual({error:{code:'PROVIDER_UNAVAILABLE',message:'payment is not available yet'}});
  expect(fixture.from).toHaveBeenCalledExactlyOnceWith('payments');expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it.each(['pi_irrelevant',null])('acknowledges irrelevant verified event without database access (%s)',async intentId=>{
  fixture.event={kind:'unrecognized',intentId,raw:{}};
  const response=await deliver();expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true,ignored:'unrecognized'});
  expect(fixture.parse).toHaveBeenCalledTimes(1);expect(fixture.db).not.toHaveBeenCalled();expect(fixture.from).not.toHaveBeenCalled();expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it.each(['payment_succeeded','payment_failed','refund_completed'])('processes healthy redelivery of %s when the payment arrives',async kind=>{
  fixture.event={kind,intentId:'pi_test_late',raw:{}};fixture.lookup={data:null,error:null};
  expect((await deliver()).status).toBe(503);expect(fixture.rpc).not.toHaveBeenCalled();
  fixture.lookup={data:{id:'payment-test',state:kind==='payment_failed'?'requires_payment':'processing',amount:100},error:null};
  if(kind==='payment_failed')fixture.rpc.mockResolvedValueOnce({data:{result:'FAILED'},error:null});
  const response=await deliver();expect(response.status).toBe(200);
  const body=await response.json();expect(body.received).toBe(true);
  if(kind==='payment_succeeded'){expect(body.confirmed).toBe(false);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('succeed_payment_webhook',{p_payment_id:'payment-test',p_observed_amount:100});}
  if(kind==='payment_failed'){expect(body.failed).toBe(true);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('fail_payment_webhook',{p_payment_id:'payment-test'});}
  if(kind==='refund_completed'){expect(body.refunded).toBe(true);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('record_refund_webhook',{p_payment_id:'payment-test',p_provider_refund_id:'re_fixture',p_refunded_total:50,p_is_fully_refunded:false,p_is_cumulative:false});}
 });
 it('healthy redelivery preserves an already parked payment after the outage',async()=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_test_retry',raw:{}};
  fixture.lookup={data:null,error:{message:'database unavailable'}};
  expect((await deliver()).status).toBe(500);
  fixture.lookup={data:{id:'payment-test',state:'processing'},error:null};
  fixture.rpc.mockResolvedValueOnce({data:{result:'IGNORED'},error:null});
  const response=await deliver();expect(response.status).toBe(200);
  expect(await response.json()).toEqual({received:true,confirmed:false});
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('succeed_payment_webhook',{p_payment_id:'payment-test',p_observed_amount:100});
 });
 it('still rejects unverified deliveries before database access',async()=>{
  fixture.parse.mockRejectedValueOnce(Error('bad signature'));const response=await deliver();expect(response.status).toBe(400);expect(fixture.from).not.toHaveBeenCalled();
 });
});

describe('database-authoritative processing delivery',()=>{
 it.each(['requires_payment','processing','succeeded','failed','refunded','partially_refunded'])('delegates success despite stale routing state %s',async state=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_fixture',raw:{}};fixture.lookup={data:{id:'payment-test',state},error:null};
  fixture.rpc.mockResolvedValueOnce({data:{result:'CONFIRMED',replayed:false},error:null});
  const response=await deliver();expect(await response.json()).toEqual({received:true,confirmed:true,replayed:false});
  expect(fixture.from).toHaveBeenCalledExactlyOnceWith('payments');expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('succeed_payment_webhook',{p_payment_id:'payment-test',p_observed_amount:100});
 });
 it.each(['processing','succeeded','refunded'])('delegates failure despite stale routing state %s',async state=>{
  fixture.event={kind:'payment_failed',intentId:'pi_fixture',raw:{}};fixture.lookup={data:{id:'payment-test',state},error:null};
  fixture.rpc.mockResolvedValueOnce({data:{result:'IGNORED'},error:null});expect((await deliver()).status).toBe(200);expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('fail_payment_webhook',{p_payment_id:'payment-test'});
 });
 it.each(['amount_mismatch','capacity_oversold'])('returns authoritative park %s without refund',async reason=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_fixture',raw:{}};fixture.lookup={data:{id:'payment-test',state:'processing'},error:null};
  fixture.rpc.mockResolvedValueOnce({data:{result:'PARKED',reason},error:null});expect(await (await deliver()).json()).toEqual({received:true,confirmed:false,parked:reason});expect(fixture.refund).not.toHaveBeenCalled();
 });
 it.each([{data:null,error:{code:'55P03'}},{data:null,error:null},{data:{result:'NOT_FOUND'},error:null}])('retries RPC failure or disappearing anchor',async result=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_fixture',raw:{}};fixture.lookup={data:{id:'payment-test',state:'processing'},error:null};fixture.rpc.mockResolvedValueOnce(result);
  expect((await deliver()).status).toBe(500);
 });
});
