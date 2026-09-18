import {expect,it} from 'vitest';
import {compareTextFields} from '../src/textFieldComparison';
const field=(key:string,extra={})=>({key,kind:'text',required:false,minLength:0,maxLength:100,...extra});
const doc=(fields:unknown[])=>({schemaVersion:1,fields});
it('defines local additions, saved removals, stable output ordering and independent index changes',()=>{
 const result=compareTextFields(doc([field('b'),field('new')]),doc([field('a'),field('b')]));
 expect(result.map(e=>[e.key,e.status,e.reordered,e.localIndex,e.savedIndex])).toEqual([['b','unchanged',true,0,1],['new','added',false,1,undefined],['a','removed',false,undefined,0]]);
 expect(result[1]).not.toHaveProperty('saved');expect(result[2]).not.toHaveProperty('local');
});
it('compares exact metadata and prompt omission without Unicode normalization',()=>{
 const baseline=field('a',{prompt:'e\u0301'});
 for(const change of [{prompt:'\u00e9'},{prompt:' e\u0301 '},{required:true},{minLength:1},{maxLength:99}])expect(compareTextFields(doc([{...baseline,...change}]),doc([baseline]))[0]?.status).toBe('changed');
 expect(compareTextFields(doc([field('a')]),doc([field('a',{prompt:'Question'})]))[0]?.status).toBe('changed');
 expect(compareTextFields(doc([field('a')]),doc([field('a')]))[0]?.status).toBe('unchanged');
});
it('uses stable keys rather than duplicate prompts and safely handles inherited-name keys',()=>{
 const fields=[field('toString',{prompt:'Same'}),field('hasOwnProperty',{prompt:'Same'})];
 const result=compareTextFields(doc([...fields].reverse()),doc(fields));expect(result.every(e=>e.status==='unchanged'&&e.reordered)).toBe(true);
});
it('returns detached frozen snapshots without mutating inputs',()=>{
 const input={...field('a'),prompt:'Original'};const result=compareTextFields(doc([input]),doc([]));input.prompt='Changed';
 expect(result[0]?.local?.prompt).toBe('Original');expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result[0])).toBe(true);expect(Object.isFrozen(result[0]?.local)).toBe(true);
});
it('rejects hostile descriptors and malformed contracts on either side without getters',()=>{
 let invoked=0;const hostile=Object.defineProperty(field('a'),'prompt',{get(){invoked++;return 'Secret';},enumerable:true});
 for(const invalid of [doc([hostile]),doc([field('a'),field('a')]),doc([field('a',{kind:'textarea'})]),{schemaVersion:2,fields:[]},doc([field('a',{prompt:undefined})])]){
  expect(()=>compareTextFields(invalid,doc([]))).toThrow('INVALID_TEXT_CONTRACT');expect(()=>compareTextFields(doc([]),invalid)).toThrow('INVALID_TEXT_CONTRACT');
 }expect(invoked).toBe(0);
});
it('bounds both inputs to64 and union to128',()=>{
 const make=(prefix:string,count:number)=>doc(Array.from({length:count},(_,i)=>field(prefix+i)));
 expect(compareTextFields(make('a',64),make('b',64))).toHaveLength(128);expect(()=>compareTextFields(make('a',65),doc([]))).toThrow();expect(compareTextFields(doc([]),doc([]))).toEqual([]);
});
