import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createFlowHttpServer} from './http';
import {createFlowRepository} from './repository';
import {createCustomerAvailabilityReader} from './customer-availability';
import {createCustomerHoldWriter} from './customer-hold';
import {createCustomerMockPayment,createCustomerConfirmation} from './customer-payment';
assert.equal(process.env.PAID_OPTION_LOCAL_TEST,'1');
if(process.env.CI==='true'){assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST??''));assert.equal(process.env.PGPORT,'5432');assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_option_/);}
else{assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55436');assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_option_/);}
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const pool=new Pool({max:8}),id=(n:number)=>`42000000-0000-4000-8000-${String(n).padStart(12,'0')}`,ownerOrigin='https://portal.example.test',customerOrigin='https://checkout.example.test';
const env={BOOKING_LUMIN_ENV:'staging',BOOKING_LUMIN_FAKE_PAYMENTS:'1'};
const server=createFlowHttpServer({repository:createFlowRepository(pool),ownerOrigins:[ownerOrigin],customerOrigins:[customerOrigin],authenticateOwner:async token=>token==='owner-token-123456'?id(1):token==='foreign-token-123456'?id(99):null,paidSimplePublication:true,customerAvailability:createCustomerAvailabilityReader(pool),customerHold:createCustomerHoldWriter(pool),customerMockPayment:createCustomerMockPayment(pool,env),customerConfirmation:createCustomerConfirmation(pool)});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
async function post(path:string,body:unknown,token?:string,origin=customerOrigin){const response=await fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return{status:response.status,json:await response.json()};}
const publish=(n:number,token='owner-token-123456')=>post(`/api/paid-option-flows/${id(n)}/publish?tenantId=${id(2)}`,{serviceId:id(3),name:'Paid housekeeping',allowedOrigins:[customerOrigin]},token,ownerOrigin);
const request=(token:string,key:string,start:string)=>post('/api/flow-sessions/request',{idempotencyKey:key,answers:{access:{choiceIds:['present']}},customer:{name:'Customer',email:key+'@example.test'},requestedStart:start},token);
try{
 await pool.query(`insert into auth.users(id,email) values($1,'paid-owner@example.test'),($2,'foreign-owner@example.test')`,[id(1),id(99)]);
 await pool.query(`insert into public.tenants(id,name,slug,timezone,currency) values($1,'Paid','paid-option-fixture','UTC','USD'),($2,'Foreign','paid-option-foreign-fixture','UTC','USD')`,[id(2),id(20)]);
 await pool.query(`insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($3,$4,'BUSINESS_OWNER')`,[id(2),id(1),id(20),id(99)]);
 await pool.query(`insert into public.services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1,$2,'Housekeeping','simple','USD',12500,60)`,[id(3),id(2)]);
 await pool.query(`insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,choices) values($1,$2,'access','Will someone be present?','single_choice',true,$3::jsonb)`,[id(2),id(3),JSON.stringify([{id:'present',label:'Someone present',priceDelta:0,priceMultiplierBp:10000},{id:'key',label:'Key provided',priceDelta:0,priceMultiplierBp:10000}])]);
 await pool.query(`insert into public.scheduling_policies(tenant_id,service_id,lead_time_minutes,horizon_days,slot_interval_minutes) values($1,$2,0,30,30)`,[id(2),id(3)]);
 await pool.query(`insert into public.availability_rules(tenant_id,service_id,weekday,start_minute,end_minute,capacity) select $1,$2,n,0,1440,1 from generate_series(0,6)n`,[id(2),id(3)]);
 assert.equal((await publish(4,'foreign-token-123456')).status,403);
 const legacy=await post(`/api/paid-simple-flows/${id(80)}/publish?tenantId=${id(2)}`,{serviceId:id(3),name:'V3 rejects questions',allowedOrigins:[customerOrigin]},'owner-token-123456',ownerOrigin);assert.equal(legacy.status,422);
 assert.equal((await publish(4,'foreign-token-123456')).status,403);
 const publication=await publish(4);assert.equal(publication.status,200,JSON.stringify(publication));assert.equal(publication.json.data.renderSchemaVersion,4);assert.equal((await publish(4)).status,409);
 const installation=publication.json.data.installationId;
 const session=await post(`/api/installations/${installation}/sessions`,{});assert.equal(session.status,200,JSON.stringify(session));const token=session.json.data.sessionToken;
 assert.deepEqual(session.json.data.render.service.price,{amount:12500,currency:'USD'});assert.equal(session.json.data.render.paymentMode,'staging_mock');assert.equal(session.json.data.render.simulated,true);
 const tomorrow=new Date();tomorrow.setUTCDate(tomorrow.getUTCDate()+1);tomorrow.setUTCHours(0,0,0,0);const from=tomorrow.toISOString(),to=new Date(+tomorrow+86400000).toISOString();
 const availability=await fetch(base+'/api/flow-sessions/availability?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),{headers:{origin:customerOrigin,authorization:`Bearer ${token}`}});assert.equal(availability.status,200);const slots=(await availability.json()).data.slots;assert.ok(slots.length);const start=slots.find((s:{start:string})=>s.start.includes('T10:00:00'))?.start??slots[0].start;
 for(const answers of [{},{access:{choiceIds:['unknown']}},{access:{choiceIds:['present','key']}},{other:{choiceIds:['present']}},{access:{choiceIds:['present'],price:1}},{access:{quantity:1}}]){
  assert.equal((await post('/api/flow-sessions/request',{idempotencyKey:'invalid-answers-0001',answers,customer:{name:'Customer',email:'invalid@example.test'},requestedStart:start},token)).status,400);
 }
 assert.equal(Number((await pool.query('select count(*) n from public.bookings')).rows[0].n),0);
 const submitted=await request(token,'paid-journey-00001',start);assert.equal(submitted.status,200,JSON.stringify(submitted));assert.deepEqual(await request(token,'paid-journey-00001',start),submitted);
 assert.equal((await post('/api/flow-sessions/request',{idempotencyKey:'paid-journey-00001',answers:{access:{choiceIds:['present']}},customer:{name:'Customer',email:'paid-journey-00001@example.test'},requestedStart:start,amount:1},token)).status,400);
 assert.equal((await post('/api/flow-sessions/request',{idempotencyKey:'paid-journey-00001',answers:{access:{choiceIds:['key']}},customer:{name:'Customer',email:'paid-journey-00001@example.test'},requestedStart:start},token)).status,409);
 const hold=await post('/api/flow-sessions/hold',{},token);assert.equal(hold.status,200,JSON.stringify(hold));assert.deepEqual(await post('/api/flow-sessions/hold',{},token),hold);
 const booking=hold.json.data.bookingId;assert.deepEqual((await pool.query('select tenant_id,selection,state,pricing from public.bookings where id=$1',[booking])).rows[0],{tenant_id:id(2),selection:{serviceId:id(3),answers:{access:{choiceIds:['present']}}},state:'draft',pricing:{}});
 assert.equal((await post('/api/flow-sessions/mock-payment',{amount:1},token)).status,400);assert.equal((await post('/api/flow-sessions/mock-payment',{},'b'.repeat(43))).status,403);assert.equal((await post('/api/flow-sessions/mock-payment',{},token,'https://foreign.example.test')).status,403);
 await pool.query("update public.bookings set selection=jsonb_set(selection,'{answers,access,choiceIds}','[\"key\"]') where id=$1",[booking]);assert.equal((await post('/api/flow-sessions/mock-payment',{},token)).status,422);assert.equal(Number((await pool.query('select count(*) n from public.payments where booking_id=$1',[booking])).rows[0].n),0);await pool.query("update public.bookings set selection=jsonb_set(selection,'{answers,access,choiceIds}','[\"present\"]') where id=$1",[booking]);
 const paid=await post('/api/flow-sessions/mock-payment',{},token);assert.equal(paid.status,200,JSON.stringify(paid));assert.deepEqual(paid.json.data,{schemaVersion:1,bookingId:booking,paymentId:paid.json.data.paymentId,state:'confirmed',replayed:false,provider:'staging_mock',simulated:true});
 const replay=await post('/api/flow-sessions/mock-payment',{},token);assert.equal(replay.status,200);assert.equal(replay.json.data.replayed,true);assert.equal(replay.json.data.paymentId,paid.json.data.paymentId);
 const confirmed=await post('/api/flow-sessions/confirm',{},token);assert.equal(confirmed.status,200);assert.equal(confirmed.json.data.replayed,true);assert.equal(confirmed.json.data.bookingId,booking);assert.equal(confirmed.json.data.paymentId,paid.json.data.paymentId);
 assert.equal((await pool.query('select status from public.capacity_holds where booking_id=$1',[booking])).rows[0].status,'consumed');assert.equal((await pool.query('select state,pricing from public.bookings where id=$1',[booking])).rows[0].state,'confirmed');
 assert.deepEqual((await pool.query('select amount::int,currency,provider,state from public.payments where booking_id=$1',[booking])).rows[0],{amount:12500,currency:'USD',provider:'staging_mock',state:'succeeded'});
 // Catalog drift cannot silently charge a different current price, including on a confirmed replay.
 await pool.query('update public.services set base_price=13000 where id=$1',[id(3)]);assert.equal((await post('/api/flow-sessions/mock-payment',{},token)).status,422);assert.equal((await post(`/api/installations/${installation}/sessions`,{})).status,422);await pool.query('update public.services set base_price=12500 where id=$1',[id(3)]);
 // Exact installed question IDs, labels and zero-price effects cannot drift.
 const storedChoices=(await pool.query('select choices from public.service_questions where service_id=$1',[id(3)])).rows[0].choices;
 for(const [path,value] of [['{0,label}',JSON.stringify('Changed label')],['{0,id}',JSON.stringify('changed-id')],['{0,priceDelta}','1'],['{0,priceMultiplierBp}','20000']]){
  await pool.query('update public.service_questions set choices=jsonb_set(choices,$2::text[],$3::jsonb) where service_id=$1',[id(3),path,value]);
  assert.equal((await post(`/api/installations/${installation}/sessions`,{})).status,422);assert.equal((await request(token,'paid-journey-00001',start)).status,422);assert.equal((await post('/api/flow-sessions/mock-payment',{},token)).status,422);
  await pool.query('update public.service_questions set choices=$2::jsonb where service_id=$1',[id(3),JSON.stringify(storedChoices)]);
 }
 // A second real request tests rollback if session expires while test payment is blocked.
 const session2=await post(`/api/installations/${installation}/sessions`,{}),token2=session2.json.data.sessionToken;
 const start2=new Date(Date.parse(start)+2*3600000).toISOString();assert.equal((await request(token2,'paid-journey-00002',start2)).status,200);const hold2=await post('/api/flow-sessions/hold',{},token2);assert.equal(hold2.status,200);const booking2=hold2.json.data.bookingId;
 await pool.query(`update public.flow_sessions set expires_at=clock_timestamp()+interval '2 seconds' where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,[token2]);
 const blocker=await pool.connect();try{
 await blocker.query('begin');await blocker.query('lock table public.payments in share row exclusive mode');const pending=post('/api/flow-sessions/mock-payment',{},token2);let waiting=false;
 for(let i=0;i<100;i++){waiting=(await pool.query(`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query='lock table public.payments in share row exclusive mode') waiting`)).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(waiting,'actual HTTP mock transaction waited at existing payment serialization');await new Promise(r=>setTimeout(r,2100));await blocker.query('rollback');assert.equal((await pending).status,403);
 }finally{await blocker.query('rollback');blocker.release();}
 assert.equal(Number((await pool.query('select count(*) n from public.payments where booking_id=$1',[booking2])).rows[0].n),0);assert.equal((await pool.query('select state,pricing,payment_id from public.bookings where id=$1',[booking2])).rows[0].state,'draft');assert.equal((await pool.query('select status from public.capacity_holds where booking_id=$1',[booking2])).rows[0].status,'active');
 // Hold expiry while an otherwise-valid session waits must also roll back all financial writes.
 const token3=(await post(`/api/installations/${installation}/sessions`,{})).json.data.sessionToken,start3=new Date(Date.parse(start)+4*3600000).toISOString();assert.equal((await request(token3,'paid-journey-00003',start3)).status,200);const booking3=(await post('/api/flow-sessions/hold',{},token3)).json.data.bookingId;
 await pool.query("update public.capacity_holds set expires_at=clock_timestamp()+interval '2 seconds' where booking_id=$1",[booking3]);
 const holdBlocker=await pool.connect();try{await holdBlocker.query('begin');await holdBlocker.query('lock table public.payments in share row exclusive mode');const pending=post('/api/flow-sessions/mock-payment',{},token3);let waiting=false;
 for(let i=0;i<100;i++){waiting=(await pool.query(`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query='lock table public.payments in share row exclusive mode') waiting`)).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
 assert.ok(waiting);await new Promise(r=>setTimeout(r,2100));await holdBlocker.query('rollback');assert.equal((await pending).status,409);
 }finally{await holdBlocker.query('rollback');holdBlocker.release();}
 assert.equal(Number((await pool.query('select count(*) n from public.payments where booking_id=$1',[booking3])).rows[0].n),0);assert.deepEqual((await pool.query('select state,pricing,payment_id from public.bookings where id=$1',[booking3])).rows[0],{state:'draft',pricing:{},payment_id:null});
 await pool.query(`update public.flow_sessions set revoked=true where token_hash=encode(sha256(convert_to($1,'UTF8')),'hex')`,[token]);assert.equal((await post('/api/flow-sessions/confirm',{},token)).status,403);
 console.log('PASS real HTTP paid V4 zero-price choice owner publication/session/availability/request/exact selection/hold/server12500 test-payment/consumed confirmation/replays, foreign denial, pinned price drift, blocked payment expiry full rollback; no real provider');
}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
