import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { handleFieldDraftV3Request as handle } from './field-drafts-v3-http';
import { FlowError } from './repository';
const actor='11111111-1111-4111-8111-111111111111',tenant='22222222-2222-4222-8222-222222222222',flow='33333333-3333-4333-8333-333333333333';
const definition=()=>({schemaVersion:3,fields:[{key:'question',kind:'dropdown',required:false,choices:[{id:'one',label:' Same 🌍 '},{id:'two',label:' Same 🌍 '}],prompt:'Exact label'}]});
const save=()=>({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:definition()});
const receipt=()=>({fieldDraftVersion:3,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:definition(),runtimePublishable:false});
function request(method='POST') {
 const emitter=new EventEmitter();
 return Object.assign(emitter,{method,url:`/api/field-drafts-v3/${flow}?tenantId=${tenant}`,headers:{authorization:'Bearer synthetic-owner-token','content-type':'application/json'} as Record<string,string>,complete:false,aborted:false,destroyed:false,pause:vi.fn()});
}
const deps=(raw:unknown=receipt())=>({allowLocalFieldDraftV3:true,authenticateOwner:vi.fn(async()=>actor),call:vi.fn(async()=>raw)});
async function started(req:ReturnType<typeof request>,d:ReturnType<typeof deps>) {
 const pending=handle(req as unknown as IncomingMessage,d);
 await Promise.resolve();await Promise.resolve();
 return {pending};
}
async function send(payload:unknown=save(),d=deps(),req=request()) {
 const {pending}=await started(req,d);
 req.emit('data',Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload)));
 req.complete=true;req.emit('end');return pending;
}
function cleaned(req:ReturnType<typeof request>) { for(const event of ['data','end','error','aborted','close'])expect(req.listenerCount(event)).toBe(0); }
afterEach(()=>vi.useRealTimers());
it('disabled capability rejects before any identity or repository access',async()=>{
 for(const gate of [undefined,false,'true',1]) {const d={...deps(),allowLocalFieldDraftV3:gate as boolean};expect(await handle(request() as unknown as IncomingMessage,d)).toEqual({status:404,body:{ok:false,code:'NOT_AVAILABLE'}});expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});
it('forged authority and cross-version payloads cannot reach SQL',async()=>{
 for(const extra of [{actorId:actor},{tenantId:tenant},{flowId:flow},{fieldDraftVersion:1},{parentAuthoringVersion:1},{runtimePublishable:true},{stale:false},{expectedRevision:Number.MAX_SAFE_INTEGER}]) {const d=deps();expect((await send({...save(),...extra},d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();}
});
it('uses only verified actor plus exact selector tuple',async()=>{
 const d=deps();expect((await send(save(),d)).status).toBe(200);expect(d.call).toHaveBeenCalledWith('save_field_draft_v3',[actor,tenant,flow,0,1,definition()]);
});
it('rejects ambiguous tenant selectors and encoded route confusion before auth',async()=>{
 for(const tail of [`?tenantId=${tenant}&tenantId=${tenant}`,`?tenantId=${tenant}&actor=${actor}`,`?tenantId=nope`,'']) {const req=request(),d=deps();req.url=`/api/field-drafts-v3/${flow}${tail}`;expect((await send(save(),d,req)).status).toBe(400);expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});
it('bounds UTF8 bytes rather than JavaScript length and rejects malformed bytes',async()=>{
 for(const raw of [Buffer.from(' '.repeat(32769)),Buffer.from('🌍'.repeat(8193)),Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80]),Buffer.from('{')]) {const d=deps();expect((await send(raw,d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();}
 const raw=JSON.stringify(save());expect((await send(Buffer.from(raw+' '.repeat(32768-Buffer.byteLength(raw))))).status).toBe(200);
});
it('rejects contradictory framing, wrong media type and declared length mismatches',async()=>{
 for(const headers of [{'content-length':'1'},{'content-length':'32769'},{'content-length':'00'},{'content-length':'0','transfer-encoding':'chunked'},{'transfer-encoding':'gzip'},{'content-type':'text/plain'}]) {const req=request(),d=deps();Object.assign(req.headers,headers);expect((await send(save(),d,req)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);}
});
it('rejects GET data instead of allowing a hidden command body',async()=>{const d=deps(),req=request('GET');expect((await send(Buffer.from('x'),d,req)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);});
it('aborted, prematurely closed and non-buffer streams settle and remove listeners',async()=>{
 for(const event of ['aborted','close','error','data']) {const req=request(),d=deps(),{pending}=await started(req,d);req.emit(event,event==='data'?'not bytes':new Error('private'));expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();expect(req.pause).toHaveBeenCalled();cleaned(req);}
});
it('stalled body deadline settles without RPC or retained listeners',async()=>{
 vi.useFakeTimers();const req=request(),d=deps(),{pending}=await started(req,d);await vi.advanceTimersByTimeAsync(10000);expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);expect(vi.getTimerCount()).toBe(0);
});
it('rejects pre-aborted streams and cleans successful body listeners',async()=>{
 const req=request(),d=deps();req.aborted=true;expect((await send(save(),d,req)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);
 const good=request();expect((await send(save(),deps(),good)).status).toBe(200);cleaned(good);
});
it('receipt authority/version/revision/definition mismatches never become success',async()=>{
 for(const extra of [{fieldDraftVersion:1},{runtimePublishable:true},{stale:false},{actorId:actor},{draftRevision:2},{savedParentRevision:2,currentParentRevision:2},{currentParentRevision:2},{definition:{schemaVersion:3,fields:[]}},{definition:{...definition(),fields:[{...definition().fields[0],prompt:'Exact label '}]}}]) expect(await send(save(),deps({...receipt(),...extra}))).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
});
it('malicious receipt accessors and proxies are redacted without invoking getters',async()=>{
 const getter=vi.fn(()=>{throw new Error('private');});const raw={...receipt()};Object.defineProperty(raw,'definition',{enumerable:true,get:getter});
 for(const value of [raw,new Proxy({}, {getPrototypeOf(){throw new Error('private');}})])expect((await send(save(),deps(value))).body).toEqual({ok:false,code:'INTERNAL_ERROR'});
 expect(getter).not.toHaveBeenCalled();
});
it('only finite mapped errors cross the boundary and do not expose backend details',async()=>{
 for(const [error,status,code] of [[new FlowError('CONFLICT'),409,'CONFLICT'],[new FlowError('FORBIDDEN'),403,'FORBIDDEN'],[new Error('secret SQL'),500,'INTERNAL_ERROR'],[{code:'42501',message:'secret'},500,'INTERNAL_ERROR']] as const) {const d=deps();d.call.mockImplementation(async()=>{throw error;});expect(await send(save(),d)).toEqual({status,body:{ok:false,code}});}
});
it('duplicate raw authority/framing headers reject before authentication',async()=>{
 for(const name of ['Authorization','Content-Length','Transfer-Encoding','Content-Type']) {const req=Object.assign(request(),{rawHeaders:[name,'first',name.toLowerCase(),'second']}),d=deps();expect((await send(save(),d,req)).status).toBe(400);expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});
it('abort after complete bytes but before asynchronous dispatch prevents mutation',async()=>{
 const req=request(),d=deps(),{pending}=await started(req,d);req.emit('data',Buffer.from(JSON.stringify(save())));req.complete=true;req.emit('end');req.aborted=true;
 expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);
});
it('dead socket after body settlement never dispatches repository call',async()=>{
 for(const method of ['GET','POST']) {const req=Object.assign(request(method),{socket:{destroyed:false}}),d=deps(),{pending}=await started(req,d);if(method==='POST')req.emit('data',Buffer.from(JSON.stringify(save())));req.complete=true;req.emit('end');req.destroyed=true;req.socket.destroyed=true;expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);}
});
it('completed stream auto-destruction is not confused with socket disconnection',async()=>{
 for(const method of ['GET','POST']) {const req=Object.assign(request(method),{socket:{destroyed:false}}),d=deps(method==='GET'?{status:'present',receipt:receipt()}:receipt()),{pending}=await started(req,d);if(method==='POST')req.emit('data',Buffer.from(JSON.stringify(save())));req.complete=true;req.emit('end');req.destroyed=true;expect((await pending).status).toBe(200);expect(d.call).toHaveBeenCalledTimes(1);cleaned(req);}
});
it('destroyed incomplete stream cannot dispatch even after an end event',async()=>{
 const req=request(),d=deps(),{pending}=await started(req,d);req.emit('data',Buffer.from(JSON.stringify(save())));req.emit('end');req.destroyed=true;expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();cleaned(req);
});
it('multibyte codepoints may split across chunks without lossy decoding',async()=>{
 const def={...definition(),fields:[{...definition().fields[0],prompt:'🌍'}]},d=deps({...receipt(),definition:def}),req=request(),{pending}=await started(req,d);
 const bytes=Buffer.from(JSON.stringify({...save(),definition:def}));const at=bytes.indexOf(Buffer.from('🌍'));
 req.emit('data',bytes.subarray(0,at+1));req.emit('data',bytes.subarray(at+1));req.complete=true;req.emit('end');expect((await pending).status).toBe(200);cleaned(req);
});
it('rejects nonprimitive authenticated identity without inspecting hostile properties',async()=>{
 const trap=vi.fn(()=>{throw Error('private identity');});// Promise resolution probes then before the controller receives the value; all identity reflection stays forbidden.
 const identity=new Proxy({}, {get(_target,key){if(key==='then')return undefined;return trap();},ownKeys:trap,getOwnPropertyDescriptor:trap,getPrototypeOf:trap});
 for(const value of [identity,{},42,new String(actor)]){const d=deps();d.authenticateOwner.mockResolvedValue(value as never);expect((await send(save(),d)).body).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(d.call).not.toHaveBeenCalled();}
 expect(trap).not.toHaveBeenCalled();
});
it('rejects V2 routes, envelopes and definitions without fallback',async()=>{
 const req=request(),d=deps();req.url=req.url.replace('field-drafts-v3','field-drafts-v2');expect((await send(save(),d,req)).status).toBe(404);expect(d.authenticateOwner).not.toHaveBeenCalled();
 for(const payload of [{...save(),fieldDraftVersion:2},{...save(),definition:{schemaVersion:2,fields:[]}}]){const next=deps();expect((await send(payload,next)).status).toBe(400);expect(next.call).not.toHaveBeenCalled();}
 expect((await send(save(),deps({...receipt(),fieldDraftVersion:2}))).status).toBe(500);
});
it.each(['order','id','label'])('rejects dropdown receipt %s mutation despite duplicate visible labels',async mode=>{
 const raw=receipt(),choices=raw.definition.fields[0]!.choices;
 if(mode==='order')choices.reverse();if(mode==='id')choices[0]!.id='other';if(mode==='label')choices[0]!.label='Same 🌍';
 expect(await send(save(),deps(raw))).toEqual({status:500,body:{ok:false,code:'INTERNAL_ERROR'}});
});
it('accepts canonical property ordering but preserves exact ordered choices',async()=>{
 const raw=receipt(),field=raw.definition.fields[0]!;
 const canonical={...raw,definition:{fields:[{choices:field.choices.map(c=>({label:c.label,id:c.id})),prompt:field.prompt,required:field.required,kind:field.kind,key:field.key}],schemaVersion:3}};
 const d=deps(canonical);expect((await send(save(),d)).status).toBe(200);expect(d.call).toHaveBeenCalledOnce();
});
