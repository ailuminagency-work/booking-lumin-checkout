import { afterEach, expect, it, vi } from 'vitest';
import { createFieldDraftV2Client } from './fieldDraftV2Client';
const flow='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',token='synthetic.private.token';
const definition=()=>({schemaVersion:2,fields:[{key:'q',kind:'textarea',required:false,minLength:0,maxLength:30,prompt:' Exact 🌍 '}]});
const save=()=>({fieldDraftVersion:2,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:definition()});
const receipt=()=>({fieldDraftVersion:2,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:definition(),runtimePublishable:false});
const missing=()=>({status:'missing',fieldDraftVersion:2,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false});
function setup(payload:unknown={ok:true,data:receipt()},status=200) {const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload),{status}));return {fetcher,client:createFieldDraftV2Client('https://api.example',false,fetcher,true)};}
afterEach(()=>vi.useRealTimers());
it('rejects unsafe origins and credentials without transport',async()=>{
 for(const base of ['https://user:password@api.example','https://api.example/path','https://api.example?x=1','https://api.example#fragment','https://api.example/','http://api.example'])expect(()=>createFieldDraftV2Client(base,false,vi.fn<typeof fetch>(),true)).toThrow();
 for(const credential of ['short','x'.repeat(4097),token+'\n',token+'/=',token+' ']) {const {client,fetcher}=setup();await expect(client.read(credential,tenant,flow)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(fetcher).not.toHaveBeenCalled();}
 for(const selector of ['../other',tenant+'&actor='+flow,tenant+'\n']) {const {client,fetcher}=setup();await expect(client.read(token,selector,flow)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(fetcher).not.toHaveBeenCalled();}
});
it('denies absent or truthy nonboolean capability without fetching or falling back',async()=>{
 for(const gate of [undefined,false,1,'true']) {const fetcher=vi.fn<typeof fetch>(),client=createFieldDraftV2Client('https://api.example',false,fetcher,gate as boolean);await expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'NOT_AVAILABLE'});await expect(client.save(token,tenant,flow,save())).rejects.toMatchObject({code:'NOT_AVAILABLE'});expect(fetcher).not.toHaveBeenCalled();}
});
it('rejects hostile save objects and exhausted revisions before fetch',async()=>{
 const getter=vi.fn(()=>{throw new Error(token);});const accessor={...save()};Object.defineProperty(accessor,'definition',{enumerable:true,get:getter});
 for(const value of [accessor,new Proxy({},{getPrototypeOf(){throw new Error(token);}}),{...save(),actorId:flow},{...save(),fieldDraftVersion:1},{...save(),expectedRevision:Number.MAX_SAFE_INTEGER},{...save(),definition:{schemaVersion:1,fields:[]}}]) {const {client,fetcher}=setup();await expect(client.save(token,tenant,flow,value)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(fetcher).not.toHaveBeenCalled();}expect(getter).not.toHaveBeenCalled();
});
it('binds saved receipt to exact request definition and revisions',async()=>{
 for(const change of [{draftRevision:2},{savedParentRevision:2,currentParentRevision:2},{currentParentRevision:2},{definition:{schemaVersion:2,fields:[]}},{definition:{...definition(),fields:[{...definition().fields[0],prompt:'Exact 🌍'}]}},{stale:false},{runtimePublishable:true},{fieldDraftVersion:1}]) {const {client}=setup({ok:true,data:{...receipt(),...change}});await expect(client.save(token,tenant,flow,save())).rejects.toMatchObject({code:'INTERNAL_ERROR'});}
});
it('copies request before caller mutation while preserving exact whitespace and Unicode',async()=>{
 let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;})),client=createFieldDraftV2Client('https://api.example',false,fetcher,true),input=save();const pending=client.save(token,tenant,flow,input);input.definition.fields[0]!.prompt='mutated';finish(new Response(JSON.stringify({ok:true,data:receipt()})));expect(await pending).toMatchObject({definition:definition(),stale:false});expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(save());expect(fetcher.mock.calls[0]![0]).toBe(`https://api.example/api/field-drafts-v2/${flow}?tenantId=${tenant}`);
});
it('rejects oversized UTF8 save even when schema field count is valid',async()=>{
 const input={...save(),definition:{schemaVersion:2,fields:Array.from({length:64},(_,i)=>({...definition().fields[0],key:`q${i}`,prompt:'🌍'.repeat(200)}))}}, {client,fetcher}=setup();await expect(client.save(token,tenant,flow,input)).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(fetcher).not.toHaveBeenCalled();
});
it('rejects malformed and overbudget response bytes without raw details',async()=>{
 for(const bytes of [new Uint8Array([0xff]),new Uint8Array(32769)]) {const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes)),client=createFieldDraftV2Client('https://api.example',false,fetcher,true);await expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'INTERNAL_ERROR'});}
});
it('accepts exact 32768 byte response boundary',async()=>{
 const raw=JSON.stringify({ok:true,data:missing()}),fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(raw+' '.repeat(32768-new TextEncoder().encode(raw).length)));
 expect(await createFieldDraftV2Client('https://api.example',false,fetcher,true).read(token,tenant,flow)).toEqual(missing());
});
it('requires matching finite status/code and never retries or uses V1',async()=>{
 for(const [status,payload] of [[201,{ok:true,data:missing()}],[409,{ok:false,code:'FORBIDDEN'}],[403,{ok:false,code:'CONFLICT'}],[400,{ok:false,code:'INVALID_REQUEST',detail:token}],[404,{ok:true,data:missing()}]] as const) {const {client,fetcher}=setup(payload,status);await expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'INTERNAL_ERROR'});expect(fetcher).toHaveBeenCalledTimes(1);}
});
it('invalidating stalled response rejects promptly even if cancellation hangs',async()=>{
 const cancel=vi.fn(()=>new Promise<void>(()=>{})),fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({cancel}))),client=createFieldDraftV2Client('https://api.example',false,fetcher,true);
 const rejected=expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'UNAUTHENTICATED'});await Promise.resolve();await Promise.resolve();client.invalidate();await rejected;expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
});
it('late fetch response is cancelled and cannot restore an invalidated request',async()=>{
 let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;})),client=createFieldDraftV2Client('https://api.example',false,fetcher,true),cancel=vi.fn();const rejected=expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'UNAUTHENTICATED'});client.invalidate();await rejected;finish(new Response(new ReadableStream({cancel})));await Promise.resolve();await Promise.resolve();expect(cancel).toHaveBeenCalledTimes(1);
});
it('deadline owns stalled fetch and empty stalled streams without adapter cooperation',async()=>{
 vi.useFakeTimers();for(const stream of [false,true]) {const cancel=vi.fn(),fetcher=vi.fn<typeof fetch>(()=>stream?Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array());},cancel}))):new Promise(()=>{})),client=createFieldDraftV2Client('https://api.example',false,fetcher,true);const rejected=expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'INTERNAL_ERROR'});await vi.advanceTimersByTimeAsync(15000);await rejected;expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);if(stream)expect(cancel).toHaveBeenCalledTimes(1);}
});
it('new generation stays usable after invalidation of an older pending fetch',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,data:missing()}))),client=createFieldDraftV2Client('https://api.example',false,fetcher,true);const old=expect(client.read(token,tenant,flow)).rejects.toMatchObject({code:'UNAUTHENTICATED'});client.invalidate();expect(await client.read(token,tenant,flow)).toEqual(missing());await old;
});
