import {expect,it} from 'vitest';
import {ConfirmationReceiptHistory} from './confirmation-receipt-history';
const tenantId='ab000000-0000-4000-8000-000000000002',bookingId='cd000000-0000-4000-8000-000000000003';
const email={channel:'email',recordedAt:'2026-10-01T12:34:56.123456Z'},sms={channel:'sms',recordedAt:'2026-10-02T01:02:03Z'};
const value={schemaVersion:1,tenantId,bookingId,receipts:[email,sms]};
it.each([[],[email],[sms],[email,sms]].map(receipts=>({receipts})))('preserves only actual historical rows and microsecond UTC timestamps',({receipts})=>{
 const result=ConfirmationReceiptHistory.parse({...value,tenantId:tenantId.toUpperCase(),bookingId:bookingId.toUpperCase(),receipts});
 expect(result).toEqual({...value,receipts});expect(JSON.stringify(result)).not.toMatch(/recipient|provider|delivered|simulated|payload|receiptRecorded/);
});
it.each([
 {...value,schemaVersion:2},{...value,tenantId:'foreign'},{...value,bookingId:null},{...value,delivered:true},
 {...value,receipts:[sms,email]},{...value,receipts:[email,email]},{...value,receipts:[sms,sms]},{...value,receipts:[email,sms,email]},
 {...value,receipts:[{...email,recipient:'private@example.test'}]},{...value,receipts:[{...email,channel:'push'}]},
 ...[null,'infinity','2026-02-30T12:34:56Z','2026-10-01T12:34:56+00:00','2026-10-01T12:34:56','2026-10-01T12:34:56.1234567Z',new Date('2026-10-01T12:34:56Z')].map(recordedAt=>({...value,receipts:[{...email,recordedAt}]})),
])('rejects widened, reordered, duplicate or invalid history claims',input=>expect(ConfirmationReceiptHistory.safeParse(input).success).toBe(false));
