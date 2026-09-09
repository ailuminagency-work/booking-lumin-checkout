import {describe,it,expect,vi} from 'vitest';
import {createRuntimeClient,type RuntimeConfig} from '../src/index';
const T='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333';
const config:RuntimeConfig={url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',tenantId:T};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function transport(responses:Response[]){return vi.fn<typeof fetch>(async()=>responses.shift()??json({private:'do not display'},500))}
describe('public runtime transport boundary',()=>{
 it('rejects server secret, service-role JWT, unsafe origins and non-UUID config before network access',()=>{
  const f=transport([]);for(const patch of [{publishableKey:'sb_secret_SYNTHETIC'},{publishableKey:`x.${btoa(JSON.stringify({role:'service_role'}))}.x`},{url:'http://example.supabase.co'},{url:'https://user:password@example.supabase.co'},{url:'https://example.supabase.co?secret=fixture'},{tenantId:'email@example.test'}])expect(()=>createRuntimeClient({...config,...patch},f)).toThrow('configuration');expect(f).not.toHaveBeenCalled();
 });
 it('scopes catalog and rejects tenant-poisoned returned rows',async()=>{
  const f=transport([json([{id:S,tenant_id:U,name:'Foreign',currency:'USD',duration_minutes:60,base_price:0,active:true}])]);const c=createRuntimeClient(config,f);
  await expect(c.services()).rejects.toThrow('Catalog data is invalid');expect(String(f.mock.calls[0]?.[0])).toContain(`tenant_id=eq.${T}`);expect(String(f.mock.calls[0]?.[0])).toContain('active=eq.true');
 });
 it('retries draft with identical key/body and never sends a price or confirmed state',async()=>{
  const f=transport([json({message:'PII provider secret'},500),json([{booking_id:U,reference:'LMN-TEST'}])]);const c=createRuntimeClient(config,f);
  const draft={serviceId:S,idempotencyKey:'logical-request-stable-key',slotStart:'2030-01-01T12:00:00Z',slotEnd:'2030-01-01T13:00:00Z',customer:{name:'Synthetic',email:'synthetic@example.test'}};
  await expect(c.saveDraft(draft)).rejects.toThrow('not accepted');expect(await c.saveDraft(draft)).toEqual({booking_id:U,reference:'LMN-TEST'});
  expect(f.mock.calls[0]?.[1]?.body).toBe(f.mock.calls[1]?.[1]?.body);const body=JSON.parse(String(f.mock.calls[1]?.[1]?.body));expect(body.p_tenant_id).toBe(T);expect(body.p_idempotency_key).toBe(draft.idempotencyKey);expect(body).not.toHaveProperty('pricing');expect(body).not.toHaveProperty('state');
 });
 it('derives membership user from authenticated user endpoint and forgets session on logout',async()=>{
  const f=transport([json({access_token:'synthetic-access-token',user:{id:S}}),json({id:U}),json([{tenant_id:T,role:'BUSINESS_OWNER'}])]);const c=createRuntimeClient(config,f);
  expect(await c.signIn('synthetic@example.test','fixture-only')).toBe(U);await c.memberships();expect(String(f.mock.calls[2]?.[0])).toContain(`user_id=eq.${U}`);
  expect(f.mock.calls[1]?.[1]?.headers).toMatchObject({Authorization:'Bearer synthetic-access-token'});c.signOut();await expect(c.drafts(T)).rejects.toThrow('sign in');expect(f).toHaveBeenCalledTimes(3);
 });
 it('denies platform view fetching to member accounts before any aggregate request',async()=>{
  const f=transport([json({access_token:'synthetic'}),json({id:U}),json([])]);const c=createRuntimeClient(config,f);await c.signIn('synthetic@example.test','fixture');await expect(c.aggregates()).rejects.toThrow('Platform administrator');expect(f.mock.calls.some(([url])=>String(url).includes('platform_booking_stats'))).toBe(false);
 });
 it('queries only four safe views after platform identity check',async()=>{
  const f=transport([json({access_token:'synthetic'}),json({id:U}),json([{user_id:U}]),json([]),json([{state:'draft',booking_count:1}]),json([]),json([])]);const c=createRuntimeClient(config,f);await c.signIn('synthetic@example.test','fixture');const result=await c.aggregates();expect(result.platform_booking_stats[0]).toMatchObject({state:'draft'});for(const [url] of f.mock.calls)expect(String(url)).not.toMatch(/rest\/v1\/(customers|payments|bookings)\?/);
 });
 it('discards authenticated responses when logout happens in flight',async()=>{
  let resolve!:(r:Response)=>void;const pending=new Promise<Response>(r=>resolve=r);let n=0;const f=vi.fn<typeof fetch>(async()=>++n===1?json({access_token:'synthetic'}):n===2?json({id:U}):pending);const c=createRuntimeClient(config,f);await c.signIn('synthetic@example.test','fixture');const read=c.memberships();c.signOut();resolve(json([{tenant_id:T,role:'BUSINESS_OWNER'}]));await expect(read).rejects.toThrow('Session changed');
 });
 it('does not reflect server errors containing sensitive values',async()=>{
  const f=transport([json({message:'private@example.test token=fixture'},403)]);const c=createRuntimeClient(config,f);await expect(c.services()).rejects.toThrow(/^Access denied for this account\.$/);
 });
});
