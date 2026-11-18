// Actual PostgreSQL catalog mutation tests. Synthetic transport, no provider calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:10});
const base={provider:'stripe_connect',platformAccountId:'acct_platformAAA',accountId:'acct_unknownAAA',livemode:false,eventId:'evt_'+randomUUID().replaceAll('-',''),objectType:'payment_intent',eventType:'payment_intent.succeeded',eventCreated:1760000000,eventApiVersion:'2024-06-20',parserVersion:1,schemaVersion:1,intentId:'pi_unknown',intentAmount:1250,currency:'USD'};
const record=async(facts=base,client=pool)=>(await client.query('select payment_internal.record_quarantined_event($1::jsonb) result',[JSON.stringify(facts)])).rows[0].result;
const service=async facts=>{const c=await pool.connect();try{await c.query('set role service_role');return await record(facts,c);}finally{await c.query('reset role');c.release();}};
const counts=async()=>{const result={};for(const table of ['bookings','payments','refunds','payment_reviews','payment_attempt_intents','payment_request_envelopes'])result[table]=(await pool.query(`select count(*) n from public.${table}`)).rows[0].n;return result;};
const initial=await counts();let cases=0;
try{
 const first=await service(base);assert.equal(first.outcome,'inserted');assert.equal(first.quarantineState,'quarantined');assert.deepEqual(first.facts,base);assert.equal(first.conflictSeen,false);cases++;
 const duplicate=await service(base);assert.equal(duplicate.receiptId,first.receiptId);assert.equal(duplicate.outcome,'duplicate');assert.deepEqual(duplicate.facts,base);cases++;
 const conflict=await service({...base,intentAmount:1251});assert.equal(conflict.outcome,'conflict');assert.equal(conflict.conflictSeen,true);assert.deepEqual(conflict.facts,base);assert.equal(conflict.receiptId,first.receiptId);cases++;
 const again=await service(base);assert.equal(again.conflictSeen,true);assert.equal(again.outcome,'conflict');assert.deepEqual(again.facts,base);cases++;
 for(const extra of [{platformAccountId:'acct_platformBBB'},{accountId:'acct_unknownBBB'},{livemode:true}]){const r=await service({...base,...extra});assert.equal(r.outcome,'inserted');assert.notEqual(r.receiptId,first.receiptId);cases++;}
 for(const eventType of ['payment_intent.payment_failed','payment_intent.canceled']){const r=await service({...base,eventId:'evt_'+randomUUID().replaceAll('-',''),eventType,eventApiVersion:null});assert.equal(r.outcome,'inserted');assert.equal(r.facts.eventApiVersion,null);cases++;}
 // Concurrent duplicates converge on one immutable receipt.
 const race={...base,eventId:'evt_'+randomUUID().replaceAll('-','')};const results=await Promise.all(Array.from({length:8},()=>service(race)));assert.equal(new Set(results.map(r=>r.receiptId)).size,1);assert.equal(results.filter(r=>r.outcome==='inserted').length,1);cases++;
 const mixed={...base,eventId:'evt_'+randomUUID().replaceAll('-','')};const mixedResults=await Promise.all(Array.from({length:8},(_,i)=>service({...mixed,intentAmount:1250+i%2})));
 assert.equal(new Set(mixedResults.map(r=>r.receiptId)).size,1);const winner=mixedResults.find(r=>r.outcome==='inserted').facts;
 assert.ok(mixedResults.some(r=>r.outcome==='conflict'));assert.ok(mixedResults.every(r=>JSON.stringify(r.facts)===JSON.stringify(winner)));assert.equal((await service(winner)).conflictSeen,true);cases++;
 // Incoming altered event identity stays a new receipt; changed facts don't rewrite.
 for(const change of [{eventType:'payment_intent.canceled'},{intentId:'pi_different'},{currency:'EUR'},{eventCreated:1760000001},{eventApiVersion:null}]){const r=await service({...base,...change});assert.equal(r.outcome,'conflict');assert.deepEqual(r.facts,base);cases++;}
 // Rollback receipt insertion then redeliver. Never claim durability before COMMIT.
 const c=await pool.connect();try{
  await c.query('begin');await c.query('set local role service_role');const rollback={...base,eventId:'evt_'+randomUUID().replaceAll('-','')};await record(rollback,c);await c.query('rollback');assert.equal((await service(rollback)).outcome,'inserted');cases++;
  const clean={...base,eventId:'evt_'+randomUUID().replaceAll('-','')};await service(clean);await c.query('begin');await c.query('set local role service_role');await record({...clean,intentAmount:1251},c);await c.query('rollback');assert.equal((await service(clean)).conflictSeen,false);assert.equal((await service({...clean,intentAmount:1251})).conflictSeen,true);cases++;
 }finally{await c.query('rollback');c.release();}
 const malformed=[null,[],{},...['raw','signature','clientToken','secretKey','metadata','error','tenantId','bookingId'].map(k=>({...base,[k]:'forbidden'})),
  {...base,livemode:null},{...base,livemode:'false'},{...base,intentAmount:'1250'},{...base,intentAmount:1.2},{...base,intentAmount:0},{...base,intentAmount:9007199254740992},
  {...base,eventId:'error text'},{...base,eventId:'pi_wrongtype'},{...base,intentId:'ch_wrongtype'},{...base,intentId:'pi_wrong_secret_value'},{...base,eventId:''},{...base,eventId:'x'.repeat(256)},{...base,eventId:'evt_bad\n'},{...base,intentId:' pi_bad'},
  {...base,accountId:null},{...base,accountId:''},{...base,eventCreated:-1},{...base,eventCreated:1.5},{...base,eventCreated:253402300800},
  {...base,objectType:'charge'},{...base,eventType:'charge.refunded'},{...base,eventType:'refund.updated'},{...base,provider:'stripe'},
  {...base,parserVersion:2},{...base,schemaVersion:2},{...base,eventApiVersion:123},{...base,currency:'usd'}];
 const {eventApiVersion,...missingVersion}=base;malformed.push(missingVersion);
 for(const bad of malformed){await assert.rejects(service(bad),/INVALID_PAYMENT_RECEIPT/);cases++;}
 const admin=await pool.connect();try{
  for(const role of ['anon','authenticated','service_role']){
   await admin.query('begin');await admin.query(`set local role ${role}`);
   for(const table of ['event_receipts','event_receipt_conflicts']){
    for(const q of [`select * from payment_internal.${table}`,`select ${table==='event_receipts'?'intent_amount':'receipt_id'} from payment_internal.${table}`,`delete from payment_internal.${table}`]){await admin.query('savepoint denied');await assert.rejects(admin.query(q),/permission denied/);await admin.query('rollback to denied');cases++;}
   }
   if(role!=='service_role'){await admin.query('savepoint denied');await assert.rejects(record(base,admin),/permission denied/);await admin.query('rollback to denied');cases++;}
   await admin.query('rollback');
  }
  await admin.query('begin');for(const q of ["update payment_internal.event_receipts set intent_amount=1","delete from payment_internal.event_receipts","delete from payment_internal.event_receipt_conflicts"]){await admin.query('savepoint immutable');await assert.rejects(admin.query(q),/PAYMENT_SOURCE_IMMUTABLE/);await admin.query('rollback to immutable');cases++;}await admin.query('rollback');
 }finally{await admin.query('rollback');admin.release();}
 assert.equal((await pool.query('select count(*) n from payment_internal.event_receipt_conflicts where receipt_id=$1',[first.receiptId])).rows[0].n,'1');
 assert.deepEqual(await counts(),initial);assert.equal((await pool.query("select count(*) n from payment_internal.event_receipts where quarantine_state<>'quarantined'")).rows[0].n,'0');
 console.log(`PASS ${cases} receipt checks: private authority, immutable quarantine, bounded conflict, concurrent duplicate/conflict, cross-source isolation, rollback/redelivery, closed malformed rejection and zero financial effects`);
}finally{await pool.end();}
