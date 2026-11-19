import {expect,it,vi} from 'vitest';
import {createRuntimeClient} from '../src/index';
const U='22222222-2222-4222-8222-222222222222';
const config={url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic',tenantId:'11111111-1111-4111-8111-111111111111'};
const json=(v:unknown)=>new Response(JSON.stringify(v));
for(const stage of ['exchange','user'] as const)for(const result of ['resolve','reject'] as const){
 it(`stale OAuth ${stage} ${result} cannot clear or replace a newer password session`,async()=>{
  let finish!:(r:Response)=>void,reject!:(e:Error)=>void;const delayed=new Promise<Response>((a,b)=>{finish=a;reject=b});let userCalls=0;
  const f=vi.fn<typeof fetch>(async(url)=>{const s=String(url);if(s.includes('grant_type=pkce'))return stage==='exchange'?delayed:json({access_token:'old-oauth-token-synthetic'});if(s.includes('grant_type=password'))return json({access_token:'new-password-token-synthetic'});if(s.endsWith('/user'))return ++userCalls===1&&stage==='user'?delayed:json({id:U});if(s.includes('tenant_members'))return json([]);throw Error('unexpected');});
  const c=createRuntimeClient(config,f);const old=c.finishOAuthCode('old-auth-code','v'.repeat(64));const settled=old.catch(e=>e);await vi.waitFor(()=>expect(f).toHaveBeenCalledTimes(stage==='exchange'?1:2));c.signOut();await c.signIn('fixture@example.test','synthetic');
  if(result==='resolve')finish(json(stage==='exchange'?{access_token:'old-oauth-token-synthetic'}:{id:U}));else reject(Error('private transport detail'));
  expect(await settled).toBeInstanceOf(Error);await c.memberships();expect(f.mock.calls.at(-1)?.[1]?.headers).toMatchObject({Authorization:'Bearer new-password-token-synthetic'});
 });
}
it('failed OAuth identity clears its own token and cannot authorize membership reads',async()=>{const f=vi.fn<typeof fetch>(async(url)=>String(url).includes('grant_type=pkce')?json({access_token:'synthetic-oauth-token'}):json({id:'not-a-uuid'}));const c=createRuntimeClient(config,f);await expect(c.finishOAuthCode('auth-code','v'.repeat(64))).rejects.toThrow();await expect(c.memberships()).rejects.toThrow('sign in');expect(f).toHaveBeenCalledTimes(2);});
it('late direct token callback failure does not clear replacement session',async()=>{let fail!:(e:Error)=>void;let n=0;const f=vi.fn<typeof fetch>(async(url)=>{if(String(url).includes('grant_type=password'))return json({access_token:'new-password-token'});if(String(url).endsWith('/user'))return ++n===1?new Promise<Response>((_,r)=>{fail=r}):json({id:U});return json([])});const c=createRuntimeClient(config,f);const old=c.finishOAuth('old-direct-token-synthetic').catch(e=>e);await vi.waitFor(()=>expect(fail).toBeTypeOf('function'));await c.signIn('fixture@example.test','synthetic');fail(Error('private'));expect(await old).toBeInstanceOf(Error);await c.memberships();expect(f.mock.calls.at(-1)?.[1]?.headers).toMatchObject({Authorization:'Bearer new-password-token'});});
