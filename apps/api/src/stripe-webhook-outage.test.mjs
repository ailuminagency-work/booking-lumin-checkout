import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';

// Handler-boundary test: signature parsing is replaced by an already-verified
// event. Real signature crypto has its separate Edge tests; no provider is called.
const fixture=vi.hoisted(()=>({handler:null,lookup:null,event:null,from:vi.fn(),rpc:vi.fn(),parse:vi.fn()}));
vi.mock('../../../supabase/functions/_shared/db.ts',()=>({
 serviceRoleClient:()=>({from:fixture.from,rpc:fixture.rpc}),
 jsonResponse:(body,status=200)=>new Response(JSON.stringify(body),{status}),
 errorResponse:(code,message,status)=>new Response(JSON.stringify({error:{code,message}}),{status}),
}));
vi.mock('../../../supabase/functions/_shared/stripe.ts',()=>({
 createStripeClient:()=>({parseWebhook:fixture.parse}),
 interpretRefundEvent:vi.fn(),shouldIgnoreStalePaymentFailure:vi.fn(),webhookIntentAmount:vi.fn(),
}));
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();
 fixture.parse.mockImplementation(async()=>fixture.event);
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
 it('retains genuine unknown-intent acknowledgement after a successful read',async()=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_test_unknown',raw:{}};fixture.lookup={data:null,error:null};
  const response=await deliver();expect(response.status).toBe(200);expect(await response.json()).toEqual({received:true,note:'unknown intent'});expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it('healthy redelivery preserves an already parked payment after the outage',async()=>{
  fixture.event={kind:'payment_succeeded',intentId:'pi_test_retry',raw:{}};
  fixture.lookup={data:null,error:{message:'database unavailable'}};
  expect((await deliver()).status).toBe(500);
  fixture.lookup={data:{id:'payment-test',state:'processing'},error:null};
  const response=await deliver();expect(response.status).toBe(200);
  expect(await response.json()).toEqual({received:true,confirmed:false,note:'already resolved payment'});
  expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it('still rejects unverified deliveries before database access',async()=>{
  fixture.parse.mockRejectedValueOnce(Error('bad signature'));const response=await deliver();expect(response.status).toBe(400);expect(fixture.from).not.toHaveBeenCalled();
 });
});

