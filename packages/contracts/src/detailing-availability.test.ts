import {describe,it,expect} from 'vitest';
import {DetailingAvailabilityQuery,DetailingAvailabilityReceipt} from './detailing-availability';
const id=(n:number)=>`65000000-0000-4000-8000-${String(n).padStart(12,'0')}`,from='2030-01-02T00:00:00.000Z',to='2030-01-03T00:00:00.000Z';
const receipt={schemaVersion:1,versionId:id(1),installationId:id(2),serviceId:id(3),expiresAt:to,durationMinutes:60,timezone:'UTC',slots:[{start:'2030-01-02T09:00:00.000Z',end:'2030-01-02T10:00:00.000Z',remainingCapacity:1}]};
describe('closed Detailing availability contract',()=>{
 it('accepts canonical bounded ranges and capacity-one ordered slots',()=>{expect(DetailingAvailabilityQuery.parse({from,to})).toEqual({from,to});expect(DetailingAvailabilityReceipt.parse(receipt)).toEqual(receipt);expect(DetailingAvailabilityReceipt.parse({...receipt,slots:[]})).toMatchObject({slots:[]});});
 it.each([{from,to:from},{from:to,to:from},{from,to:'2030-01-10T00:00:00.000Z'},{from:from.replace('.000',''),to},{from:from.replace('Z','+00:00'),to},{from,to,tenantId:id(8)},{from,to,serviceId:id(8)}])('rejects noncanonical/unbounded/client authority query %j',q=>expect(DetailingAvailabilityQuery.safeParse(q).success).toBe(false));
 it.each([{...receipt,tenantId:id(8)},{...receipt,total:1},{...receipt,timezone:'invalid'},{...receipt,slots:[{...receipt.slots[0],remainingCapacity:2}]},{...receipt,slots:[{...receipt.slots[0],end:to}]},{...receipt,slots:[...receipt.slots,...receipt.slots]},{...receipt,slots:[{...receipt.slots[0],price:1}]}])('rejects malformed or non-authoritative receipt %j',r=>expect(DetailingAvailabilityReceipt.safeParse(r).success).toBe(false));
});
