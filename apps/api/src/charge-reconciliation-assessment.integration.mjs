// Disposable synthetic assessment evidence only; no financial/refund processing.
// Fixture scaffold: result assertions await final RPC contract; not an executed test suite.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback database required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,statement_timeout:5000};
const db=new pg.Client(config),a=new pg.Client(config),b=new pg.Client(config),watch=new pg.Client(config);
await Promise.all([db.connect(),a.connect(),b.connect(),watch.connect()]);
let passed=0;const ok=label=>{passed++;console.log('PASS',label)};
async function seed(state='processing',hold='active',options={}){
 const t=options.owner?.t??randomUUID(),s=options.owner?.s??randomUUID(),booking=randomUUID(),payment=randomUUID();
 if(!options.owner)await db.query("insert into tenants(id,name,slug,timezone,currency) values($1::uuid,'Synthetic processing authority',$1::uuid::text,'UTC','USD')",[t]);
 if(!options.owner)await db.query("insert into services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1::uuid,$2,'Test','simple','USD',100,60)",[s,t]);
 await db.query(`insert into bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state) values($1::uuid,$2,$1::uuid::text,$1::uuid::text,$3,'{"total":{"amount":100,"currency":"USD"}}','2035-05-01T10:00Z','2035-05-01T11:00Z','pending_payment')`,[booking,t,JSON.stringify({serviceId:s})]);
 await db.query("insert into payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'stripe_connect',$1::uuid::text,$4,100,'USD')",[payment,t,booking,state]);
 if(hold!=='missing')await db.query("insert into capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1::uuid,$2,$3,'2035-05-01T10:00Z','2035-05-01T11:00Z',$3::uuid::text,$4,clock_timestamp()+$5::interval)",[t,s,booking,hold==='expired'?'active':hold,hold==='expired'?'-1 minute':'10 minutes']);
 await db.query('delete from payments where id=$1',[payment]);
 const suffix=t.replaceAll('-',''); const account=options.account??('acct_'+suffix), platform=options.platform??'acct_platformAAA';
 if(!options.owner)await db.query("insert into payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected',$2,true)",[t,account]);
 const source=(await a.query('select id from register_payment_source_scope($1,$2,$3)',[t,platform,options.mode??false])).rows[0].id;
 const attempt=(await a.query('select id from bind_booking_payment_source($1,$2,$3)',[t,booking,source])).rows[0].id;
 await a.query("select snapshot_payment_attempt_request($1,$2,100,'USD')",[t,attempt]);
 if(options.envelope!==false)await a.query("select snapshot_payment_request_envelope($1,$2,'2024-06-20')",[t,attempt]);
 const intent=options.intent??('pi_'+payment.replaceAll('-',''));
 await a.query("select associate_payment_attempt_intent($1,$2,$3,$4,$5,$6,100,'USD')",[t,attempt,intent,platform,account,options.mode??false]);
 return {t,s,booking,payment,source,attempt,intent,platform,account,mode:options.mode??false};
}
const eid=()=> 'evt_'+randomUUID().replaceAll('-','');
const common=f=>({provider:'stripe_connect',platformAccountId:f.platform,accountId:f.account,livemode:f.mode,eventId:eid(),eventCreated:1760000000,eventApiVersion:null,parserVersion:3,schemaVersion:3,currency:'USD',intentId:f.intent});
const charge=f=>({...common(f),objectType:'charge',eventType:'charge.refunded',chargeId:'ch_'+randomUUID().replaceAll('-',''),chargeAmount:100,chargeCaptured:true,chargeAmountCaptured:100,chargeAmountRefunded:25,chargeRefunded:false});
const refund=(f,ch)=>({...common(f),objectType:'refund',eventType:'refund.updated',refundId:'re_'+randomUUID().replaceAll('-',''),refundAmount:25,refundStatus:'pending',chargeId:ch});
const record=async(f,c=a)=>(await c.query('select payment_internal.record_scoped_payment_observation($1,$2) r',[f.attempt,'processing'])).rows[0].r;
const receipt=async(x,c=a)=>(await c.query('select payment_internal.record_quarantined_event($1) r',[x])).rows[0].r.receiptId;
const apply=async(id,c=a)=>(await c.query('select payment_internal.associate_refund_receipt($1) r',[id])).rows[0].r;
const assoc=(r,type)=>{assert.deepEqual(Object.keys(r).sort(),['associationId','entityType','status']);assert.equal(r.status,'associated_observation');assert.equal(r.entityType,type);assert.match(r.associationId,/^[0-9a-f-]{36}$/);return r.associationId;};
const quarantine=r=>{assert.equal(r.status,'quarantined');assert.deepEqual(Object.keys(r).sort(),['reason','status']);assert.match(r.reason,/^[a-z_]{1,80}$/);};
const snapshot=async f=>{const r={};for(const table of ['payments','bookings','capacity_holds','resource_reservations','refunds','payment_reviews','durable_outbox'])r[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') r from ${table} x where ${table==='bookings'?'id':'booking_id'}=$1`,[f.booking])).rows[0].r;return r;};
const anchor=async(type,id)=>(await db.query(`select to_jsonb(x) r from payment_internal.${type}_anchors x where id=$1`,[id])).rows[0]?.r;
const marker=async(type,id)=>(await db.query(`select to_jsonb(x) r from payment_internal.${type}_anchor_conflicts x where anchor_id=$1`,[id])).rows[0]?.r;
const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
async function waitLock(id){for(let i=0;i<150;i++){if((await watch.query('select wait_event_type from pg_stat_activity where pid=$1',[id])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('contender did not block');}
const fixtures=[];
async function fixture(options={}){const f=await seed('processing','active',options);const p=await record(f);f.payment=p.paymentId;f.before=await snapshot(f);fixtures.push(f);return f;}
async function boundCharge(f){const facts=charge(f),id=await receipt(facts),anchorId=assoc(await apply(id),'charge');return {facts,id,anchorId};}

// Every record is a synthetic trusted SQL assertion, not evidence of a real Stripe refund.
async function chargeEvidence(f, observations=[{}]) {
 const base=charge(f), ids=[];let anchorId;
 for(const extra of observations){const x={...base,eventId:eid(),...extra},id=await receipt(x);ids.push(id);anchorId=assoc(await apply(id),'charge');}
 return {facts:base,receiptIds:ids,anchorId};
}
async function refundEvidence(f,ch,amount,statuses=['pending']) {
 const base={...refund(f,ch.facts.chargeId),refundAmount:amount},ids=[];let anchorId;
 for(let i=0;i<statuses.length;i++){const x={...base,eventId:eid(),eventCreated:100-i,refundStatus:statuses[i]},id=await receipt(x);ids.push(id);anchorId=assoc(await apply(id),'refund');}
 return {facts:base,receiptIds:ids,anchorId};
}
async function completeSnapshot(){
 const result={};
 for(const table of ['public.payments','public.bookings','public.capacity_holds','public.resource_reservations','public.refunds','public.payment_reviews','public.durable_outbox','payment_internal.event_receipts','payment_internal.event_receipt_conflicts','payment_internal.charge_anchors','payment_internal.charge_anchor_conflicts','payment_internal.refund_anchors','payment_internal.refund_anchor_conflicts'])
  result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') r from ${table} x`)).rows[0].r;
 return result;
}
const assess=async(id,c=a)=>(await c.query('select payment_internal.assess_charge_reconciliation($1) r',[id])).rows[0].r;
// All comparisons run in a read-only transaction and assert every evidence/financial table unchanged.
async function readAssessment(id){const before=await completeSnapshot();await a.query('begin read only');try{const result=await assess(id);await a.query('commit');assert.deepEqual(await completeSnapshot(),before);return result;}catch(error){await a.query('rollback');throw error;}}
async function accountingFixture(){
 const f=await fixture(),ch=await chargeEvidence(f,[{chargeAmountRefunded:100,chargeRefunded:true}]);
 const r30=await refundEvidence(f,ch,30,['succeeded','pending','failed']);
 const r70=await refundEvidence(f,ch,70,['pending','succeeded']);
 return {f,ch,r30,r70};
}

function result(r,classification,amount=null,cumulative=[]){
 assert.deepEqual(Object.keys(r).sort(),['accountingAuthorized','chargeCumulativeObservedAmounts','classification','coverageComplete','individualObservedAmount','reason']);
 assert.equal(r.classification,classification);assert.match(r.reason,/^[a-z_]{1,80}$/);
 assert.equal(r.coverageComplete,false);assert.equal(r.accountingAuthorized,false);
 assert.equal(r.individualObservedAmount,amount);assert.deepEqual(r.chargeCumulativeObservedAmounts,cumulative);
}
async function consistent(){const f=await fixture(),ch=await chargeEvidence(f,[{chargeAmountRefunded:100,chargeRefunded:true}]);const r30=await refundEvidence(f,ch,30,['succeeded']),r70=await refundEvidence(f,ch,70,['succeeded']);return {f,ch,r30,r70};}
try {
 await a.query('set role service_role');await b.query('set role service_role');
 result(await readAssessment(randomUUID()),'coverage_unknown');ok('missing anchor fails closed');
 const base=await consistent();result(await readAssessment(base.ch.anchorId),'observed_consistent',100,[100]);ok('100 cumulative and 30+70 individual stay separate, never 200');
 await refundEvidence(base.f,await chargeEvidence(base.f,[{chargeAmountRefunded:0}]),25,['pending']);
 result(await readAssessment(base.ch.anchorId),'observed_consistent',100,[100]);ok('known other charge on same PI not attributed');
 for(const status of [null,'pending','failed','canceled','requires_action']){const x=await consistent();await receipt({...x.r30.facts,eventId:eid(),refundStatus:status});result(await readAssessment(x.ch.anchorId),'status_needs_verification');ok('status observation requires verification '+status);}
 {const x=await accountingFixture();result(await readAssessment(x.ch.anchorId),'status_needs_verification');ok('out-of-order evolving statuses never choose winner');}
 {const f=await fixture(),ch=await chargeEvidence(f,[{chargeAmountRefunded:0,chargeRefunded:false}]);result(await readAssessment(ch.anchorId),'observed_consistent',0,[0]);ok('explicit zero cumulative with no refunds');}
 for(const extra of [{chargeAmountRefunded:99},{chargeAmount:101},{chargeAmountCaptured:99},{chargeCaptured:false},{chargeRefunded:false}]){const x=await consistent();await receipt({...x.ch.facts,eventId:eid(),chargeAmountRefunded:100,chargeRefunded:true,...extra});result(await readAssessment(x.ch.anchorId),'coverage_unknown');ok('changing charge observations remain coverage uncertainty');}
 for(const extra of [{intentId:null},{chargeId:null}]){const x=await consistent();await receipt({...refund(x.f,x.ch.facts.chargeId),eventId:eid(),refundStatus:'succeeded',...extra});result(await readAssessment(x.ch.anchorId),'coverage_unknown');ok('one missing pointer unresolved');}
 {const x=await consistent();await receipt({...refund(x.f,null),intentId:null,refundStatus:'pending'});result(await readAssessment(x.ch.anchorId),'observed_consistent',100,[100]);ok('unanchored both-null evidence cannot be attributed');}
 {const x=await consistent();await receipt({...x.r30.facts,eventId:eid(),refundAmount:31});result(await readAssessment(x.ch.anchorId),'authority_conflict');ok('immutable amount contradiction outranks clean statuses');}
 {const x=await consistent();await receipt({...x.r30.facts,eventId:eid(),refundStatus:'pending'});const bad=await receipt({...x.r30.facts,eventId:eid(),refundAmount:31});await apply(bad);result(await readAssessment(x.ch.anchorId),'authority_conflict');ok('sticky association conflict outranks status uncertainty');}
 {const x=await consistent();await receipt({...x.r30.facts,refundAmount:31});result(await readAssessment(x.ch.anchorId),'authority_conflict');ok('origin receipt conflict invalidates evidence');}
 {const x=await consistent();const other=await chargeEvidence(x.f,[{chargeAmountRefunded:0}]);await receipt({...x.r30.facts,eventId:eid(),chargeId:other.facts.chargeId});result(await readAssessment(x.ch.anchorId),'authority_conflict');ok('anchored refund contradiction cannot hide under another charge');}
 {const x=await consistent();for(const change of [{accountId:'acct_otherAAAA'},{platformAccountId:'acct_otherBBBB'},{livemode:true}])await receipt({...x.r30.facts,eventId:eid(),refundAmount:99,refundStatus:'failed',...change});result(await readAssessment(x.ch.anchorId),'observed_consistent',100,[100]);ok('foreign full-source facts do not contaminate same IDs');}
 {const x=await consistent();await db.query('begin');await db.query('alter table payments disable trigger payment_provenance_guard');await db.query('update payments set amount=101 where id=$1',[x.f.payment]);result(await assess(x.ch.anchorId,db),'authority_conflict');await db.query('rollback');ok('canonical authority corruption rejected');}
 // Each budget is independently tested at the exact boundary and one beyond it.
 for(const budget of ['charge','refund_receipts','refund_anchors']){
  const f=await fixture(),ch=await chargeEvidence(f,[{chargeAmountRefunded:0,chargeRefunded:false}]);
  if(budget==='charge')for(let i=1;i<256;i++)await receipt({...ch.facts,eventId:eid(),chargeAmountRefunded:0,chargeRefunded:false});
  let first;
  if(budget==='refund_receipts'){first=await refundEvidence(f,ch,0,['succeeded']);for(let i=1;i<256;i++)await receipt({...first.facts,eventId:eid(),refundStatus:'succeeded'});}
  if(budget==='refund_anchors')for(let i=0;i<256;i++)await refundEvidence(f,ch,0,['succeeded']);
  result(await readAssessment(ch.anchorId),'observed_consistent',0,[0]);
  if(budget==='charge')await receipt({...ch.facts,eventId:eid(),chargeAmountRefunded:0,chargeRefunded:false});
  else if(budget==='refund_receipts')await receipt({...first.facts,eventId:eid(),refundStatus:'succeeded'});
  else await refundEvidence(f,ch,0,['succeeded']);
  result(await readAssessment(ch.anchorId),'coverage_unknown');ok(budget+' 256 boundary, 257 suppresses partial amounts');
 }
 {const x=await consistent();await b.query('begin');await receipt({...x.r30.facts,eventId:eid(),refundStatus:'pending'},b);
  result(await readAssessment(x.ch.anchorId),'observed_consistent',100,[100]);await b.query('commit');result(await readAssessment(x.ch.anchorId),'status_needs_verification');ok('uncommitted evidence invisible, next committed snapshot reflects uncertainty');}
 {const f=await fixture(),ch=await chargeEvidence(f,[{chargeAmountRefunded:Number.MAX_SAFE_INTEGER,chargeRefunded:true}]);
  await refundEvidence(f,ch,4503599627370496,['succeeded']);await refundEvidence(f,ch,4503599627370496,['succeeded']);
  result(await readAssessment(ch.anchorId),'coverage_unknown');ok('individually safe amounts with unsafe aggregate suppress sum');
 }
 {const x=await consistent(),key=Number.parseInt(randomUUID().replaceAll('-','').slice(0,7),16),ap=await pid(a);
  await db.query('select pg_advisory_lock($1)',[key]);
  let pending;
  try{
   await a.query('begin read only');
   pending=a.query('with barrier as materialized (select pg_advisory_xact_lock($1)) select payment_internal.assess_charge_reconciliation($2) r from barrier',[key,x.ch.anchorId]);pending.catch(()=>{});
   await waitLock(ap);
   await receipt({...x.r30.facts,eventId:eid(),refundStatus:'pending'},b);
   const before=await completeSnapshot();
   await db.query('select pg_advisory_unlock($1)',[key]);
   result((await pending).rows[0].r,'observed_consistent',100,[100]);await a.query('commit');
   assert.deepEqual(await completeSnapshot(),before);
   result(await readAssessment(x.ch.anchorId),'status_needs_verification');
   ok('in-flight statement retains coherent pre-commit snapshot; next statement observes uncertainty');
  }finally{await db.query('select pg_advisory_unlock($1)',[key]);if(pending)await pending.catch(()=>{});await a.query('rollback');}
 }
 {const x=await consistent();const u=refund(x.f,x.ch.facts.chargeId);await receipt({...u,refundStatus:'succeeded'});await receipt({...u,eventId:eid(),refundAmount:u.refundAmount+1,refundStatus:'succeeded'});result(await readAssessment(x.ch.anchorId),'coverage_unknown');ok('unanchored conflicting amounts cannot become observed consistent');}
 {const x=await consistent(),other=await chargeEvidence(x.f,[{chargeAmountRefunded:0}]),r=await refundEvidence(x.f,other,0,['succeeded']);
  const ambiguous={...r.facts,eventId:eid(),chargeId:null,refundStatus:'pending'};
  await receipt(ambiguous);
  result(await readAssessment(x.ch.anchorId),'coverage_unknown');ok('null charge matching PI is uncertainty even when refund anchored to other charge');
  await receipt({...ambiguous,refundAmount:ambiguous.refundAmount+1});
  const conflicted=await readAssessment(x.ch.anchorId);result(conflicted,'authority_conflict');assert.equal(conflicted.reason,'refund_observation_conflict');
  ok('selected ambiguous receipt conflict is evidence-integrity refusal, not charge attribution');
 }
 for(const role of ['anon','authenticated']){await db.query('begin');await db.query('set local role '+role);await assert.rejects(assess(base.ch.anchorId,db),e=>e.code==='42501');await db.query('rollback');ok(role+' private assessment denied');}
 for(const f of fixtures)assert.deepEqual(await snapshot(f),f.before);ok('all financial fixtures unchanged');
 console.log(`${passed} actual PostgreSQL charge assessment checks passed; no accounting authority`);
} finally {await Promise.all([db.query('rollback').catch(()=>{}),a.query('rollback').catch(()=>{}),b.query('rollback').catch(()=>{})]);await Promise.all([db.end(),a.end(),b.end(),watch.end()]);}
