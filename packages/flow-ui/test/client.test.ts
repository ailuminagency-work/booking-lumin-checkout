import {afterEach,it,expect,vi} from 'vitest';
import {createFlowClient} from '../src/client';
import {answersValid,orderedQuestions,type ServiceRender,type FlowConfig,type Answers} from '../src/types';
const id='11111111-1111-4111-8111-111111111111';
const service:ServiceRender={id,name:'Request',durationMinutes:30,questions:[{id:'one',prompt:'Choose',kind:'single_choice',required:true,choices:[{id:'a',label:'A'}]},{id:'qty',prompt:'Quantity',kind:'quantity',required:true,choices:[],minQty:0,maxQty:4},{id:'many',prompt:'Options',kind:'multi_choice',required:false,choices:[{id:'x',label:'X'}]}]};
const config:FlowConfig={key:'request',steps:service.questions.map(q=>({key:q.id,questionKey:q.id,kind:'question',required:q.required}))};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
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
it('bounds a never-resolving fetch to one 15-second request and aborts it',async()=>{
 vi.useFakeTimers();const signals:AbortSignal[]=[];
 const client=createFlowClient('https://api.example',false,async(_url,options)=>{signals.push(options!.signal!);return new Promise<Response>(()=>{});});
 const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR',message:'The request could not be completed.'});
 expect(signals).toHaveLength(1);await vi.advanceTimersByTimeAsync(14999);expect(signals[0]!.aborted).toBe(false);await vi.advanceTimersByTimeAsync(1);await observed;expect(signals[0]!.aborted).toBe(true);
});
it('bounds a never-resolving body and discards a response after timeout',async()=>{
 vi.useFakeTimers();const body=deferred<unknown>(),cancel=vi.fn(async()=>{}),response={ok:true,json:()=>body.promise,body:{cancel}} as unknown as Response;
 const client=createFlowClient('https://api.example',false,async()=>response),pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 await vi.advanceTimersByTimeAsync(15000);await observed;expect(cancel).toHaveBeenCalledTimes(1);body.resolve({ok:true,data:{services:[service]}});await Promise.resolve();
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
 let monotonic=0;vi.spyOn(performance,'now').mockImplementation(()=>monotonic);const body=deferred<unknown>(),cancel=vi.fn(async()=>{});
 const client=createFlowClient('https://api.example',false,async()=>({ok:true,body:{cancel},json:()=>body.promise} as unknown as Response));const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 monotonic=15001;body.resolve({ok:true,data:{services:[service]}});await observed;expect(cancel).toHaveBeenCalledTimes(1);
});
it('rechecks the deadline after timer cleanup before resolving successful data',async()=>{
 let monotonic=0,advanceOnClear=false;vi.spyOn(performance,'now').mockImplementation(()=>monotonic);
 const nativeClear=globalThis.clearTimeout;
 vi.spyOn(globalThis,'clearTimeout').mockImplementation(handle=>{nativeClear(handle);if(advanceOnClear)monotonic=15000;});
 const gate=deferred<Response>(),cancel=vi.fn(async()=>{}),client=createFlowClient('https://api.example',false,async()=>gate.promise);
 const pending=client.services('secret',id),observed=expect(pending).rejects.toMatchObject({code:'INTERNAL_ERROR'});
 monotonic=14999;advanceOnClear=true;gate.resolve({ok:true,body:{cancel},json:async()=>({ok:true,data:{services:[service]}})} as unknown as Response);
 await observed;expect(cancel).toHaveBeenCalledTimes(1);
});
