import {expect,it,vi} from 'vitest';
import {parseFieldDocumentV3 as parse} from '../src/fieldDocumentV3';
import {parseFieldDocumentV2} from '../src/fieldDocumentV2';
import {parseTextFieldDocument} from '../src/fieldAnswers';
const choice=(extra={})=>({id:'standard',label:'  Standard 🌍  ',...extra});
const dropdown=(extra={})=>({key:'package',kind:'dropdown',required:false,choices:[choice()],...extra});
const text=(extra={})=>({key:'notes',kind:'text',required:false,minLength:0,maxLength:100,...extra});
const doc=(fields:unknown[]=[])=>({schemaVersion:3,fields});
const reject=(value:unknown)=>expect(()=>parse(value)).toThrow('INVALID_FIELD_V3_CONTRACT');
it('copies and freezes every choice and document level with exact labels and omitted prompts',()=>{
 const field=dropdown(),input=doc([text({prompt:'Exact text'}),text({key:'long',kind:'textarea'}),field]),out=parse(input);
 expect(out.fields[2]).toEqual(field);expect(out.fields[2]).not.toHaveProperty('prompt');field.choices[0]!.label='changed';expect(out.fields[2]).toMatchObject({choices:[{label:'  Standard 🌍  '}]});
 const frozen=(v:unknown):void=>{if(v&&typeof v==='object'){expect(Object.isFrozen(v)).toBe(true);Object.values(v).forEach(frozen);}};frozen(out);
});
it('uses stable per-field IDs while duplicate labels and IDs in different fields remain independent',()=>{
 const choices=[choice({id:'a',label:'Same'}),choice({id:'b',label:'Same'})];expect(parse(doc([dropdown({choices}),dropdown({key:'second',choices})])).fields).toHaveLength(2);reject(doc([dropdown({choices:[choice(),choice()]})]));reject(doc([dropdown(),dropdown()]));
});
it('enforces 1..32 choices, 256 aggregate choices and 64 fields at exact boundaries',()=>{
 const choices=Array.from({length:32},(_,i)=>choice({id:`c${i}`}));const fields=Array.from({length:8},(_,i)=>dropdown({key:`d${i}`,choices}));expect(parse(doc(fields)).fields).toHaveLength(8);reject(doc([...fields,dropdown({key:'overflow'})]));reject(doc([dropdown({choices:[]})]));reject(doc([dropdown({choices:[...choices,choice({id:'extra'})]})]));expect(parse(doc(Array.from({length:64},(_,i)=>text({key:`t${i}`})))).fields).toHaveLength(64);reject(doc(Array.from({length:65},(_,i)=>text({key:`t${i}`}))));
});
it('validates labels by codepoints and preserves exact whitespace without normalization',()=>{
 for(const label of ['🌍'.repeat(200),' e\u0301 ','\u0085','\u200b'])expect(parse(doc([dropdown({choices:[choice({label})]})])).fields[0]).toMatchObject({choices:[{label}]});
 for(const label of ['', ' ', '\u00a0','x\ny','x\ry','x\u2028y','x\u2029y','\0','\ud800','\udc00','🌍'.repeat(201),undefined,null,42])reject(doc([dropdown({choices:[choice({label})]})]));
});
it('rejects unsafe IDs, unsupported effects, defaults, prices and mixed field shape',()=>{
 for(const id of ['','__proto__','constructor','prototype','with space','1first','a'.repeat(65)])reject(doc([dropdown({choices:[choice({id})]})]));
 for(const extra of [{price:1},{effect:'skip'},{default:'standard'},{minLength:0},{maxLength:1},{kind:'radio'}])reject(doc([dropdown(extra)]));
 reject(doc([dropdown({choices:[choice({price:1})]})]));reject(doc([text({choices:[choice()]})]));
});
it('rejects accessors without invocation and hostile record or list descriptors',()=>{
 const getter=vi.fn();const c=Object.defineProperty(choice(),'label',{enumerable:true,get:getter});reject(doc([dropdown({choices:[c]})]));expect(getter).not.toHaveBeenCalled();
 const symbol=Object.assign(choice(),{[Symbol('hidden')]:1}),hidden=Object.defineProperty(choice(),'hidden',{value:1});
 for(const choices of [new Array(1),Object.assign([choice()],{extra:1}),[symbol],[hidden],Object.setPrototypeOf([choice()],null)])reject(doc([dropdown({choices})]));
 reject(Object.create(doc()));reject(doc([Object.create(dropdown())]));reject(new Proxy({},{getPrototypeOf(){throw Error('private');}}));
});
it('permits detached plain null-prototype records while all older versions reject V3',()=>{
 const input=Object.assign(Object.create(null),doc([Object.assign(Object.create(null),dropdown())]));expect(parse(input).schemaVersion).toBe(3);
 for(const old of [parseFieldDocumentV2,parseTextFieldDocument])expect(()=>old(doc([text()]))).toThrow();for(const schemaVersion of [1,2,4,'3'])reject({schemaVersion,fields:[]});
});
it('retains V2 text definition semantics exactly',()=>{
 for(const field of [text(),text({kind:'textarea',prompt:' Exact '}),text({required:true,minLength:1,maxLength:4096})])expect(parse(doc([field])).fields).toEqual(parseFieldDocumentV2({schemaVersion:2,fields:[field]}).fields);
 for(const field of [text({required:true,maxLength:0}),text({prompt:''}),text({minLength:2,maxLength:1}),text({maxLength:4097})])reject(doc([field]));
});
it.each(['text','dropdown'])('captures %s key descriptors once before validation and deduplication',kind=>{
 let reads=0;const target=kind==='text'?text({key:'first'}):dropdown({key:'first'});const proxy=new Proxy(target,{getOwnPropertyDescriptor(object,key){const descriptor=Reflect.getOwnPropertyDescriptor(object,key);return key==='key'?{...descriptor!,value:++reads===1?'first':'second'}:descriptor;}});
 const normal=kind==='text'?text({key:'second'}):dropdown({key:'second'});const out=parse(doc([proxy,normal]));expect(out.fields.map(f=>f.key)).toEqual(['first','second']);expect(reads).toBe(1);
});
