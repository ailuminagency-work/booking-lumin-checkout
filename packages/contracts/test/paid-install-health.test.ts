import {describe,expect,it} from 'vitest';
import {PaidInstallHealth} from '../src/paid-install-health';
const id='48000000-0000-4000-8000-000000000001',receipt={versionId:id,installationId:id,renderSchemaVersion:3,hostedPath:`/checkout/flow/${id}`};
const good={schemaVersion:1,flowId:id,versionId:id,renderSchemaVersion:3,status:'unknown',installation:{status:'available',receipt},catalog:{status:'compatible'},customerEvidence:{issuedSessionCount:0,sessionCountCapped:false,lastSuccessfulLoadAt:null,loadEvidence:'unavailable',confirmedStagingBookingCount:0,bookingCountCapped:false,lastConfirmedStagingBookingAt:null},testPayment:{mode:'staging_mock',simulated:true,enabled:true}};
describe('strict owner evidence contract',()=>{
 it('accepts unknown compatible evidence',()=>expect(PaidInstallHealth.safeParse(good).success).toBe(true));
 it.each([{status:'healthy'},{token:'secret'},{installation:{status:'available',receipt:null}},{installation:{status:'available',receipt:{...receipt,hostedPath:'https://foreign.test'}}},{customerEvidence:{...good.customerEvidence,lastSuccessfulLoadAt:'2026-10-04T00:00:00Z'}},{customerEvidence:{...good.customerEvidence,sessionCountCapped:true}},{customerEvidence:{...good.customerEvidence,confirmedStagingBookingCount:1}},{testPayment:{mode:'live',simulated:false,enabled:true}}])('rejects widened or fabricated evidence %j',change=>expect(PaidInstallHealth.safeParse({...good,...change}).success).toBe(false));
});
