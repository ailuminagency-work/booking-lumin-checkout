import {expect,it} from 'vitest';
import {CustomerDraftFields} from './customer-draft-fields';
import {ConditionalCustomerFieldConfiguration,ConditionalCustomerFieldAnswers,canonicalizeConditionalCustomerFieldAnswers,resolveConditionalCustomerFieldVisibility} from './conditional-customer-fields';
const field=(id:string,required=false,maxLength=40)=>({id,kind:'text' as const,label:'Customer information',required,maxLength});
const source=field('custom_access',true),detail={...field('custom_detail',true),when:{fieldId:'custom_access',equals:'yes'}},last={...field('custom_note'),when:{fieldId:'custom_detail',equals:'gate'}};
const config={schemaVersion:3,customerFields:[source,detail,last]};
it('explicit V3 preserves ordered definitions and uses exact earlier-field equality',()=>{
 expect(ConditionalCustomerFieldConfiguration.parse(config)).toEqual(config);
 expect(resolveConditionalCustomerFieldVisibility(config,{})).toEqual(['custom_access']);
 expect(resolveConditionalCustomerFieldVisibility(config,{custom_access:'yes'})).toEqual(['custom_access','custom_detail']);
 expect(resolveConditionalCustomerFieldVisibility(config,{custom_access:'yes',custom_detail:'gate'})).toEqual(['custom_access','custom_detail','custom_note']);
 for(const custom_access of ['Yes',' yes','yes ','no'])expect(resolveConditionalCustomerFieldVisibility(config,{custom_access})).toEqual(['custom_access']);
});
it('hidden required fields are not required; visible ones are enforced',()=>{
 expect(canonicalizeConditionalCustomerFieldAnswers(config,{custom_access:'no'})).toEqual({custom_access:'no'});
 expect(()=>canonicalizeConditionalCustomerFieldAnswers(config,{})).toThrow('INVALID_CONDITIONAL_CUSTOMER_ANSWER');
 expect(()=>canonicalizeConditionalCustomerFieldAnswers(config,{custom_access:'yes'})).toThrow('INVALID_CONDITIONAL_CUSTOMER_ANSWER');
 expect(()=>canonicalizeConditionalCustomerFieldAnswers(config,{custom_access:'yes',custom_detail:'   '})).toThrow('INVALID_CONDITIONAL_CUSTOMER_ANSWER');
 expect(canonicalizeConditionalCustomerFieldAnswers(config,{custom_access:'yes',custom_detail:'other'})).toEqual({custom_access:'yes',custom_detail:'other'});
});
it('canonicalizes key order only, preserving values and optional omission without mutating either input',()=>{
 const answers={custom_note:' Exact 😀 ',custom_detail:'gate',custom_access:'yes'};const before=JSON.stringify([config,answers]);
 const result=canonicalizeConditionalCustomerFieldAnswers(config,answers);expect(Object.keys(result)).toEqual(['custom_access','custom_detail','custom_note']);expect(result).toEqual(answers);expect(JSON.stringify([config,answers])).toBe(before);
 expect(canonicalizeConditionalCustomerFieldAnswers({schemaVersion:3,customerFields:[field('custom_optional')]},{})).toEqual({});
 expect(canonicalizeConditionalCustomerFieldAnswers({schemaVersion:3,customerFields:[field('custom_optional')]},{custom_optional:''})).toEqual({custom_optional:''});
});
it.each([{custom_access:'no',custom_detail:'gate'},{custom_access:'no',custom_note:'hidden'},{custom_access:'yes',custom_detail:'other',custom_note:'hidden'}])('rejects hidden answers consistently for partial and complete evaluation %j',answers=>{
 expect(()=>resolveConditionalCustomerFieldVisibility(config,answers)).toThrow('INVALID_CONDITIONAL_CUSTOMER_ANSWER');expect(()=>canonicalizeConditionalCustomerFieldAnswers(config,answers)).toThrow('INVALID_CONDITIONAL_CUSTOMER_ANSWER');
});
it.each(['custom_missing','custom_detail','custom_note','tenantId','price','payment','role','custom_price','custom_payment_id','custom_constructor','__proto__'])('rejects unknown/self/later/native/injection condition reference %s',fieldId=>{
 expect(ConditionalCustomerFieldConfiguration.safeParse({...config,customerFields:[source,{...detail,when:{fieldId,equals:'yes'}}]}).success).toBe(false);
});
it.each([
 {...config,schemaVersion:2},{...config,schemaVersion:5},{...config,tenantId:'spoof'},
 {...config,customerFields:[source,source]},
 {...config,customerFields:[source,{...detail,when:{fieldId:'custom_access',equals:'yes',operator:'eval'}}]},
 {...config,customerFields:[source,{...detail,price:1}]},
 {...config,customerFields:[{...source,when:{fieldId:'custom_detail',equals:'yes'}},detail]},
 {...config,customerFields:Array.from({length:11},(_,i)=>field('custom_field_'+i))},
 {...config,customerFields:[field('custom_amount')]},
 {...config,customerFields:[{...source,maxLength:1001}]},
 {...config,customerFields:[{...source,label:'bad\u0000'}]},
 {...config,customerFields:[{...source,label:'bad\ud800'}]},
 {...config,customerFields:[source,{...detail,when:{fieldId:'custom_access',equals:'x'.repeat(41)}}]},
 {...config,customerFields:[source,{...detail,when:{fieldId:'custom_access',equals:''}}]},
 {...config,customerFields:[source,{...detail,when:{fieldId:'custom_access',equals:'   '}}]},
])('rejects widened, cyclic, oversized or malformed definitions %#',value=>{expect(ConditionalCustomerFieldConfiguration.safeParse(value).success).toBe(false);expect(()=>canonicalizeConditionalCustomerFieldAnswers(value,{})).toThrow();});
it.each([null,[],{custom_unknown:'value'},{price:'1'},{custom_access:1},{custom_access:'x'.repeat(41)},{custom_access:'bad\n'},{custom_access:'bad\ud800'},{custom_access:'bad\udc00'},JSON.parse('{"__proto__":{"polluted":true}}')])('rejects malformed/authority/unknown/oversized answer payload %#',answers=>{expect(()=>canonicalizeConditionalCustomerFieldAnswers(config,answers)).toThrow();});
it('rejects inherited, non-enumerable, accessor and symbol answers without evaluating accessors',()=>{
 expect(ConditionalCustomerFieldAnswers.safeParse(Object.create({custom_access:'yes'})).success).toBe(false);
 expect(ConditionalCustomerFieldAnswers.safeParse(Object.defineProperty({},'custom_access',{value:'yes'})).success).toBe(false);
 let called=false;const accessor=Object.defineProperty({},'custom_access',{enumerable:true,get:()=>{called=true;return'yes';}});expect(ConditionalCustomerFieldAnswers.safeParse(accessor).success).toBe(false);expect(called).toBe(false);
 expect(ConditionalCustomerFieldAnswers.safeParse({[Symbol('hidden')]:'value'}).success).toBe(false);expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
});
it('supports bounded UTF16 pairs in labels, conditions and values; counts pairs as two units',()=>{
 const unicode={schemaVersion:3,customerFields:[{...field('custom_access',true,2),label:'Access 😀'},{...field('custom_detail',true,2),when:{fieldId:'custom_access',equals:'😀'}}]};
 expect(canonicalizeConditionalCustomerFieldAnswers(unicode,{custom_access:'😀',custom_detail:'😀'})).toEqual({custom_access:'😀',custom_detail:'😀'});
 expect(()=>canonicalizeConditionalCustomerFieldAnswers(unicode,{custom_access:'😀',custom_detail:'😀a'})).toThrow();
});
it('max10 is inclusive and no hidden-source fallback or truthiness activates a field',()=>{
 const ten={schemaVersion:3,customerFields:Array.from({length:10},(_,i)=>field('custom_field_'+i))};expect(ConditionalCustomerFieldConfiguration.parse(ten)).toEqual(ten);expect(canonicalizeConditionalCustomerFieldAnswers(ten,{})).toEqual({});
 const optional={schemaVersion:3,customerFields:[field('custom_access'),detail,last]};expect(resolveConditionalCustomerFieldVisibility(optional,{})).toEqual(['custom_access']);expect(canonicalizeConditionalCustomerFieldAnswers(optional,{})).toEqual({});
});
it('supports exact padded condition values and never normalizes the comparison',()=>{
 const padded={schemaVersion:3,customerFields:[source,{...detail,when:{fieldId:'custom_access',equals:' yes '}}]};
 expect(resolveConditionalCustomerFieldVisibility(padded,{custom_access:'yes'})).toEqual(['custom_access']);
 expect(canonicalizeConditionalCustomerFieldAnswers(padded,{custom_access:' yes ',custom_detail:'exact'})).toEqual({custom_access:' yes ',custom_detail:'exact'});
});
it('enforces inclusive 1000-unit text and 10-answer bounds',()=>{
 const maximum={schemaVersion:3,customerFields:[field('custom_long',true,1000)]};
 expect(canonicalizeConditionalCustomerFieldAnswers(maximum,{custom_long:'x'.repeat(1000)})).toEqual({custom_long:'x'.repeat(1000)});
 expect(()=>canonicalizeConditionalCustomerFieldAnswers(maximum,{custom_long:'x'.repeat(1001)})).toThrow();
 expect(ConditionalCustomerFieldAnswers.safeParse(Object.fromEntries(Array.from({length:11},(_,i)=>['custom_field_'+i,'value']))).success).toBe(false);
});
it('legacy unconditional fields remain unchanged and reject new conditional metadata',()=>{
 expect(CustomerDraftFields.parse([source])).toEqual([source]);expect(CustomerDraftFields.safeParse([source,detail]).success).toBe(false);
 expect(ConditionalCustomerFieldConfiguration.safeParse({schemaVersion:1,customerFields:[source]}).success).toBe(false);
 expect(ConditionalCustomerFieldConfiguration.safeParse({schemaVersion:2,customerFields:[source]}).success).toBe(false);
});
