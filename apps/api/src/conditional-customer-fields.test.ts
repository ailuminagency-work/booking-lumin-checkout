import {describe,it,expect} from 'vitest';
import {ConditionalCustomerFieldRequestInput,PaidConditionalCustomerFieldDraft,SavePaidConditionalCustomerFieldDraft,validateConditionalCustomerFieldRequest} from './conditional-customer-fields';
import {AnyPaidSimpleDraft,CustomerFieldRequestInput,SavePaidCustomerFieldDraft,RpcResults} from './contracts';
const id='40000000-0000-4000-8000-000000000001';
const fields=[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20},{id:'custom_code',kind:'text',label:'Code',required:true,maxLength:4,when:{fieldId:'custom_access',equals:'gate'}}];
const draft={schemaVersion:3,expectedRevision:2,serviceId:id,name:'Saved',presentation:{accentColor:'#0e7490',layout:'compact'},customerFields:fields};
const render={versionId:id,renderSchemaVersion:6,submissionMode:'paid_conditional_customer_field_request',paymentMode:'staging_mock',simulated:true,service:{id,name:'Housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}},publication:{name:'Saved',draftRevision:3,presentation:draft.presentation},customerFields:fields};
const request={schemaVersion:3,idempotencyKey:'conditional-request-0001',answers:{},customerAnswers:{custom_access:'door'},customer:{name:' Customer ',email:'test@example.com'},requestedStart:'2026-10-06T10:00:00-07:00'};
describe('closed conditional server boundaries',()=>{
 it('parses exact versioned save/read shapes without dropping conditions',()=>{
  expect(SavePaidConditionalCustomerFieldDraft.parse(draft)).toEqual(draft);
  const{expectedRevision,...saved}=draft;expect(PaidConditionalCustomerFieldDraft.parse({...saved,flowId:id,revision:3}).customerFields).toEqual(fields);
  expect(SavePaidCustomerFieldDraft.safeParse(draft).success).toBe(false);expect(AnyPaidSimpleDraft.safeParse({...saved,flowId:id,revision:3}).success).toBe(false);
 });
 it('normalizes existing customer/time fields and retains exact conditional values',()=>{
  const validated=validateConditionalCustomerFieldRequest(render,{...request,customerAnswers:{custom_code:'😀😀',custom_access:'gate'}});
  expect(validated.customer.name).toBe('Customer');expect(validated.requestedStart).toBe('2026-10-06T17:00:00.000Z');expect(Object.keys(validated.customerAnswers)).toEqual(['custom_access','custom_code']);
  expect(validated).not.toHaveProperty('serviceId');expect(validated).not.toHaveProperty('price');
 });
 it.each([{price:1},{tenantId:id},{providerState:'succeeded'},{customerFields:fields},{schemaVersion:2},{answers:{serviceId:id}},{customer:{...request.customer,role:'BUSINESS_OWNER'}},{requestedStart:'bad'},{customer:{name:'bad\ud800',email:'test@example.com'}}])('rejects forged request authority %j',patch=>expect(ConditionalCustomerFieldRequestInput.safeParse({...request,...patch}).success).toBe(false));
 it.each([{custom_access:'door',custom_code:'1234'},{custom_access:'gate'},{custom_access:'gate',custom_code:'12345'},{custom_access:'door',custom_other:'x'}])('validates against server snapshot rather than client assertions %j',customerAnswers=>expect(()=>validateConditionalCustomerFieldRequest(render,{...request,customerAnswers})).toThrow());
 it.each([{expectedRevision:-1},{expectedRevision:1.5},{schemaVersion:2},{total:1},{customerFields:[fields[1],fields[0]]},{customerFields:[{...fields[0],label:'bad\ud800'}]}])('rejects malformed draft metadata %j',patch=>expect(SavePaidConditionalCustomerFieldDraft.safeParse({...draft,...patch}).success).toBe(false));
 it('keeps old request and session RPC acceptance closed to schema3/render6',()=>{
  expect(CustomerFieldRequestInput.safeParse(request).success).toBe(false);
  expect(RpcResults.issue_flow_session.safeParse({expiresAt:'2026-10-06T18:00:00Z',render}).success).toBe(false);
 });
 it('cannot substitute malformed or legacy pinned server render',()=>{
  expect(()=>validateConditionalCustomerFieldRequest({...render,renderSchemaVersion:5},request)).toThrow();
  expect(()=>validateConditionalCustomerFieldRequest({...render,customerFields:[fields[1],fields[0]]},request)).toThrow();
 });
});
