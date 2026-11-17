import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {Pool} from 'pg';
import {createConfirmationOutboxQueue} from './confirmation-outbox-queue.js';
import {createConfirmationOutboxWorker,confirmationDeliveryKey,type ConfirmationLease} from './confirmation-outbox-worker.js';
import {planNotifications} from '../../../packages/notifications/src/index.js';
import {baseConfig,bookingContext} from '../../../packages/notifications/test/fixtures.js';

assert.equal(process.env.CONFIRMATION_OUTBOX_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,process.env.CI==='true'?'5432':'55463');
assert.match(process.env.PGDATABASE??'',/^lumin_confirmation_outbox_/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const expectedServerHost=process.env.CONFIRMATION_OUTBOX_CI_SERVER_HOST;
if(process.env.CI==='true'){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(isIP(expectedServerHost??''),4);
 assert.match(expectedServerHost!,/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/);
}else assert.equal(expectedServerHost,undefined,'CI server override forbidden locally');
const id=(n:number)=>`64000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(3);
const pool=new Pool({max:8});
let restartedPool:Pool|undefined;
try{
 const target=(await pool.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')).rows[0];
 assert.equal(target.host,process.env.CI==='true'?expectedServerHost:'127.0.0.1');assert.equal(String(target.port),process.env.PGPORT);assert.equal(target.database,process.env.PGDATABASE);
 assert.equal((await pool.query('select count(*)::int n from public.tenants where id in ($1,$2)',[tenant,id(4)])).rows[0].n,0,'fresh disposable database required; fixture identities exist');
 // Fixture-only setup. No destructive global cleanup; reruns require a fresh DB.
 const fixture=(await readFile(new URL('../../../supabase/tests/confirmation_outbox_tests.sql',import.meta.url),'utf8')).split('-- No new grants:')[0]!.replace(/^\\set.*$/gm,'')
  .replaceAll('63000000','64000000').replaceAll('confirmation-outbox','confirmation-delivery-store').replaceAll('outbox-owner','delivery-store-owner').replaceAll('outbox-admin','delivery-store-admin');
 await pool.query(fixture+'commit;');
 await pool.query('select public.confirm_succeeded_payment($1),public.confirm_succeeded_payment($2)',[id(110),id(111)]);
 await pool.query("select public.outbox_enqueue($1,$2,'booking.requested',$3),public.outbox_enqueue($1,$4,'booking.changed',$5)",[tenant,id(12),id(212),id(13),id(213)]);
 await pool.query("update public.durable_outbox set state='leased',attempts=max_attempts,generation=1,lease_token=$2,lease_until=clock_timestamp()-interval '1 minute' where tenant_id=$1 and event_type<>'booking.confirmed'",[tenant,id(900)]);
 const unrelated=(await pool.query("select * from public.durable_outbox where tenant_id=$1 and event_type<>'booking.confirmed' order by id",[tenant])).rows;
 const queue=createConfirmationOutboxQueue(pool,tenant);
 const overlap=await Promise.all([queue.leaseConfirmed(tenant,10,60),queue.leaseConfirmed(tenant,10,60)]);
 const leases=overlap.flat() as ConfirmationLease[];
 assert.equal(leases.length,2);assert.equal(new Set(leases.map(row=>row.id)).size,2);
 const first=leases[0]!;
 assert.equal(await queue.isCurrent(first),true);
 assert.equal(await queue.isCurrent({...first,booking_id:id(14),dedup_key:id(14)}),false,'DB rejects mismatched booking metadata');
 assert.equal(await queue.ack({...first,booking_id:id(14),dedup_key:id(14)}),false);
 assert.equal(await queue.retry({...first,booking_id:id(14),dedup_key:id(14)},'permanent'),false);
 await assert.rejects(queue.isCurrent({...first,tenant_id:id(4)}),/INVALID_BINDING/);
 await assert.rejects(queue.isDelivered(confirmationDeliveryKey(id(4),first.booking_id,'email')),/INVALID_BINDING/);
 await assert.rejects(queue.recordDelivered(first,confirmationDeliveryKey(tenant,id(14),'email')),/INVALID_BINDING/);
 const emailKey=confirmationDeliveryKey(tenant,first.booking_id,'email');
 assert.deepEqual(await Promise.all([queue.recordDelivered(first,emailKey),queue.recordDelivered(first,emailKey)]),[true,true]);
 const receipts=(await pool.query('select * from public.confirmation_delivery_receipts where tenant_id=$1',[tenant])).rows;
 assert.equal(receipts.length,1);assert.equal(await queue.isDelivered(emailKey),true);
 assert.equal(await queue.recordDelivered(first,emailKey),true);
 assert.deepEqual((await pool.query('select * from public.confirmation_delivery_receipts where tenant_id=$1',[tenant])).rows,receipts);

 // Observe a receipt writer waiting on the queue lock. Expiry during that wait
 // must be evaluated after lock acquisition and leave no successful receipt.
 const blocker=await pool.connect();await blocker.query('begin');
 await blocker.query('select id from public.durable_outbox where id=$1 for update',[first.id]);
 const pending=queue.recordDelivered(first,confirmationDeliveryKey(tenant,first.booking_id,'sms'));
 let observed=false;
 try{
  for(let attempt=0;attempt<100;attempt++){
   const waiting=(await pool.query("select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 and query like '%select public.outbox_confirmation_record%'")).rows[0].n;
   if(waiting===1){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }
  await blocker.query("update public.durable_outbox set lease_until=clock_timestamp()-interval '1 minute' where id=$1",[first.id]);
 }finally{await blocker.query('commit');blocker.release();}
 assert.equal(await pending,false);assert.ok(observed,'receipt writer lock contention observed');
 assert.equal(await queue.isCurrent(first),false);
 const reclaimed=(await queue.leaseConfirmed(tenant,10,60)) as ConfirmationLease[];
 assert.equal(reclaimed.length,1);assert.equal(reclaimed[0]!.generation,first.generation+1);
 assert.equal(await queue.recordDelivered(first,confirmationDeliveryKey(tenant,first.booking_id,'sms')),false);
 for(const row of [reclaimed[0]!,leases[1]!])assert.equal(await queue.retry(row,'transient'),true);
 await pool.query("update public.durable_outbox set available_at=clock_timestamp()-interval '1 minute' where tenant_id=$1 and event_type='booking.confirmed'",[tenant]);

 const attempts=new Map<string,number>();let failSms=true;let failedBooking='';
 const provider={async send(_input:unknown,key:string){attempts.set(key,(attempts.get(key)??0)+1);
  if(key.endsWith(':sms')&&failSms){failSms=false;failedBooking=key.split(':')[1]!;return {kind:'transient' as const};}return {kind:'sent' as const};}};
 async function loadContext(boundTenant:string,booking:string){
  assert.equal(boundTenant,tenant);
  const row=(await pool.query('select b.id,b.tenant_id,b.state,b.reference,b.slot_start,b.slot_end,t.name from public.bookings b join public.tenants t on t.id=b.tenant_id where b.tenant_id=$1 and b.id=$2',[tenant,booking])).rows[0];
  assert.equal(row.state,'confirmed');
  const context=bookingContext({id:row.id,state:'confirmed',reference:row.reference,slotStart:row.slot_start.toISOString(),slotEnd:row.slot_end.toISOString()});context.tenant={id:row.tenant_id,name:row.name};
  return {bookingTenantId:row.tenant_id,context,config:baseConfig({tenantId:tenant})};
 }
 const dependencies={provider,loadContext,plan:(context:Parameters<typeof planNotifications>[1],config:Parameters<typeof planNotifications>[2],now:string)=>planNotifications('booking.confirmed',context,config,now),now:()=>Date.now()};
 const outcomes=(await createConfirmationOutboxWorker({queue,...dependencies}).runBatch(tenant,{concurrency:1})).outcomes.sort();
 assert.deepEqual(outcomes,['completed','retry']);
 const priorEmailAttempts=attempts.get(confirmationDeliveryKey(tenant,failedBooking,'email'))??0;
 await pool.query("update public.durable_outbox set available_at=clock_timestamp()-interval '1 minute' where tenant_id=$1 and state='ready' and event_type='booking.confirmed'",[tenant]);
 // Recreate both the pool/adapter and worker: successful channel receipts must
 // come from PostgreSQL, never the old worker's memory.
 restartedPool=new Pool({max:4});
 const restartedQueue=createConfirmationOutboxQueue(restartedPool,tenant);
 assert.equal(await restartedQueue.isDelivered(emailKey),true);
 assert.deepEqual(await createConfirmationOutboxWorker({queue:restartedQueue,...dependencies}).runBatch(tenant),{outcomes:['completed']});
 assert.equal(attempts.get(confirmationDeliveryKey(tenant,failedBooking,'email'))??0,priorEmailAttempts);
 assert.equal(attempts.get(confirmationDeliveryKey(tenant,failedBooking,'sms')),2);
 assert.equal((await pool.query('select count(*)::int n from public.confirmation_delivery_receipts where tenant_id=$1',[tenant])).rows[0].n,4);
 assert.deepEqual((await pool.query("select * from public.durable_outbox where tenant_id=$1 and event_type<>'booking.confirmed' order by id",[tenant])).rows,unrelated);
 assert.deepEqual(await restartedQueue.leaseConfirmed(tenant,10,60),[]);
 // A second, distinct wait exists AFTER the outbox lock/deadline check:
 // the receipt INSERT needs a booking FK KEY SHARE lock. It must not commit
 // a receipt if a booking FOR UPDATE holder releases after lease expiry.
 await pool.query('select public.confirm_succeeded_payment($1)',[id(114)]);
 const bookingBlocker=await pool.connect();await bookingBlocker.query('begin');
 const blockerPid=(await bookingBlocker.query('select pg_backend_pid() pid')).rows[0].pid;
 await bookingBlocker.query('select id from public.bookings where id=$1 for update',[id(14)]);
 const short=(await restartedQueue.leaseConfirmed(tenant,1,1))[0] as ConfirmationLease;
 assert.equal(short.booking_id,id(14));
 const lateKey=confirmationDeliveryKey(tenant,id(14),'email');
 const late=restartedQueue.recordDelivered(short,lateKey);
 let fkWaitObserved=false;
 try{
  for(let attempt=0;attempt<100;attempt++){
   const waiting=(await pool.query("select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and $1::integer=any(pg_blocking_pids(pid)) and query like '%select public.outbox_confirmation_record%'",[blockerPid])).rows[0].n;
   if(waiting===1){fkWaitObserved=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
  }
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(short.lease_until)+50-Date.now())));
 }finally{await bookingBlocker.query('commit');bookingBlocker.release();}
 assert.equal(await late,false);assert.ok(fkWaitObserved,'receipt insertion observed waiting on booking FK lock');
 assert.equal(await restartedQueue.isDelivered(lateKey),false,'late FK insertion must roll back its receipt');
 assert.equal((await pool.query('select count(*)::int n from public.confirmation_delivery_receipts where tenant_id=$1 and booking_id=$2',[tenant,id(14)])).rows[0].n,0);
 assert.equal(await restartedQueue.ack(short),false);
 const fresh=(await restartedQueue.leaseConfirmed(tenant,1,60))[0] as ConfirmationLease;
 assert.equal(fresh.generation,short.generation+1);
 assert.equal(await restartedQueue.recordDelivered(fresh,lateKey),true);
 assert.equal(await restartedQueue.ack(fresh),true);
 console.log('PASS confirmation delivery store: filtered concurrent leasing, immutable channel receipts, tenant/booking binding, observed outbox/FK expiry-wait rollback, stale generation, mock partial-send recovery across pool/worker restart, unrelated-event preservation');
}finally{await restartedPool?.end();await pool.end();}
