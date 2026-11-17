import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runHostedOptionSmoke} from './phase-a-hosted-option-smoke.mjs';
const sha='a'.repeat(40),now=Date.parse('2030-01-01T00:00:00.000Z'),from='2030-01-02T00:00:00.000Z',start='2030-01-02T10:00:00.000Z',end='2030-01-02T11:00:00.000Z';
const service='fbdff55f-86f9-4260-b525-741f876aa1de',installation='c52f77b7-dcfd-4280-b52d-1714514873c8';
const env={BOOKING_LUMIN_OPTION_HOSTED_TEST:'1',BOOKING_LUMIN_OPTION_EXPECTED_RELEASE_SHA:sha,BOOKING_LUMIN_OPTION_WINDOW_START:from};
const version={schemaVersion:1,service:'booking-lumin-api',environment:'staging',releaseSha:sha};
const slots=[{start,end,remainingCapacity:1}],available={schemaVersion:1,serviceId:service,durationMinutes:60,slots};
const refs=['LMN-'+('1'.repeat(32)),'LMN-'+('2'.repeat(32))],booking='11111111-1111-1111-1111-111111111111',payment='33333333-3333-4333-8333-333333333333';
function fixture({versionValue=version,availabilityValue=available,secondAvailability=availabilityValue,failPath,sessionChange={}}={}){
 const calls=[];let issued=0,saved=0,held=0,paid=0,reads=0;
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});const path=new URL(url).pathname,body=options.body===undefined?undefined:JSON.parse(options.body);
  if(path===failPath)throw Error('private server detail');
  if(path==='/version')return json(versionValue);
  if(path==='/health'||path==='/ready')return json({status:path==='/health'?'ok':'ready'});
  if(path.endsWith('/sessions')){
   if(options.headers.origin==='https://foreign.example.test')return json({ok:false,code:'FORBIDDEN'},403);
   return json({ok:true,data:{sessionToken:(++issued===1?'s':'t').repeat(43),expiresAt:'2030-01-02T23:59:00.000Z',render:{renderSchemaVersion:4,submissionMode:'paid_option_request',paymentMode:'staging_mock',simulated:true,service:{id:service,durationMinutes:60,price:{amount:12500,currency:'USD'}},...sessionChange}}});
  }
  if(path.endsWith('/availability'))return json({ok:true,data:++reads===1?availabilityValue:secondAvailability});
  if(path.endsWith('/request')){
   if(!options.headers.authorization)return json({ok:false,code:'UNAUTHENTICATED'},401);
   const choice=body.answers.access.choiceIds[0];if(choice==='forged')return json({ok:false,code:'INVALID_REQUEST'},400);
   if(choice==='present')return json({ok:false,code:'CONFLICT'},409);
   return json({ok:true,data:{reference:refs[saved++],state:'draft',confirmed:false}});
  }
  if(path.endsWith('/hold'))return ++held===1?json({ok:true,data:{schemaVersion:1,bookingId:booking,holdId:payment,status:'active',expiresAt:'2030-01-02T23:59:00.000Z'}}):json({ok:false,code:'CONFLICT'},409);
  if(path.endsWith('/mock-payment'))return json({ok:true,data:{schemaVersion:1,bookingId:booking,paymentId:payment,state:'confirmed',replayed:paid++>0,provider:'staging_mock',simulated:true}});
  throw Error('unexpected fixed staging path');
 };
 return{calls,fetchImpl};
}
test('import has no network side effects and missing gates prevent even a version request',async()=>{
 for(const change of [{BOOKING_LUMIN_OPTION_HOSTED_TEST:undefined},{BOOKING_LUMIN_OPTION_EXPECTED_RELEASE_SHA:undefined},{BOOKING_LUMIN_OPTION_EXPECTED_RELEASE_SHA:'A'.repeat(40)},{BOOKING_LUMIN_OPTION_EXPECTED_RELEASE_SHA:sha+'x'},{BOOKING_LUMIN_OPTION_WINDOW_START:'invalid'},{BOOKING_LUMIN_OPTION_WINDOW_START:'2029-12-31T00:00:00.000Z'},{BOOKING_LUMIN_OPTION_WINDOW_START:'2030-02-01T00:00:00.000Z'}]){
  const f=fixture();await assert.rejects(runHostedOptionSmoke({...env,...change},{...f,now}));assert.equal(f.calls.length,0);
 }
});
for(const change of [{releaseSha:'b'.repeat(40)},{environment:'production'},{service:'leadgate-api'},{schemaVersion:2},{extra:'private'}])test('fails closed before any session or writer for wrong version '+Object.keys(change)[0],async()=>{
 const f=fixture({versionValue:{...version,...change}});await assert.rejects(runHostedOptionSmoke(env,{...f,now}));assert.deepEqual(f.calls.map(c=>[new URL(c.url).pathname,c.options.method]),[['/version','GET']]);
});
test('uses a common fresh server slot rather than the input window, preserves fixed staging isolation and explicit adversarial/replay checks',async()=>{
 const f=fixture(),result=await runHostedOptionSmoke(env,{...f,now,createId:()=> 'controlled-idempotency-key'});
 assert.equal(result.result,'PASS');assert.equal(result.start,start);assert.notEqual(result.start,from);assert.equal(result.releaseSha,sha);
 assert.equal(result.ownerAcceptance,false);assert.equal(result.frontendAcceptance,false);assert.equal(result.portalVisibility,false);
 assert.equal(result.installation,installation);assert.equal(result.paymentReplay,'same payment and booking');assert.deepEqual(result.holdStatuses,[200,409]);
 const reads=f.calls.filter(c=>new URL(c.url).pathname.endsWith('/availability'));assert.equal(reads.length,2);
 for(const {url,options} of reads){const query=new URL(url).searchParams;assert.equal(query.get('from'),from);assert.equal(query.get('to'),'2030-01-03T00:00:00.000Z');assert.equal(options.method,'GET');assert.match(options.headers.authorization,/^Bearer [st]{43}$/);}
 for(const {url,options} of f.calls){assert.equal(new URL(url).origin,'https://booking-lumin-api-staging.onrender.com');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');assert.ok(options.signal);assert.ok(!url.includes('Bearer'));}
 for(const c of f.calls.filter(c=>new URL(c.url).pathname.endsWith('/request'))){assert.equal(JSON.parse(c.options.body).requestedStart,start);}
 assert.ok(!JSON.stringify(result).includes('s'.repeat(43)));assert.ok(!JSON.stringify(result).includes('option-race-'));
});
for(const invalid of [
 {...available,serviceId:installation},{...available,durationMinutes:30},{...available,slots:[]},{...available,slots:[{start,end,remainingCapacity:2}]},
 {...available,slots:[{start:'invalid',end,remainingCapacity:1}]},{...available,slots:[{start:from,end,remainingCapacity:1}]},
 {...available,slots:[{start,end,remainingCapacity:0}]},{...available,slots:[{start,end,remainingCapacity:1.5}]},
 {...available,slots:[{start,end,remainingCapacity:1,secret:'private'}]},{...available,slots:[slots[0],slots[0]]},
 {...available,slots:[{start:'2030-01-03T01:00:00.000Z',end:'2030-01-03T02:00:00.000Z',remainingCapacity:1}]},
])test('invalid or empty availability prevents booking, hold and payment '+JSON.stringify(invalid.slots),async()=>{
 const f=fixture({availabilityValue:invalid});await assert.rejects(runHostedOptionSmoke(env,{...f,now}));assert.equal(f.calls.filter(c=>['/api/flow-sessions/request','/api/flow-sessions/hold','/api/flow-sessions/mock-payment'].includes(new URL(c.url).pathname)).length,0);
});
test('nonoverlapping availability prevents writers',async()=>{
 const f=fixture({secondAvailability:{...available,slots:[{start:end,end:'2030-01-02T12:00:00.000Z',remainingCapacity:1}]}});await assert.rejects(runHostedOptionSmoke(env,{...f,now}));assert.equal(f.calls.filter(c=>new URL(c.url).pathname.endsWith('/request')).length,0);
});
test('a writer transport failure stops without automatic replay or later financial calls',async()=>{
 const f=fixture({failPath:'/api/flow-sessions/request'});await assert.rejects(runHostedOptionSmoke(env,{...f,now}));assert.equal(f.calls.filter(c=>new URL(c.url).pathname.endsWith('/request')).length,1);assert.equal(f.calls.filter(c=>new URL(c.url).pathname.endsWith('/mock-payment')).length,0);
});
test('real payment mode rejects before availability or booking writers',async()=>{
 const f=fixture({sessionChange:{paymentMode:'live'}});await assert.rejects(runHostedOptionSmoke(env,{...f,now}));assert.equal(f.calls.filter(c=>new URL(c.url).pathname.startsWith('/api/flow-sessions/')).length,0);
});
