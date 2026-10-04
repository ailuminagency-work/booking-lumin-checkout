import {it,expect,vi} from 'vitest';
import {createFlowClient} from '../src/client';
import {answersValid,orderedQuestions,type ServiceRender,type FlowConfig,type Answers} from '../src/types';
const id='11111111-1111-4111-8111-111111111111';
const service:ServiceRender={id,name:'Request',durationMinutes:30,questions:[{id:'one',prompt:'Choose',kind:'single_choice',required:true,choices:[{id:'a',label:'A'}]},{id:'qty',prompt:'Quantity',kind:'quantity',required:true,choices:[],minQty:0,maxQty:4},{id:'many',prompt:'Options',kind:'multi_choice',required:false,choices:[{id:'x',label:'X'}]}]};
const config:FlowConfig={key:'request',steps:service.questions.map(q=>({key:q.id,questionKey:q.id,kind:'question',required:q.required}))};
it('rejects unsafe API origins and allows loopback HTTP only with explicit harness',()=>{
 for(const base of ['http://api.example','https://user:pass@api.example','https://api.example/path','https://api.example?x=1','https://api.example#x','http://localhost'])expect(()=>createFlowClient(base)).toThrow();
 expect(()=>createFlowClient('http://127.0.0.1:8787',true)).not.toThrow();
});
it('keeps credentials only in header and omits browser session state',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,data:{services:[service]}})));
 const client=createFlowClient('https://api.example',false,fetcher);await client.services('private-token',id);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).not.toContain('private-token');expect(options.credentials).toBe('omit');expect(options.redirect).toBe('error');expect(options.headers).toMatchObject({Authorization:'Bearer private-token'});
});
it('rejects stale response after awaited JSON and invalidates without storing tokens',async()=>{
 let resolve!:(v:unknown)=>void;const body=new Promise(r=>resolve=r);
 const client=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>body} as Response));
 const request=client.services('old-token',id);await Promise.resolve();client.invalidate();resolve({ok:true,data:{services:[service]}});await expect(request).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('redacts network/database messages and rejects extra response fields',async()=>{
 for(const response of [{ok:false,code:'BAD_SQL',message:'secret'}, {ok:true,data:{services:[{...service,secret:'private'}]}}]){const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify(response)));await expect(client.services('token',id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});}
});
it('requires choice and quantity, preserves valid zero, bounds quantities and choices',()=>{
 expect(answersValid(service,config,{})).toBe(false);
 const valid={one:{choiceIds:['a']},qty:{quantity:0}};expect(answersValid(service,config,valid)).toBe(true);
 for(const change of ([{qty:{quantity:5}},{qty:{quantity:1.5}},{one:{choiceIds:['unknown']}},{one:{choiceIds:['a','a']}},{many:{choiceIds:['x','x']}},{foreign:{quantity:1}}] as Answers[]))expect(answersValid(service,config,{...valid,...change})).toBe(false);
});
it('ordering shares exact required service question set and rejects weakened policy',()=>{
 expect(orderedQuestions(service,{...config,steps:[...config.steps].reverse()}).map(q=>q.id)).toEqual(['many','qty','one']);
 expect(()=>orderedQuestions(service,{...config,steps:config.steps.slice(1)})).toThrow();
 expect(()=>orderedQuestions(service,{...config,steps:config.steps.map(s=>({...s,required:false}))})).toThrow();
});
it('loads session availability with bearer only, validates bounded ranges and slot contracts',async()=>{
 const token='t'.repeat(43),from='2030-01-01T00:00:00Z',to='2030-01-02T00:00:00Z';
 const data={schemaVersion:1,serviceId:id,durationMinutes:30,slots:[{start:'2030-01-01T10:00:00Z',end:'2030-01-01T10:30:00Z',remainingCapacity:1}]};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,data})));const client=createFlowClient('https://api.example',false,fetcher);
 expect(await client.availability(token,from,to)).toEqual(data);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toContain('/api/flow-sessions/availability?from=');expect(url).not.toMatch(/tenantId|serviceId|tttt/);expect(options.method).toBe('GET');expect(options.headers).toMatchObject({Authorization:'Bearer '+token});
 for(const range of [[to,from],[from,'2030-01-09T00:00:00Z'],['invalid',to]])await expect(client.availability(token,range[0]!,range[1]!)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(fetcher).toHaveBeenCalledTimes(1);
 for(const change of [{serviceId:'bad'},{durationMinutes:0},{slots:[{...data.slots[0],end:'2030-01-01T10:15:00Z'}]},{slots:[{...data.slots[0],start:'invalid'}]},{slots:[{...data.slots[0],remainingCapacity:0}]},{slots:[data.slots[0],data.slots[0]]},{slots:[{...data.slots[0],start:'2029-12-31T10:00:00Z',end:'2029-12-31T10:30:00Z'}]},{secret:'private'}]){
  const bad=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{...data,...change}})));await expect(bad.availability(token,from,to)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 }
});
it('invalidates availability responses after JSON resolves',async()=>{
 let resolve!:(value:unknown)=>void;const body=new Promise(r=>resolve=r);const client=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>body} as Response));
 const request=client.availability('t'.repeat(43),'2030-01-01T00:00:00Z','2030-01-02T00:00:00Z');client.invalidate();resolve({ok:true,data:{schemaVersion:1,serviceId:id,durationMinutes:30,slots:[]}});await expect(request).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('accepts actual core full-day output, retains cross-midnight ends and filters next-midnight starts',async()=>{
 const {createAvailabilityEngine}=await import('@lumin/core');
 const from='2030-01-01T00:00:00.000Z',to='2030-01-02T00:00:00.000Z';
 const slots=createAvailabilityEngine().getSlots({tenantTimezone:'America/Los_Angeles',serviceId:id,durationMinutes:30,policy:{leadTimeMinutes:0,horizonDays:60,slotIntervalMinutes:15},rules:Array.from({length:7},(_,weekday)=>({id,tenantId:id,serviceId:id,weekday,startMinute:0,endMinute:1440,capacity:1})),overrides:[],existing:[],now:'2029-12-31T00:00:00.000Z',from,to});
 expect(slots.some(slot=>slot.start===to)).toBe(true);
 const crossMidnight=slots.find(slot=>slot.start<to&&slot.end>to);expect(crossMidnight).toBeDefined();
 const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{schemaVersion:1,serviceId:id,durationMinutes:30,slots}})));
 const result=await client.availability('t'.repeat(43),from,to);
 expect(result.slots).toEqual(slots.filter(slot=>slot.start>=from&&slot.start<to));expect(result.slots).toContainEqual(crossMidnight);expect(result.slots.some(slot=>slot.start===to)).toBe(false);
});
it('holds the persisted session request with an empty body and strict receipt',async()=>{
 const token='t'.repeat(43),receipt={schemaVersion:1,bookingId:id,holdId:'22222222-2222-4222-8222-222222222222',status:'active',expiresAt:'2030-01-01T10:05:00Z'};
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,data:receipt})));const client=createFlowClient('https://api.example',false,fetcher);expect(await client.hold(token)).toEqual(receipt);
 const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.example/api/flow-sessions/hold');expect(options.method).toBe('POST');expect(options.body).toBe('{}');expect(options.headers).toMatchObject({Authorization:'Bearer '+token});expect(options.credentials).toBe('omit');
 expect(()=>client.hold('bad-token')).toThrow();expect(fetcher).toHaveBeenCalledTimes(1);
 for(const change of [{schemaVersion:2},{schemaVersion:undefined},{bookingId:'invalid'},{holdId:'invalid'},{status:'confirmed'},{expiresAt:'invalid'},{confirmed:true},{tenantId:id}]){
  const bad=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{...receipt,...change}})));await expect(bad.hold(token)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 }
});
it('discards a hold receipt when the customer session is invalidated',async()=>{
 let resolve!:(value:unknown)=>void;const body=new Promise(r=>resolve=r);const client=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>body} as Response));
 const request=client.hold('t'.repeat(43));client.invalidate();resolve({ok:true,data:{schemaVersion:1,bookingId:id,holdId:id,status:'active',expiresAt:'2030-01-01T10:05:00Z'}});await expect(request).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('accepts the actual customer hold HTTP response envelope',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const token='t'.repeat(43),origin='https://checkout.example.test';
 const server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[],customerOrigins:[origin],customerHold:async()=>({bookingId:id,holdId:id,status:'active',expiresAt:'2030-01-01T10:05:00Z'})});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const client=createFlowClient('http://127.0.0.1:'+address.port,true,(input,options)=>fetch(input,{...options,headers:{...options?.headers,Origin:origin}}));
  expect(await client.hold(token)).toEqual({schemaVersion:1,bookingId:id,holdId:id,status:'active',expiresAt:'2030-01-01T10:05:00Z'});
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
it('validates committed paid V3 sessions without falling back to question render versions',async()=>{
 const render={versionId:id,renderSchemaVersion:3,submissionMode:'paid_service_request',paymentMode:'staging_mock',simulated:true,service:{id,name:'Housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}}};
 for(const value of [render,{...render,renderSchemaVersion:4},{...render,simulated:false},{...render,paymentMode:'stripe'},{...render,config:{steps:[]}},{...render,service:{...render.service,price:{amount:0,currency:'USD'}}}]){
  const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{sessionToken:'t'.repeat(43),expiresAt:'2035-01-01T00:00:00Z',render:value}})));
  if(value===render)expect((await client.session(id)).render).toEqual(render);else await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 }
});
it('accepts the actual staging test-payment HTTP envelope with bearer-only empty-body authority',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const token='t'.repeat(43),origin='https://checkout.example.test';const writer=vi.fn(async()=>({bookingId:id,paymentId:id,state:'confirmed' as const,replayed:false,provider:'staging_mock' as const,simulated:true as const}));
 const server=createFlowHttpServer({repository:{call:async()=>{throw Error('unexpected');}},ownerOrigins:[],customerOrigins:[origin],customerMockPayment:writer});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const transport=vi.fn((input:RequestInfo|URL,options?:RequestInit)=>fetch(input,{...options,headers:{...options?.headers,Origin:origin}}));const client=createFlowClient('http://127.0.0.1:'+address.port,true,transport);
  expect(await client.mockPayment(token)).toEqual({schemaVersion:1,bookingId:id,paymentId:id,state:'confirmed',replayed:false,provider:'staging_mock',simulated:true});expect(writer).toHaveBeenCalledTimes(1);const [url,options]=transport.mock.calls[0]!;expect(url).toBe('http://127.0.0.1:'+address.port+'/api/flow-sessions/mock-payment');expect(options?.body).toBe('{}');expect(options?.headers).toMatchObject({Authorization:'Bearer '+token});expect(options?.credentials).toBe('omit');
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
it('rejects widened or unconfirmed test-payment receipts and invalidated responses',async()=>{
 const receipt={schemaVersion:1,bookingId:id,paymentId:id,state:'confirmed',replayed:false,provider:'staging_mock',simulated:true};
 for(const change of [{schemaVersion:2},{schemaVersion:undefined},{bookingId:'invalid'},{paymentId:'invalid'},{state:'draft'},{provider:'stripe'},{simulated:false},{replayed:undefined},{amount:12500}]){const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify({ok:true,data:{...receipt,...change}})));await expect(client.mockPayment('t'.repeat(43))).rejects.toMatchObject({code:'INTERNAL_ERROR'});}
 let resolve!:(value:unknown)=>void;const body=new Promise(r=>resolve=r);const client=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>body} as Response));const pending=client.mockPayment('t'.repeat(43));client.invalidate();resolve({ok:true,data:receipt});await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});

