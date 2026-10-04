import {describe,it,expect,vi} from 'vitest';
import {createRuntimeClient,type RuntimeConfig} from '../src/index';
const T='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333';
const config:RuntimeConfig={url:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic_fixture',tenantId:T};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function transport(responses:Response[]){return vi.fn<typeof fetch>(async()=>responses.shift()??json({private:'do not display'},500))}
describe('public runtime transport boundary',()=>{
 it('reads all booking states through an authenticated tenant-filtered query',async()=>{
  const states=['draft','pending_payment','confirmed','completed','cancelled','refunded','failed'];
  const bookings=states.map(state=>({id:S,tenant_id:T,reference:'LMN-'+state,state,slot_start:'2030-01-01T12:00:00Z',created_at:'2029-12-01T12:00:00Z'}));
  const f=transport([json({access_token:'synthetic'}),json({id:U}),json(bookings)]);const c=createRuntimeClient(config,f);
  await expect(c.bookings(T)).rejects.toThrow('sign in');expect(f).not.toHaveBeenCalled();
  await c.signIn('synthetic@example.test','fixture');expect(await c.bookings(T)).toEqual(bookings);
  const url=String(f.mock.calls[2]?.[0]);expect(url).toContain(`tenant_id=eq.${T}`);expect(url).not.toContain('state=eq.draft');
  expect(f.mock.calls[2]?.[1]?.headers).toMatchObject({Authorization:'Bearer synthetic'});
  c.signOut();await expect(c.bookings(T)).rejects.toThrow('sign in');expect(f).toHaveBeenCalledTimes(3);
 });
 it('rejects foreign-tenant booking rows and malformed state or dates',async()=>{
  const row={id:S,tenant_id:T,reference:'LMN-TEST',state:'confirmed',slot_start:'2030-01-01T12:00:00Z',created_at:'2029-12-01T12:00:00Z'};
  for(const patch of [{tenant_id:U},{state:'paid-by-client'},{slot_start:'invalid'},{created_at:'invalid'}]){
   const f=transport([json({access_token:'synthetic'}),json({id:U}),json([{...row,...patch}])]);const c=createRuntimeClient(config,f);await c.signIn('synthetic@example.test','fixture');await expect(c.bookings(T)).rejects.toThrow('Booking data is invalid');
  }
 });
 it('discovers authenticated memberships without a configured tenant but cannot submit an unbound booking',async()=>{
  const f=transport([json({access_token:'synthetic'}),json({id:U}),json([{tenant_id:T,role:'BUSINESS_OWNER'}])]);
  const owner=createRuntimeClient({...config,tenantId:'',allowMembershipDiscovery:true},f);
  await expect(owner.memberships()).rejects.toThrow('sign in');
  expect(f).not.toHaveBeenCalled();
  await owner.signIn('synthetic@example.test','fixture');
  expect(await owner.memberships()).toEqual([{tenant_id:T,role:'BUSINESS_OWNER'}]);
  const calls=f.mock.calls.length;
  await expect(owner.services()).rejects.toThrow();
  await expect(owner.drafts('')).rejects.toThrow();
  await expect(owner.saveDraft({serviceId:S,idempotencyKey:'synthetic-stable-key',slotStart:'2030-01-01T12:00:00Z',slotEnd:'2030-01-01T13:00:00Z',customer:{name:'Synthetic',email:'synthetic@example.test'}})).rejects.toThrow('valid business');
  expect(f).toHaveBeenCalledTimes(calls);
 });
 it('keeps customer checkout and malformed owner tenant construction strict',()=>{
  const f=transport([]);
  expect(()=>createRuntimeClient({...config,tenantId:''},f)).toThrow('configuration');
  expect(()=>createRuntimeClient({...config,tenantId:'spoof',allowMembershipDiscovery:true},f)).toThrow('configuration');
  expect(f).not.toHaveBeenCalled();
 });
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
it('rejects a body decoded after the authenticated session has ended',async()=>{
 let finish!:(value:unknown)=>void;const decoded=new Promise<unknown>(r=>finish=r);const slow=json([]);vi.spyOn(slow,'json').mockReturnValue(decoded);
 const f=transport([json({access_token:'synthetic'}),json({id:U}),slow]);const c=createRuntimeClient(config,f);await c.signIn('synthetic@example.test','fixture');const pending=c.memberships();
 await vi.waitFor(()=>expect(slow.json).toHaveBeenCalled());c.signOut();finish([{tenant_id:T,role:'BUSINESS_OWNER'}]);await expect(pending).rejects.toThrow('Session changed');
});
const F='44444444-4444-4444-8444-444444444444';
const publicationReceipt={versionId:U,installationId:S,renderSchemaVersion:3 as const,hostedPath:'/checkout/flow/'+S};
const publicationInput={serviceId:S,name:'Paid test form',checkoutOrigin:'https://booking-lumin-checkout-staging.netlify.app'};
it('keeps the connected owner credential private while publishing the exact paid-simple body',async()=>{
 const secret='synthetic-owner-private-token';const f=transport([json({access_token:secret}),json({id:U}),json({ok:true,data:publicationReceipt})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);
 await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'not_sent'});expect(f).not.toHaveBeenCalled();await c.signIn('owner@example.test','fixture');expect(await c.publishPaidSimple(T,F,publicationInput)).toEqual(publicationReceipt);
 const [url,options]=f.mock.calls[2]!;expect(url).toBe('https://api.example.test/api/paid-simple-flows/'+F+'/publish?tenantId='+T);expect(String(url)).not.toContain(secret);expect(options?.headers).toEqual({Authorization:'Bearer '+secret,'Content-Type':'application/json'});expect(options?.credentials).toBe('omit');expect(options?.redirect).toBe('error');expect(JSON.parse(options?.body as string)).toEqual({serviceId:S,name:'Paid test form',allowedOrigins:[publicationInput.checkoutOrigin]});expect(JSON.stringify(c)).not.toContain(secret);expect(c).not.toHaveProperty('token');expect(c).not.toHaveProperty('accessToken');expect(c.paidSimplePublicationState(T)).toEqual({phase:'published',flowId:F,receipt:publicationReceipt});
 const state=c.paidSimplePublicationState(T);if(state.phase==='published')(state.receipt as {versionId:string}).versionId=F;expect(c.paidSimplePublicationState(T)).toMatchObject({receipt:{versionId:U}});c.signOut();expect(c.paidSimplePublicationState(T)).toEqual({phase:'ready'});await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'not_sent'});
});
it('rejects missing or unsafe publication origins and widened authority before mutation',async()=>{
 for(const origin of ['http://localhost:8787','https://api.example.test/','https://user:pass@api.example.test','https://api.example.test/path','https://api.example.test?token=fixture','https://api.example.test#x'])expect(()=>createRuntimeClient({...config,bookingApiOrigin:origin})).toThrow('configuration');
 const f=transport([json({access_token:'synthetic-private-token'}),json({id:U})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');
 for(const input of [{...publicationInput,checkoutOrigin:'https://checkout.example.test/path'},{...publicationInput,serviceId:'invalid'},{...publicationInput,name:' '},{...publicationInput,amount:1}])await expect(c.publishPaidSimple(T,F,input)).rejects.toMatchObject({delivery:'not_sent'});expect(f).toHaveBeenCalledTimes(2);
 const unconfigured=createRuntimeClient(config,transport([json({access_token:'synthetic-private-token'}),json({id:U})]));await unconfigured.signIn('owner@example.test','fixture');await expect(unconfigured.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'not_sent'});
});
it('locks unknown delivery for the whole business without new flow identities or replay',async()=>{
 const f=transport([json({access_token:'synthetic-private-token'}),json({id:U}),json({ok:true,data:{...publicationReceipt,hostedPath:'/checkout/flow/'+F}})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'unknown'});expect(c.paidSimplePublicationState(T)).toEqual({phase:'unknown',flowId:F});await expect(c.publishPaidSimple(T,U,publicationInput)).rejects.toMatchObject({delivery:'unknown'});await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'unknown'});expect(f).toHaveBeenCalledTimes(3);expect(c.paidSimplePublicationState(U)).toEqual({phase:'ready'});
});
it('fails closed on malformed version receipts and server failures that could follow a commit',async()=>{
 for(const response of [json({ok:true,data:{...publicationReceipt,renderSchemaVersion:2}}),json({ok:true,data:{...publicationReceipt,versionId:'bad'}}),json({ok:true,data:{...publicationReceipt,extra:'private'}}),json({ok:true,data:publicationReceipt,extra:'private'}),json({ok:false,code:'INTERNAL_ERROR'},500),json({message:'private-token'},502)]){
  const f=transport([json({access_token:'synthetic-private-token'}),json({id:U}),response]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'unknown'});expect(c.paidSimplePublicationState(T).phase).toBe('unknown');
 }
});
it('allows an explicit corrected attempt after definitive rejection but never echoes server details',async()=>{
 const f=transport([json({access_token:'synthetic-private-token'}),json({id:U}),json({ok:false,code:'UNSUPPORTED_CONFIG'},422),json({ok:true,data:publicationReceipt})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'rejected'});expect(c.paidSimplePublicationState(T)).toEqual({phase:'ready'});expect(await c.publishPaidSimple(T,U,publicationInput)).toEqual(publicationReceipt);
});
it('drops publication receipts decoded after logout or another sign-in',async()=>{
 let finish!:(value:unknown)=>void;const decoded=new Promise<unknown>(resolve=>finish=resolve);const response=json({});vi.spyOn(response,'json').mockReturnValue(decoded);const f=transport([json({access_token:'synthetic-private-token'}),json({id:U}),response]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');const pending=c.publishPaidSimple(T,F,publicationInput);await vi.waitFor(()=>expect(response.json).toHaveBeenCalled());c.signOut();finish({ok:true,data:publicationReceipt});await expect(pending).rejects.toMatchObject({delivery:'unknown'});expect(c.paidSimplePublicationState(T)).toEqual({phase:'ready'});
});
it('verifies the actual owner paid publication HTTP envelope without exposing a credential accessor',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const portalOrigin='https://portal.example.test';const ownerToken='synthetic-owner-private-token';const call=vi.fn(async(_name:string,params:readonly unknown[])=>({versionId:params[5],installationId:params[6],renderSchemaVersion:3}));
 const server=createFlowHttpServer({repository:{call},ownerOrigins:[portalOrigin],customerOrigins:[publicationInput.checkoutOrigin],authenticateOwner:async token=>token===ownerToken?U:null,paidSimplePublication:true});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const f=vi.fn<typeof fetch>(async(input,options)=>{const url=new URL(String(input));if(url.pathname==='/auth/v1/token')return json({access_token:ownerToken});if(url.pathname==='/auth/v1/user')return json({id:U});return fetch('http://127.0.0.1:'+address.port+url.pathname+url.search,{...options,headers:{...options?.headers,Origin:portalOrigin}});});const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');const receipt=await c.publishPaidSimple(T,F,publicationInput);expect(receipt).toMatchObject({renderSchemaVersion:3,hostedPath:'/checkout/flow/'+receipt.installationId});expect(receipt.versionId).toMatch(/^[0-9a-f-]{36}$/);expect(call).toHaveBeenCalledWith('publish_paid_simple_flow',[U,T,F,S,'Paid test form',receipt.versionId,receipt.installationId,[publicationInput.checkoutOrigin]]);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
it('does not bind a previous publication receipt to a newly signed-in session',async()=>{
 let finish!:(value:unknown)=>void;const decoded=new Promise<unknown>(resolve=>finish=resolve);const response=json({});vi.spyOn(response,'json').mockReturnValue(decoded);const f=transport([json({access_token:'synthetic-old-owner-token'}),json({id:U}),response,json({access_token:'synthetic-new-owner-token'}),json({id:S})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('old@example.test','fixture');const pending=c.publishPaidSimple(T,F,publicationInput);await vi.waitFor(()=>expect(response.json).toHaveBeenCalled());await c.signIn('new@example.test','fixture');finish({ok:true,data:publicationReceipt});await expect(pending).rejects.toMatchObject({delivery:'unknown'});expect(c.paidSimplePublicationState(T)).toEqual({phase:'ready'});expect(f.mock.calls[4]?.[1]?.headers).toMatchObject({Authorization:'Bearer synthetic-new-owner-token'});
});

it('recovers an exact publication receipt by an authenticated read without a writer or credential disclosure',async()=>{
 const f=transport([json({access_token:'synthetic-private-owner'}),json({id:U}),json({ok:true,data:publicationReceipt})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);
 await expect(c.recoverPaidSimplePublication(T,F)).rejects.toMatchObject({delivery:'not_sent'});await c.signIn('owner@example.test','fixture');expect(await c.recoverPaidSimplePublication(T,F)).toEqual(publicationReceipt);
 expect(f.mock.calls[2]).toEqual(['https://api.example.test/api/paid-simple-flows/'+F+'/publication?tenantId='+T,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer synthetic-private-owner'}}]);expect(c.paidSimplePublicationState(T)).toEqual({phase:'published',flowId:F,receipt:publicationReceipt});expect(c.paidSimplePublicationState(U)).toEqual({phase:'ready'});await expect(c.publishPaidSimple(T,U,publicationInput)).rejects.toMatchObject({delivery:'not_sent'});expect(f).toHaveBeenCalledTimes(3);
});
it('does not unlock unknown delivery on not-found, failed, malformed or unsupported receipt lookup',async()=>{
 for(const response of [json({ok:false,code:'NOT_AVAILABLE'},404),json({ok:false,code:'FORBIDDEN'},403),json({ok:false,code:'UNSUPPORTED_CONFIG'},422),json({ok:false,code:'INTERNAL_ERROR'},500),json({ok:true,data:{...publicationReceipt,hostedPath:'/checkout/flow/'+F}}),json({ok:true,data:{...publicationReceipt,renderSchemaVersion:2}}),json({ok:true,data:{...publicationReceipt,versionId:'invalid'}}),json({ok:true,data:{...publicationReceipt,extra:'secret'}}),json({ok:true,data:publicationReceipt,extra:'secret'})]){
  const f=transport([json({access_token:'synthetic-private-owner'}),json({id:U}),response]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.recoverPaidSimplePublication(T,F)).rejects.toMatchObject({delivery:'unknown'});expect(c.paidSimplePublicationState(T)).toEqual({phase:'unknown',flowId:F});await expect(c.publishPaidSimple(T,U,publicationInput)).rejects.toMatchObject({delivery:'unknown'});await expect(c.recoverPaidSimplePublication(T,U)).rejects.toMatchObject({delivery:'not_sent'});expect(f).toHaveBeenCalledTimes(3);
 }
});
it('allows explicitly rechecking only the same uncertain attempt and never automatically publishes',async()=>{
 let n=0;const f=vi.fn<typeof fetch>(async()=>++n===1?json({access_token:'synthetic-private-owner'}):n===2?json({id:U}):n===3?Promise.reject(Error('private-response-secret')):json({ok:true,data:publicationReceipt}));const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.recoverPaidSimplePublication(T,F)).rejects.toThrow('could not be checked');expect(c.paidSimplePublicationState(T)).toEqual({phase:'unknown',flowId:F});expect(await c.recoverPaidSimplePublication(T,F)).toEqual(publicationReceipt);expect(f.mock.calls.slice(2).every(([,options])=>options?.method==='GET'&&!options?.body)).toBe(true);
});
it('recovers a missing POST receipt through GET without replaying publication',async()=>{
 const f=transport([json({access_token:'synthetic-private-owner'}),json({id:U}),json({ok:false,code:'INTERNAL_ERROR'},500),json({ok:true,data:publicationReceipt})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.publishPaidSimple(T,F,publicationInput)).rejects.toMatchObject({delivery:'unknown'});expect(await c.recoverPaidSimplePublication(T,F)).toEqual(publicationReceipt);expect(f.mock.calls[2]?.[1]?.method).toBe('POST');expect(f.mock.calls[3]?.[1]?.method).toBe('GET');
});
it('binds in-flight receipt reads and drops old-generation results even during a new same-business read',async()=>{
 let finish!:(value:unknown)=>void;const decoded=new Promise<unknown>(resolve=>finish=resolve);const response=json({});vi.spyOn(response,'json').mockReturnValue(decoded);const f=transport([json({access_token:'old-private-owner'}),json({id:U}),response,json({access_token:'new-private-owner'}),json({id:S}),json({ok:false,code:'NOT_AVAILABLE'},404)]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('old@example.test','fixture');const pending=c.recoverPaidSimplePublication(T,F);await vi.waitFor(()=>expect(response.json).toHaveBeenCalled());await expect(c.recoverPaidSimplePublication(T,F)).rejects.toMatchObject({delivery:'not_sent'});await expect(c.recoverPaidSimplePublication(T,U)).rejects.toMatchObject({delivery:'not_sent'});await c.signIn('new@example.test','fixture');await expect(c.recoverPaidSimplePublication(T,U)).rejects.toMatchObject({delivery:'unknown'});finish({ok:true,data:publicationReceipt});await expect(pending).rejects.toThrow('session changed');expect(c.paidSimplePublicationState(T)).toEqual({phase:'unknown',flowId:U});expect(f.mock.calls[5]?.[1]?.headers).toEqual({Authorization:'Bearer new-private-owner'});
});
it('rejects malformed recovery identities before any network or publication lock',async()=>{
 const f=transport([json({access_token:'synthetic-private-owner'}),json({id:U})]);const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.recoverPaidSimplePublication('invalid',F)).rejects.toMatchObject({delivery:'not_sent'});await expect(c.recoverPaidSimplePublication(T,'invalid')).rejects.toMatchObject({delivery:'not_sent'});expect(f).toHaveBeenCalledTimes(2);expect(c.paidSimplePublicationState(T)).toEqual({phase:'ready'});
});

it('validates the actual publication recovery HTTP envelope and identity without invoking the writer',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const portalOrigin='https://portal.example.test',ownerToken='synthetic-recovery-owner';const writer=vi.fn(async()=>{throw Error('publication writer must not run');});let available=false;const read=vi.fn(async()=>available?publicationReceipt:null);
 const server=createFlowHttpServer({repository:{call:writer},ownerOrigins:[portalOrigin],customerOrigins:[publicationInput.checkoutOrigin],authenticateOwner:async token=>token===ownerToken?U:null,paidSimplePublication:true,paidPublication:read});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const f=vi.fn<typeof fetch>(async(input,options)=>{const url=new URL(String(input));if(url.pathname==='/auth/v1/token')return json({access_token:ownerToken});if(url.pathname==='/auth/v1/user')return json({id:U});return fetch('http://127.0.0.1:'+address.port+url.pathname+url.search,{...options,headers:{...options?.headers,Origin:portalOrigin}});});const c=createRuntimeClient({...config,bookingApiOrigin:'https://api.example.test'},f);await c.signIn('owner@example.test','fixture');await expect(c.recoverPaidSimplePublication(T,F)).rejects.toThrow('No active receipt');expect(c.paidSimplePublicationState(T)).toEqual({phase:'unknown',flowId:F});available=true;expect(await c.recoverPaidSimplePublication(T,F)).toEqual(publicationReceipt);expect(read).toHaveBeenCalledTimes(2);expect(read).toHaveBeenNthCalledWith(1,U,T,F);expect(read).toHaveBeenNthCalledWith(2,U,T,F);expect(writer).not.toHaveBeenCalled();expect(f.mock.calls.slice(2).every(([,options])=>options?.method==='GET'&&!options?.body)).toBe(true);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
},15000);
