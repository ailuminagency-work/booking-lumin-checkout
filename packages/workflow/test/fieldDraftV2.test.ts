import {expect,it} from 'vitest';
import {parseFieldDraftSaveV2,parseFieldDraftReceiptV2,parseFieldDraftReadV2} from '../src/fieldDraftV2';
import {parseTextFieldDraftSave,parseTextFieldDraftReceipt} from '../src/textFieldDraft';
const definition=()=>({schemaVersion:2,fields:[{key:'notes',kind:'textarea',required:false,minLength:0,maxLength:4096,prompt:'Exact prompt'}]});
const save=()=>({fieldDraftVersion:2,parentAuthoringVersion:2,expectedRevision:0,expectedFlowRevision:1,definition:definition()});
const receipt=()=>({fieldDraftVersion:2,parentAuthoringVersion:2,draftRevision:1,savedParentRevision:1,currentParentRevision:1,definition:definition(),runtimePublishable:false});
const missing=()=>({status:'missing',fieldDraftVersion:2,parentAuthoringVersion:2,currentParentRevision:1,runtimePublishable:false});
const invalid=(action:()=>unknown)=>expect(action).toThrow('INVALID_FIELD_DRAFT_V2_CONTRACT');
it('parses exact create/update tokens and derives stale from monotonic parent revisions',()=>{
 expect(parseFieldDraftSaveV2(save()).expectedRevision).toBe(0);
 expect(parseFieldDraftSaveV2({...save(),expectedRevision:2}).expectedRevision).toBe(2);
 expect(parseFieldDraftReceiptV2(receipt()).stale).toBe(false);
 expect(parseFieldDraftReceiptV2({...receipt(),currentParentRevision:2}).stale).toBe(true);
 invalid(()=>parseFieldDraftReceiptV2({...receipt(),savedParentRevision:2}));
 invalid(()=>parseFieldDraftReceiptV2({...receipt(),stale:false}));
});
it('distinguishes exact missing from present without inventing data',()=>{
 expect(parseFieldDraftReadV2(missing())).toEqual(missing());
 const present=parseFieldDraftReadV2({status:'present',receipt:receipt()});expect(present.status).toBe('present');
 for(const extra of [{definition:definition()},{draftRevision:0},{stale:false},{receipt:receipt()}])invalid(()=>parseFieldDraftReadV2({...missing(),...extra}));
 invalid(()=>parseFieldDraftReadV2({status:'present'}));invalid(()=>parseFieldDraftReadV2({status:'other'}));
});
it('requires safe integer revision tokens and preserves MAX_SAFE_INTEGER for storage overflow checks',()=>{
 for(const key of ['expectedRevision','expectedFlowRevision'])for(const bad of [-0,-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'1',null])invalid(()=>parseFieldDraftSaveV2({...save(),[key]:bad}));
 invalid(()=>parseFieldDraftSaveV2({...save(),expectedFlowRevision:0}));
 for(const key of ['draftRevision','savedParentRevision','currentParentRevision'])for(const bad of [-0,0,-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'1'])invalid(()=>parseFieldDraftReceiptV2({...receipt(),[key]:bad}));
 expect(parseFieldDraftSaveV2({...save(),expectedRevision:Number.MAX_SAFE_INTEGER,expectedFlowRevision:Number.MAX_SAFE_INTEGER}).expectedRevision).toBe(Number.MAX_SAFE_INTEGER);
 expect(parseFieldDraftReceiptV2({...receipt(),draftRevision:Number.MAX_SAFE_INTEGER,savedParentRevision:Number.MAX_SAFE_INTEGER,currentParentRevision:Number.MAX_SAFE_INTEGER}).stale).toBe(false);
});
it('rejects mixed versions, client authority fields and publishability claims without changing V1',()=>{
 for(const extra of [{fieldDraftVersion:1},{parentAuthoringVersion:1},{actor:'forged'},{tenant:'forged'},{definition:{schemaVersion:1,fields:[]}}])invalid(()=>parseFieldDraftSaveV2({...save(),...extra}));
 invalid(()=>parseFieldDraftReceiptV2({...receipt(),runtimePublishable:true}));invalid(()=>parseFieldDraftReadV2({...missing(),runtimePublishable:true}));
 expect(()=>parseTextFieldDraftSave(save())).toThrow('INVALID_TEXT_DRAFT_CONTRACT');expect(()=>parseTextFieldDraftReceipt(receipt())).toThrow('INVALID_TEXT_DRAFT_CONTRACT');
 // A discriminator is not a lookup or authorization check: arbitrary valid revision tokens parse.
 expect(parseFieldDraftSaveV2({...save(),expectedFlowRevision:900}).expectedFlowRevision).toBe(900);
});
it('rejects accessor/prototype/unknown-property attacks with no getter invocation',()=>{
 let calls=0;
 for(const [parser,input,key] of [[parseFieldDraftSaveV2,save(),'definition'],[parseFieldDraftReceiptV2,receipt(),'draftRevision'],[parseFieldDraftReadV2,missing(),'status']] as const){
  const hostile=Object.defineProperty({...input},key,{enumerable:true,get(){calls++;return 1;}});invalid(()=>parser(hostile));
  invalid(()=>parser(Object.assign(Object.create({extra:true}),input)));invalid(()=>parser({...input,extra:true}));
 }expect(calls).toBe(0);
});
it('returns detached deeply frozen data and rejects nested definition bounds',()=>{
 const input=save(),out=parseFieldDraftSaveV2(input);input.definition.fields[0]!.prompt='Mutated';
 expect(out.definition.fields[0]?.prompt).toBe('Exact prompt');expect(Object.isFrozen(out)).toBe(true);expect(Object.isFrozen(out.definition.fields[0])).toBe(true);
 const read=parseFieldDraftReadV2({status:'present',receipt:receipt()});expect(Object.isFrozen(read)).toBe(true);if(read.status==='present')expect(Object.isFrozen(read.receipt)).toBe(true);
 invalid(()=>parseFieldDraftSaveV2({...save(),definition:{schemaVersion:2,fields:Array.from({length:65},(_,i)=>({...definition().fields[0],key:'n'+i}))}}));
});
