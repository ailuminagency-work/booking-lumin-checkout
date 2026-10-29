import {describe,expect,it} from 'vitest';
import {CustomerFieldRequestInput,RequestInput,RpcResults} from './contracts';
const input={schemaVersion:2,idempotencyKey:'customer-request-key-123',answers:{},customerAnswers:{custom_access:'Door code 12'},customer:{name:'Customer',email:'customer@example.test'},requestedStart:'2030-01-01T10:00:00Z'};
describe('explicit informational customer request boundary remains closed pending SQL authority',()=>{
 it('accepts the strict additional-answer envelope with separate fixed identity and empty priced answers',()=>{
  expect(CustomerFieldRequestInput.parse(input)).toEqual({...input,requestedStart:'2030-01-01T10:00:00.000Z'});
 });
 it.each([{schemaVersion:1},{schemaVersion:5},{schemaVersion:undefined},{customerAnswers:undefined},{answers:{custom_access:{choiceIds:['x']}}},
  {price:12500},{total:12500},{tax:0},{tenantId:'40000000-0000-4000-8000-000000000001'},{provider:'staging_mock'},{role:'BUSINESS_OWNER'},
  {customer:{...input.customer,tenantId:'40000000-0000-4000-8000-000000000001'}},{customerAnswers:{custom_price:'1'}},{customerAnswers:{custom_access:'x'.repeat(1001)}},{customerAnswers:{custom_access:'bad\ud800'}},
 ])('rejects unversioned, monetary, malformed and extra inputs %j',change=>expect(CustomerFieldRequestInput.safeParse({...input,...change}).success).toBe(false));
 it('rejects injected answer keys and preserves valid surrogate pairs',()=>{
  expect(CustomerFieldRequestInput.safeParse({...input,customerAnswers:JSON.parse('{"__proto__":"x"}')}).success).toBe(false);
  expect(CustomerFieldRequestInput.parse({...input,customerAnswers:{custom_access:'😀'}}).customerAnswers).toEqual({custom_access:'😀'});
 });
 it('does not route this new envelope through the legacy request or session-result contracts',()=>{
  expect(RequestInput.safeParse(input).success).toBe(false);
  expect(RequestInput.parse({idempotencyKey:input.idempotencyKey,answers:{},customer:input.customer,requestedStart:input.requestedStart}).answers).toEqual({});
  expect(RpcResults.issue_flow_session.safeParse({expiresAt:'2030-01-01T10:00:00Z',render:{renderSchemaVersion:5}}).success).toBe(false);
 });
});
