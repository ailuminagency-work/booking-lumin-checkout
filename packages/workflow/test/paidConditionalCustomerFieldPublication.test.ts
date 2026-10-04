import {describe,it,expect} from 'vitest';
import {PaidConditionalCustomerFieldRender,validatePaidConditionalCustomerFieldAnswers} from '../src/paidConditionalCustomerFieldPublication';
import {PaidCustomerFieldRender} from '../src/paidCustomerFieldPublication';
const source={id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20};
const dependent={id:'custom_code',kind:'text',label:'Code',required:true,maxLength:4,when:{fieldId:'custom_access',equals:'gate'}};
const render={versionId:'40000000-0000-4000-8000-000000000001',renderSchemaVersion:6,submissionMode:'paid_conditional_customer_field_request',paymentMode:'staging_mock',simulated:true,service:{id:'40000000-0000-4000-8000-000000000002',name:'Housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}},publication:{name:'Saved',draftRevision:3,presentation:{accentColor:'#0e7490',layout:'compact'}},customerFields:[source,dependent]};
describe('V6 pinned conditional customer fields',()=>{
 it('keeps immutable order and exact price without mutating render or answers',()=>{
  const before=structuredClone(render),answers={custom_code:'😀😀',custom_access:'gate'};
  const actual=validatePaidConditionalCustomerFieldAnswers(render,answers);
  expect(Object.keys(actual)).toEqual(['custom_access','custom_code']);expect(actual).toEqual(answers);expect(render).toEqual(before);
 });
 it('enforces only visible required fields with exact equality',()=>{
  expect(validatePaidConditionalCustomerFieldAnswers(render,{custom_access:'door'})).toEqual({custom_access:'door'});
  expect(validatePaidConditionalCustomerFieldAnswers(render,{custom_access:'Gate'})).toEqual({custom_access:'Gate'});
  expect(validatePaidConditionalCustomerFieldAnswers(render,{custom_access:' gate '})).toEqual({custom_access:' gate '});
  expect(()=>validatePaidConditionalCustomerFieldAnswers(render,{custom_access:'gate'})).toThrow();
 });
 it.each([{custom_access:'door',custom_code:''},{custom_access:'gate',custom_code:' '},{custom_access:'gate',custom_code:'12345'},{custom_access:'door',custom_unknown:'x'},{custom_access:'gate',custom_code:'\ud800'},{custom_access:'gate',custom_code:'a\n'},{}])('rejects hidden, unknown or invalid answers %j',answers=>expect(()=>validatePaidConditionalCustomerFieldAnswers(render,answers)).toThrow());
 it.each([{renderSchemaVersion:5},{submissionMode:'paid_customer_field_request'},{paymentMode:'stripe'},{simulated:false},{tenantId:render.service.id},{total:0},{customerFields:[dependent,source]},{customerFields:[{...source,price:1}]},{service:{...render.service,questions:[]}}])('rejects authority widening and malformed definitions %j',patch=>expect(PaidConditionalCustomerFieldRender.safeParse({...render,...patch}).success).toBe(false));
 it('does not widen V5 or accept old snapshots as V6',()=>{
  const old={...render,renderSchemaVersion:5,submissionMode:'paid_customer_field_request',customerFields:[source]};
  expect(PaidCustomerFieldRender.safeParse(old).success).toBe(true);expect(PaidCustomerFieldRender.safeParse(render).success).toBe(false);expect(PaidConditionalCustomerFieldRender.safeParse(old).success).toBe(false);
 });
});
