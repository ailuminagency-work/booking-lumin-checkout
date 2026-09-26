import {afterEach,expect,it,vi} from 'vitest';
import type {AddressInfo} from 'node:net';
import type {Server} from 'node:http';
import {createFlowHttpServer} from './http';
import type {AdoptionOutcome} from './service-template-adoption';
import {adoptServiceTemplate,type AdoptionClient} from './service-template-adoption';

const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor='11111111-1111-4111-8111-111111111111';
const service='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const origin='https://owner.example.test';
const token='x'.repeat(32);
const idempotencyKey='template-key-000001';
type VerifiedActor={userId:string};
type AdoptionRequest={tenantId:string;templateKey:string;idempotencyKey:string};
let server:Server|undefined;

afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;});

async function setup(adopt:(actor:{userId:string},request:{tenantId:string;templateKey:string;idempotencyKey:string})=>Promise<AdoptionOutcome>){
 server=createFlowHttpServer({repository:{call:async()=>{throw Error('UNEXPECTED_RPC');}},authenticateOwner:async credential=>credential===token?actor:null,
  ownerOrigins:[origin],customerOrigins:['https://customer.example.test'],adoptTemplate:adopt});
 await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as AddressInfo).port;
 return async(body:unknown,options:{credential?:string;method?:string;tenantId?:string}={})=>{
  const response=await fetch(`http://127.0.0.1:${port}/api/service-templates/adopt?tenantId=${options.tenantId??tenant}`,{
   method:options.method??'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${options.credential??token}`},
   body:options.method==='GET'?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 };
}

it('passes only verified actor, tenant and strict key to the server adoption seam',async()=>{
 const adopt=vi.fn(async(_actor:VerifiedActor,_request:AdoptionRequest):Promise<AdoptionOutcome>=>({kind:'committed',serviceId:service,templateKey:'housekeeping',active:false}));
 const request=await setup(adopt);
 const result=await request({key:'housekeeping',idempotencyKey});
 expect(result).toEqual({status:200,body:{ok:true,data:{serviceId:service,templateKey:'housekeeping',active:false}}});
 expect(adopt).toHaveBeenCalledExactlyOnceWith({userId:actor},{tenantId:tenant,templateKey:'housekeeping',idempotencyKey});
});

it('rejects browser service authority, missing identity and invalid tenant before adoption',async()=>{
 const adopt=vi.fn(async(_actor:VerifiedActor,_request:AdoptionRequest):Promise<AdoptionOutcome>=>({kind:'committed',serviceId:service,templateKey:'housekeeping',active:false}));
 const request=await setup(adopt);
 for(const body of [{key:'housekeeping',idempotencyKey,basePrice:0},{key:'constructor',idempotencyKey},{key:'housekeeping',idempotencyKey,tenantId:tenant}]){
  expect((await request(body)).status).toBe(400);
 }
 expect((await request({key:'housekeeping',idempotencyKey},{credential:'y'.repeat(32)})).status).toBe(401);
 expect((await request({key:'housekeeping',idempotencyKey},{tenantId:'invalid-tenant'})).status).toBe(400);
 expect(adopt).not.toHaveBeenCalled();
});

it('never reports an uncertain commit as success or changes the reconciliation key',async()=>{
 const adopt=vi.fn(async(_actor:VerifiedActor,_request:AdoptionRequest):Promise<AdoptionOutcome>=>({kind:'unknown_commit',code:'COMMIT_UNCERTAIN',reconciliation:'RETRY_OR_LOOKUP_WITH_SAME_KEY'}));
 const request=await setup(adopt);
 expect(await request({key:'housekeeping',idempotencyKey})).toEqual({status:503,body:{ok:false,code:'COMMIT_UNCERTAIN',reconciliation:'RETRY_WITH_SAME_KEY_ONLY'}});
 expect(adopt).toHaveBeenCalledTimes(1);
 expect(adopt.mock.calls[0]![1].idempotencyKey).toBe(idempotencyKey);
});

it('fails closed on a mismatched receipt and maps tenant denial without leaking internals',async()=>{
 const adopt=vi.fn(async(_actor:VerifiedActor,_request:AdoptionRequest):Promise<AdoptionOutcome>=>({kind:'committed',serviceId:service,templateKey:'other-template',active:false}));
 const request=await setup(adopt);
 expect(await request({key:'housekeeping',idempotencyKey})).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
 adopt.mockImplementationOnce(async()=>({kind:'failed',code:'FORBIDDEN',transaction:'not_committed'}));
 expect(await request({key:'housekeeping',idempotencyKey})).toEqual({status:403,body:{ok:false,code:'FORBIDDEN'}});
});

it('connects authenticated HTTP adoption to canonical housekeeping material in one transaction',async()=>{
 const calls:{sql:string;values?:unknown[]}[]=[];
 const client:AdoptionClient={
  async query(sql,values){
   calls.push({sql,values});
   if(sql.startsWith('SELECT t.currency'))return {command:'SELECT',rows:[{currency:'EUR',timezone:'Europe/Amsterdam'}]};
   if(sql.startsWith('SELECT public.begin_service_draft_intent'))return {command:'SELECT',rows:[{result:{state:'pending',serviceId:null,templateKey:'housekeeping',active:false}}]};
   if(sql.startsWith('SELECT public.ingest_service_draft'))return {command:'SELECT',rows:[{result:{serviceId:service,templateKey:'housekeeping',active:false}}]};
   return {command:sql.startsWith('BEGIN')?'BEGIN':sql==='COMMIT'?'COMMIT':sql.startsWith('SET')?'SET':'SELECT',rows:[{}]};
  },release(){},
 };
 const request=await setup((verified,input)=>adoptServiceTemplate({connect:async()=>client},verified,input));
 expect(await request({key:'housekeeping',idempotencyKey})).toEqual({status:200,body:{ok:true,data:{serviceId:service,templateKey:'housekeeping',active:false}}});
 const rpc=calls.find(call=>call.sql.startsWith('SELECT public.ingest_service_draft'));
 expect(rpc?.values?.slice(0,4)).toEqual([actor,tenant,idempotencyKey,'housekeeping']);
 const canonical=JSON.parse(rpc!.values![4] as string);
 expect(canonical.name).toBe('Housekeeping');
 expect(canonical).not.toHaveProperty('currency');
 expect(canonical).not.toHaveProperty('tenantId');
 expect(canonical).not.toHaveProperty('active');
 expect(calls.at(-1)?.sql).toBe('COMMIT');
});

