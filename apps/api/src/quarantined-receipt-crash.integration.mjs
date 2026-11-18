// Actual isolated child process + loopback HTTP + PostgreSQL. No production ingress.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {signStripeTestWebhook} from '../../../packages/adapters/src/stripePayment.ts';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error('Unexpected database override');
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:3});
const children=new Set();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const id=()=> 'evt_'+randomUUID().replaceAll('-','');
const fixture=(eventId=id(),extra={})=>({id:eventId,object:'event',type:'payment_intent.succeeded',created:1760000000,api_version:'2024-06-20',account:'acct_fixtureAAAA',livemode:false,data:{object:{id:'pi_fixture123',object:'payment_intent',amount:1250,currency:'usd',livemode:false,metadata:{tenantId:'ignored'},client_secret:'synthetic-never-return'}},...extra});
const count=async(eventId)=>(await pool.query('select count(*)::integer n from payment_internal.event_receipts where event_id=$1',[eventId])).rows[0].n;
async function snapshots(){const result={};for(const table of ['bookings','payments','refunds','payment_reviews','payment_attempt_intents','payment_request_envelopes'])result[table]=(await pool.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.${table} t`)).rows[0].rows;return result;}
async function start(source='a',phase='none'){
 const env={FLOW_TEST_DISPOSABLE:'1',PGHOST:'127.0.0.1',PGPORT:process.env.PGPORT,PGUSER:process.env.PGUSER??'postgres',PGDATABASE:process.env.PGDATABASE};
 for(const k of ['SystemRoot','WINDIR','TEMP','TMP','PGPASSWORD'])if(process.env[k])env[k]=process.env[k];
 const child=fork(fileURLToPath(new URL('./quarantined-receipt-crash-worker.mjs',import.meta.url)),[source,phase],{env,execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']});
 children.add(child);const messages=[];child.on('message',m=>messages.push(m));child.stdout.resume();child.stderr.resume();
 const closed=new Promise(resolve=>child.once('exit',(code,signal)=>{children.delete(child);resolve({code,signal});}));
 async function wait(type){for(let i=0;i<400;i++){const found=messages.find(m=>m.type===type);if(found)return found;if(child.exitCode!==null||child.signalCode!==null)throw Error('fixture child exited early');await sleep(25);}throw Error('fixture barrier timeout');}
 const ready=await wait('ready');return {child,closed,wait,url:`http://127.0.0.1:${ready.port}/receipt`};
}
async function stop(w){if(w.child.exitCode!==null||w.child.signalCode!==null)return;w.child.kill('SIGKILL');await w.closed;}
async function send(w,e,signature){const payload=typeof e==='string'?e:JSON.stringify(e);const res=await fetch(w.url,{method:'POST',headers:{'Stripe-Signature':signature??signStripeTestWebhook(payload,'synthetic-crash-signing',1760000000)},body:payload,signal:AbortSignal.timeout(15000)});return {status:res.status,body:await res.json()};}
async function backendGone(pid){for(let i=0;i<200;i++){if((await pool.query('select count(*)::integer n from pg_stat_activity where pid=$1',[pid])).rows[0].n===0)return;await sleep(25);}throw Error('killed child database backend still alive');}
const before=await snapshots();
try{
 let w=await start();
 const bad=fixture();assert.equal((await send(w,bad,'t=1760000000,v1=bad')).status,400);assert.equal(await count(bad.id),0);
 const malformed=fixture();delete malformed.api_version;assert.equal((await send(w,malformed)).status,400);assert.equal(await count(malformed.id),0);
 const wrongSource=fixture(id(),{account:'acct_otherAAAA'});assert.equal((await send(w,wrongSource)).status,400);assert.equal(await count(wrongSource.id),0);
 const exact=fixture();const exactRaw=JSON.stringify(exact),exactSignature=signStripeTestWebhook(exactRaw,'synthetic-crash-signing',1760000000);
 assert.equal((await send(w,exactRaw+' ',exactSignature)).status,400);assert.equal((await send(w,'\uFEFF'+exactRaw,exactSignature)).status,400);assert.equal(await count(exact.id),0);
 assert.equal((await pool.query('select count(*)::integer n from payment_internal.event_receipts')).rows[0].n,0);
 const unicode=fixture();unicode.data.object.metadata.note='synthetic é 🙂';const unicodeResult=await send(w,unicode);assert.equal(unicodeResult.status,503);assert.equal(await count(unicode.id),1);assert.ok(!JSON.stringify(unicodeResult.body).includes('synthetic é'));
 await stop(w);console.log('PASS real verifier failures and signed malformed/source mismatch produce zero receipts');
 w=await start('a','db_failure');const failure=fixture();assert.equal((await send(w,failure)).status,503);assert.equal(await count(failure.id),0);await stop(w);console.log('PASS real SQL statement failure rolls back and never returns success');
 for(const phase of ['before_commit','after_commit']){
  w=await start('a',phase);const e=fixture();const pending=send(w,e).then(x=>({response:x}),()=>({disconnected:true}));
  const barrier=await w.wait('barrier');assert.equal(barrier.phase,phase);assert.ok(Number.isInteger(barrier.backendPid));
  assert.equal(await count(e.id),phase==='before_commit'?0:1);
  assert.equal(w.child.kill('SIGKILL'),true);await w.closed;await backendGone(barrier.backendPid);
  assert.deepEqual(await pending,{disconnected:true});assert.equal(await count(e.id),phase==='before_commit'?0:1);
  const restarted=await start();const redelivery=await send(restarted,e);assert.equal(redelivery.status,503);assert.equal(redelivery.body.outcome,phase==='before_commit'?'inserted':'duplicate');assert.equal(await count(e.id),1);await stop(restarted);
  console.log(`PASS actual killed child ${phase}: backend exited, restart/redelivery exactly one committed receipt`);
 }
 w=await start();const duplicate=fixture();const duplicateResults=await Promise.all(Array.from({length:8},()=>send(w,duplicate)));assert.ok(duplicateResults.every(r=>r.status===503));assert.equal(duplicateResults.filter(r=>r.body.outcome==='inserted').length,1);assert.equal(await count(duplicate.id),1);
 const conflict=fixture();const altered={...conflict,data:{object:{...conflict.data.object,amount:1251}}};const contested=await Promise.all(Array.from({length:8},(_,i)=>send(w,i%2?altered:conflict)));assert.ok(contested.every(r=>r.status===503));assert.ok(contested.some(r=>r.body.outcome==='conflict'));assert.equal(await count(conflict.id),1);for(const e of [conflict,altered]){const r=await send(w,e);assert.equal(r.body.outcome,'conflict');assert.equal(r.body.conflictSeen,true);}
 assert.equal((await pool.query('select count(*)::integer n from payment_internal.event_receipt_conflicts c join payment_internal.event_receipts r on r.id=c.receipt_id where r.event_id=$1',[conflict.id])).rows[0].n,1);
 await stop(w);console.log('PASS concurrent HTTP duplicates/conflicts remain one quarantined receipt and sticky bounded conflict');
 const cross=fixture();for(const source of ['a','b','live','platform']){w=await start(source);const e={...cross,account:source==='b'?'acct_fixtureBBBB':'acct_fixtureAAAA',livemode:source==='live',data:{object:{...cross.data.object,livemode:source==='live'}}};const result=await send(w,e);assert.equal(result.status,503);assert.equal(result.body.outcome,'inserted');assert.ok(!JSON.stringify(result.body).includes('synthetic-never-return'));await stop(w);}assert.equal(await count(cross.id),4);
 assert.deepEqual(await snapshots(),before);assert.equal((await pool.query("select count(*)::integer n from payment_internal.event_receipts where quarantine_state<>'quarantined'")).rows[0].n,0);console.log('PASS fixed trusted platform/account/mode isolate same event IDs; all original booking/payment/refund rows unchanged; no ACK200');
}finally{for(const child of children)child.kill('SIGKILL');await Promise.all([...children].map(c=>new Promise(r=>c.once('exit',r))));await pool.end();}
