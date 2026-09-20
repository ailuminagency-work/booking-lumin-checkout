import { expect, it, vi } from 'vitest';
import { parseFieldPublicationV1 as parse } from '../src/fieldPublicationV1';
const envelope=()=>({fieldPublicationVersion:1,tenantId:'11111111-1111-4111-8111-111111111111',flowId:'22222222-2222-4222-8222-222222222222',versionId:'abcdefab-1234-4567-89ab-abcdefabcdef',parentAuthoringVersion:2,sourceParentRevision:7,sourceFieldDraftRevision:3,submissionMode:'unconfirmed_request',definition:{schemaVersion:3,fields:[{key:'short',kind:'text',required:false,minLength:0,maxLength:10,prompt:'  Exact <text>  '},{key:'long',kind:'textarea',required:true,minLength:1,maxLength:20},{key:'vehicle',kind:'dropdown',required:true,prompt:'Pick',choices:[{id:'second',label:' Duplicate '},{id:'first',label:' Duplicate '}]}]}});
const rejects=(value:unknown)=>expect(()=>parse(value)).toThrow(/^INVALID_FIELD_PUBLICATION_V1_CONTRACT$/);
it('preserves exact mixed definitions, identity spelling and opaque choice order',()=>{
 const value=envelope();value.versionId=value.versionId.toUpperCase();expect(parse(value)).toEqual(value);
 const output=parse(value);expect(output.definition.fields[2]).toEqual(value.definition.fields[2]);
 expect('runtimePublishable' in output).toBe(false);
});
it('returns deeply detached frozen own data',()=>{
 const value=envelope(),output=parse(value);
 expect(output).not.toBe(value);expect(output.definition).not.toBe(value.definition);expect(output.definition.fields).not.toBe(value.definition.fields);
 function frozen(input:unknown):void{if(input&&typeof input==='object'){expect(Object.isFrozen(input)).toBe(true);for(const child of Object.values(input))frozen(child);}}
 frozen(output);
 value.definition.fields[0]!.prompt='Changed';value.definition.fields[2]!.choices![0]!.label='Changed';value.definition.fields.reverse();
 expect(output.definition.fields[0]!.prompt).toBe('  Exact <text>  ');expect(output.definition.fields[2]).toMatchObject({choices:[{id:'second',label:' Duplicate '},{id:'first',label:' Duplicate '}]});
 expect(()=>Object.assign(output,{sourceParentRevision:99})).toThrow();
});
it.each([0,-0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined])('rejects nonpositive or unsafe revision %s in either source position',value=>{
 for(const key of ['sourceParentRevision','sourceFieldDraftRevision'])rejects({...envelope(),[key]:value});
});
it('accepts independently positive source revisions including safe integer boundaries without pretending to compare stored rows',()=>{
 expect(parse({...envelope(),sourceParentRevision:1,sourceFieldDraftRevision:Number.MAX_SAFE_INTEGER}).sourceFieldDraftRevision).toBe(Number.MAX_SAFE_INTEGER);
 expect(parse({...envelope(),sourceParentRevision:Number.MAX_SAFE_INTEGER,sourceFieldDraftRevision:1}).sourceParentRevision).toBe(Number.MAX_SAFE_INTEGER);
});
it.each(['tenantId','flowId','versionId'])('checks %s UUID syntax without coercion',key=>{
 for(const value of ['', 'not-a-uuid','11111111-1111-4111-8111-11111111111g',42,null,{},' '+envelope().tenantId])rejects({...envelope(),[key]:value});
});
it('requires exact discriminators and rejects authority or unknown properties',()=>{
 for(const change of [{fieldPublicationVersion:2},{parentAuthoringVersion:3},{submissionMode:'confirmed_booking'},{runtimePublishable:true},{authorized:true},{price:100}])rejects({...envelope(),...change});
 for(const key of Object.keys(envelope())){const value:Record<string,unknown>={...envelope()};delete value[key];rejects(value);}
});
it('rejects accessors, symbols, hidden properties and inherited envelopes without reading getters',()=>{
 const getter=vi.fn(()=>envelope().tenantId);
 for(const key of ['tenantId','definition']){const value=envelope();Object.defineProperty(value,key,{get:getter,enumerable:true});rejects(value);}
 expect(getter).not.toHaveBeenCalled();
 const symbol={...envelope(),[Symbol('extra')]:true};rejects(symbol);
 const hidden=envelope();Object.defineProperty(hidden,'tenantId',{value:hidden.tenantId,enumerable:false});rejects(hidden);
 rejects(Object.create(envelope()));rejects(new Proxy(envelope(),{ownKeys(){throw Error('private');}}));
 expect(parse(Object.assign(Object.create(null),envelope()))).toEqual(envelope());
});
it('delegates strict nested V3 validation and rejects duplicate opaque IDs without normalizing labels',()=>{
 const original=envelope();rejects({...original,definition:{...original.definition,schemaVersion:2}});
 const duplicate=envelope();duplicate.definition.fields[2]!.choices![1]!.id='second';rejects(duplicate);
 const getter=vi.fn(()=> 'private');const accessor=envelope();Object.defineProperty(accessor.definition.fields[2]!.choices![0]!,'label',{get:getter,enumerable:true});rejects(accessor);expect(getter).not.toHaveBeenCalled();
 rejects({...original,definition:{schemaVersion:3,fields:[{key:'bad',kind:'dropdown',required:false,choices:[]}]}});
});
