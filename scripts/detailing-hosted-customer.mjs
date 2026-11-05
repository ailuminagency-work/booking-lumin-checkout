import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DetailingQuoteReceipt,DetailingAvailabilityReceipt,DetailingRequestReceipt,DetailingHoldReceipt} from '@lumin/contracts';
import {DetailingCatalogRender} from '@lumin/workflow';
import {DetailingPaymentReceipt} from '../apps/api/src/detailing-payment.ts';

// Controlled customer API acceptance only. This does not certify an owner login,
// a Netlify browser journey, Portal visibility, or real provider payments.
// Run with node --import tsx so the authoritative receipt schemas are reused.
const base='https://booking-lumin-api-staging.onrender.com';
const origin='https://booking-lumin-checkout-staging.netlify.app';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if(process.env.DETAILING_HOSTED_TEST!=='1')throw Error('Explicit isolated staging test opt-in required');
const [installationId,serviceId,versionId,sha]=process.argv.slice(2);
if(![installationId,serviceId,versionId].every(v=>uuid.test(v??''))||!/^[0-9a-f]{40}$/.test(sha??''))throw Error('Explicit fixture identities and release SHA required');
let stage='runtime';
const sessionSchema=z.object({sessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:z.string().datetime({offset:true}),render:DetailingCatalogRender}).strict();
const failure=z.object({ok:z.literal(false),code:z.enum(['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','CONFLICT','NOT_AVAILABLE','UNSUPPORTED_CONFIG','INTERNAL_ERROR','RATE_LIMITED'])}).strict();
async function call(path,body,token,requestOrigin=origin,expected=200){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{origin:requestOrigin,...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
 assert.equal(response.status,expected,'Unexpected status at '+stage);
 if(path.startsWith('/api/'))assert.equal(response.headers.get('access-control-allow-origin'),requestOrigin===origin?origin:null,'Exact CORS at '+stage);
 const text=await response.text();assert.ok(text.length<262144,'Bounded response');const result=JSON.parse(text);
 if(path.startsWith('/api/')){
  if(expected!==200){failure.parse(result);return result;}
  const schema=path.endsWith('/sessions')?sessionSchema:path.endsWith('/quote')?DetailingQuoteReceipt:path.includes('/availability?')?DetailingAvailabilityReceipt:path.endsWith('/request')?DetailingRequestReceipt:path.endsWith('/hold')?DetailingHoldReceipt:DetailingPaymentReceipt;
  return z.object({ok:z.literal(true),data:schema}).strict().parse(result).data;
 }return result;
}
function bound(value){for(const [key,id] of Object.entries({installationId,serviceId,versionId}))assert.equal(value[key],id,'Bound identity '+key+' at '+stage);}
try{
 for(const [path,state] of [['/health','ok'],['/ready','ready']])assert.equal((await call(path)).status,state);
 assert.equal((await call('/version')).releaseSha,sha,'Exact deployed release');
 stage='session';const session=await call(`/api/detailing-installations/${installationId}/sessions`,{});
 assert.match(session.sessionToken,/^[A-Za-z0-9_-]{43}$/);assert.ok(Date.parse(session.expiresAt)>Date.now());
 assert.equal(session.render.versionId,versionId);assert.equal(session.render.serviceId,serviceId);assert.equal(session.render.businessType,'AUTO_DETAILING');
 const token=session.sessionToken,selection={packageId:'basic',vehicleId:'suv',addonIds:['pet-hair'],locationId:'mobile'};
 stage='quote';const quote=await call('/api/detailing-flow-sessions/quote',selection,token);bound(quote);assert.deepEqual(quote.selection,selection);assert.deepEqual(quote.pricing.total,{amount:25000,currency:'USD'});
 stage='availability';const from=new Date();from.setUTCDate(from.getUTCDate()+1);from.setUTCHours(0,0,0,0);const to=new Date(from.getTime()+86400000);
 const available=await call('/api/detailing-flow-sessions/availability?'+new URLSearchParams({from:from.toISOString(),to:to.toISOString()}),undefined,token);bound(available);
 const slot=available.slots.find(s=>s.remainingCapacity>0&&Date.parse(s.start)>Date.now());assert.ok(slot,'Available staging fixture slot');
 stage='request';const requestBody={schemaVersion:1,idempotencyKey:'hosted-detailing-'+randomUUID(),selection,customer:{name:'Fictional staging customer',email:'hosted-detailing@example.test'},requestedStart:slot.start};
 const request=await call('/api/detailing-flow-sessions/request',requestBody,token);bound(request);assert.equal(request.state,'draft');assert.equal(request.confirmed,false);assert.deepEqual(request.selection,selection);assert.deepEqual(request.pricing,quote.pricing);assert.equal(request.slot.start,slot.start);assert.equal(request.slot.end,slot.end);
 const replay=await call('/api/detailing-flow-sessions/request',requestBody,token);assert.deepEqual(replay,request,'Exact request replay');
 stage='prehold payment';await call('/api/detailing-flow-sessions/mock-payment',{},token,origin,409);
 stage='hold';const hold=await call('/api/detailing-flow-sessions/hold',{},token);bound(hold);assert.equal(hold.bookingId,request.bookingId);assert.ok(Date.parse(hold.expiresAt)>Date.now());
 stage='tamper';await call('/api/detailing-flow-sessions/mock-payment',{amount:1},token,origin,400);await call('/api/detailing-flow-sessions/mock-payment',{},token,'https://foreign.example.test',403);await call('/api/detailing-flow-sessions/mock-payment',{},undefined,origin,401);
 stage='concurrent test payment';const race=await Promise.all([call('/api/detailing-flow-sessions/mock-payment',{},token),call('/api/detailing-flow-sessions/mock-payment',{},token)]);
 assert.deepEqual(race.map(r=>r.replayed).sort(),[false,true]);assert.equal(race[0].paymentId,race[1].paymentId);
 for(const r of race){bound(r);assert.equal(r.bookingId,request.bookingId);assert.equal(r.provider,'staging_mock');assert.equal(r.simulated,true);assert.equal(r.state,'confirmed');}
 stage='confirmation replay';const confirmed=await call('/api/detailing-flow-sessions/confirm',{},token);assert.deepEqual(confirmed,{...race[0],replayed:true});assert.deepEqual(await call('/api/detailing-flow-sessions/mock-payment',{},token),confirmed);
 console.log(JSON.stringify({result:'PASS',scope:'controlled hosted customer API',releaseSha:sha,installationId,serviceId,versionId,bookingId:request.bookingId,paymentId:confirmed.paymentId,slot:{start:request.slot.start,end:request.slot.end},totalMinor:25000,currency:'USD',simulated:true,requestReplay:true,concurrentOnePayment:true,confirmationReplay:true,tamper400:true,foreignOrigin403:true,unauthenticated401:true,ownerAcceptance:false,frontendAcceptance:false,portalVisibility:false,secretsPrinted:false}));
}catch{console.error(JSON.stringify({result:'FAIL',stage,secretsPrinted:false,automaticRetry:false}));process.exitCode=1;}
