import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {createNotificationPlannerConfigApi} from './notification-planner-config.js';
import {createConfirmationContextLoader} from './confirmation-context-loader.js';
import {createConfirmationOutboxQueue} from './confirmation-outbox-queue.js';
import {createConfirmationOutboxWorker,confirmationDeliveryKey,type ConfirmationQueue,type ConfirmationLease,type ConfirmationDeliveryProvider} from './confirmation-outbox-worker.js';
import {planNotifications} from '../../../packages/notifications/src/index.js';
import {createMockNotificationProvider} from '../../../packages/adapters/src/mockNotification.js';

// Local test only: creates synthetic data in a fresh disposable DB. No provider
// activation, external requests, scheduler, or production entrypoint.
assert.equal(process.env.CONFIRMATION_PLANNER_DELIVERY_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'55436');
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_confirmation_planner_delivery_[a-z0-9_]+$/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const id=(n:number)=>`66010000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(3),connection=id(9),pool=new Pool({max:6});
try{
 const target=(await pool.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')).rows[0];
 assert.equal(target.host,'127.0.0.1');assert.equal(String(target.port),'55436');assert.equal(target.database,process.env.PGDATABASE);
 assert.equal((await pool.query('select count(*)::int n from public.tenants')).rows[0].n,0,'fresh empty database required');
 const fixture=(await readFile(new URL('../../../supabase/tests/confirmation_outbox_tests.sql',import.meta.url),'utf8')).split('-- No new grants:')[0]!.replace(/^\\set.*$/gm,'').replaceAll('63000000','66010000').replaceAll('confirmation-outbox','planner-delivery').replaceAll('outbox-owner','planner-delivery-owner').replaceAll('outbox-admin','planner-delivery-admin');
 await pool.query(fixture+'commit;');
 await pool.query('insert into public.customers(id,tenant_id,name,email,phone) values($1,$2,$3,$4,$5)',[id(8),tenant,'Synthetic customer','synthetic@example.test','+12065550123']);
 await pool.query('update public.bookings set customer_id=$1 where tenant_id=$2',[id(8),tenant]);
 await pool.query("insert into public.notification_connections(id,tenant_id,provider,status,config) values($1,$2,'mock-notification','connected',$3)",[connection,tenant,{label:'Fixture-only preselected mock adapter; no credentials'}]);
 await pool.query("insert into public.notification_connection_secrets(connection_id,tenant_id,credentials_encrypted) values($1,$2,decode('010203','hex'))",[connection,tenant]);
 for(const n of [10,11,14,15])await pool.query('select public.confirm_succeeded_payment($1)',[id(n+100)]);
 // Keep not-yet-tested confirmed rows outside the batch; fixture-only queue timing.
 await pool.query("update public.durable_outbox set available_at=clock_timestamp()+interval '1 day' where tenant_id=$1 and booking_id<>$2",[tenant,id(10)]);
 // Fixture temporarily disconnects its own mock connection below; compare
 // all connection authority/configuration fields while excluding update timestamp.
 const fingerprint=async()=> (await pool.query(`select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(x) order by id) from public.bookings x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.payments x),'refunds',(select jsonb_agg(to_jsonb(x) order by id) from public.refunds x),'connections',(select jsonb_agg((to_jsonb(x)-'updated_at') order by id) from public.notification_connections x),'secrets',(select jsonb_agg(to_jsonb(x) order by connection_id) from public.notification_connection_secrets x),'holds',(select jsonb_agg(to_jsonb(x) order by id) from public.capacity_holds x),'reservations',(select jsonb_agg(to_jsonb(x) order by id) from public.resource_reservations x)) result`)).rows[0].result;
 const before=await fingerprint(),queue=createConfirmationOutboxQueue(pool,tenant),mock=createMockNotificationProvider();
 const binding={tenantId:tenant,connectionId:connection,providerName:mock.providerName,supportedChannels:['email','sms'] as const};
 const loadContext=createConfirmationContextLoader(pool,binding),api=createNotificationPlannerConfigApi(pool);
 const provider:ConfirmationDeliveryProvider={async send(input){await mock.send(input);return {kind:'sent'};}};
 const plan=(ctx:Parameters<typeof planNotifications>[1],config:Parameters<typeof planNotifications>[2],now:string)=>planNotifications('booking.confirmed',ctx,config,now);
 const worker=(q:ConfirmationQueue=queue,p:ConfirmationDeliveryProvider=provider,loader=loadContext)=>createConfirmationOutboxWorker({queue:q,provider:p,loadContext:loader,plan,now:Date.now});
 const due=async(n:number)=>{await pool.query("update public.durable_outbox set available_at=clock_timestamp()-interval '1 second' where tenant_id=$1 and booking_id=$2",[tenant,id(n)]);};
 const receipts=async(n:number)=>(await pool.query('select channel from public.confirmation_delivery_receipts where tenant_id=$1 and booking_id=$2 order by channel',[tenant,id(n)])).rows;
 const state=async(n:number)=>(await pool.query('select state from public.durable_outbox where tenant_id=$1 and booking_id=$2',[tenant,id(n)])).rows[0].state;
 // Missing persisted planner cannot use connection.config as fallback.
 assert.equal(await api.read(id(1),tenant),null);
 assert.deepEqual((await worker().runBatch(tenant,{limit:1})).outcomes,['retry']);assert.equal(mock.sentMessages().length,0);
 const config={tenantId:tenant,locale:'en-US',timezone:'UTC',sender:{emailFrom:'fixture@example.test',smsFrom:'+12065550123'},events:[{event:'booking.confirmed' as const,channels:['email','sms'] as Array<'email'|'sms'>}],reminders:[],templates:[{trigger:'booking.confirmed' as const,channel:'email' as const,locale:'en-US',subject:'Saved {{bookingReference}}',body:'Saved planner {{tenantName}}: {{total}}'},{trigger:'booking.confirmed' as const,channel:'sms' as const,locale:'en-US',body:'Saved {{bookingReference}}'}]};
 const saved=await api.save(id(1),tenant,{expectedRevision:0,config});assert.equal(saved.revision,1);
 await pool.query("update public.notification_connections set status='not_connected' where id=$1",[connection]);await due(10);
 assert.deepEqual((await worker().runBatch(tenant,{limit:1})).outcomes,['retry']);assert.equal(mock.sentMessages().length,0);
 await pool.query("update public.notification_connections set status='connected' where id=$1",[connection]);
 const foreignLoader=createConfirmationContextLoader(pool,{...binding,tenantId:id(4)});await due(10);
 assert.deepEqual((await worker(queue,provider,foreignLoader).runBatch(tenant,{limit:1})).outcomes,['retry']);assert.equal(mock.sentMessages().length,0);
 await due(10);assert.deepEqual((await worker().runBatch(tenant,{limit:1})).outcomes,['completed']);assert.deepEqual(await receipts(10),[{channel:'email'},{channel:'sms'}]);assert.equal(await state(10),'completed');
 const first=mock.sentMessages();assert.equal(first.length,2);assert.ok(first[0]!.variables.body!.includes('Saved planner'));assert.equal(first[0]!.to,'synthetic@example.test');
 const restartedPool=new Pool({max:2});
 try{
  const restartedQueue=createConfirmationOutboxQueue(restartedPool,tenant);
  assert.equal(await restartedQueue.isDelivered(confirmationDeliveryKey(tenant,id(10),'email')),true);
  assert.equal(await restartedQueue.isDelivered(confirmationDeliveryKey(tenant,id(10),'sms')),true);
  const restarted=createConfirmationOutboxWorker({queue:restartedQueue,provider,loadContext:createConfirmationContextLoader(restartedPool,binding),plan,now:Date.now});
  assert.deepEqual((await restarted.runBatch(tenant,{limit:1})).outcomes,[]);assert.equal(mock.sentMessages().length,2,'fresh pool/queue/worker cannot resend durable channels');
 }finally{await restartedPool.end();}
 // Partial channel failure: successful email remains durable, only SMS retries.
 await due(11);let failSms=true;const partial:ConfirmationDeliveryProvider={async send(input,key){if(input.channel==='sms'&&failSms){failSms=false;return {kind:'transient'};}return provider.send(input,key);}};
 assert.deepEqual((await worker(queue,partial).runBatch(tenant,{limit:1})).outcomes,['retry']);assert.deepEqual(await receipts(11),[{channel:'email'}]);await due(11);
 assert.deepEqual((await worker(queue,partial).runBatch(tenant,{limit:1})).outcomes,['completed']);assert.deepEqual(await receipts(11),[{channel:'email'},{channel:'sms'}]);assert.equal(mock.sentMessages().filter(m=>m.channel==='email').length,2);
 // An expired lease cannot send, record or acknowledge.
 await due(14);const expired=(await queue.leaseConfirmed(tenant,1,60))[0] as ConfirmationLease;
 await pool.query("update public.durable_outbox set lease_until=clock_timestamp()-interval '1 second' where id=$1",[expired.id]);
 const beforeExpired=mock.sentMessages().length;
 assert.deepEqual((await worker({...queue,leaseConfirmed:async()=>[expired]}).runBatch(tenant,{limit:1})).outcomes,['stale']);assert.equal(mock.sentMessages().length,beforeExpired);assert.deepEqual(await receipts(14),[]);assert.equal(await state(14),'leased');
 assert.deepEqual((await worker().runBatch(tenant,{limit:1})).outcomes,['completed']);
 // Deliberately lose lease after mock send: no stale receipt/ack. The existing
 // mock has no provider-side idempotency, so reclaim MAY duplicate that send.
 await due(15);let expireAfterSend=true;const keys:string[]=[];
 const lost:ConfirmationDeliveryProvider={async send(input,key){keys.push(key);const result=await provider.send(input,key);if(expireAfterSend){expireAfterSend=false;await pool.query("update public.durable_outbox set lease_until=clock_timestamp()-interval '1 second' where tenant_id=$1 and booking_id=$2 and state='leased'",[tenant,id(15)]);}return result;}};
 assert.deepEqual((await worker(queue,lost).runBatch(tenant,{limit:1})).outcomes,['stale']);assert.deepEqual(await receipts(15),[]);assert.equal(await state(15),'leased');
 assert.deepEqual((await worker(queue,lost).runBatch(tenant,{limit:1})).outcomes,['completed']);assert.equal(keys[0],keys[1],'same stable key, but mock may repeat before durable receipt');assert.equal(keys.length,3);
 assert.deepEqual(await fingerprint(),before,'planner delivery must not mutate provider/secrets/financial state');
 console.log('PASS local saved planner -> canonical loader -> MOCK worker/ledger/ack; unavailable bindings; partial retry; expiry fencing; preserved authority (no external exactly-once claim)');
}finally{await pool.end();}
