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
