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
 fixture.rpc.mockResolvedValue({data:{received:true,refunded:true,full:false},error:null});
 fixture.amount.mockReturnValue(100);
 fixture.refund.mockReturnValue({refundedTotal:50,refundId:'re_fixture',isCumulative:false,isFullyRefunded:false});
 fixture.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>fixture.lookup};return q;});
 vi.stubGlobal('Deno',{env:{get:()=> 'test-only-placeholder'},serve:handler=>{fixture.handler=handler;}});
 await import('../../../supabase/functions/stripe-webhook/index.ts');
});
afterEach(()=>vi.unstubAllGlobals());
async function deliver(){return fixture.handler(new Request('http://localhost/webhook',{method:'POST',headers:{'Stripe-Signature':'fixture-verified-by-mock'},body:'{}'}));}
describe('legacy-only transactional webhook boundary',()=>{
 it.each(['payment_succeeded','payment_failed','refund_completed'])('retries database error for %s without lookup',async kind=>{
  fixture.event={kind,intentId:'pi_fixture',raw:{}};fixture.rpc.mockResolvedValue({data:null,error:{message:'private database detail'}});
  const response=await deliver();expect(response.status).toBe(500);expect(await response.json()).toEqual({error:{code:'PROVIDER_UNAVAILABLE',message:'processing error'}});expect(fixture.from).not.toHaveBeenCalled();expect(fixture.rpc).toHaveBeenCalledTimes(1);
 });
 it.each(['payment_succeeded','payment_failed','refund_completed'])('missing or scoped %s stays retryable',async kind=>{
  fixture.event={kind,intentId:'pi_fixture',raw:{}};fixture.rpc.mockResolvedValue({data:{result:'UNAVAILABLE'},error:null});const response=await deliver();expect(response.status).toBe(503);expect(await response.json()).toEqual({error:{code:'PROVIDER_UNAVAILABLE',message:'payment is not available yet'}});expect(fixture.from).not.toHaveBeenCalled();
 });
 it.each(['payment_succeeded','payment_failed','refund_completed'])('missing intent %s retries without DB',async kind=>{fixture.event={kind,intentId:null,raw:{}};expect((await deliver()).status).toBe(503);expect(fixture.db).not.toHaveBeenCalled();});
 it.each(['pi_irrelevant',null])('irrelevant verified event has no database access %s',async intentId=>{fixture.event={kind:'unrecognized',intentId,raw:{}};expect(await(await deliver()).json()).toEqual({received:true,ignored:'unrecognized'});expect(fixture.db).not.toHaveBeenCalled();});
 it('bad signature never reaches database',async()=>{fixture.parse.mockRejectedValue(Error('private signature detail'));expect((await deliver()).status).toBe(400);expect(fixture.db).not.toHaveBeenCalled();});
 it.each(['payment_succeeded','payment_failed','refund_completed'])('healthy redelivery %s uses one atomic RPC',async kind=>{
  fixture.event={kind,intentId:'pi_fixture',raw:{synthetic:true}};fixture.rpc.mockResolvedValueOnce({data:{result:'UNAVAILABLE'},error:null});expect((await deliver()).status).toBe(503);fixture.rpc.mockResolvedValueOnce({data:{received:true},error:null});expect((await deliver()).status).toBe(200);
  expect(fixture.rpc).toHaveBeenLastCalledWith('process_legacy_payment_webhook',{p_provider_intent_id:'pi_fixture',p_kind:kind,p_observed_amount:kind==='payment_succeeded'?100:kind==='refund_completed'?50:null,p_refund_id:kind==='refund_completed'?'re_fixture':null,p_is_cumulative:false});expect(fixture.from).not.toHaveBeenCalled();
 });
 it.each([{received:true,confirmed:true,replayed:false},{received:true,confirmed:true,replayed:true},{received:true,confirmed:false},{received:true,confirmed:false,parked:'amount_mismatch'},{received:true,confirmed:false,parked:'capacity_oversold'},{received:true,failed:true},{received:true,failed:false,note:'ignored stale failure'},{received:true,refunded:true,full:true},{received:true,refunded:false,full:false,note:'refund amount unavailable'}])('returns authoritative response unchanged %j',async data=>{fixture.event={kind:'payment_succeeded',intentId:'pi_fixture',raw:{}};fixture.rpc.mockResolvedValue({data,error:null});expect(await(await deliver()).json()).toEqual(data);expect(fixture.refund).not.toHaveBeenCalled();});
 it.each([null,{}, {result:'NOT_FOUND'}])('invalid RPC result %j cannot acknowledge',async data=>{fixture.event={kind:'payment_succeeded',intentId:'pi_fixture',raw:{}};fixture.rpc.mockResolvedValue({data,error:null});expect((await deliver()).status).toBe(500);});
 it.each([null,0,-1,30,100])('refund amount %s passes shape only, never helper full flag',async amount=>{fixture.event={kind:'refund_completed',intentId:'pi_fixture',raw:{synthetic:true}};fixture.refund.mockReturnValue({refundedTotal:amount,refundId:null,isCumulative:true,isFullyRefunded:true});expect((await deliver()).status).toBe(200);expect(fixture.refund).toHaveBeenCalledWith(fixture.event.raw,0);expect(fixture.rpc).toHaveBeenCalledWith('process_legacy_payment_webhook',{p_provider_intent_id:'pi_fixture',p_kind:'refund_completed',p_observed_amount:amount,p_refund_id:null,p_is_cumulative:true});expect(fixture.from).not.toHaveBeenCalled();});
});
