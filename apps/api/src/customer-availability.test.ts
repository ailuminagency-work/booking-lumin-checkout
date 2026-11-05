import {describe,expect,it} from 'vitest';
import {createCustomerAvailabilityReader} from './customer-availability';
describe('customer availability transaction',()=>{
 it('discards computed slots when the final capability check expires',async()=>{
  const statements:string[]=[];let checks=0;
  const client={query:async(sql:string)=>{
   statements.push(sql);
   if(sql.includes('customer_flow_availability_scope')){
    if(++checks===2)throw Object.assign(new Error('private database detail'),{code:'42501'});
    return {rows:[{scope:{tenantId:'34000000-0000-4000-8000-000000000002',serviceId:'34000000-0000-4000-8000-000000000003',timezone:'UTC',durationMinutes:60}}]};
   }
   return {rows:[]};
  },release:()=>{}};
  const reader=createCustomerAvailabilityReader({connect:async()=>client} as never,()=> '2030-01-01T00:00:00Z');
  await expect(reader('a'.repeat(64),'https://checkout.example.test','2030-01-02T00:00:00Z','2030-01-03T00:00:00Z')).rejects.toMatchObject({code:'FORBIDDEN',message:'FORBIDDEN'});
  expect(statements).toContain('rollback');expect(statements).not.toContain('commit');
 });
});
