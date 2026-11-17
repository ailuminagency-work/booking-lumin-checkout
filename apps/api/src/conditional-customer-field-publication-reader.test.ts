import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {ConditionalCustomerFieldPublicationReceipt,createConditionalCustomerFieldPublicationReader} from './conditional-customer-field-publication-reader';
const id=(n:number)=>`56000000-0000-4000-8000-${String(n).padStart(12,'0')}`,origin='https://checkout.example.test';
const service={id:id(3),name:'Housekeeping',durationMinutes:60,price:{amount:12500,currency:'USD'}};
const snapshot={renderSchemaVersion:6,submissionMode:'paid_conditional_customer_field_request',paymentMode:'staging_mock',simulated:true,service,publication:{name:'Saved',draftRevision:2,presentation:{accentColor:'#0e7490',layout:'compact'}},customerFields:[{id:'custom_access',kind:'text',label:'Access',required:true,maxLength:20}]};
const row={tenantId:id(2),flowId:id(4),versionId:id(5),sourceRevision:'2',renderSchemaVersion:6,snapshot,config:{key:'paid_conditional_customer_field',steps:[{key:'service',kind:'info',title:service.name}]},serviceId:service.id,boundSnapshot:service,installations:[{installationId:id(6),allowedOrigins:[origin]}]};
function fixture(result:unknown,error?:unknown){
 const query=vi.fn(async(sql:string)=>{if(sql.startsWith('select public.')){if(error)throw error;return{rows:[{result}]};}return{rows:[]};}),release=vi.fn();
 return{query,release,read:createConditionalCustomerFieldPublicationReader({connect:async()=>({query,release})} as unknown as Pool,[origin])};
}
describe('conditional publication recovery evidence',()=>{
 it('reads exactly bound immutable publication through fixed owner RPC with no writer or private grants',async()=>{
  const f=fixture(row),receipt=await f.read(id(1),id(2),id(4));
  expect(receipt).toEqual({flowId:id(4),draftRevision:2,publication:{versionId:id(5),installationId:id(6),renderSchemaVersion:6,hostedPath:`/checkout/flow/${id(6)}`}});
  expect(f.query.mock.calls.map(([s])=>s)).toEqual(['begin isolation level repeatable read','set local role service_role','select public.owner_conditional_customer_field_publication($1::uuid,$2::uuid,$3::uuid) result','commit']);expect(f.release).toHaveBeenCalledOnce();
 });
 it.each([{tenantId:id(9)},{flowId:id(9)},{renderSchemaVersion:5},{sourceRevision:'02'},{sourceRevision:'9007199254740992'},{sourceRevision:'1'},{serviceId:id(9)},{boundSnapshot:{...service,price:{amount:1,currency:'USD'}}},{config:{...row.config,key:'paid_customer_field'}},{snapshot:{...snapshot,total:1}},{snapshot:{...snapshot,customerFields:[{...snapshot.customerFields[0],when:{fieldId:'custom_missing',equals:'x'}}]}},{installations:[]},{installations:[row.installations[0],row.installations[0]]},{installations:[{installationId:id(6),allowedOrigins:[origin,origin]}]},{installations:[{installationId:id(6),allowedOrigins:['https://foreign.example.test']}]},{installations:[{installationId:id(6),allowedOrigins:[origin+'/']}]}])('fails closed malformed, foreign and unverified binding %j',async patch=>expect(await fixture({...row,...patch}).read(id(1),id(2),id(4))).toBeNull());
 it.each(['42501','P0002'])('returns absence for unauthorized or unavailable RPC %s',async code=>{
  const f=fixture(undefined,{code});expect(await f.read(id(1),id(2),id(4))).toBeNull();expect(f.query).toHaveBeenCalledWith('rollback');
 });
 it('does not expose database errors and rejects malformed identity before connection',async()=>{
  await expect(fixture(undefined,{code:'XX000',message:'private details'}).read(id(1),id(2),id(4))).rejects.toThrow('INTERNAL_ERROR');
  const f=fixture(row);await expect(f.read('invalid',id(2),id(4))).rejects.toThrow('INVALID_REQUEST');expect(f.query).not.toHaveBeenCalled();
 });
 it('rejects a noncanonical receipt and a legacy schema without coercion',()=>{
  const receipt={flowId:id(4),draftRevision:2,publication:{versionId:id(5),installationId:id(6),renderSchemaVersion:6,hostedPath:`/checkout/flow/${id(6)}`}};
  expect(ConditionalCustomerFieldPublicationReceipt.safeParse(receipt).success).toBe(true);
  expect(ConditionalCustomerFieldPublicationReceipt.safeParse({...receipt,publication:{...receipt.publication,renderSchemaVersion:5}}).success).toBe(false);
  expect(ConditionalCustomerFieldPublicationReceipt.safeParse({...receipt,publication:{...receipt.publication,hostedPath:'https://evil.test'}}).success).toBe(false);
 });
});
