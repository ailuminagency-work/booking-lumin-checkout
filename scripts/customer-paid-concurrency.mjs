import {pathToFileURL} from 'node:url';
const API='https://booking-lumin-api-staging.onrender.com';
const ORIGIN='https://booking-lumin-checkout-staging.netlify.app';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
function check(condition,label){if(!condition)throw Error(label);}
function receipt(r,booking){return r.status===200&&exact(r.data,['schemaVersion','bookingId','paymentId','state','replayed','provider','simulated'])&&r.data.schemaVersion===1&&r.data.bookingId===booking&&uuid(r.data.paymentId)&&r.data.state==='confirmed'&&typeof r.data.replayed==='boolean'&&r.data.provider==='staging_mock'&&r.data.simulated===true;}
/** Two contenders only. No credentials or customer fields leave this function. */
export async function runCustomerConcurrency(env,{fetcher=fetch,now=Date.now,timeoutMs=10000}={}){
 check(env.BOOKING_LUMIN_HOSTED_CONCURRENCY==='1','CONFIG: explicit staging concurrency opt-in required');
 check(env.BOOKING_LUMIN_API_BASE_URL===API&&env.BOOKING_LUMIN_CUSTOMER_ORIGIN===ORIGIN,'CONFIG: only canonical Booking Lumin staging targets are allowed');
 const installation=env.BOOKING_LUMIN_INSTALLATION_ID;
 check(uuid(installation),'CONFIG: published test installation required');
 const start=Date.parse(env.BOOKING_LUMIN_AVAILABILITY_FROM),end=Date.parse(env.BOOKING_LUMIN_AVAILABILITY_TO);
 check(Number.isFinite(start)&&Number.isFinite(end)&&start>now()&&end>start&&end-start<=86400000,'CONFIG: explicit future availability interval of at most one day required');
 async function call(path,token,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetcher(API+path,{method:body===undefined?'GET':'POST',redirect:'error',signal:controller.signal,headers:{origin:ORIGIN,accept:'application/json',...(token?{authorization:`Bearer ${token}`}:{ }),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   check(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''),'Response format was not verified');
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;check(size<=262144,'Response exceeded limit');chunks.push(item.value)}}finally{await reader.cancel().catch(()=>{})}
   const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(response.ok){check(exact(value,['ok','data'])&&value.ok===true,'Success envelope was not verified');return {status:response.status,data:value.data}}
   check(exact(value,['ok','code'])&&value.ok===false&&typeof value.code==='string','Failure envelope was not verified');return {status:response.status,code:value.code};
  }catch(error){if(error instanceof Error&&/^(CONFIG:|Response |Success |Failure )/.test(error.message))throw error;throw Error('Staging request could not be verified; do not automatically replay mutations');}
  finally{clearTimeout(timer);controller.abort()}
 }
 const customers=[];
 for(let i=0;i<2;i++){
  const s=await call(`/api/installations/${installation}/sessions`,undefined,{});
  check(s.status===200&&s.data?.render?.renderSchemaVersion===3&&s.data.render.paymentMode==='staging_mock'&&s.data.render.simulated===true&&uuid(s.data.render.versionId)&&uuid(s.data.render.service?.id)&&Number.isSafeInteger(s.data.render.service?.price?.amount)&&s.data.render.service.price.amount>0&&typeof s.data.sessionToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s.data.sessionToken),'Published simulated session was not verified');
  customers.push({token:s.data.sessionToken,render:s.data.render});
 }
 check(JSON.stringify(customers[0].render)===JSON.stringify(customers[1].render),'Contenders received different published snapshots');
 const query=new URLSearchParams({from:new Date(start).toISOString(),to:new Date(end).toISOString()});
 const availability=await call('/api/flow-sessions/availability?'+query,customers[0].token);
 check(availability.status===200&&Array.isArray(availability.data?.slots),'Availability was not verified');
 const slot=availability.data.slots.find(s=>s.remainingCapacity===1&&Date.parse(s.start)>=start&&Date.parse(s.start)<end);
 check(slot&&Number.isFinite(Date.parse(slot.end))&&Date.parse(slot.end)>Date.parse(slot.start),'No single-capacity test slot available');
 for(let i=0;i<2;i++){
  const c=customers[i],key=crypto.randomUUID();
  const r=await call('/api/flow-sessions/request',c.token,{idempotencyKey:key,answers:{},customer:{name:`Concurrency staging contender ${i+1}`,email:`concurrency-${key}@example.test`},requestedStart:slot.start});
  check(r.status===200&&r.data?.state==='draft'&&r.data.confirmed===false&&/^LMN-[0-9A-F]{32}$/.test(r.data.reference),'Draft request was not verified');
  c.booking=r.data.reference.slice(4).toLowerCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
 }
 const holds=await Promise.all(customers.map(c=>call('/api/flow-sessions/hold',c.token,{})));
 const winners=holds.map((h,i)=>h.status===200?i:-1).filter(i=>i>=0);
 check(winners.length===1,'Capacity race did not produce exactly one winner');
 const win=winners[0],lose=1-win,winner=customers[win],loser=customers[lose];
 check([404,409].includes(holds[lose].status)&&['NOT_AVAILABLE','CONFLICT'].includes(holds[lose].code),'Losing contender was not denied by capacity authority');
 check(exact(holds[win].data,['schemaVersion','bookingId','holdId','status','expiresAt'])&&holds[win].data.schemaVersion===1&&holds[win].data.bookingId===winner.booking&&uuid(holds[win].data.holdId)&&holds[win].data.status==='active'&&Date.parse(holds[win].data.expiresAt)>now(),'Winning hold identity was not verified');
 const payments=await Promise.all([call('/api/flow-sessions/mock-payment',winner.token,{}),call('/api/flow-sessions/mock-payment',winner.token,{})]);
 check(payments.every(p=>receipt(p,winner.booking))&&payments[0].data.paymentId===payments[1].data.paymentId&&payments.filter(p=>p.data.replayed===false).length===1,'Concurrent payment did not preserve one authoritative payment');
 const denied=await call('/api/flow-sessions/mock-payment',loser.token,{});
 check([404,409].includes(denied.status)&&['NOT_AVAILABLE','CONFLICT'].includes(denied.code),'Loser payment was not denied');
 return {api:API,origin:ORIGIN,installation,version:customers[0].render.versionId,slot:slot.start,winnerBookingId:winner.booking,loserBookingId:loser.booking,holdId:holds[win].data.holdId,paymentId:payments[0].data.paymentId,winners:1,losers:1,duplicatePaymentId:false,simulated:true,ownerPortal:'NOT_CERTIFIED'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await runCustomerConcurrency(process.env)))}catch(error){console.error(error instanceof Error?error.message:'Staging concurrency failed');process.exitCode=1}}
