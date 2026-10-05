import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';

assert.equal(process.env.CONFIRMATION_OUTBOX_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,process.env.CI==='true'?'5432':'55463');
assert.match(process.env.PGDATABASE??'',/^lumin_confirmation_outbox_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);

const pool=new Pool({max:8});
const id=(n:number)=>`63000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function confirm(payment:string){
 const connection=await pool.connect();
 try{
  await connection.query('begin');
  await connection.query("set local statement_timeout='10s'");
  await connection.query("set local application_name='confirmation-outbox-confirm'");
  await connection.query('set local role service_role');
  const result=(await connection.query('select public.confirm_succeeded_payment($1::uuid) result',[payment])).rows[0].result;
  await connection.query('commit');
  return result;
 }catch(error){await connection.query('rollback');throw error;}finally{connection.release();}
}

try{
 const target=(await pool.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')).rows[0];
 assert.equal(target.host,'127.0.0.1');assert.equal(String(target.port),process.env.PGPORT);assert.equal(target.database,process.env.PGDATABASE);
 assert.equal((await pool.query('select count(*)::int n from public.tenants where id in ($1::uuid,$2::uuid)',[id(3),id(4)])).rows[0].n,0,'fresh disposable database required; fixture identities already exist');
 // Reuse the same bounded SQL fixtures, excluding every assertion/attack and
 // rolling transaction. This harness owns only its synthetic tenant identities.
 const fixture=(await readFile(new URL('../../../supabase/tests/confirmation_outbox_tests.sql',import.meta.url),'utf8')).split('-- No new grants:')[0]!.replace(/^\\set.*$/gm,'');
 await pool.query(fixture+'commit;');
 for(const booking of [10,11]){
  const blocker=await pool.connect();
  await blocker.query('begin');
  await blocker.query('select id from public.payments where id=$1 for update',[id(booking+100)]);
  const pending=Promise.all([confirm(id(booking+100)),confirm(id(booking+100))]);
  let observed=false;
  try{
   for(let attempt=0;attempt<100;attempt++){
    const waiting=(await pool.query("select count(*)::int n from pg_stat_activity where datname=current_database() and application_name='confirmation-outbox-confirm' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0")).rows[0].n;
    if(waiting===2){observed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  }finally{await blocker.query('commit');blocker.release();}
  const receipts=await pending;
  assert.ok(observed,'both confirmation transactions must be observed waiting on the persisted payment lock');
  assert.deepEqual(receipts.map(receipt=>receipt.replayed).sort(),[false,true]);
  const envelopes=(await pool.query("select * from public.durable_outbox where tenant_id=$1 and booking_id=$2 and event_type='booking.confirmed'",[id(3),id(booking)])).rows;
  assert.equal(envelopes.length,1);
  assert.deepEqual(envelopes[0].payload,{});
  assert.equal(envelopes[0].dedup_key,id(booking));
  assert.equal(envelopes[0].state,'ready');assert.equal(envelopes[0].attempts,0);
  assert.equal((await confirm(id(booking+100))).replayed,true);
  assert.deepEqual((await pool.query('select * from public.durable_outbox where id=$1',[envelopes[0].id])).rows,envelopes);
  assert.equal((await pool.query("select count(*)::int n from public.booking_state_history where booking_id=$1 and to_state='confirmed'",[id(booking)])).rows[0].n,1);
 }
 // Queue delivery state is independent from confirmation replay. A leased
 // envelope must neither reset nor be replaced by another replay.
 const worker=await pool.connect();let leased;
 try{
  await worker.query('begin');await worker.query('set local role service_role');
  leased=(await worker.query('select * from public.outbox_lease($1,10,60)',[id(3)])).rows;
  assert.equal(leased.length,2);
  await worker.query('commit');
 }finally{worker.release();}
 for(const envelope of leased){
  const payment=(await pool.query('select payment_id from public.bookings where id=$1',[envelope.booking_id])).rows[0].payment_id;
  assert.equal((await confirm(payment)).replayed,true);
  assert.deepEqual((await pool.query('select * from public.durable_outbox where id=$1',[envelope.id])).rows[0],envelope);
 }
 console.log('PASS confirmation outbox: observed service/rental lock contention, one logical envelope and transition, exact repeated replay, empty payload, and unchanged leased delivery state');
}finally{await pool.end();}
