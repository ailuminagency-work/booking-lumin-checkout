// Synthetic local PostgreSQL evidence, never provider capture evidence.
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {createStripePaymentProvider,signStripeTestWebhook} from '../../../packages/adapters/src/stripePayment.ts';
import {normalizeStripeReceiptCandidate} from '../../../packages/adapters/src/stripeReceiptCandidate.internal.ts';
import pg from 'pg';
import {normalizeStripeRefundReceiptCandidateV3} from '../../../packages/adapters/src/stripeRefundReceiptCandidateV3.internal.ts';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??'')) throw Error('Disposable loopback database required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS']) if(process.env[k]) throw Error(`Unexpected ${k}`);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,statement_timeout:5000};
const db=new pg.Client(config), a=new pg.Client(config),b=new pg.Client(config);await Promise.all([db.connect(),a.connect(),b.connect()]);
let passed=0;const ok=label=>{passed++;console.log('PASS',label)};
async function seed(state='processing',hold='active',options={}){
 const t=options.owner?.t??randomUUID(),s=options.owner?.s??randomUUID(),booking=randomUUID(),payment=randomUUID();
 if(!options.owner)await db.query("insert into tenants(id,name,slug,timezone,currency) values($1::uuid,'Synthetic processing authority',$1::uuid::text,'UTC','USD')",[t]);
 if(!options.owner)await db.query("insert into services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1::uuid,$2,'Test','simple','USD',100,60)",[s,t]);
 await db.query(`insert into bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state) values($1::uuid,$2,$1::uuid::text,$1::uuid::text,$3,'{"total":{"amount":100,"currency":"USD"}}','2035-05-01T10:00Z','2035-05-01T11:00Z','pending_payment')`,[booking,t,JSON.stringify({serviceId:s})]);
 await db.query("insert into payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'stripe_connect',$1::uuid::text,$4,100,'USD')",[payment,t,booking,state]);
 if(hold!=='missing')await db.query("insert into capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1::uuid,$2,$3,'2035-05-01T10:00Z','2035-05-01T11:00Z',$3::uuid::text,$4,clock_timestamp()+$5::interval)",[t,s,booking,hold==='expired'?'active':hold,hold==='expired'?'-1 minute':'10 minutes']);
 await db.query('delete from payments where id=$1',[payment]);
 const suffix=t.replaceAll('-',''); const account=options.account??('acct_'+suffix), platform='acct_platformAAA';
 if(!options.owner)await db.query("insert into payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected',$2,true)",[t,account]);
 const source=(await a.query('select id from register_payment_source_scope($1,$2,$3)',[t,platform,options.mode??false])).rows[0].id;
 const attempt=(await a.query('select id from bind_booking_payment_source($1,$2,$3)',[t,booking,source])).rows[0].id;
 await a.query("select snapshot_payment_attempt_request($1,$2,100,'USD')",[t,attempt]);
 if(options.envelope!==false)await a.query("select snapshot_payment_request_envelope($1,$2,'2024-06-20')",[t,attempt]);
 const intent=options.intent??('pi_'+payment.replaceAll('-',''));
 await a.query("select associate_payment_attempt_intent($1,$2,$3,$4,$5,$6,100,'USD')",[t,attempt,intent,platform,account,options.mode??false]);
 return {t,s,booking,payment,source,attempt,intent,platform,account};
}
const record=async(c,f,state='requires_payment')=>(await c.query('select payment_internal.record_scoped_payment_observation($1,$2) r',[f.attempt,state])).rows[0].r;
const facts=(f,extra={})=>({provider:'stripe_connect',platformAccountId:f.platform,accountId:f.account,livemode:false,eventId:'evt_'+randomUUID().replaceAll('-',''),objectType:'payment_intent',eventType:'payment_intent.succeeded',eventCreated:1760000000,eventApiVersion:null,parserVersion:2,schemaVersion:2,intentStatus:"succeeded",amountReceived:100,amountCapturable:0,intentId:f.intent,intentAmount:100,currency:'USD',...extra});
const receipt=async(c,x)=>(await c.query('select payment_internal.record_quarantined_event($1) r',[x])).rows[0].r;
const apply=async(c,id)=>(await c.query('select payment_internal.process_scoped_success_receipt($1) r',[id])).rows[0].r;
const snapshot=async f=>{const r={};for(const table of ['payments','bookings','capacity_holds','resource_reservations','refunds','payment_reviews','durable_outbox'])r[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') r from ${table} x where ${table==='bookings'?'id':'booking_id'}=$1`,[f.booking])).rows[0].r;return r;};
const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
async function waitLock(id){for(let i=0;i<150;i++){if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[id])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('contender did not block');}
const eid=()=> 'evt_'+randomUUID().replaceAll('-','');
const common=f=>({provider:'stripe_connect',platformAccountId:f.platform,accountId:f.account,livemode:false,eventId:eid(),eventCreated:1760000000,eventApiVersion:null,parserVersion:3,schemaVersion:3,currency:'USD',intentId:f.intent});
const charge=f=>({...common(f),objectType:'charge',eventType:'charge.refunded',chargeId:'ch_'+randomUUID().replaceAll('-',''),chargeAmount:100,chargeCaptured:true,chargeAmountCaptured:100,chargeAmountRefunded:25,chargeRefunded:false});
const refund=f=>({...common(f),objectType:'refund',eventType:'refund.updated',refundId:'re_'+randomUUID().replaceAll('-',''),refundAmount:25,refundStatus:'pending',chargeId:null});
const rows=async id=>(await db.query('select to_jsonb(r) r from payment_internal.event_receipts r where id=$1',[id])).rows[0].r;
try{
 await a.query('set role service_role');await b.query('set role service_role');const f=await seed();await record(a,f);const before=await snapshot(f);
 for(const x of [charge(f),refund(f)]){const r=await receipt(a,x);assert.deepEqual(r.facts,x);assert.equal(r.quarantineState,'quarantined');assert.equal((await receipt(a,x)).outcome,'duplicate');const row=await rows(r.receiptId);for(const k of ['intent_amount','intent_status','amount_received','amount_capturable'])assert.equal(row[k],null);assert.equal((await apply(a,r.receiptId)).reason,'unsupported_type');assert.equal((await a.query('select payment_internal.process_scoped_failure_receipt($1) r',[r.receiptId])).rows[0].r.reason,'unsupported_type');assert.notEqual((await a.query('select payment_internal.resolve_quarantined_payment_receipt($1) r',[r.receiptId])).rows[0].r.status,'matched_observation');ok(x.objectType+' exact replay, no PI money, processors quarantined');}
 for(const type of ['refund.created','refund.updated','refund.failed'])for(const status of [null,'pending','requires_action','succeeded','failed','canceled']){const x={...refund(f),eventType:type,refundStatus:status,intentId:null,chargeId:null};assert.deepEqual((await receipt(a,x)).facts,x);ok('status without inference '+type+' '+status);}
 for(const x of [{...charge(f),intentId:null},{...refund(f),chargeId:'ch_actual',intentId:null},{...refund(f),chargeId:null},{...charge(f),chargeAmount:0,chargeAmountCaptured:100,chargeAmountRefunded:200,chargeCaptured:false,chargeRefunded:true},{...refund(f),refundAmount:9007199254740991}]){assert.deepEqual((await receipt(a,x)).facts,x);ok('nullable associations / independent money observations');}
 for(const builder of [charge,refund]){const x=builder(f);for(const key of Object.keys(x)){const bad={...x,eventId:eid()};delete bad[key];await assert.rejects(receipt(a,bad),/INVALID_PAYMENT_RECEIPT/);}ok('every '+x.objectType+' field explicit');}
 for(const [key,values] of [['refundStatus',['unknown',0,false,{},'succeeded\n']],['intentId',[false,{},'ch_wrong','', 'pi_bad\n']],['chargeId',[{},false,'pi_wrong','']],['refundAmount',[-1,0.1,'1',null,9007199254740992]]])for(const value of values){await assert.rejects(receipt(a,{...refund(f),[key]:value}),/INVALID_PAYMENT_RECEIPT/);ok('reject malformed '+key);}
 for(const change of [{chargeId:null},{chargeCaptured:null},{chargeRefunded:0},{chargeAmount:null},{chargeAmountCaptured:-1},{chargeAmountRefunded:'25'},{refundId:'re_unexpected'},{intentAmount:100},{metadata:{}},{eventType:'refund.updated'},{schemaVersion:2},{parserVersion:2}]){await assert.rejects(receipt(a,{...charge(f),...change}),/INVALID_PAYMENT_RECEIPT/);ok('closed charge '+Object.keys(change)[0]);}
 for(const change of [{refundId:null},{refundId:'ch_wrong'},{eventType:'refund.deleted'},{objectType:'charge'},{chargeAmount:100},{intentStatus:'succeeded'}]){await assert.rejects(receipt(a,{...refund(f),...change}),/INVALID_PAYMENT_RECEIPT/);ok('closed refund '+Object.keys(change)[0]);}
 for(const first of [1,2,3]){const v1={...facts(f),parserVersion:1,schemaVersion:1};delete v1.intentStatus;delete v1.amountReceived;delete v1.amountCapturable;const v2=facts(f),v3=refund(f);for(const x of [v1,v2,v3])x.eventId=v1.eventId;const order=first===1?[v1,v3]:first===2?[v2,v3]:[v3,v2];const r=await receipt(a,order[0]),original=await rows(r.receiptId);assert.equal((await receipt(a,order[1])).outcome,'conflict');assert.deepEqual(await rows(r.receiptId),original);assert.equal((await receipt(a,order[0])).outcome,'conflict');ok('cross-version sticky original '+first);}
 {const x=charge(f),y={...refund(f),eventId:x.eventId},r=await receipt(a,x),original=await rows(r.receiptId);assert.equal((await receipt(a,y)).outcome,'conflict');assert.deepEqual(await rows(r.receiptId),original);assert.equal((await receipt(a,x)).outcome,'conflict');ok('same event charge/refund shape mismatch preserves original');}
 {const x=refund(f),r=await receipt(a,x),original=await rows(r.receiptId);for(const status of ['succeeded','failed','pending'])assert.equal((await receipt(a,{...x,refundStatus:status})).outcome,'conflict');assert.deepEqual(await rows(r.receiptId),original);ok('same event changed status sticky conflict');}
 {const x=refund(f);for(const [status,time] of [['succeeded',20],['pending',10],['failed',15]]){const y={...x,eventId:eid(),eventCreated:time,refundStatus:status};assert.deepEqual((await receipt(a,y)).facts,y);}ok('different events retain out-of-order status observations');}
 {const x=refund(f),results=await Promise.all([receipt(a,x),receipt(b,x)]);assert.equal(results[0].receiptId,results[1].receiptId);assert.equal(results.filter(r=>r.outcome==='inserted').length,1);const y=charge(f),conflicts=await Promise.all([receipt(a,y),receipt(b,{...y,chargeAmountRefunded:26})]);assert.equal(conflicts[0].receiptId,conflicts[1].receiptId);assert.equal((await receipt(a,conflicts[0].facts)).outcome,'conflict');ok('concurrent duplicate/conflict arbitration');}
 {const x=refund(f),ids=[];for(const changed of [{},{accountId:'acct_anotherAAA'},{platformAccountId:'acct_anotherBBB'},{livemode:true}])ids.push((await receipt(a,{...x,...changed})).receiptId);assert.equal(new Set(ids).size,4);ok('same event/refund source identities isolated');}
 {const x=refund(f);await a.query('begin');await receipt(a,x);await a.query('rollback');assert.equal((await receipt(a,x)).outcome,'inserted');ok('rollback/redelivery');}
 {const r=await receipt(a,refund(f));await assert.rejects(db.query("update payment_internal.event_receipts set refund_status='succeeded' where id=$1",[r.receiptId]),/PAYMENT_SOURCE_IMMUTABLE/);await assert.rejects(db.query('delete from payment_internal.event_receipts where id=$1',[r.receiptId]),/PAYMENT_SOURCE_IMMUTABLE/);ok('refund receipt immutable');}
 for(const role of ['anon','authenticated']){await db.query('begin');await db.query(`set local role ${role}`);await assert.rejects(receipt(db,refund(f)),e=>e.code==='42501');await db.query('rollback');ok(role+' recorder denied');}
 const verifier=createStripePaymentProvider({secretKey:'unused-synthetic',webhookSecret:'synthetic-refund-facts',directChargeSource:{accountId:f.account,livemode:false},now:()=>1760000000000,fetchImpl:()=>{throw Error('provider network forbidden');}});
 for(const object of [{object:'charge',id:'ch_composed',payment_intent:f.intent,livemode:false,amount:100,amount_captured:100,amount_refunded:25,captured:true,refunded:false,currency:'usd',refunds:{data:[{id:'re_not_authority',amount:999}]}},{object:'refund',id:'re_composed',payment_intent:f.intent,charge:null,amount:25,status:null,currency:'usd',metadata:{intentId:'pi_not_authority'}}]){
  const event={object:'event',id:eid(),type:object.object==='charge'?'charge.refunded':'refund.failed',created:1760000000,api_version:null,account:f.account,livemode:false,data:{object}},raw=JSON.stringify(event),signature=signStripeTestWebhook(raw,'synthetic-refund-facts',1760000000);
  const count=async()=>(await db.query('select count(*) n from payment_internal.event_receipts')).rows[0].n,beforeCount=await count();
  await assert.rejects(verifier.parseWebhook(raw+' ',signature));assert.equal(await count(),beforeCount);
  const verified=await verifier.parseWebhook(raw,signature),candidate=normalizeStripeRefundReceiptCandidateV3(verified.raw,{platformAccountId:f.platform});const r=await receipt(a,candidate);assert.deepEqual(r.facts,candidate);assert.equal((await apply(a,r.receiptId)).reason,'unsupported_type');ok('actual Node HMAC raw projection through private PostgreSQL '+object.object);
 }
 assert.deepEqual(await snapshot(f),before);ok('all linked payment/booking/hold/resource/refund/review/outbox rows unchanged');
 console.log(`${passed} actual PostgreSQL refund facts v3 checks passed; no refund processing`);
}finally{await Promise.all([db.end(),a.end(),b.end()]);}
