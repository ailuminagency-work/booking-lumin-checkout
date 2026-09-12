import {it,expect,vi} from 'vitest';
import {createRosterClient} from '../src/rosterClient';
const tenant='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
const base='http://127.0.0.1:8787';
const snapshot={rosterVersion:1,workers:[{id:worker,displayName:'🙂'.repeat(160),active:true}],crews:[],eligibility:[],shifts:[],services:[]};
const ok=(data:unknown)=>new Response(JSON.stringify({ok:true,data}));
it('rejects unsafe URL shapes before sending credentials',()=>{for(const url of ['https://name:secret@example.test','http://example.test','https://example.test/?x=1','https://example.test#x',base+'/'])expect(()=>createRosterClient(url,true)).toThrow();expect(()=>createRosterClient(base)).toThrow();});
it('sends credentials only in headers and validates bounded complete snapshots',async()=>{const fetcher=vi.fn(async()=>ok(snapshot));const client=createRosterClient(base,true,fetcher);expect((await client.snapshot('synthetic-secret',tenant)).workers[0]?.displayName).toBe('🙂'.repeat(160));expect(fetcher.mock.calls[0]).toEqual([base+'/api/roster?tenantId='+tenant,expect.objectContaining({credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-secret'}})]);});
it('rejects extra sensitive fields, dangling references, oversize and unknown errors without reflection',async()=>{for(const data of [{...snapshot,access:[{userId:tenant}]},{...snapshot,workers:[{...snapshot.workers[0],phone:'private'}]},{...snapshot,crews:[{id:other,name:'Crew',active:true,workerIds:[other]}]},{...snapshot,services:[{id:other,name:'x'.repeat(4097),active:true}]}])await expect(createRosterClient(base,true,async()=>ok(data)).snapshot('token',tenant)).rejects.toMatchObject({code:'INTERNAL_ERROR'});await expect(createRosterClient(base,true,async()=>new Response(JSON.stringify({ok:false,code:'secret exception'}),{status:500})).snapshot('token',tenant)).rejects.toThrow('The roster request could not be completed.');});
it('invalidates a response while its body is still arriving',async()=>{let controller!:ReadableStreamDefaultController<Uint8Array>;const stream=new ReadableStream<Uint8Array>({start(c){controller=c;}});const client=createRosterClient(base,true,async()=>new Response(stream));const pending=client.snapshot('old',tenant);await Promise.resolve();client.invalidate();controller.enqueue(new TextEncoder().encode(JSON.stringify({ok:true,data:snapshot})));controller.close();await expect(pending).rejects.toMatchObject({code:'UNAUTHENTICATED'});});
it('bounds the HTTP body before JSON parsing',async()=>{await expect(createRosterClient(base,true,async()=>new Response(' '.repeat(525313))).snapshot('token',tenant)).rejects.toMatchObject({code:'INTERNAL_ERROR'});});
it('rejects wrong-version and wrong-identity receipts without retries',async()=>{for(const receipt of [{rosterVersion:1,entityId:worker},{rosterVersion:2,entityId:other},{rosterVersion:2,entityId:worker,extra:'private'}]){const fetcher=vi.fn(async()=>ok(receipt));await expect(createRosterClient(base,true,fetcher).worker('token',tenant,worker,{expectedRosterVersion:1,displayName:'Name',active:true})).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(fetcher).toHaveBeenCalledTimes(1);}});
it('validates request bounds and exact inputs before sending',()=>{const fetcher=vi.fn();const client=createRosterClient(base,true,fetcher);for(const body of [{expectedRosterVersion:Number.MAX_SAFE_INTEGER,displayName:'Name',active:true},{expectedRosterVersion:1,displayName:'🙂'.repeat(161),active:true},{expectedRosterVersion:1,displayName:'Name',active:true,userId:tenant}])expect(()=>client.worker('token',tenant,null,body)).toThrow();expect(fetcher).not.toHaveBeenCalled();});
it('validates membership and eligibility receipt intent',async()=>{await expect(createRosterClient(base,true,async()=>ok({rosterVersion:2,crewId:other,workerId:worker,present:false})).member('token',tenant,other,{expectedRosterVersion:1,workerId:worker,present:true})).rejects.toMatchObject({code:'INTERNAL_ERROR'});await expect(createRosterClient(base,true,async()=>ok({rosterVersion:2,serviceId:other,workerId:worker,active:true})).eligibility('token',tenant,{expectedRosterVersion:1,serviceId:other,workerId:worker,active:true,create:true})).resolves.toMatchObject({rosterVersion:2});});

const shiftInput={workerId:worker,kind:'available' as const,startsAt:'2030-11-03T01:30:00.000001-04:00',endsAt:'2030-11-03T01:30:00.000002-04:00',sourceTimeZone:'America/New_York',active:true,expectedRosterVersion:1};
it('creates and updates shifts with exact requests and existing transport flags',async()=>{
 for(const id of [null,other]){
  const fetcher=vi.fn(async()=>ok({rosterVersion:2,entityId:other}));
  await expect(createRosterClient(base,true,fetcher).shift('synthetic-secret',tenant,id,shiftInput)).resolves.toEqual({rosterVersion:2,entityId:other});
  expect(fetcher.mock.calls).toEqual([[base+'/api/roster/shifts'+(id===null?'':'/'+id)+'?tenantId='+tenant,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-secret'},body:JSON.stringify(shiftInput)}]]);
 }
});
it('requires literal null for shift creation and validates IDs and strict input before fetch',()=>{
 const fetcher=vi.fn();const client=createRosterClient(base,true,fetcher);
 for(const id of ['',undefined,false,0,'not-a-uuid'])expect(()=>client.shift('token',tenant,id as unknown as string,shiftInput)).toThrow();
 for(const body of [{...shiftInput,create:true},{...shiftInput,workerId:undefined},{...shiftInput,kind:'unknown'},{...shiftInput,active:'true'},{...shiftInput,expectedRosterVersion:Number.MAX_SAFE_INTEGER},{...shiftInput,startsAt:'2030-02-30T00:00:00Z'},{...shiftInput,endsAt:shiftInput.startsAt},{...shiftInput,sourceTimeZone:''}])expect(()=>client.shift('token',tenant,null,body as typeof shiftInput)).toThrow();
 expect(()=>client.shift('token','invalid',null,shiftInput)).toThrow();expect(fetcher).not.toHaveBeenCalled();
});
it('rejects invalid shift receipts after one request without retry',async()=>{
 for(const receipt of [{rosterVersion:1,entityId:other},{rosterVersion:3,entityId:other},{rosterVersion:2,entityId:worker},{rosterVersion:2,entityId:other,extra:'private'},{rosterVersion:2,entityId:'invalid'},{entityId:other}]){
  const fetcher=vi.fn(async()=>ok(receipt));await expect(createRosterClient(base,true,fetcher).shift('token',tenant,other,shiftInput)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(fetcher).toHaveBeenCalledTimes(1);
 }
 const fetcher=vi.fn(async()=>ok({rosterVersion:2,entityId:'invalid'}));await expect(createRosterClient(base,true,fetcher).shift('token',tenant,null,shiftInput)).rejects.toMatchObject({code:'INTERNAL_ERROR'});
});
it('preserves full shift precision, explicit offsets and PostgreSQL zone labels',async()=>{
 for(const body of [shiftInput,{...shiftInput,kind:'blocked' as const,active:false,sourceTimeZone:'posix/UTC',startsAt:'0001-01-01T00:00:00.000001Z',endsAt:'0001-01-01T00:00:00.000002Z'},{...shiftInput,sourceTimeZone:'Etc/UTC',startsAt:'9999-12-31T23:59:59.999998Z',endsAt:'9999-12-31T23:59:59.999999Z'}]){
  const fetcher=vi.fn(async()=>ok({rosterVersion:2,entityId:other}));await createRosterClient(base,true,fetcher).shift('token',tenant,null,body);expect(fetcher.mock.calls[0]).toEqual([expect.any(String),expect.objectContaining({body:JSON.stringify(body)})]);
 }
});
it('minimizes shift failures and does not retry a lost create response',async()=>{
 for(const response of [async()=>new Response(JSON.stringify({ok:false,code:'CONFLICT'}),{status:409}),async()=>new Response(JSON.stringify({ok:false,code:'private SQL error'}),{status:500}),async()=>{throw Error('private driver error');}]){
  const fetcher=vi.fn(response);const pending=createRosterClient(base,true,fetcher).shift('token',tenant,null,shiftInput);await expect(pending).rejects.toThrow(/^(The roster changed\. Refresh and review before saving again\.|The roster request could not be completed\.)$/);expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