const v4Render={versionId:id,renderSchemaVersion:4,submissionMode:'paid_option_request',paymentMode:'staging_mock',simulated:true,service:{id,name:'Pinned option service',durationMinutes:30,price:{amount:12500,currency:'USD'},questions:[{id:'visit',prompt:'Choose a visit',kind:'single_choice',required:true,choices:[{id:'first',label:'First visit'},{id:'return',label:'Return visit'}]}]}};
it('loads strict V4 sessions and rejects widened or unknown render versions without fallback',async()=>{
 for(const render of [v4Render,{...v4Render,renderSchemaVersion:5},{...v4Render,publication:{name:'Caller'}},{...v4Render,service:{...v4Render.service,questions:[{...v4Render.service.questions[0],kind:'multi_choice'}]}}]){const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({ok:true,data:{sessionToken:'v'.repeat(43),expiresAt:'2035-01-01T00:00:00Z',render}})));const client=createFlowClient('https://api.example',false,fetcher);if(render===v4Render)expect((await client.session(id)).render).toEqual(render);else await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(fetcher.mock.calls[0]?.[0]).not.toContain('vvvv');}
});
it('drops an awaited V4 session body after the flow generation changes',async()=>{
 let finish!:(value:unknown)=>void;const client=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>new Promise(r=>finish=r)}) as Response);const pending=client.session(id);await Promise.resolve();client.invalidate();finish({ok:true,data:{sessionToken:'v'.repeat(43),expiresAt:'2035-01-01T00:00:00Z',render:v4Render}});await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('accepts actual V4 session and request HTTP envelopes with exact pinned option answers and no price authority',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const origin='https://checkout.example.test',answers={visit:{choiceIds:['return']}};const repository={call:vi.fn(async(name:string)=>{if(name==='issue_flow_session')return {expiresAt:'2035-01-01T00:00:00Z',render:v4Render};if(name==='submit_flow_request')return {reference:'LMN-'+id.replaceAll('-','').toUpperCase(),state:'draft',confirmed:false};throw Error('Unexpected RPC');})};const server=createFlowHttpServer({repository,ownerOrigins:[],customerOrigins:[origin]});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const transport=vi.fn((input:RequestInfo|URL,options?:RequestInit)=>fetch(input,{...options,headers:{...options?.headers,Origin:origin}}));const client=createFlowClient('http://127.0.0.1:'+address.port,true,transport);const session=await client.session(id);expect(session.render).toEqual(v4Render);const body={idempotencyKey:'option-identity-123456',answers,customer:{name:'Synthetic',email:'synthetic@example.test'},requestedStart:'2030-01-01T10:00:00Z'};expect(await client.submit(session.sessionToken,body)).toMatchObject({state:'draft',confirmed:false});expect(transport.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(body));expect(transport.mock.calls[1]?.[1]?.headers).toMatchObject({Authorization:'Bearer '+session.sessionToken});expect(repository.call.mock.calls[1]?.[0]).toBe('submit_flow_request');
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

const v5Render={versionId:id,renderSchemaVersion:5 as const,submissionMode:'paid_customer_field_request' as const,paymentMode:'staging_mock' as const,simulated:true as const,service:{id,name:'Pinned informational service',durationMinutes:30,price:{amount:12500,currency:'USD'}},publication:{name:'Saved form',draftRevision:2,presentation:{accentColor:'#4f46e5' as const,layout:'stacked' as const}},customerFields:[{id:'custom_note',kind:'text' as const,label:'Note',required:true,maxLength:5},{id:'custom_extra',kind:'text' as const,label:'Optional information',required:false,maxLength:8}]};
const v5Token='f'.repeat(43),v5Receipt={reference:'LMN-'+id.replaceAll('-','').toUpperCase(),state:'draft',confirmed:false};
const v5Body=()=>({schemaVersion:2 as const,idempotencyKey:'field-request-identity-123',answers:{},customerAnswers:{custom_note:' Hi '},customer:{name:'Synthetic',email:'synthetic@example.test'},requestedStart:'2030-01-01T10:00:00Z'});
const v5Session=(render:unknown=v5Render,expiresAt='2035-01-01T00:00:00Z')=>new Response(JSON.stringify({ok:true,data:{sessionToken:v5Token,expiresAt,render}}));
it('accepts strict V5 pinned sessions and rejects wider fields or unrelated render versions',async()=>{
 for(const render of [v5Render,{...v5Render,renderSchemaVersion:6},{...v5Render,publication:undefined},{...v5Render,customerFields:[{...v5Render.customerFields[0],price:100}]},{...v5Render,customerFields:[v5Render.customerFields[0],v5Render.customerFields[0]]},{...v5Render,service:{...v5Render.service,questions:[]}}]){
  const client=createFlowClient('https://api.example',false,async()=>v5Session(render));
  if(render===v5Render){expect((await client.customerFieldSession(id)).render).toEqual(render);await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});}else await expect(client.customerFieldSession(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 }
});
it('requires a live acquired V5 capability and denies the legacy submission path without a request',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>v5Session()),client=createFlowClient('https://api.example',false,transport);
 await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await client.customerFieldSession(id);expect(()=>client.submit(v5Token,v5Body())).toThrow();expect(transport).toHaveBeenCalledTimes(1);
 client.invalidate();await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 const expired=createFlowClient('https://api.example',false,async()=>v5Session(v5Render,'2000-01-01T00:00:00Z'));await expect(expired.customerFieldSession(id)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('validates only pinned informational text, UTF16 bounds and exact empty priced answers before transport',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>v5Session()),client=createFlowClient('https://api.example',false,transport);await client.customerFieldSession(id);
 for(const customerAnswers of [{},{custom_note:'   '},{custom_note:'123456'},{custom_note:'x\n'},{custom_note:'\ud800'},{custom_note:'okay',custom_foreign:'x'},{custom_note:7},{custom_note:'😀😀😀'},Object.create({custom_note:'okay'})])await expect(client.submitCustomerFields(v5Token,{...v5Body(),customerAnswers} as never)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 for(const change of [{schemaVersion:1},{answers:{price:{quantity:12500}}},{tenantId:id},{customer:{...v5Body().customer,role:'owner'}},{requestedStart:'invalid'}])await expect(client.submitCustomerFields(v5Token,{...v5Body(),...change} as never)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(transport).toHaveBeenCalledTimes(1);
});
it('freezes V5 body and key through an ambiguous result, preserves whitespace and optional omission, and retries exactly',async()=>{
 let attempt=0;const transport=vi.fn<typeof fetch>(async(_url,options)=>{if(options?.body==='{}')return v5Session();if(++attempt===1)throw Error('lost receipt');return new Response(JSON.stringify({ok:true,data:v5Receipt}));});const client=createFlowClient('https://api.example',false,transport);const session=await client.customerFieldSession(id);(session.render as typeof v5Render).customerFields[0]!.maxLength=100;
 await expect(client.submitCustomerFields(v5Token,{...v5Body(),customerAnswers:{custom_note:'123456'}})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 const body=v5Body();await expect(client.submitCustomerFields(v5Token,body)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 for(const change of [{idempotencyKey:'replacement-identity-123'},{customerAnswers:{custom_note:'other'}},{customer:{name:'Other',email:'other@example.test'}},{requestedStart:'2030-01-02T10:00:00Z'}])await expect(client.submitCustomerFields(v5Token,{...v5Body(),...change})).rejects.toMatchObject({code:'CONFLICT'});
 expect(await client.submitCustomerFields(v5Token,v5Body())).toEqual(v5Receipt);expect(transport.mock.calls[1]![1]?.body).toBe(transport.mock.calls[2]![1]?.body);
 const sent=JSON.parse(String(transport.mock.calls[2]![1]?.body));expect(sent).toMatchObject({schemaVersion:2,answers:{},customerAnswers:{custom_note:' Hi '}});expect(sent.customerAnswers).not.toHaveProperty('custom_extra');expect(sent).not.toHaveProperty('price');expect(transport.mock.calls[2]![1]).toMatchObject({method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{Authorization:'Bearer '+v5Token}});
});
it('canonicalizes informational answer order using pinned definitions while preserving all values',async()=>{
 const transport=vi.fn<typeof fetch>(async(_url,options)=>options?.body==='{}'?v5Session():new Response(JSON.stringify({ok:true,data:v5Receipt})));const client=createFlowClient('https://api.example',false,transport);await client.customerFieldSession(id);
 await client.submitCustomerFields(v5Token,{...v5Body(),customerAnswers:{custom_extra:'',custom_note:'😀'}});await client.submitCustomerFields(v5Token,{...v5Body(),customerAnswers:{custom_note:'😀',custom_extra:''}});expect(transport.mock.calls[1]![1]?.body).toBe(transport.mock.calls[2]![1]?.body);
});
it('rejects malformed V5 request receipts, keeps the frozen attempt, and discards late session/request responses',async()=>{
 for(const receipt of [{...v5Receipt,confirmed:true},{...v5Receipt,reference:'LMN-foreign'},{...v5Receipt,total:12500}]){const transport=vi.fn<typeof fetch>(async(_url,options)=>options?.body==='{}'?v5Session():new Response(JSON.stringify({ok:true,data:receipt})));const client=createFlowClient('https://api.example',false,transport);await client.customerFieldSession(id);await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'INTERNAL_ERROR'});await expect(client.submitCustomerFields(v5Token,{...v5Body(),idempotencyKey:'other-key-123456789'})).rejects.toMatchObject({code:'CONFLICT'});}
 let finish!:(value:unknown)=>void;const client=createFlowClient('https://api.example',false,async(_url,options)=>options?.body==='{}'?v5Session():({ok:true,json:()=>new Promise(resolve=>finish=resolve)}) as Response);await client.customerFieldSession(id);const request=client.submitCustomerFields(v5Token,v5Body());await Promise.resolve();client.invalidate();finish({ok:true,data:v5Receipt});await expect(request).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 const late=createFlowClient('https://api.example',false,async()=>({ok:true,json:()=>new Promise(resolve=>finish=resolve)}) as Response);const pending=late.customerFieldSession(id);await Promise.resolve();late.invalidate();finish(await v5Session().json());await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});await expect(late.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('rejects reuse of a V5 capability for changed pinned definitions and enforces expiry before and after submission',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>v5Session());const client=createFlowClient('https://api.example',false,transport);await client.customerFieldSession(id);transport.mockImplementation(async()=>v5Session({...v5Render,versionId:'22222222-2222-4222-8222-222222222222'}));await expect(client.customerFieldSession(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 const clock=vi.spyOn(Date,'now');try{clock.mockReturnValue(Date.parse('2034-01-01T00:00:00Z'));let finish!:(value:unknown)=>void;const exp=createFlowClient('https://api.example',false,async(_url,options)=>options?.body==='{}'?v5Session():({ok:true,json:()=>new Promise(resolve=>finish=resolve)}) as Response);await exp.customerFieldSession(id);const pending=exp.submitCustomerFields(v5Token,v5Body());await Promise.resolve();clock.mockReturnValue(Date.parse('2036-01-01T00:00:00Z'));finish({ok:true,data:v5Receipt});await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});await expect(exp.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});}finally{clock.mockRestore();}
});

