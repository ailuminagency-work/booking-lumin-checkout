import {describe,expect,it} from 'vitest';
import {CustomerDraftFields} from '../src/customer-draft-fields';
const optional={id:'custom_access',kind:'text',label:'Access notes',required:false,maxLength:500},required={id:'custom_contact',kind:'text',label:'Contact notes',required:true,maxLength:100};
describe('additional informational customer draft fields',()=>{
 it('preserves optional/required metadata and exact explicit array order',()=>{expect(CustomerDraftFields.parse([required,optional])).toEqual([required,optional]);expect(CustomerDraftFields.parse([optional,required])).toEqual([optional,required]);expect(CustomerDraftFields.parse([])).toEqual([]);});
 it.each([{id:'name'},{id:'custom_name'},{id:'custom_email'},{id:'custom_price'},{id:'custom_constructor'},{id:'custom___proto__'},{id:'custom_Access'},{id:'custom_'+ 'a'.repeat(42)},{kind:'email'},{kind:'quantity'},{label:' Untrimmed '},{label:'bad\nlabel'},{label:'bad\u0085label'},{label:''},{label:'x'.repeat(101)},{required:'true'},{maxLength:0},{maxLength:1001},{maxLength:1.5},{price:10},{defaultValue:'customer data'},{role:'BUSINESS_OWNER'}])('rejects widened/unsafe definitions %j',change=>expect(CustomerDraftFields.safeParse([{...optional,...change}]).success).toBe(false));
 it('rejects duplicate identity and overflow without stripping fields',()=>{expect(CustomerDraftFields.safeParse([optional,optional]).success).toBe(false);expect(CustomerDraftFields.safeParse(Array.from({length:11},(_,i)=>({...optional,id:'custom_field'+i}))).success).toBe(false);});
});
