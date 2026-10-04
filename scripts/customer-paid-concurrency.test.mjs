import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCustomerConcurrency} from './customer-paid-concurrency.mjs';
const id=n=>`37000000-0000-4000-8000-${String(n).padStart(12,'0')}`,A='A'.repeat(43),B='B'.repeat(43);
const env={BOOKING_LUMIN_HOSTED_CONCURRENCY:'1',BOOKING_LUMIN_API_BASE_URL:'https://booking-lumin-api-staging.onrender.com',BOOKING_LUMIN_CUSTOMER_ORIGIN:'https://booking-lumin-checkout-staging.netlify.app',BOOKING_LUMIN_INSTALLATION_ID:id(1),BOOKING_LUMIN_AVAILABILITY_FROM:'2030-01-02T00:00:00Z',BOOKING_LUMIN_AVAILABILITY_TO:'2030-01-03T00:00:00Z'};
const now=()=>Date.parse('2030-01-01T00:00:00Z');
function fixture({twoWinners=false,foreignReceipt=false,realProvider=false,loserPaid=false}={}){
 let sessions=0,requests=0,payments=0;const seen=[];
 const render={renderSchemaVersion:3,submissionMode:'paid_service_request',paymentMode:realProvider?'live':'staging_mock',simulated:!realProvider,versionId:id(2),service:{id:id(3),name:'Housekeeping',price:{amount:12500,currency:'USD'},durationMinutes:60}};
 const fetcher=async(url,options)=>{
  seen.push({url,options});const path=new URL(url).pathname,token=options.headers.authorization;
  const ok=data=>Response.json({ok:true,data}),deny=()=>Response.json({ok:false,code:'CONFLICT'},{status:409});
  if(path.includes('/installations/'))return ok({sessionToken:sessions++===0?A:B,render});
  if(path.endsWith('/availability'))return ok({slots:[{start:'2030-01-02T10:00:00Z',end:'2030-01-02T11:00:00Z',remainingCapacity:1}]});
  if(path.endsWith('/request'))return ok({state:'draft',confirmed:false,reference:'LMN-'+id(++requests+3).replaceAll('-','').toUpperCase()});
  if(path.endsWith('/hold'))return token===`Bearer ${A}`||twoWinners?ok({schemaVersion:1,bookingId:token===`Bearer ${A}`?id(4):id(5),holdId:id(6),status:'active',expiresAt:'2030-01-01T00:05:00Z'}):deny();
  if(path.endsWith('/mock-payment'))return token===`Bearer ${A}`||loserPaid?ok({schemaVersion:1,bookingId:foreignReceipt?id(99):id(4),paymentId:id(7),state:'confirmed',replayed:payments++>0,provider:'staging_mock',simulated:true}):deny();
  throw Error('Unexpected request');
 };
 return {fetcher,seen};
}
test('mutations require explicit opt-in and exact canonical staging scope',async()=>{for(const change of [{BOOKING_LUMIN_HOSTED_CONCURRENCY:undefined},{BOOKING_LUMIN_API_BASE_URL:'https://leadgate.example.test'},{BOOKING_LUMIN_CUSTOMER_ORIGIN:'https://foreign.example.test'},{BOOKING_LUMIN_AVAILABILITY_TO:'2030-01-05T00:00:00Z'}])await assert.rejects(runCustomerConcurrency({...env,...change},{now,fetcher:()=>{throw Error('Network must not run')}}),/CONFIG/)});
test('two-contender race preserves one hold/payment and returns no bearer or customer fields',async()=>{const f=fixture();const evidence=await runCustomerConcurrency(env,{...f,now});assert.equal(evidence.winners,1);assert.equal(evidence.losers,1);assert.equal(evidence.paymentId,id(7));assert.ok(!JSON.stringify(evidence).includes(A));assert.ok(!JSON.stringify(evidence).includes('@example.test'));for(const r of f.seen.filter(r=>r.url.endsWith('/hold')||r.url.endsWith('/mock-payment')))assert.equal(r.options.body,'{}');assert.equal(f.seen.filter(r=>r.url.endsWith('/hold')).length,2)});
test('overselling fails acceptance rather than recording a pass',async()=>{await assert.rejects(runCustomerConcurrency(env,{...fixture({twoWinners:true}),now}),/exactly one winner/)});
test('foreign successful payment receipts fail acceptance',async()=>{await assert.rejects(runCustomerConcurrency(env,{...fixture({foreignReceipt:true}),now}),/one authoritative payment/)});
test('real-provider publications cannot enable the staging payment test',async()=>{await assert.rejects(runCustomerConcurrency(env,{...fixture({realProvider:true}),now}),/simulated session/)});
test('a successful loser payment fails acceptance',async()=>{await assert.rejects(runCustomerConcurrency(env,{...fixture({loserPaid:true}),now}),/Loser payment/)});
