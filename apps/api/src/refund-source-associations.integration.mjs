// Disposable synthetic association evidence only; no financial/refund processing.
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
try{
 await a.query('set role service_role');await b.query('set role service_role');
 const f=await fixture(),ch=await boundCharge(f),original=await anchor('charge',ch.anchorId);
 assert.equal(original.payment_id,f.payment);assert.equal(original.attempt_id,f.attempt);assert.equal(original.source_scope_id,f.source);assert.equal(original.origin_receipt_id,ch.id);
 assert.equal(assoc(await apply(ch.id),'charge'),ch.anchorId);
 for(const changes of [{chargeAmount:900,chargeCaptured:false,chargeAmountCaptured:0,chargeAmountRefunded:200,chargeRefunded:true},{chargeAmount:0,chargeAmountRefunded:0}])assert.equal(assoc(await apply(await receipt({...ch.facts,eventId:eid(),...changes})),'charge'),ch.anchorId);
 assert.deepEqual(await anchor('charge',ch.anchorId),original);ok('charge mapping immutable while independent charge observations vary');
 const ch2=await boundCharge(f);assert.notEqual(ch2.anchorId,ch.anchorId);ok('two distinct charges may bind same canonical PI');
 const rf=refund(f,ch.facts.chargeId),rid=await receipt(rf),raid=assoc(await apply(rid),'refund'),roriginal=await anchor('refund',raid);
 assert.equal(roriginal.charge_anchor_id,ch.anchorId);assert.equal(roriginal.payment_id,f.payment);assert.equal(roriginal.origin_receipt_id,rid);
 for(const status of [null,'succeeded','failed','pending'])assert.equal(assoc(await apply(await receipt({...rf,eventId:eid(),eventCreated:1,refundStatus:status})),'refund'),raid);
 assert.deepEqual(await anchor('refund',raid),roriginal);ok('refund statuses and delivery order do not choose financial winner');
 for(const change of [{intentId:null},{intentId:'pi_unknown'},{platformAccountId:'acct_otherAAAA'},{accountId:'acct_otherBBBB'},{livemode:!f.mode},{currency:'EUR'}])quarantine(await apply(await receipt({...charge(f),...change})));
 for(const change of [{chargeId:null},{intentId:null,chargeId:null},{chargeId:'ch_unknown'},{intentId:'pi_unknown'},{currency:'EUR'}])quarantine(await apply(await receipt({...refund(f,ch.facts.chargeId),...change})));
 quarantine(await apply(randomUUID()));ok('missing source, unmatched pointers, missing both pointers and currency mismatch quarantine');
 // Neither nullable pointer authorizes reconstructing missing provider facts.
 const nullPi=refund(f,ch.facts.chargeId);nullPi.intentId=null;quarantine(await apply(await receipt(nullPi)));ok('nullable PI remains unresolved despite already anchored charge');
 for(const bad of [{chargeId:{}},{chargeId:'pi_wrong'},{intentId:{id:f.intent}},{refundAmount:-1}])await assert.rejects(receipt({...refund(f,ch.facts.chargeId),...bad}),/INVALID_PAYMENT_RECEIPT/);ok('malformed facts rejected before association');
 // Missing pointers never authorize inference, but known contradictions remain durable evidence.
 for(const change of [{intentId:null,refundAmount:26},{chargeId:null,currency:'EUR'},{intentId:null,chargeId:'ch_contradiction'},{chargeId:null,intentId:'pi_contradiction'}]){
  const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund'),before=await anchor('refund',aid);
  const bad=await receipt({...x,eventId:eid(),...change});quarantine(await apply(bad));
  const first=await marker('refund',aid);assert.ok(first);assert.equal(first.receipt_id,bad);
  quarantine(await apply(id));quarantine(await apply(await receipt({...x,eventId:eid(),intentId:null,chargeId:null})));
  assert.deepEqual(await marker('refund',aid),first);assert.deepEqual(await anchor('refund',aid),before);
  ok('null pointer preserves sticky known contradiction '+Object.keys(change).join('/'));
 }
 for(const change of [{intentId:null},{chargeId:null},{intentId:null,chargeId:null}]){
  const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund');
  const partial=await receipt({...x,eventId:eid(),...change});quarantine(await apply(partial));assert.equal(await marker('refund',aid),undefined);
  assert.equal(assoc(await apply(id),'refund'),aid);ok('matching known facts with null pointers do not create false conflict');
 }
 {const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),partial=await receipt({...x,intentId:null,chargeId:null});
  quarantine(await apply(partial));assert.equal((await db.query('select count(*) n from payment_internal.refund_anchors where source_scope_id=$1 and refund_id=$2',[g.source,x.refundId])).rows[0].n,'0');
  const complete=await receipt({...x,eventId:eid()}),aid=assoc(await apply(complete),'refund');
  quarantine(await apply(partial));assert.equal(await marker('refund',aid),undefined);assert.equal((await anchor('refund',aid)).origin_receipt_id,complete);
  ok('null-first observation creates no anchor and later complete event may bind');
 }
 {const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund');
  for(const source of [{accountId:'acct_foreignAAA'},{platformAccountId:'acct_foreignBBB'},{livemode:!g.mode}]){
   quarantine(await apply(await receipt({...x,eventId:eid(),intentId:null,chargeId:null,refundAmount:26,...source})));
   assert.equal(await marker('refund',aid),undefined);assert.equal(assoc(await apply(id),'refund'),aid);
  }ok('null contradiction in foreign source never contaminates known refund');
 }
 {const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund'),partial=await receipt({...x,eventId:eid(),intentId:null,refundAmount:26});
  await db.query('begin');await db.query('select 1 from payments where id=$1 for update',[g.payment]);await db.query('select 1 from payment_internal.event_receipts where id=$1 for update',[id]);
  try{quarantine(await apply(partial));}finally{await db.query('rollback');}
  assert.ok(await marker('refund',aid));ok('null-path contradiction locks only own receipt and refund anchor, not original payment/receipt');
 }
 // Identical external identifiers across account/mode boundaries remain independent.
 for(const options of [{intent:f.intent},{owner:f,mode:true,intent:f.intent},{owner:f,platform:'acct_alternateAAA',intent:f.intent}]){const g=await fixture(options),cg={...charge(g),chargeId:ch.facts.chargeId},ca=assoc(await apply(await receipt(cg)),'charge');assert.notEqual(ca,ch.anchorId);const ra=assoc(await apply(await receipt({...refund(g,cg.chargeId),refundId:rf.refundId})),'refund');assert.notEqual(ra,raid);assert.equal((await anchor('charge',ca)).source_scope_id,g.source);}ok('same charge/refund/PI identifiers isolated by full source account and mode');
 for(const kind of ['charge','refund']){
  const g=await fixture(),cg=await boundCharge(g),base=kind==='charge'?cg.facts:refund(g,cg.facts.chargeId),baseReceipt=kind==='charge'?cg.id:await receipt(base),id=kind==='charge'?cg.anchorId:assoc(await apply(baseReceipt),'refund');
  const before=await anchor(kind,id),other=kind==='charge'?{...base,eventId:eid(),currency:'EUR'}:{...base,eventId:eid(),refundAmount:26};
  quarantine(await apply(await receipt(other)));const first=await marker(kind,id);assert.ok(first);
  await assert.rejects(db.query(`update payment_internal.${kind}_anchor_conflicts set reason='association_conflict' where anchor_id=$1`,[id]));
  await assert.rejects(db.query(`delete from payment_internal.${kind}_anchor_conflicts where anchor_id=$1`,[id]));
  quarantine(await apply(baseReceipt));quarantine(await apply(await receipt({...other,eventId:eid()})));assert.deepEqual(await marker(kind,id),first);assert.deepEqual(await anchor(kind,id),before);ok(kind+' first conflict marker sticky and mapping unchanged');
 }
 {const g=await fixture(),cg=await boundCharge(g);await receipt({...cg.facts,chargeAmountRefunded:99});quarantine(await apply(cg.id));quarantine(await apply(await receipt(refund(g,cg.facts.chargeId))));ok('later origin receipt conflict quarantines derived refund');}
 {const g=await fixture(),cg=await boundCharge(g);quarantine(await apply(await receipt({...cg.facts,eventId:eid(),currency:'EUR'})));quarantine(await apply(await receipt(refund(g,cg.facts.chargeId))));ok('charge anchor conflict propagates to refund association');}
 {const g=await fixture(),cg=await boundCharge(g),x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund'),original=await anchor('refund',aid);await receipt({...x,refundStatus:'succeeded'});quarantine(await apply(await receipt({...x,eventId:eid()})));assert.deepEqual(await anchor('refund',aid),original);ok('later refund origin receipt conflict blocks new status observations');}
 {const g=await fixture(),x=charge(g),id=await receipt(x);await db.query('begin');await db.query('select 1 from payments where id=$1 for update',[g.payment]);const bp=await pid(b),pending=apply(id,b);pending.catch(()=>{});await waitLock(bp);await db.query('update bookings set idempotency_key=$2 where id=$1',[g.booking,randomUUID()]);await db.query('commit');quarantine(await pending);assert.equal((await db.query('select count(*) n from payment_internal.charge_anchors where source_scope_id=$1',[g.source])).rows[0].n,'0');g.before=await snapshot(g);ok('canonical booking identity freshly checked after candidate payment wait');}
 {const g=await seed(),x=charge(g);const legacy=randomUUID();await db.query("insert into payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1,$2,$3,'stripe_connect',$4,'processing',100,'USD')",[legacy,g.t,g.booking,g.intent]);g.before=await snapshot(g);fixtures.push(g);quarantine(await apply(await receipt(x)));assert.equal((await db.query('select count(*) n from payment_internal.charge_anchors where source_scope_id=$1',[g.source])).rows[0].n,'0');ok('same intent legacy NULL provenance never adopted');}
 // Different candidate payment, same source: no lock or graph chase of original payment.
 {const g=await fixture(),h=await fixture({owner:g}),cg=await boundCharge(g),x={...charge(h),chargeId:cg.facts.chargeId},id=await receipt(x);await db.query('begin');await db.query('select 1 from payments where id=$1 for update',[g.payment]);try{quarantine(await apply(id));}finally{await db.query('rollback');}assert.equal((await anchor('charge',cg.anchorId)).payment_id,g.payment);ok('contradictory charge pointer does not lock another payment or rebind');}
 {const g=await fixture(),h=await fixture({owner:g}),cg=await boundCharge(g),ch=await boundCharge(h);
  const x=refund(g,cg.facts.chargeId),id=await receipt(x),aid=assoc(await apply(id),'refund'),before=await anchor('refund',aid);
  quarantine(await apply(await receipt({...x,eventId:eid(),intentId:h.intent,chargeId:ch.facts.chargeId})));
  assert.deepEqual(await anchor('refund',aid),before);quarantine(await apply(id));ok('same refund cannot rebind to another coherent charge/payment');
  quarantine(await apply(await receipt(refund(g,ch.facts.chargeId))));ok('explicit PI and charge payment must agree');
 }
 for(const [type,id] of [['charge',ch.anchorId],['refund',raid]]){
  await assert.rejects(db.query(`update payment_internal.${type}_anchors set currency='EUR' where id=$1`,[id]));
  await assert.rejects(db.query(`delete from payment_internal.${type}_anchors where id=$1`,[id]));
  ok('owner direct '+type+' immutable anchor update/delete denied');
 }
 {const g=await fixture(),cg=await boundCharge(g),id=await receipt({...cg.facts,eventId:eid()});
  await db.query('begin');await db.query('select 1 from payment_internal.event_receipts where id=$1 for update',[cg.id]);
  try{assert.equal(assoc(await apply(id),'charge'),cg.anchorId);}finally{await db.query('rollback');}
  ok('association reads but never locks another origin receipt');
 }
 // Hold a completed first association uncommitted; second must demonstrably wait.
 for(const kind of ['charge','refund'])for(const conflict of [false,true])for(const reverse of [false,true]){
  const g=await fixture(),h=conflict&&kind==='charge'?await fixture({owner:g}):g,cg=kind==='refund'?await boundCharge(g):null;
  const first=kind==='charge'?charge(g):refund(g,cg.facts.chargeId),second={...first,eventId:eid(),...(conflict?(kind==='charge'?{intentId:h.intent}:{refundAmount:26}):{})};
  const ids=await Promise.all([receipt(first,a),receipt(second,b)]);if(reverse)ids.reverse();
  await a.query('begin');const initial=await apply(ids[0],a),aid=assoc(initial,kind),bp=await pid(b);const pending=apply(ids[1],b);pending.catch(()=>{});
  await waitLock(bp);await a.query('commit');const result=await pending;
  if(conflict){quarantine(result);quarantine(await apply(ids[0]));assert.ok(await marker(kind,aid));}else assert.equal(assoc(result,kind),aid);
  ok(`${kind} gated ${conflict?'conflicting':'duplicate'} insertion reverse=${reverse}`);
 }
 // Unlike amount-only contention, these contenders own distinct payment and charge rows.
 for(const reverse of [false,true]){
  const g=await fixture(),h=await fixture({owner:g}),cg=await boundCharge(g),ch=await boundCharge(h);
  const first=refund(g,cg.facts.chargeId),second={...refund(h,ch.facts.chargeId),refundId:first.refundId};
  const entries=[{id:await receipt(first),f:g,ch:cg},{id:await receipt(second),f:h,ch}];if(reverse)entries.reverse();
  await a.query('begin');const aid=assoc(await apply(entries[0].id,a),'refund'),bp=await pid(b);
  const pending=apply(entries[1].id,b);pending.catch(()=>{});await waitLock(bp);
  // The waiter must have reached its own candidate rows before unique arbitration.
  await db.query('begin');await db.query("set local lock_timeout='100ms'");
  await assert.rejects(db.query('select 1 from payments where id=$1 for update',[entries[1].f.payment]),e=>e.code==='55P03');await db.query('rollback');
  await db.query('begin');await db.query("set local lock_timeout='100ms'");
  await assert.rejects(db.query('select 1 from payment_internal.charge_anchors where id=$1 for update',[entries[1].ch.anchorId]),e=>e.code==='55P03');await db.query('rollback');
  await a.query('commit');quarantine(await pending);
  const saved=await anchor('refund',aid);assert.equal(saved.payment_id,entries[0].f.payment);assert.equal(saved.charge_anchor_id,entries[0].ch.anchorId);assert.equal(saved.origin_receipt_id,entries[0].id);
  const conflict=await marker('refund',aid);assert.equal(conflict.receipt_id,entries[1].id);
  quarantine(await apply(entries[0].id));quarantine(await apply(entries[1].id));assert.deepEqual(await anchor('refund',aid),saved);assert.deepEqual(await marker('refund',aid),conflict);
  ok('distinct coherent payment/charge refund unique arbitration reverse='+reverse);
 }
 {const g=await fixture(),x=charge(g),id=await receipt(x);await a.query('begin');await apply(id);await a.query('rollback');assert.equal((await db.query('select count(*) n from payment_internal.charge_anchors where source_scope_id=$1 and charge_id=$2',[g.source,x.chargeId])).rows[0].n,'0');assoc(await apply(id),'charge');ok('association rollback redelivery safe');}
 for(const level of ['repeatable read','serializable']){await a.query('begin isolation level '+level);await assert.rejects(apply(ch.id),e=>e.code==='25001'&&/UNSUPPORTED_ISOLATION/.test(e.message));await a.query('rollback');ok(level+' unsupported isolation rejected');}
 for(const role of ['anon','authenticated']){await db.query('begin');await db.query('set local role '+role);await assert.rejects(apply(ch.id,db),e=>e.code==='42501');await db.query('rollback');ok(role+' private RPC denied');}
 for(const table of ['charge_anchors','refund_anchors','charge_anchor_conflicts','refund_anchor_conflicts']){await assert.rejects(a.query('select * from payment_internal.'+table),e=>e.code==='42501');await assert.rejects(a.query('delete from payment_internal.'+table),e=>e.code==='42501');ok('service direct table read/write denied '+table);}
 for(const fx of fixtures)assert.deepEqual(await snapshot(fx),fx.before);ok('all linked booking/payment/holds/resources/refunds/reviews/outbox unchanged');
 console.log(`${passed} actual PostgreSQL refund source association checks passed; observations only`);
}finally{await Promise.all([db.query('rollback').catch(()=>{}),a.query('rollback').catch(()=>{}),b.query('rollback').catch(()=>{})]);await Promise.all([db.end(),a.end(),b.end(),watch.end()]);}
