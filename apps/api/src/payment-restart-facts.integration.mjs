// Disposable actual PostgreSQL; no provider calls or runtime activation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
if(process.env.FLOW_TEST_DISPOSABLE!=='1'||process.env.PGHOST!=='127.0.0.1'||!/^lumin_/.test(process.env.PGDATABASE??''))throw Error('Disposable loopback required');
for(const k of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])if(process.env[k])throw Error(`Unexpected ${k}`);
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER??'postgres',database:process.env.PGDATABASE,max:3});
const c=await pool.connect(),w=await pool.connect();
const t=randomUUID(),b=randomUUID(),other=randomUUID();
const read=async(client=c,tenant=t,booking=b)=>(await client.query('select public.read_payment_attempt_restart($1,$2) f',[tenant,booking])).rows[0].f;
const denied=async(sql,pattern=/permission denied/)=>{await c.query('savepoint denied');await assert.rejects(c.query(sql),pattern);await c.query('rollback to denied');};
try{
 await c.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Restart fixture',$1::uuid::text,'UTC','USD')",[t]);
 await c.query("insert into public.payment_connections(tenant_id,provider,status,account_id,charges_enabled) values($1,'stripe_connect','connected','acct_restartAAA',true)",[t]);
 await c.query("insert into public.bookings(id,tenant_id,reference,slot_start,slot_end,idempotency_key) values($1,$2,'RESTART',now(),now()+interval '1 hour','secret-capability-never-return')",[b,t]);
 await c.query('set role service_role');
 assert.equal(await read(),null);assert.equal(await read(c,other),null);assert.equal(await read(c,t,other),null);
 const s=(await c.query("select id from public.register_payment_source_scope($1,'acct_platformAAA',false)",[t])).rows[0].id;
 const s2=(await c.query("select id from public.register_payment_source_scope($1,'acct_platformAAA',true)",[t])).rows[0].id;
 const a=(await c.query('select id from public.bind_booking_payment_source($1,$2,$3)',[t,b,s])).rows[0].id;
 const bound=await read();assert.equal(bound.attempt_id,a);assert.equal(bound.source_bound,true);assert.equal(bound.request_recorded,false);assert.equal(bound.intent_associated,false);
 assert.equal(await read(c,other),null);
 assert.deepEqual(Object.keys(bound).sort(),['attempt_id','booking_id','intent','intent_associated','request','request_recorded','source','source_bound']);
 assert.ok(!JSON.stringify(bound).includes('secret-capability'));assert.ok(!JSON.stringify(bound).includes('retry'));
 // Writer remains uncommitted while reader must complete without waiting or dirty observation.
 await w.query('begin');await w.query('set local role service_role');
 await w.query("select public.snapshot_payment_attempt_request($1,$2,1250,'USD')",[t,a]);
 await c.query("set statement_timeout='2s'");assert.deepEqual(await read(),bound);
 await w.query('commit');const snapshot=await read();assert.deepEqual(snapshot.request,{amount:1250,currency:'USD',schema_version:1});
 await w.query('begin');await w.query('set local role service_role');
 await w.query("select public.associate_payment_attempt_intent($1,$2,'pi_restart','acct_platformAAA','acct_restartAAA',false,1250,'USD')",[t,a]);
 assert.deepEqual(await read(),snapshot);await w.query('commit');const complete=await read();assert.deepEqual(complete.intent,{provider_intent_id:'pi_restart'});assert.equal(complete.intent_associated,true);
 // Historical facts survive current connection changes and terminal booking; no revival.
 await c.query('reset role');await c.query("update public.payment_connections set account_id='acct_reconnectedA',charges_enabled=false,blocked_reason='charges_disabled' where tenant_id=$1",[t]);
 await c.query("update public.bookings set state='pending_payment' where id=$1",[b]);
 await c.query("update public.bookings set state='failed' where id=$1",[b]);
 await c.query('set role service_role');assert.deepEqual(await read(),complete);
 await c.query('begin');await c.query('set transaction read only');assert.deepEqual(await read(),complete);await c.query('commit');
 console.log('PASS unknown/cross-tenant, exact safe shape, original snapshot, historical source, terminal read-only and concurrent uncommitted observations');
 await c.query('reset role');await c.query('begin');
 for(const role of ['anon','authenticated']){
  await c.query(`set local role ${role}`);await denied(`select public.read_payment_attempt_restart('${t}','${b}')`);await c.query('reset role');
 }
 await c.query('set local role service_role');
 for(const table of ['payment_attempt_requests','payment_attempt_intents'])await denied(`select * from public.${table}`);
 await c.query('reset role');await c.query('rollback');
 // Rollback-only privileged corruption: never turn inconsistent binding into absence or facts.
 for(const sql of [
  `update public.bookings set idempotency_key='different-capability-value' where id='${b}'`,
  `alter table public.payment_attempt_intents disable trigger payment_attempt_intents_immutable; update public.payment_attempt_intents set source_scope_id='${s2}' where attempt_id='${a}'`,
 ]){
  await c.query('begin');await c.query(sql);await c.query('set local role service_role');await denied(`select public.read_payment_attempt_restart('${t}','${b}')`,/PAYMENT_RESTART_FACTS_CONFLICT/);await c.query('rollback');
 }
 assert.deepEqual(await read(),complete);
 for(const table of ['payments','payment_reviews','refunds'])assert.equal(Number((await c.query(`select count(*) n from public.${table} where tenant_id=$1`,[t])).rows[0].n),0);
 console.log('PASS client execution and direct ledger reads denied; corrupt binding fails closed; no financial side effects');
}finally{await c.query('rollback');await w.query('rollback');c.release();w.release();await pool.end();}
