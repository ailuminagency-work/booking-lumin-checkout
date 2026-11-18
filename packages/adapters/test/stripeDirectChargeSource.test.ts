import {describe,it,expect,vi} from 'vitest';
import {createStripePaymentProvider,signStripeTestWebhook} from '../src/stripePayment';
import {createStripeClient} from '../../../supabase/functions/_shared/stripe';
const account='acct_12345678',other='acct_87654321',now=1760000000000;
const input={tenantId:'00000000-0000-4000-8000-000000000001',bookingId:'booking-test',amount:{amount:100,currency:'USD'},idempotencyKey:'stable-key'};
const intent={id:'pi_fixture',status:'requires_payment_method',amount:100,currency:'usd',client_secret:'fixture-only',livemode:false};
const factories=[['node',createStripePaymentProvider],['deno mirror',createStripeClient]] as const;
for(const [name,create] of factories)describe(`${name} dormant direct-charge source`,()=>{
 function fixture(source:any={accountId:account,livemode:false},body:any=intent){
  const calls:RequestInit[]=[];
  const fetchImpl=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{calls.push(init!);return new Response(JSON.stringify(body),{status:200});});
  const options={secretKey:'fixture-only',webhookSecret:'fixture-signing',directChargeSource:source,fetchImpl,now:()=>now};
  return {provider:create(options),options,calls,fetchImpl};
 }
 it('pins account header for create/read/replay, unaffected by caller metadata or option mutation',async()=>{
  const source={accountId:account,livemode:false};const f=fixture(source);
  source.accountId=other;source.livemode=true;f.options.directChargeSource={accountId:other,livemode:true};
  const request={...input,metadata:{'Stripe-Account':other,accountId:other,livemode:'true'}};
  const one=await f.provider.createIntent(request),two=await f.provider.createIntent(request),read=await f.provider.getIntent('pi_fixture');
  for(const result of [one,two,read]){expect(result?.source).toEqual({accountId:account,livemode:false});expect(Object.isFrozen(result?.source)).toBe(true);}
  for(const call of f.calls)expect(new Headers(call.headers).get('Stripe-Account')).toBe(account);
  expect(new Headers(f.calls[0]?.headers).get('Idempotency-Key')).toBe('stable-key');expect(new Headers(f.calls[1]?.headers).get('Idempotency-Key')).toBe('stable-key');
 });
 it('validates explicit live expectation without deriving mode from credential text',async()=>{
  const f=fixture({accountId:account,livemode:true},{...intent,livemode:true});
  expect((await f.provider.createIntent(input)).source).toEqual({accountId:account,livemode:true});
 });
 it.each([true,undefined,'false',null])('rejects mismatched or unverified returned mode %s',async livemode=>{
  const f=fixture(undefined,{...intent,livemode});
  await expect(f.provider.createIntent(input)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  await expect(f.provider.getIntent('pi_fixture')).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
 });
 it.each([{accountId:'acct_bad\r\nInjected',livemode:false},{accountId:account,livemode:'false'},{accountId:'',livemode:false},null])('invalid source refuses construction without fetch',source=>{
  const fetchImpl=vi.fn();expect(()=>create({secretKey:'x',webhookSecret:'y',directChargeSource:source as never,fetchImpl})).toThrow();expect(fetchImpl).not.toHaveBeenCalled();
 });
 it('does not opt legacy callers into account routing or returned source',async()=>{
  const fetchImpl=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({...intent,livemode:undefined})));
  const p=create({secretKey:'x',webhookSecret:'y',fetchImpl});const result=await p.createIntent(input);
  expect(result).not.toHaveProperty('source');expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('Stripe-Account')).toBe(false);
 });
 it.each([{account:other,livemode:false},{account,livemode:true},{account,livemode:undefined},{account:undefined,livemode:false}])('rejects verified webhook from wrong/missing source %j',scope=>{
  const f=fixture();const payload=JSON.stringify({type:'payment_intent.succeeded',...scope,data:{object:intent}});
  return expect(f.provider.parseWebhook(payload,signStripeTestWebhook(payload,'fixture-signing',now/1000))).rejects.toMatchObject({code:'WEBHOOK_UNVERIFIED'});
 });
 it('accepts matching signed webhook without trusting metadata as source',async()=>{
  const f=fixture();const payload=JSON.stringify({type:'payment_intent.succeeded',account,livemode:false,data:{object:{...intent,metadata:{accountId:other}}}});
  expect((await f.provider.parseWebhook(payload,signStripeTestWebhook(payload,'fixture-signing',now/1000))).kind).toBe('payment_succeeded');expect(f.fetchImpl).not.toHaveBeenCalled();
 });
});
it('node cancel pins the same direct account without exposing a refund primitive',async()=>{
 const fetchImpl=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response('{}'));
 const p=createStripePaymentProvider({secretKey:'x',webhookSecret:'y',directChargeSource:{accountId:account,livemode:false},fetchImpl});
 await p.cancelIntent('pi_fixture');expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('Stripe-Account')).toBe(account);expect(p).not.toHaveProperty('refund');
});
