import {describe,it,expect} from 'vitest';
import {createFakeStripe} from './fakeStripe';
const DAY=24*60*60*1000;
function setup(){let now=1000;const fake=createFakeStripe({webhookSecret:'synthetic',nowMilliseconds:()=>now});
 const post=(body='amount=100&currency=usd',key='same-key',account='acct_one')=>fake.fetchImpl('https://api.stripe.test/v1/payment_intents',{method:'POST',headers:{'Idempotency-Key':key,'Stripe-Account':account},body});
 return {fake,post,advance:(ms:number)=>{now+=ms;}};}
describe('bounded API-v1 PaymentIntent fake idempotency',()=>{
 it('replays cached original response, not subsequently mutated live intent',async()=>{const {fake,post}=setup();const first=await (await post()).json();fake.drive(first.id,'succeeded');expect(await (await post()).json()).toEqual(first);expect(fake.getIntent(first.id)?.status).toBe('succeeded');expect(fake.intents()).toHaveLength(1);});
 it('compares parameters independent of field ordering',async()=>{const {post}=setup();const first=await(await post()).json();expect(await(await post('currency=usd&amount=100')).json()).toEqual(first);});
 it.each(['amount=101&currency=usd','amount=100&currency=eur','amount=100&currency=usd&metadata[x]=changed'])('rejects changed parameters %s',async body=>{const {post,fake}=setup();await post();const result=await post(body);expect(result.status).toBe(400);expect((await result.json()).error.type).toBe('idempotency_error');expect(fake.intents()).toHaveLength(1);});
 it('replays post-execution 500 and rejects changed params, without absence inference',async()=>{const {fake,post}=setup();fake.armIntentExecutionError();const first=await post();expect(first.status).toBe(500);const body=await first.json();const replay=await post();expect(replay.status).toBe(500);expect(await replay.json()).toEqual(body);expect((await post('amount=101&currency=usd')).status).toBe(400);});
 it('does not cache validation failures',async()=>{const {post}=setup();expect((await post('amount=0&currency=usd')).status).toBe(400);expect((await post()).status).toBe(200);});
 it('does not cache rate limiting before execution',async()=>{const {post,fake}=setup();fake.armRateLimit();expect((await post()).status).toBe(429);expect((await post()).status).toBe(200);});
 it('retains at just under 24h, then models possible pruning and duplicate creation',async()=>{const {post,fake,advance}=setup();const first=await(await post()).json();advance(DAY-1);expect((await(await post()).json()).id).toBe(first.id);advance(1);expect((await(await post()).json()).id).not.toBe(first.id);expect(fake.intents()).toHaveLength(2);});
 it('expired cached error can execute anew; this is a hazard not retry authorization',async()=>{const {fake,post,advance}=setup();fake.armIntentExecutionError();expect((await post()).status).toBe(500);advance(DAY);expect((await post()).status).toBe(200);});
 it('scopes keys by connected account',async()=>{const {post,fake}=setup();const a=await(await post(undefined,undefined,'acct_one')).json();const b=await(await post(undefined,undefined,'acct_two')).json();expect(a.id).not.toBe(b.id);expect(fake.intents()).toHaveLength(2);});
});
