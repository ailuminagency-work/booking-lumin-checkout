import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {Pool as PgPool} from 'pg';
import type {ConfirmationQueue,ConfirmationLease,ConfirmationDeliveryProvider} from './confirmation-outbox-worker.js';

// Local/registered CI test only: synthetic data in a fresh disposable DB. No provider
// activation, external requests, scheduler, or production entrypoint.
assert.equal(process.env.CONFIRMATION_PLANNER_DELIVERY_LOCAL_TEST,'1');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,process.env.CI==='true'?'5432':'55436');
assert.match(process.env.PGDATABASE??'',/^lumin_phase_a_confirmation_planner_delivery_[a-z0-9_]+$/);
for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const expectedServerHost=process.env.CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST;
if(process.env.CI==='true'){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(isIP(expectedServerHost??''),4);
 assert.match(expectedServerHost!,/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/);
}else assert.equal(expectedServerHost,undefined,'CI server override forbidden locally');
const childMode=process.env.CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE;
if(childMode!==undefined||process.env.CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN!==undefined){
 assert.equal(process.env.CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN,'1');
 assert.ok(childMode==='deliver'||childMode==='recover');
 assert.ok(process.send&&process.connected,'child execution requires parent IPC');
}
// Unsafe entrypoints reject before loading the database/worker/schema graph.
// Dynamic imports preserve the exact positive fixture but avoid transforming
// unrelated runtime modules for every denial subprocess under the full suite.
const {Pool}=await import('pg');
const {createNotificationPlannerConfigApi}=await import('./notification-planner-config.js');
const {createConfirmationContextLoader}=await import('./confirmation-context-loader.js');
const {createConfirmationOutboxQueue}=await import('./confirmation-outbox-queue.js');
const {createConfirmationOutboxWorker,confirmationDeliveryKey}=await import('./confirmation-outbox-worker.js');
const {planNotifications}=await import('../../../packages/notifications/src/index.js');
const {createMockNotificationProvider}=await import('../../../packages/adapters/src/mockNotification.js');
const id=(n:number)=>`66010000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(3),connection=id(9),pool=new Pool({max:6});

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function authorityFingerprint(p:PgPool){return (await p.query(`select jsonb_build_object('bookings',(select jsonb_agg(to_jsonb(x) order by id) from public.bookings x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from public.payments x),'refunds',(select jsonb_agg(to_jsonb(x) order by id) from public.refunds x),'connections',(select jsonb_agg((to_jsonb(x)-'updated_at') order by id) from public.notification_connections x),'secrets',(select jsonb_agg(to_jsonb(x) order by connection_id) from public.notification_connection_secrets x),'holds',(select jsonb_agg(to_jsonb(x) order by id) from public.capacity_holds x),'reservations',(select jsonb_agg(to_jsonb(x) order by id) from public.resource_reservations x)) result` )).rows[0].result;}
async function fullFingerprint(p:PgPool){return {authority:await authorityFingerprint(p),operational:(await p.query(`select jsonb_build_object('queue',(select jsonb_agg(to_jsonb(x) order by id) from public.durable_outbox x),'receipts',(select jsonb_agg(to_jsonb(x) order by tenant_id,booking_id,channel) from public.confirmation_delivery_receipts x),'planner',(select jsonb_agg(to_jsonb(x) order by tenant_id) from public.tenant_notification_planner_configs x)) result`)).rows[0].result};}
type ChildProof={mode:'deliver'|'recover';pid:number;mockSendCount:number;settingsRevision:number;settingsDigest:string;authorityDigest:string};
async function childProof(mode:'deliver'|'recover'):Promise<ChildProof>{
 // The child never seeds, discovers, changes provider bindings, or accepts IDs.
 assert.equal((await pool.query('select count(*)::int n from public.tenants')).rows[0].n,2);
 const owner=await createNotificationPlannerConfigApi(pool).read(id(1),tenant);
 assert.ok(owner);assert.equal(owner.revision,1);assert.equal(owner.config.timezone,'UTC');
 const mock=createMockNotificationProvider(),queue=createConfirmationOutboxQueue(pool,tenant);
 const binding={tenantId:tenant,connectionId:connection,providerName:mock.providerName,supportedChannels:['email','sms'] as const};
 const loadContext=createConfirmationContextLoader(pool,binding);
 assert.equal((await loadContext(tenant,id(10))).bookingTenantId,tenant);
 const before=await fullFingerprint(pool);
 const worker=createConfirmationOutboxWorker({queue,loadContext,provider:{async send(input){await mock.send(input);return {kind:'sent'};}},plan:(ctx,cfg,now)=>planNotifications('booking.confirmed',ctx,cfg,now),now:Date.now});
 assert.deepEqual((await worker.runBatch(tenant,{limit:1})).outcomes,mode==='deliver'?['completed']:[]);
 assert.equal(await queue.isDelivered(confirmationDeliveryKey(tenant,id(10),'email')),true);
 assert.equal(await queue.isDelivered(confirmationDeliveryKey(tenant,id(10),'sms')),true);
 assert.equal((await pool.query('select state from public.durable_outbox where tenant_id=$1 and booking_id=$2',[tenant,id(10)])).rows[0].state,'completed');
 assert.equal(mock.sentMessages().length,mode==='deliver'?2:0);
 if(mode==='deliver'){assert.ok(mock.sentMessages()[0]!.variables.body!.includes('Saved planner'));assert.equal(mock.sentMessages()[0]!.to,'synthetic@example.test');}
 const after=await fullFingerprint(pool);assert.deepEqual(after.authority,before.authority);
 if(mode==='recover')assert.deepEqual(after,before,'process B must not change planner/ledger/queue/financial/provider state');
 return {mode,pid:process.pid,mockSendCount:mock.sentMessages().length,settingsRevision:owner.revision,settingsDigest:digest(owner),authorityDigest:digest(after.authority)};
}
async function runChild(mode:'deliver'|'recover'):Promise<ChildProof>{
 return new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(import.meta.url),[],{execArgv:['--import','tsx'],env:{...process.env,CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE:mode,CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN:'1'},stdio:['ignore','ignore','ignore','ipc']});
  let proof:ChildProof|undefined;const timer=setTimeout(()=>{child.kill();reject(new Error('LOCAL_CHILD_PROOF_TIMEOUT'));},30000);
  child.once('message',value=>{proof=value as ChildProof;});child.once('error',()=>{clearTimeout(timer);reject(new Error('LOCAL_CHILD_PROOF_UNAVAILABLE'));});
  child.once('close',code=>{clearTimeout(timer);if(code!==0||!proof||proof.mode!==mode||proof.pid===process.pid){reject(new Error('LOCAL_CHILD_PROOF_FAILED'));return;}resolve(proof);});
 });
}
let proof:ChildProof|undefined;
try{
 const target=(await pool.query('select host(inet_server_addr()) host,inet_server_port() port,current_database() database')).rows[0];
 assert.equal(target.host,process.env.CI==='true'?expectedServerHost:'127.0.0.1');assert.equal(String(target.port),process.env.PGPORT);assert.equal(target.database,process.env.PGDATABASE);
 if(childMode){proof=await childProof(childMode as 'deliver'|'recover');}else{
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
 const fingerprint=()=>authorityFingerprint(pool);
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
 await due(10);
 const processA=await runChild('deliver'); // Promise resolves only after A exits.
 assert.equal(processA.mockSendCount,2);assert.equal(processA.settingsRevision,saved.revision);
 assert.equal(processA.settingsDigest,digest(saved));assert.equal(processA.authorityDigest,digest(await fingerprint()));
 assert.deepEqual(await receipts(10),[{channel:'email'},{channel:'sms'}]);assert.equal(await state(10),'completed');
 const processB=await runChild('recover');
 assert.equal(processB.mockSendCount,0);assert.equal(processB.settingsDigest,processA.settingsDigest);
 assert.equal(processB.authorityDigest,processA.authorityDigest);assert.equal(mock.sentMessages().length,0,'parent mock is independent from both child processes');
 console.log('PASS OS-process A exited after persisted mock receipts/ack; separate process B loaded same planner/receipts, sent zero and changed no state');
 // Partial channel failure: successful email remains durable, only SMS retries.
 await due(11);let failSms=true;const partial:ConfirmationDeliveryProvider={async send(input,key){if(input.channel==='sms'&&failSms){failSms=false;return {kind:'transient'};}return provider.send(input,key);}};
 assert.deepEqual((await worker(queue,partial).runBatch(tenant,{limit:1})).outcomes,['retry']);assert.deepEqual(await receipts(11),[{channel:'email'}]);await due(11);
 assert.deepEqual((await worker(queue,partial).runBatch(tenant,{limit:1})).outcomes,['completed']);assert.deepEqual(await receipts(11),[{channel:'email'},{channel:'sms'}]);assert.equal(mock.sentMessages().filter(m=>m.channel==='email').length,1);
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
}
}finally{await pool.end();}
if(proof){await new Promise<void>((resolve,reject)=>process.send!(proof,error=>error?reject(new Error('LOCAL_CHILD_PROOF_UNAVAILABLE')):resolve()));process.disconnect();}