it('explicit paid acquisition accepts V3/V4 with one issuance and no fallback capability request',async()=>{
 const {customerFields:_,...v3Base}=v5Render;
 for(const value of [v4Render,{...v3Base,renderSchemaVersion:3,submissionMode:'paid_service_request'}]){
  const transport=vi.fn<typeof fetch>(async()=>v5Session(value)),client=createFlowClient('https://api.example',false,transport);expect((await client.customerFieldSession(id)).render).toEqual(value);expect(transport).toHaveBeenCalledTimes(1);await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 }
});

it('binds subsequent V5 replay receipts to the first verified request identity',async()=>{
 let reference=v5Receipt.reference;const transport=vi.fn<typeof fetch>(async(_url,options)=>options?.body==='{}'?v5Session():new Response(JSON.stringify({ok:true,data:{...v5Receipt,reference}})));const client=createFlowClient('https://api.example',false,transport);await client.customerFieldSession(id);expect(await client.submitCustomerFields(v5Token,v5Body())).toEqual(v5Receipt);reference='LMN-'+('2'.repeat(32));await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'INTERNAL_ERROR'});
});

it('uses the actual V5 HTTP session/request envelopes and isolated informational RPC on explicit lost-receipt replay',async()=>{
 const {createFlowHttpServer}=await import('../../../apps/api/src/http');const origin='https://checkout.example.test';let committed:string|undefined,writes=0;
 const repository={call:vi.fn(async(name:string,args:readonly unknown[])=>{
  if(name==='issue_flow_session')return {expiresAt:'2035-01-01T00:00:00Z',render:v5Render};
  if(name==='submit_customer_field_request'){const request=JSON.stringify(args.slice(2));if(committed===undefined){committed=request;writes++;}else if(committed!==request)throw Error('Changed frozen request');return v5Receipt;}
  throw Error('Unexpected RPC');
 })};const server=createFlowHttpServer({repository,ownerOrigins:[],customerOrigins:[origin]});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};let lose=true;const transport=vi.fn(async(input:RequestInfo|URL,options?:RequestInit)=>{const response=await fetch(input,{...options,headers:{...options?.headers,Origin:origin}});if(String(input).endsWith('/request')&&lose){lose=false;await response.text();throw Error('Lost received request receipt');}return response;});const client=createFlowClient('http://127.0.0.1:'+address.port,true,transport);const session=await client.customerFieldSession(id);expect(session.render).toEqual(v5Render);
  await expect(client.submitCustomerFields(session.sessionToken,v5Body())).rejects.toMatchObject({code:'INTERNAL_ERROR'});await expect(client.submitCustomerFields(session.sessionToken,{...v5Body(),customerAnswers:{custom_note:'other'}})).rejects.toMatchObject({code:'CONFLICT'});expect(await client.submitCustomerFields(session.sessionToken,v5Body())).toEqual(v5Receipt);expect(writes).toBe(1);expect(transport.mock.calls[1]![1]?.body).toBe(transport.mock.calls[2]![1]?.body);expect(transport.mock.calls[2]![1]).toMatchObject({method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+session.sessionToken}});expect(repository.call.mock.calls.map(call=>call[0])).toEqual(['issue_flow_session','submit_customer_field_request','submit_customer_field_request']);expect(repository.call.mock.calls[1]![1].slice(2)).toEqual([v5Body().idempotencyKey,{custom_note:' Hi '},v5Body().customer,'2030-01-01T10:00:00.000Z']);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

it('explicit acquisition preserves V1/V2 legacy forms in a single issuance without granting informational submit authority',async()=>{
 const pinned={versionId:id,service,config};for(const render of [pinned,{...pinned,renderSchemaVersion:2,submissionMode:'unconfirmed_request'}]){
  const transport=vi.fn<typeof fetch>(async(_url,options)=>options?.body==='{}'?v5Session(render):new Response(JSON.stringify({ok:true,data:v5Receipt})));const client=createFlowClient('https://api.example',false,transport);expect((await client.customerFieldSession(id)).render).toEqual(render);expect(transport).toHaveBeenCalledTimes(1);await expect(client.submitCustomerFields(v5Token,v5Body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(await client.submit(v5Token,{idempotencyKey:'legacy-request-123456',answers:{one:{choiceIds:['a']},qty:{quantity:1}},customer:v5Body().customer,requestedStart:v5Body().requestedStart})).toEqual(v5Receipt);expect(transport).toHaveBeenCalledTimes(2);
 }
});
