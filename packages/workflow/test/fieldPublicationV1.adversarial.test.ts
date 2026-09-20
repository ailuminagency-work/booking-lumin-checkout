import {expect,it,vi} from 'vitest';
import {parseFieldPublicationV1 as parse} from '../src/fieldPublicationV1';
const raw=()=>({fieldPublicationVersion:1,tenantId:'11111111-1111-4111-8111-111111111111',flowId:'22222222-2222-4222-8222-222222222222',versionId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',parentAuthoringVersion:2,sourceParentRevision:3,sourceFieldDraftRevision:2,definition:{schemaVersion:3,fields:[{key:'choice',kind:'dropdown',required:true,prompt:'Choose',choices:[{id:'First',label:'  Same e\u0301  '},{id:'second',label:'  Same e\u0301  '}]}]},submissionMode:'unconfirmed_request'});
const reject=(value:unknown)=>expect(()=>parse(value)).toThrow(/^INVALID_FIELD_PUBLICATION_V1_CONTRACT$/);

it('rejects every missing key and authority-bearing unknown property',()=>{
 for(const key of Object.keys(raw())){const value:Record<string,unknown>={...raw()};delete value[key];reject(value);}
 for(const key of ['actorId','answers','credentials','price','total','confirmed','runtimePublishable','stale','expectedRevision','fieldDraftVersion','publishedAt'])reject({...raw(),[key]:true});
 for(const value of [null,undefined,[],true,'{}',new Date()])reject(value);
});

it('rejects discriminator confusion without coercion or fallback',()=>{
 for(const value of ['1',2,3,true,null])reject({...raw(),fieldPublicationVersion:value});
 for(const value of ['2',1,3,null])reject({...raw(),parentAuthoringVersion:value});
 for(const value of ['confirmed','paid','request',null,{},true])reject({...raw(),submissionMode:value});
 for(const schemaVersion of [1,2,'3',4])reject({...raw(),definition:{...raw().definition,schemaVersion}});
});

it('requires primitive exact UUID identity without trimming or object conversion',()=>{
 const convert=vi.fn(()=>raw().tenantId);
 for(const key of ['tenantId','flowId','versionId'])for(const value of ['',raw().tenantId+' ', ' '+raw().tenantId,raw().tenantId+'\n','11111111111141118111111111111111','https://example.test',null,0,{toString:convert}])reject({...raw(),[key]:value});
 expect(convert).not.toHaveBeenCalled();expect(parse(raw()).versionId).toBe(raw().versionId);
});

it('rejects zero, negative, unsafe and coerced source revisions',()=>{
 for(const key of ['sourceParentRevision','sourceFieldDraftRevision'])for(const value of [0,-0,-1,1.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,'3',null,true])reject({...raw(),[key]:value});
 const maximum=parse({...raw(),sourceParentRevision:Number.MAX_SAFE_INTEGER,sourceFieldDraftRevision:Number.MAX_SAFE_INTEGER});expect(maximum.sourceFieldDraftRevision).toBe(Number.MAX_SAFE_INTEGER);
});

it('rejects accessors and hidden or inherited records without reading getters',()=>{
 const getter=vi.fn(()=>{throw Error('private credential');});
 for(const key of Object.keys(raw())){
  reject(Object.defineProperty(raw(),key,{enumerable:true,get:getter}));
  reject(Object.defineProperty(raw(),key,{enumerable:false}));
 }
 reject(Object.assign(Object.create({tenantId:'other'}),raw()));reject({...raw(),[Symbol('private')]:true});
 const value=raw();Object.defineProperty(value.definition.fields[0]!.choices[0]!,'label',{get:getter,enumerable:true});reject(value);expect(getter).not.toHaveBeenCalled();
});

it('turns reflective proxy exceptions and cyclic structures into finite failures',()=>{
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor'])reject(new Proxy(raw(),{[trap](){throw Error('private credential');}}));
 const cyclic:Record<string,unknown>={...raw()};cyclic.definition=cyclic;reject(cyclic);
 const nested=raw();(nested.definition.fields as unknown[])[0]=nested.definition;reject(nested);
});

it('captures envelope identity, revision and definition descriptors once',()=>{
 const reads=new Map<PropertyKey,number>(),value=raw();
 const changing=new Proxy(value,{getOwnPropertyDescriptor(target,key){reads.set(key,(reads.get(key)??0)+1);const original=Reflect.getOwnPropertyDescriptor(target,key);if(!original)return original;if(reads.get(key)!==1)return {...original,value:'substituted'};return original;}});
 expect(parse(changing)).toEqual(value);for(const key of Object.keys(value))expect(reads.get(key)).toBe(1);
});

it('rejects duplicate and malformed field/choice structures and bounded overflow',()=>{
 const field=raw().definition.fields[0]!;
 for(const fields of [[field,field],[{...field,choices:[field.choices[0],field.choices[0]]}],[{...field,choices:[]}],[{...field,choices:Array.from({length:33},(_,i)=>({id:'c'+i,label:'Choice'}))}],Array.from({length:65},(_,i)=>({...field,key:'f'+i})),Array.from({length:9},(_,i)=>({...field,key:'f'+i,choices:Array.from({length:32},(_,j)=>({id:'c'+j,label:'Choice'}))})),[{...field,choices:[{id:'__proto__',label:'Choice'}]}],[{...field,choices:[{id:'a',label:'x'.repeat(201)}]}],[{...field,choices:[{id:'a',label:'\ud800'}]}]])reject({...raw(),definition:{schemaVersion:3,fields}});
 const sparse=raw();delete (sparse.definition.fields[0]!.choices as unknown[])[0];reject(sparse);
});

it('returns a detached deeply frozen definition retaining exact choice identity and labels',()=>{
 const value=raw(),output=parse(value),field=output.definition.fields[0]!;if(field.kind!=='dropdown')throw Error('Expected dropdown');
 value.tenantId='33333333-3333-4333-8333-333333333333';value.definition.fields[0]!.choices[0]!.id='changed';value.definition.fields[0]!.choices[0]!.label='changed';value.definition.fields[0]!.choices.reverse();
 expect(output.tenantId).toBe('11111111-1111-4111-8111-111111111111');expect(field.choices).toEqual([{id:'First',label:'  Same e\u0301  '},{id:'second',label:'  Same e\u0301  '}]);
 for(const item of [output,output.definition,output.definition.fields,field,field.choices,...field.choices])expect(Object.isFrozen(item)).toBe(true);
 expect(output.definition).not.toBe(value.definition);expect(field.choices).not.toBe(value.definition.fields[0]!.choices);
});
