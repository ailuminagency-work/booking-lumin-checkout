import {describe,expect,it} from 'vitest';
import {PaidSimpleRender} from '../src/paidPublication';
import {PaidOptionRender} from '../src/paidOptionPublication';
import {CustomerFieldAnswers,PaidCustomerFieldRender,isPaidCustomerFieldRender,validatePaidCustomerFieldAnswers} from '../src/paidCustomerFieldPublication';
const required={id:'custom_access',kind:'text',label:'Access instructions',required:true,maxLength:20};
const optional={id:'custom_notes',kind:'text',label:'Additional notes',required:false,maxLength:4};
const render={versionId:'40000000-0000-4000-8000-000000000001',renderSchemaVersion:5,submissionMode:'paid_customer_field_request',paymentMode:'staging_mock',simulated:true,service:{id:'40000000-0000-4000-8000-000000000002',name:'Catalog housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}},publication:{name:'Saved housekeeping',draftRevision:2,presentation:{accentColor:'#0e7490',layout:'compact'}},customerFields:[required,optional]};
describe('V5 immutable informational customer contract',()=>{
 it('preserves pinned order, revision, service price and explicit test mode',()=>{
  expect(PaidCustomerFieldRender.parse(render)).toEqual(render);expect(isPaidCustomerFieldRender(render)).toBe(true);
  expect(PaidCustomerFieldRender.parse({...render,customerFields:[optional,required]}).customerFields).toEqual([optional,required]);
  expect(PaidCustomerFieldRender.parse({...render,customerFields:[]}).customerFields).toEqual([]);
 });
 it.each([
  {renderSchemaVersion:3},{renderSchemaVersion:4},{renderSchemaVersion:6},{submissionMode:'paid_service_request'},{paymentMode:'stripe'},{simulated:false},
  {publication:undefined},{publication:{...render.publication,draftRevision:0}},{publication:{...render.publication,presentation:{accentColor:'url(evil)',layout:'compact'}}},
  {customerFields:undefined},{customerFields:[required,required]},{customerFields:[{...required,label:'bad\ud800'}]},
  {customerFields:[{...required,price:1}]},{service:{...render.service,questions:[]}},{total:1},{tenantId:render.service.id},{role:'BUSINESS_OWNER'},
 ])('rejects malformed or authority-widened snapshots %j',change=>expect(isPaidCustomerFieldRender({...render,...change})).toBe(false));
 it('keeps V3 and V4 strict instead of coercing new information into older versions',()=>{
  const legacy={versionId:render.versionId,renderSchemaVersion:3,submissionMode:'paid_service_request',paymentMode:'staging_mock',simulated:true,service:render.service};
  expect(PaidSimpleRender.parse(legacy)).toEqual(legacy);expect(PaidSimpleRender.safeParse(render).success).toBe(false);expect(PaidOptionRender.safeParse(render).success).toBe(false);
  expect(isPaidCustomerFieldRender(legacy)).toBe(false);
 });
 it('validates against immutable IDs and emits exact values in definition order without financial selection',()=>{
  const before=structuredClone(render);const answers={custom_notes:'Hi',custom_access:'  Gate code 12  '};
  const result=validatePaidCustomerFieldAnswers(render,answers);
  expect(result).toEqual(answers);expect(Object.keys(result)).toEqual(['custom_access','custom_notes']);expect(render).toEqual(before);
  expect(render.service.price).toEqual({amount:12500,currency:'USD'});expect(result).not.toHaveProperty('serviceId');
 });
 it('preserves optional omission and optional empty strings without inventing defaults',()=>{
  expect(validatePaidCustomerFieldAnswers(render,{custom_access:'Door'})).toEqual({custom_access:'Door'});
  expect(validatePaidCustomerFieldAnswers(render,{custom_access:'Door',custom_notes:''})).toEqual({custom_access:'Door',custom_notes:''});
  expect(validatePaidCustomerFieldAnswers({...render,customerFields:[]},{})).toEqual({});
 });
 it.each([{}, {custom_access:''},{custom_access:' \u00a0 '},{custom_access:'x'.repeat(21)},{custom_access:'Door',custom_notes:'12345'},
  {custom_access:'Door',custom_unknown:'No'},{custom_access:'Door',price:'1'},{custom_access:'Door',custom_price:'1'},
  {custom_access:12},{custom_access:null},{custom_access:{value:'Door'}},{custom_access:['Door']},
  {custom_access:'Door\ncode'},{custom_access:'Door\tcode'},{custom_access:'Door\u0000code'},{custom_access:'Door\u0085code'},
  {custom_access:'\ud800'},{custom_access:'\udc00'},{custom_access:'\ud800X'},[],null,
 ])('fails closed invalid/missing/unrecognized customer answers %j',answers=>expect(()=>validatePaidCustomerFieldAnswers(render,answers)).toThrow());
 it('rejects prototype keys from real JSON without stripping them',()=>{
  for(const key of ['__proto__','constructor','prototype']){
   const raw=JSON.parse(`{"custom_access":"Door","${key}":"unsafe"}`);
   expect(CustomerFieldAnswers.safeParse(raw).success).toBe(false);expect(()=>validatePaidCustomerFieldAnswers(render,raw)).toThrow();
  }
 });
 it('uses persisted UTF-16 maxLength and permits valid astral pairs',()=>{
  expect(validatePaidCustomerFieldAnswers(render,{custom_access:'Door',custom_notes:'😀😀'}).custom_notes).toBe('😀😀');
  expect(()=>validatePaidCustomerFieldAnswers(render,{custom_access:'Door',custom_notes:'😀😀a'})).toThrow();
  expect(isPaidCustomerFieldRender({...render,customerFields:[{...required,label:'Entry 😀'}]})).toBe(true);
 });
 it('bounds answer count before publication matching',()=>{
  expect(CustomerFieldAnswers.safeParse(Object.fromEntries(Array.from({length:11},(_,i)=>['custom_field'+i,'x']))).success).toBe(false);
 });
});
