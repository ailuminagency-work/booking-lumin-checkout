// Disposable actual PostgreSQL; no provider calls or runtime activation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:3});
const c=await pool.connect(),w=await pool.connect();
const t=randomUUID(),b=randomUUID(),other=randomUUID();
const material=async(client=c,tenant=t,attempt=a)=>(await client.query('select payment_internal.materialize_payment_request_envelope($1,$2) f',[tenant,attempt])).rows[0].f;
let a;
const save=async(client=c,version='2024-06-20',tenant=t,attempt=a)=>(await client.query('select * from public.snapshot_payment_request_envelope($1,$2,$3)',[tenant,attempt,version])).rows[0];
const denied=async(sql,pattern=/permission denied/)=>{await c.query('savepoint denied');await assert.rejects(c.query(sql),pattern);await c.query('rollback to denied');};
try{
 await c.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Envelope fixture',$1::uuid::text,'UTC','USD')",[t]);
 await c.query("insert into public.payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected','acct_envelopeAAA',true)",[t]);
 await c.query("insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values($1,$2,'ENVELOPE',now(),now()+interval '1 hour','synthetic-private-booking-key')",[b,t]);
 await c.query('set role service_role');
 const source=(await c.query("select id from public.register_payment_source_scope($1,'acct_platformAAA',false)",[t])).rows[0].id;
 a=(await c.query('select id from public.bind_booking_payment_source($1,$2,$3)',[t,b,source])).rows[0].id;
 await assert.rejects(save(),/PAYMENT_REQUEST_REQUIRED/);
 await c.query("select public.snapshot_payment_attempt_request($1,$2,1250,'USD')",[t,a]);
 assert.equal(await material(),null);
 await w.query('begin');await w.query('set local role service_role');const first=await save(w);
 await c.query("set statement_timeout='2s'");assert.equal(await material(),null);await w.query('commit');
 assert.deepEqual(await save(),first);assert.ok(!JSON.stringify(first).includes('synthetic-private'));assert.deepEqual(Object.keys(first).sort(),['api_version','attempt_id','created_at','serializer_version']);
 await assert.rejects(save(c,'2025-01-01'),/PAYMENT_ENVELOPE_CONFLICT/);
 for(const version of [null,'latest','2024-06-20\r\nInjected: bad','2024-06-20\n'])await assert.rejects(save(c,version),/INVALID_PAYMENT_ENVELOPE/);
 await assert.rejects(save(c,'2024-06-20',other),/PAYMENT_ATTEMPT_NOT_FOUND/);
 assert.equal(await material(c,other),null);assert.equal(await material(c,t,other),null);
 const m=await material();assert.equal(m.amount,1250);assert.equal(m.source.accountId,'acct_envelopeAAA');assert.equal(m.idempotencyKey,'synthetic-private-booking-key');
 const {serializeStripeRequestEnvelopeInternal}=await import('../../../packages/adapters/src/stripeRequestEnvelope.internal.ts');const request=serializeStripeRequestEnvelopeInternal(m);
 assert.equal(request.headers['Stripe-Version'],'2024-06-20');assert.equal(request.headers['Stripe-Account'],'acct_envelopeAAA');assert.equal(request.headers['Idempotency-Key'],m.idempotencyKey);assert.ok(!('Authorization' in request.headers));
 const restart=(await c.query('select public.read_payment_attempt_restart($1,$2) f',[t,b])).rows[0].f;assert.ok(!JSON.stringify(restart).includes(m.idempotencyKey));
 // Concurrent first writers on a separate attempt: exactly one version wins.
 await c.query('reset role');const raceBooking=randomUUID();
 await c.query("insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values($1,$2,'ENVELOPE-RACE',now(),now()+interval '1 hour','synthetic-envelope-race-key')",[raceBooking,t]);
 await c.query('set role service_role');const raceAttempt=(await c.query('select id from public.bind_booking_payment_source($1,$2,$3)',[t,raceBooking,source])).rows[0].id;
 await c.query("select public.snapshot_payment_attempt_request($1,$2,1250,'USD')",[t,raceAttempt]);await w.query('set role service_role');
 const raced=await Promise.allSettled([save(c,'2024-06-20',t,raceAttempt),save(w,'2025-01-01',t,raceAttempt)]);
 assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.filter(x=>x.status==='rejected'&&/PAYMENT_ENVELOPE_CONFLICT/.test(String(x.reason))).length,1);
 const winner=(await material(c,t,raceAttempt)).apiVersion;assert.ok(['2024-06-20','2025-01-01'].includes(winner));
 await w.query('reset role');
 await c.query('reset role');await c.query("update public.payment_connections set account_id='acct_reconnectedA',charges_enabled=false,blocked_reason='charges_disabled' where tenant_id=$1",[t]);
 await c.query("update public.bookings set state='failed' where id=$1",[b]);await c.query('set role service_role');assert.deepEqual(await material(),m);assert.deepEqual(await save(),first);
 await c.query('begin');await c.query('set transaction read only');assert.deepEqual(await material(),m);await c.query('commit');
 await c.query('reset role');await c.query('begin');
 for(const role of ['anon','authenticated']){
  assert.equal((await c.query("select has_schema_privilege($1,'payment_internal','USAGE') ok",[role])).rows[0].ok,false);
  assert.equal((await c.query("select has_function_privilege($1,'payment_internal.materialize_payment_request_envelope(uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,false);
  await c.query(`set local role ${role}`);await denied(`select payment_internal.materialize_payment_request_envelope('${t}','${a}')`);await denied(`select public.snapshot_payment_request_envelope('${t}','${a}','2024-06-20')`);await c.query('reset role');
 }
 await c.query('set local role service_role');await denied('select * from public.payment_request_envelopes');await denied('select api_version from public.payment_request_envelopes');await denied("update public.payment_request_envelopes set api_version='2025-01-01'");await c.query('reset role');await denied("update public.payment_request_envelopes set api_version='2025-01-01'",/PAYMENT_SOURCE_IMMUTABLE/);await denied('delete from public.payment_request_envelopes',/PAYMENT_SOURCE_IMMUTABLE/);await c.query('rollback');
 await c.query('begin');await c.query("update public.bookings set idempotency_key='synthetic-drifted-key' where id=$1",[b]);await c.query('set local role service_role');await denied(`select payment_internal.materialize_payment_request_envelope('${t}','${a}')`,/PAYMENT_ENVELOPE_CONFLICT/);await c.query('rollback');
 // Even matching corrupted stored header data must not escape materialization.
 await c.query('begin');await c.query('alter table public.booking_payment_attempt_sources disable trigger booking_payment_attempt_sources_immutable');
 const unsafe='synthetic-key-with\r\nInjected: value';
 await c.query('update public.booking_payment_attempt_sources set idempotency_key=$1 where id=$2',[unsafe,a]);
 await c.query('update public.bookings set idempotency_key=$1 where id=$2',[unsafe,b]);await c.query('set local role service_role');
 await denied(`select payment_internal.materialize_payment_request_envelope('${t}','${a}')`,/PAYMENT_ENVELOPE_CONFLICT/);
 await denied(`select public.snapshot_payment_request_envelope('${t}','${a}','2024-06-20')`,/PAYMENT_SOURCE_CONFLICT/);await c.query('rollback');
 for(const table of ['payments','payment_reviews','refunds'])assert.equal(Number((await c.query(`select count(*) n from public.${table} where tenant_id=$1`,[t])).rows[0].n),0);
 console.log('PASS actual envelope authority, version/replay isolation, private materialization, key non-disclosure, single-snapshot concurrent observation, historical read-only facts and no financial effects');
}finally{await c.query('rollback');await w.query('rollback');c.release();w.release();await pool.end();}
