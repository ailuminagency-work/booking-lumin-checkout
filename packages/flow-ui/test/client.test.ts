import {afterEach,it,expect,vi} from 'vitest';
import {createFlowClient} from '../src/client';
import {answersValid,orderedQuestions,type ServiceRender,type FlowConfig,type Answers} from '../src/types';
const id='11111111-1111-4111-8111-111111111111';
const service:ServiceRender={id,name:'Request',durationMinutes:30,questions:[{id:'one',prompt:'Choose',kind:'single_choice',required:true,choices:[{id:'a',label:'A'}]},{id:'qty',prompt:'Quantity',kind:'quantity',required:true,choices:[],minQty:0,maxQty:4},{id:'many',prompt:'Options',kind:'multi_choice',required:false,choices:[{id:'x',label:'X'}]}]};
const config:FlowConfig={key:'request',steps:service.questions.map(q=>({key:q.id,questionKey:q.id,kind:'question',required:q.required}))};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const streamed=(chunks:Uint8Array[],headers?:HeadersInit)=>new Response(new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}),{headers});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
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
 let release!:(value:Uint8Array)=>void;const body=new ReadableStream<Uint8Array>({start(controller){release=value=>{controller.enqueue(value);controller.close();};}});
 const client=createFlowClient('https://api.example',false,async()=>new Response(body));
 const request=client.services('old-token',id);await Promise.resolve();client.invalidate();try{release(encoded({ok:true,data:{services:[service]}}));}catch{/* Cancellation may already close the stream. */}await expect(request).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('redacts network/database messages and rejects extra response fields',async()=>{
 for(const response of [{ok:false,code:'BAD_SQL',message:'secret'}, {ok:true,data:{services:[{...service,secret:'private'}]}}]){const client=createFlowClient('https://api.example',false,async()=>new Response(JSON.stringify(response)));await expect(client.services('token',id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});}
});
it('accepts a service catalog larger than the session transport ceiling',async()=>{
 const services=Array.from({length:70},(_,i)=>({...service,id:`11111111-1111-4111-8111-${(i+1).toString(16).padStart(12,'0')}`,name:`Service ${i}`,questions:Array.from({length:20},(_,j)=>({id:`q-${i}-${j}`,prompt:'Choose a service option',kind:'single_choice' as const,required:true,choices:Array.from({length:10},(_,k)=>({id:`c-${k}`,label:'A'.repeat(200)}))}))}));
 const bytes=encoded({ok:true,data:{services}});
 expect(bytes.length).toBeGreaterThan(2097152);
 const client=createFlowClient('https://api.example',false,async()=>streamed([bytes]));
 const result=await client.services('token',id);expect(result.services).toHaveLength(70);expect(result.services[69]?.questions[19]?.choices).toHaveLength(10);
});
it('reads an exact-ceiling split session response before validating its envelope',async()=>{
 const base=encoded({ok:false,code:'NOT_AVAILABLE'}),bytes=new Uint8Array(2097152);bytes.set(base);bytes.fill(32,base.length);
 const client=createFlowClient('https://api.example',false,async()=>streamed([bytes.subarray(0,7),bytes.subarray(7)],{'Content-Length':'1'}));
 await expect(client.session(id)).rejects.toMatchObject({code:'NOT_AVAILABLE'});
});
it('rejects oversized session streams despite missing or forged wire length',async()=>{
 const oversized=new Uint8Array(2097153);oversized.fill(32);
 for(const headers of [undefined,{'Content-Length':'1'}]){
  const client=createFlowClient('https://api.example',false,async()=>streamed([oversized.subarray(0,8),oversized.subarray(8)],headers));
  await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 }
});
it('cancels the response stream when split chunks overrun the byte ceiling',async()=>{
 const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(2097152));controller.enqueue(new Uint8Array(1));},cancel});
 const client=createFlowClient('https://api.example',false,async()=>new Response(body));
 await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await Promise.resolve();expect(cancel).toHaveBeenCalledTimes(1);
});
it('ignores malformed wire lengths and validates counted decoded session bytes',async()=>{
 for(const length of ['-1','1.5','1e3','9007199254740993','01']){
  const client=createFlowClient('https://api.example',false,async()=>streamed([encoded({ok:false,code:'NOT_AVAILABLE'})],{'Content-Length':length}));
  await expect(client.session(id)).rejects.toMatchObject({code:'NOT_AVAILABLE'});
 }
});
it('decodes a multibyte UTF-8 session service name split across chunks',async()=>{
 const named={...service,name:'Café'},bytes=encoded({ok:true,data:{sessionToken:'t'.repeat(43),expiresAt:'2030-01-01T00:00:00.000Z',render:{versionId:id,config,service:named}}}),at=bytes.indexOf(0xc3);
 const client=createFlowClient('https://api.example',false,async()=>streamed([bytes.subarray(0,at+1),bytes.subarray(at+1)]));
 expect((await client.session(id)).render.service.name).toBe('Café');
});
it('copies raw bytes from a spoofed DataView rather than indexed elements',async()=>{
 const bytes=encoded({ok:false,code:'NOT_AVAILABLE'}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 Object.defineProperty(view,'BYTES_PER_ELEMENT',{value:1});
 const client=createFlowClient('https://api.example',false,async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(view as unknown as Uint8Array);controller.close();}})));
 await expect(client.session(id)).rejects.toMatchObject({code:'NOT_AVAILABLE'});
});
it('copies raw bytes from a signed one-byte view without changing JSON',async()=>{
 const bytes=encoded({ok:false,code:'NOT_AVAILABLE'}),signed=new Int8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const client=createFlowClient('https://api.example',false,async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(signed as unknown as Uint8Array);controller.close();}})));
 await expect(client.session(id)).rejects.toMatchObject({code:'NOT_AVAILABLE'});
});
it('invalidates a pending streamed response and cancels its reader',async()=>{
 const cancel=vi.fn(),response=new Response(new ReadableStream<Uint8Array>({cancel}));
 const client=createFlowClient('https://api.example',false,async()=>response),pending=client.session(id);
 await Promise.resolve();client.invalidate();await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await Promise.resolve();expect(cancel).toHaveBeenCalledTimes(1);
});
it('bounds the public session call without imposing its ceiling on configurable catalogs',async()=>{
 const oversized=new Uint8Array(2097153),fetcher=vi.fn(async()=>streamed([oversized]));
 const client=createFlowClient('https://api.example',false,fetcher);
 await expect(client.session(id)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('accepts a configurable V2 session through the bounded public path',async()=>{
 const render={versionId:id,renderSchemaVersion:2,submissionMode:'unconfirmed_request',service:{...service,name:'V2'},config:{key:'test',steps:[{key:'one',questionKey:'one',kind:'question',required:true},{key:'qty',questionKey:'qty',kind:'question',required:true},{key:'many',questionKey:'many',kind:'question',required:false}]}};
 const data={sessionToken:'t'.repeat(43),expiresAt:'2030-01-01T00:00:00.000Z',render};
 const client=createFlowClient('https://api.example',false,async()=>streamed([encoded({ok:true,data})]));
 expect((await client.session(id)).render).toMatchObject({renderSchemaVersion:2});
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
it('bounds a never-resolving fetch to one 15-second request and aborts it',async()=>{
 vi.useFakeTimers();const signals:AbortSignal[]=[];
 const client=createFlowClient('https://api.example',false,async(_url,options)=>{signals.push(options!.signal!);return new Promise<Response>(()=>{});});
 const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'The request could not be completed.'});
 expect(signals).toHaveLength(1);await vi.advanceTimersByTimeAsync(14999);expect(signals[0]!.aborted).toBe(false);await vi.advanceTimersByTimeAsync(1);await observed;expect(signals[0]!.aborted).toBe(true);
});
it('bounds a never-resolving body and discards a response after timeout',async()=>{
 vi.useFakeTimers();const cancel=vi.fn(),response=new Response(new ReadableStream<Uint8Array>({cancel}));
 const client=createFlowClient('https://api.example',false,async()=>response),pending=client.session(id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await vi.advanceTimersByTimeAsync(15000);await observed;expect(cancel).toHaveBeenCalledTimes(1);
});
it('invalidates every active call promptly despite ignored abort and discards late responses',async()=>{
 const gates=[deferred<Response>(),deferred<Response>(),deferred<Response>()],signals:AbortSignal[]=[],cancels=[vi.fn(async()=>{}),vi.fn(async()=>{}),vi.fn(async()=>{})];let called=0;
 const client=createFlowClient('https://api.example',false,async(_url,options)=>{signals.push(options!.signal!);const at=called++;return at<gates.length?gates[at]!.promise:new Response(JSON.stringify({ok:true,data:{services:[service]}}));});
 const pending=gates.map(()=>client.services('old-token',id));const observed=pending.map(p=>expect(p).rejects.toMatchObject({code:'UNAUTHENTICATED'}));expect(called).toBe(3);client.invalidate();await Promise.all(observed);expect(signals.every(signal=>signal.aborted)).toBe(true);
 gates.forEach((gate,i)=>gate.resolve({ok:true,body:{cancel:cancels[i]},json:async()=>({ok:true,data:{services:[service]}})} as unknown as Response));for(let i=0;i<8;i++)await Promise.resolve();expect(cancels.every(cancel=>cancel.mock.calls.length===1)).toBe(true);
 const later=await client.services('new-token',id);expect(later.services).toEqual([service]);expect(called).toBe(4);
});
it('does not replay a timed-out submit and permits explicit identical-body retry',async()=>{
 vi.useFakeTimers();const bodies:string[]=[];let calls=0;
 const client=createFlowClient('https://api.example',false,async(_url,options)=>{calls++;bodies.push(options!.body as string);return calls===1?new Promise<Response>(()=>{}):Promise.resolve(new Response(JSON.stringify({ok:true,data:{reference:'LMN-TEST',state:'draft',confirmed:false}})));});
 const body={idempotencyKey:'same-fixed-key',answers:{one:{choiceIds:['a']}},customer:{name:'Person',email:'person@example.test'},requestedStart:'2030-01-01T10:00:00.000Z'};
 const first=client.submit('t'.repeat(43),body),observed=expect(first).rejects.toMatchObject({code:'INTERNAL_ERROR'});await vi.advanceTimersByTimeAsync(15000);await observed;expect(calls).toBe(1);expect(await client.submit('t'.repeat(43),body)).toMatchObject({reference:'LMN-TEST'});expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);
});
it('rejects a late successful fetch continuation when its timer callback has not run',async()=>{
 let monotonic=0;vi.spyOn(performance,'now').mockImplementation(()=>monotonic);const gate=deferred<Response>(),cancel=vi.fn(async()=>{});
 const client=createFlowClient('https://api.example',false,async()=>gate.promise),pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 monotonic=15001;gate.resolve({ok:true,body:{cancel},json:async()=>({ok:true,data:{services:[service]}})} as unknown as Response);await observed;expect(cancel).toHaveBeenCalledTimes(1);
});
it('rejects a late successful JSON continuation even when timeout delivery is delayed',async()=>{
 let monotonic=0,release!:(bytes:Uint8Array)=>void;vi.spyOn(performance,'now').mockImplementation(()=>monotonic);const cancel=vi.fn();
 const client=createFlowClient('https://api.example',false,async()=>new Response(new ReadableStream<Uint8Array>({start(controller){release=bytes=>{controller.enqueue(bytes);controller.close();};},cancel})));const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await Promise.resolve();monotonic=15001;release(encoded({ok:true,data:{services:[service]}}));await observed;
});
it('rechecks the deadline after timer cleanup before resolving successful data',async()=>{
 let monotonic=0,advanceOnClear=false;vi.spyOn(performance,'now').mockImplementation(()=>monotonic);
 const nativeClear=globalThis.clearTimeout;
 vi.spyOn(globalThis,'clearTimeout').mockImplementation(handle=>{nativeClear(handle);if(advanceOnClear)monotonic=15000;});
 const gate=deferred<Response>(),cancel=vi.fn(),client=createFlowClient('https://api.example',false,async()=>gate.promise);
 const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 monotonic=14999;advanceOnClear=true;gate.resolve(new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(encoded({ok:true,data:{services:[service]}}));controller.close();},cancel})));
 await observed;
});
