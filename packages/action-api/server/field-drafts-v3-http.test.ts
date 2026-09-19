import { expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { handleFieldDraftV3Request as handle, type FieldDraftV3HttpDependencies } from './field-drafts-v3-http';
import { parseFieldDraftReadV3, parseFieldDraftReceiptV3 } from '@lumin/workflow';
import { FlowError } from './repository';
const actor='11111111-1111-4111-8111-111111111111', tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', flow='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const definition=()=>({schemaVersion:3,fields:[{key:'notes',kind:'dropdown',required:true,choices:[{id:'one',label:' Same 🌍 '},{id:'two',label:' Same 🌍 '}]}]});
const save=()=>({fieldDraftVersion:3,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:definition()});
const receipt=()=>({fieldDraftVersion:3,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:definition(),runtimePublishable:false});
const missing=()=>({status:'missing',fieldDraftVersion:3,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false});
function req(method='POST', payload: unknown=save(), url=`/api/field-drafts-v3/${flow}?tenantId=${tenant}`, headers:Record<string,string | undefined>={}) {
 const raw=Buffer.isBuffer(payload)?payload:Buffer.from(method==='GET'?'':JSON.stringify(payload));
 const stream=Readable.from(raw.length?[raw]:[],{autoDestroy:false}) as unknown as IncomingMessage;
 stream.method=method;stream.url=url;stream.headers={authorization:'Bearer verified-owner-token','content-type':'application/json',...headers};return stream;
}
function seams(result:unknown=receipt()) { return {allowLocalFieldDraftV3:true,authenticateOwner:vi.fn(async()=>actor),call:vi.fn(async()=>result)}; }
it('saves only verified actor and selector binding with strict envelope',async()=>{
 const d=seams();const result=await handle(req(),d);expect(result.status).toBe(200);expect(result.body).toEqual({ok:true,data:receipt()});
 expect(d.authenticateOwner).toHaveBeenCalledWith('verified-owner-token');expect(d.call).toHaveBeenCalledWith('save_field_draft_v3',[actor,tenant,flow,0,1,definition()]);
});
it('distinguishes missing/read stale without rebasing',async()=>{
 const d=seams(missing());expect((await handle(req('GET'),d)).body).toEqual({ok:true,data:missing()});
 const stale={...receipt(),currentParentRevision:2};const r=await handle(req('GET'),seams({status:'present',receipt:stale}));expect(r.body).toEqual({ok:true,data:{status:'present',receipt:stale}});
});
it('rejects client authority, unknown versions and future publication capabilities',async()=>{
 for(const extra of [{actorId:actor},{tenantId:tenant},{flowId:flow},{parentAuthoringVersion:1},{runtimePublishable:true},{stale:false}]) {const d=seams();expect((await handle(req('POST',{...save(),...extra}),d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();}
});
it('rejects malformed routing, duplicate queries, methods and headers',async()=>{
 for(const url of [`/api/field-drafts-v3/${flow}`,`/api/field-drafts-v3/${flow}?tenantId=${tenant}&tenantId=${tenant}`,`/api/field-drafts-v3/${flow}?tenantId=${tenant}&actorId=${actor}`,`/api/field-drafts-v3/nope?tenantId=${tenant}`]) expect((await handle(req('POST',save(),url),seams())).status).toBe(400);
 expect((await handle(req('DELETE'),seams())).status).toBe(404);
 for(const headers of [{'content-type':'text/plain'},{'content-length':'32769'},{'content-length':'3'},{'content-length':'0','transfer-encoding':'chunked'},{'transfer-encoding':'gzip'}]) {const d=seams();expect((await handle(req('POST',save(),undefined,headers),d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();}
});
it('enforces byte budget before decoding, including chunked data and invalid UTF8',async()=>{
 for(const bytes of [Buffer.alloc(32769,32),Buffer.from([0xff]),Buffer.from('{')]) {const d=seams();expect((await handle(req('POST',bytes),d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();}
 const raw=JSON.stringify(save());const atLimit=Buffer.from(raw+' '.repeat(32768-Buffer.byteLength(raw)));expect((await handle(req('POST',atLimit),seams())).status).toBe(200);
 const d=seams();expect((await handle(req('GET',Buffer.from('x')),d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();
});
it('rejects missing/failed verification without touching RPC',async()=>{
 for(const authenticateOwner of [async()=>null,async()=>{throw new Error('private auth details');},async()=> 'bad']) {const call=vi.fn();expect((await handle(req(),{allowLocalFieldDraftV3:true,authenticateOwner,call})).body).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(call).not.toHaveBeenCalled();}
 expect((await handle(req('POST',save(),undefined,{authorization:'Bearer forged'}),seams())).status).toBe(401);
});
it('maps known failures and redacts arbitrary backend errors',async()=>{
 for(const [error,status,code] of [[new FlowError('FORBIDDEN'),403,'FORBIDDEN'],[new FlowError('CONFLICT'),409,'CONFLICT'],[new Error('SQL with private data'),500,'INTERNAL_ERROR'],[{code:'42501',message:'private SQL'},500,'INTERNAL_ERROR']] as const) {const d:FieldDraftV3HttpDependencies={allowLocalFieldDraftV3:true,authenticateOwner:async()=>actor,call:async()=>{throw error;}};expect(await handle(req(),d)).toEqual({status,body:{ok:false,code}});}
});
it('rejects malformed or misbound RPC receipts',async()=>{
 for(const result of [{...receipt(),stale:false},{...receipt(),draftRevision:2},{...receipt(),savedParentRevision:2,currentParentRevision:2},{...receipt(),definition:{schemaVersion:3,fields:[]}},{...receipt(),runtimePublishable:true}]) expect((await handle(req(),seams(result))).body).toEqual({ok:false,code:'INTERNAL_ERROR'});
 expect((await handle(req('GET'),seams({status:'missing'}))).status).toBe(500);
});

it('serializes validated raw wire receipts that strict clients can parse again',async()=>{
 const saved=await handle(req(),seams());expect(saved.body.ok).toBe(true);
 if(saved.body.ok)expect(parseFieldDraftReceiptV3(JSON.parse(JSON.stringify(saved.body.data))).stale).toBe(false);
 const loaded=await handle(req('GET'),seams({status:'present',receipt:{...receipt(),currentParentRevision:2}}));
 expect(loaded.body.ok).toBe(true);
 if(loaded.body.ok){const parsed=parseFieldDraftReadV3(JSON.parse(JSON.stringify(loaded.body.data)));expect(parsed.status).toBe('present');if(parsed.status==='present')expect(parsed.receipt.stale).toBe(true);}
});

it('requires explicit trusted capability before authentication or body/RPC work',async()=>{
 for(const enabled of [undefined,false,'true',1]){const d={...seams(),allowLocalFieldDraftV3:enabled as boolean};expect(await handle(req(),d)).toEqual({status:404,body:{ok:false,code:'NOT_AVAILABLE'}});expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});
it('rejects exhausted save revision before dispatch',async()=>{const d=seams();expect((await handle(req('POST',{...save(),expectedRevision:Number.MAX_SAFE_INTEGER}),d)).status).toBe(400);expect(d.call).not.toHaveBeenCalled();});
it('bounds stalled bodies and removes owned listeners',async()=>{
 vi.useFakeTimers();try{const stream=new Readable({read(){}}) as unknown as IncomingMessage;stream.method='POST';stream.url=`/api/field-drafts-v3/${flow}?tenantId=${tenant}`;stream.headers={authorization:'Bearer verified-owner-token','content-type':'application/json'};
 const d=seams(),pending=handle(stream,d);await vi.advanceTimersByTimeAsync(10001);expect((await pending).status).toBe(400);expect(d.call).not.toHaveBeenCalled();for(const name of ['data','end','error','aborted','close'])expect(stream.listenerCount(name)).toBe(0);expect(stream.isPaused()).toBe(true);
 }finally{vi.useRealTimers();}
});

it('rejects duplicate security headers even when normalized header values appear valid',async()=>{
 for(const header of ['Authorization','Content-Length','Transfer-Encoding','Content-Type']){const request=req();request.rawHeaders=[header,'value',header.toLowerCase(),'value'];const d=seams();expect((await handle(request,d)).status).toBe(400);expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});

it('rejects raw path normalization aliases before authentication',async()=>{
 for(const prefix of ['junk/../','%2e%2e/','x\\..\\','x\t/']){const d=seams();expect((await handle(req('GET',undefined,`/api/field-drafts-v3/${prefix}${flow}?tenantId=${tenant}`),d)).status).toBe(404);expect(d.authenticateOwner).not.toHaveBeenCalled();expect(d.call).not.toHaveBeenCalled();}
});

it('distinguishes completed auto-destroyed messages from disconnected sockets before dispatch',async()=>{
 for(const method of ['GET','POST'])for(const [complete,socketDead,expected] of [[true,false,200],[true,true,400],[false,false,400]] as const){
  const request=req(method);request.once('end',()=>{Object.defineProperty(request,'complete',{value:complete});Object.defineProperty(request,'destroyed',{value:true});Object.defineProperty(request,'socket',{value:{destroyed:socketDead}});});
  const d=seams(method==='GET'?missing():receipt());expect((await handle(request,d)).status).toBe(expected);expect(d.call).toHaveBeenCalledTimes(expected===200?1:0);
 }
});
