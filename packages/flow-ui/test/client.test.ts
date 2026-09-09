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
