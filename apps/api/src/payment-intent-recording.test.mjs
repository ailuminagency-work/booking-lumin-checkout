import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
// Actual Edge handler, with provider/DB boundaries mocked. No provider calls,
// captures, refunds, or deployed database behavior are claimed by these tests.
const f=vi.hoisted(()=>({handler:null,payment:null,atProvider:null,recordError:null,readError:null,createError:null,upsert:vi.fn(),rpc:vi.fn(),create:vi.fn()}));
const tenant='10000000-0000-4000-8000-000000000001',bookingId='10000000-0000-4000-8000-000000000002',serviceId='10000000-0000-4000-8000-000000000003';
const key='stable-booking-capability-123456';
vi.mock('../../../supabase/functions/_shared/stripe.ts',()=>({createStripeClient:()=>({createIntent:f.create}),PaymentError:class extends Error{}}));
vi.mock('../../../supabase/functions/_shared/pricing.ts',()=>({price:()=>({}),chargeAmount:()=>({amount:12000,currency:'USD'}),PricingError:class extends Error{}}));
vi.mock('../../../supabase/functions/_shared/availability.ts',()=>({isSlotAvailable:()=>true,slotCapacityAt:()=>1}));
vi.mock('../../../supabase/functions/_shared/db.ts',()=>({
 jsonResponse:(body,status=200)=>new Response(JSON.stringify(body),{status}),errorResponse:(code,message,status)=>new Response(JSON.stringify({error:{code,message}}),{status}),
 serviceRoleClient:()=>({rpc:f.rpc,from:(table)=>{
  const data=()=>table==='bookings'?{id:bookingId,tenant_id:tenant,state:'pending_payment',selection:{serviceId},slot_start:'2030-01-01T10:00:00Z',slot_end:'2030-01-01T11:00:00Z',idempotency_key:key}:table==='services'?{id:serviceId,active:true,currency:'USD',name:'Cleaning',archetype:'simple'}:table==='tenants'?{timezone:'UTC',status:'active'}:table==='payments'?f.payment:null;
  const rows=()=>table==='availability_rules'?[{weekday:1,start_minute:0,end_minute:1440,capacity:1}]:table==='scheduling_policies'?[{service_id:serviceId,lead_time_minutes:0,horizon_days:365,slot_interval_minutes:60}]:[];
  const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:async()=>({data:data(),error:table==='payments'?f.readError:null}),then:(resolve)=>Promise.resolve({data:rows(),error:null}).then(resolve),upsert:f.upsert};return q;
 }}),
}));
const authoritative=(state='requires_payment')=>({tenant_id:tenant,booking_id:bookingId,provider:'stripe_connect',provider_intent_id:'pi_fixture',state,amount:12000,currency:'USD'});
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();Object.assign(f,{payment:null,atProvider:null,recordError:null,readError:null,createError:null});
 f.rpc.mockImplementation(async()=>({data:[{result:'GRANTED'}],error:null}));
 f.create.mockImplementation(async()=>{if(f.atProvider)f.payment={...f.atProvider};if(f.createError)throw f.createError;return {intentId:'pi_fixture',clientToken:'fixture-client-secret',state:'requires_payment',amount:{amount:12000,currency:'USD'}};});
 f.upsert.mockImplementation(async(row,options)=>{if(f.recordError)return {error:f.recordError};if(!f.payment)f.payment={...row};else if(!options.ignoreDuplicates)Object.assign(f.payment,row);return {error:null};});
 vi.stubGlobal('Deno',{env:{get:()=> 'fixture-only'},serve:handler=>{f.handler=handler;}});
 await import('../../../supabase/functions/create-payment-intent/index.ts');
});
afterEach(()=>vi.unstubAllGlobals());
async function request(){return f.handler(new Request('http://localhost/create-payment-intent',{method:'POST',body:JSON.stringify({tenant_id:tenant,booking_id:bookingId,idempotency_key:key})}));}
const noRelease=()=>expect(f.rpc.mock.calls.some(([name])=>name==='release_hold')).toBe(false);
describe('create intent persistence authority',()=>{
 it('inserts a new intent and returns its client capability',async()=>{const r=await request();expect(r.status).toBe(200);expect(await r.json()).toEqual({clientSecret:'fixture-client-secret',publishableKey:'fixture-only'});expect(f.payment).toEqual(authoritative());expect(f.upsert.mock.calls[0][1]).toEqual({onConflict:'provider,provider_intent_id',ignoreDuplicates:true});});
 it('replays a matching pending intent without rewriting the row',async()=>{f.payment={...authoritative(),reviewEvidence:'keep'};const before={...f.payment};expect((await request()).status).toBe(200);expect(f.payment).toEqual(before);});
 it.each(['succeeded','processing','failed','refunded','partially_refunded'])('preserves %s reached while create was in flight',async state=>{f.atProvider={...authoritative(state),reviewEvidence:'keep'};const r=await request();expect(r.status).toBe(409);expect(f.payment).toEqual(f.atProvider);expect(await r.json()).toEqual({error:{code:'ILLEGAL_TRANSITION',message:'payment is not awaiting customer payment'}});noRelease();});
 it.each([{tenant_id:'foreign'},{booking_id:'other'},{amount:1},{currency:'EUR'},{provider:'other'},{provider_intent_id:'other'}])('rejects mismatched anchor %j without overwriting it',async change=>{f.payment={...authoritative(),...change};const before={...f.payment};const r=await request();expect(r.status).toBe(409);expect((await r.json()).error.code).toBe('PAYMENT_CONFLICT');expect(f.payment).toEqual(before);noRelease();});
 it('keeps the hold when a retry transport result is uncertain',async()=>{f.payment=authoritative();f.createError=Error('private transport');const r=await request();expect(r.status).toBe(502);expect(JSON.stringify(await r.json())).not.toContain('private');noRelease();expect(f.upsert).not.toHaveBeenCalled();});
 it('keeps the hold when local recording fails after provider response',async()=>{f.recordError={message:'private persistence'};const r=await request();expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('private');noRelease();});
 it('does not expose a client capability when authoritative read fails',async()=>{f.readError={message:'private read'};const r=await request();expect(r.status).toBe(500);expect(await r.json()).toEqual({error:{code:'PROVIDER_UNAVAILABLE',message:'could not verify recorded payment'}});noRelease();});
});
