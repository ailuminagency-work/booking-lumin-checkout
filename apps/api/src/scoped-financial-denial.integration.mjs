// Synthetic local PostgreSQL evidence, never provider capture evidence.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??'')) throw Error('Disposable loopback database required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS']) if(process.env[k]) throw Error(`Unexpected ${k}`);
const config={host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,statement_timeout:5000};
const db=new pg.Client(config), a=new pg.Client(config),b=new pg.Client(config);await Promise.all([db.connect(),a.connect(),b.connect()]);
let passed=0;const ok=label=>{passed++;console.log('PASS',label)};
async function seed(state='processing',hold='active',options={}){
 const t=randomUUID(),s=randomUUID(),booking=randomUUID(),payment=randomUUID();
 await db.query("insert into tenants(id,name,slug,timezone,currency) values($1::uuid,'Synthetic processing authority',$1::uuid::text,'UTC','USD')",[t]);
 await db.query("insert into services(id,tenant_id,name,archetype,currency,base_price,duration_minutes) values($1::uuid,$2,'Test','simple','USD',100,60)",[s,t]);
 await db.query(`insert into bookings(id,tenant_id,reference,idempotency_key,selection,pricing,slot_start,slot_end,state) values($1::uuid,$2,$1::uuid::text,$1::uuid::text,$3,'{"total":{"amount":100,"currency":"USD"}}','2035-05-01T10:00Z','2035-05-01T11:00Z','pending_payment')`,[booking,t,JSON.stringify({serviceId:s})]);
 await db.query("insert into payments(id,tenant_id,booking_id,provider,provider_intent_id,state,amount,currency) values($1::uuid,$2,$3,'stripe_connect',$1::uuid::text,$4,100,'USD')",[payment,t,booking,state]);
 if(hold!=='missing')await db.query("insert into capacity_holds(tenant_id,service_id,booking_id,slot_start,slot_end,hold_key,status,expires_at) values($1::uuid,$2,$3,'2035-05-01T10:00Z','2035-05-01T11:00Z',$3::uuid::text,$4,clock_timestamp()+$5::interval)",[t,s,booking,hold==='expired'?'active':hold,hold==='expired'?'-1 minute':'10 minutes']);
 await db.query('delete from payments where id=$1',[payment]);
 const suffix=t.replaceAll('-',''); const account='acct_'+suffix, platform='acct_platformAAA';
 await db.query("insert into payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected',$2,true)",[t,account]);
 const source=(await a.query('select id from register_payment_source_scope($1,$2,false)',[t,platform])).rows[0].id;
 const attempt=(await a.query('select id from bind_booking_payment_source($1,$2,$3)',[t,booking,source])).rows[0].id;
 await a.query("select snapshot_payment_attempt_request($1,$2,100,'USD')",[t,attempt]);
 if(options.envelope!==false)await a.query("select snapshot_payment_request_envelope($1,$2,'2024-06-20')",[t,attempt]);
 const intent=options.intent??('pi_'+payment.replaceAll('-',''));
 await a.query("select associate_payment_attempt_intent($1,$2,$3,$4,$5,false,100,'USD')",[t,attempt,intent,platform,account]);
 return {t,s,booking,payment,source,attempt,intent,platform,account};
}
const record=async(c,f,state='processing')=>(await c.query('select payment_internal.record_scoped_payment_observation($1,$2) r',[f.attempt,state])).rows[0].r;
const calls={confirm:(c,id)=>c.query('select confirm_succeeded_payment($1)',[id]),succeed:(c,id)=>c.query('select succeed_payment_webhook($1,100)',[id]),fail:(c,id)=>c.query('select fail_payment_webhook($1)',[id]),park:(c,id)=>c.query("select park_payment_webhook($1,'amount_mismatch',99)",[id]),refund:(c,id)=>c.query("select record_refund_webhook($1,'re_synthetic_denial',100,true,true)",[id])};
const snapshot=async(f,c=db)=>{const result={};for(const table of ['payments','bookings','capacity_holds','resource_reservations','refunds','payment_reviews','durable_outbox']){const column=table==='bookings'?'id':'booking_id';result[table]=(await c.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') r from public.${table} x where ${column}=$1`,[f.booking])).rows[0].r;}return result;};
const deny=(c,name,id)=>assert.rejects(calls[name](c,id),e=>e.code==='42501'&&e.message==='SCOPED_PAYMENT_PROCESSING_DISABLED');
const pid=async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid;
async function waitLock(id){for(let i=0;i<150;i++){if((await db.query('select wait_event_type from pg_stat_activity where pid=$1',[id])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,20));}throw Error('contender did not block');}
try{
 await a.query('set role service_role');await b.query('set role service_role');
 for(const state of ['requires_payment','processing','succeeded','failed','refunded','partially_refunded']){const f=await seed(),r=await record(a,f,state),before=await snapshot(f);for(const name of Object.keys(calls)){await deny(a,name,r.paymentId);assert.deepEqual(await snapshot(f),before);ok(name+' scoped '+state+' denied before any effects');}}
 // Partial corrupted pairs must deny on EITHER field, not require both.
 for(const absent of ['source_scope_id','attempt_id']){const f=await seed(),r=await record(a,f,'succeeded');await db.query('begin');await db.query('alter table payments drop constraint payments_provenance_pair');await db.query('alter table payments disable trigger payment_identity_admission_guard');await db.query('alter table payments disable trigger payment_provenance_guard');await db.query(`update payments set ${absent}=null where id=$1`,[r.paymentId]);await db.query('alter table payments enable trigger payment_identity_admission_guard');await db.query('alter table payments enable trigger payment_provenance_guard');const before=await snapshot(f);for(const name of Object.keys(calls)){await db.query('savepoint denial');await db.query('set local role service_role');await deny(db,name,r.paymentId);await db.query('rollback to denial');assert.deepEqual(await snapshot(f),before);ok(name+' partial-corruption '+absent+' absent still denied');}await db.query('rollback');}
 for(const name of Object.keys(calls)){const f=await seed(),r=await record(a,f),before=await snapshot(f);await a.query('begin');await record(a,f);const bp=await pid(b),pending=deny(b,name,r.paymentId);await waitLock(bp);await a.query('commit');await pending;assert.deepEqual(await snapshot(f),before);ok(name+' waits for scoped recorder then denies unchanged');}
 // New scoped anchor is not visible before commit; once visible cannot process.
 {const f=await seed();await a.query('begin');const r=await record(a,f,'succeeded');assert.equal((await calls.succeed(b,r.paymentId)).rows[0].succeed_payment_webhook.result,'NOT_FOUND');await a.query('commit');await deny(b,'succeed',r.paymentId);ok('uncommitted scoped anchor absent then committed denied');}
 for(const name of Object.keys(calls)){await db.query('begin');await db.query('set local role authenticated');await assert.rejects(calls[name](db,randomUUID()),e=>e.code==='42501');await db.query('rollback');}ok('client execution still forbidden');
 console.log(`${passed} actual PostgreSQL scoped financial denial checks passed; no financial activation`);
}finally{await db.query('rollback').catch(()=>{});await Promise.all([a.query('rollback').catch(()=>{}),b.query('rollback').catch(()=>{})]);await Promise.all([db.end(),a.end(),b.end()]);}
