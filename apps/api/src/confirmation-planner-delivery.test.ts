import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {createNotificationPlannerConfigApi} from './notification-planner-config';
import {createConfirmationContextLoader} from './confirmation-context-loader';
import {createConfirmationOutboxWorker,type ConfirmationQueue,type ConfirmationDeliveryProvider} from './confirmation-outbox-worker';
import {planNotifications} from '../../../packages/notifications/src/index';
import {createMockNotificationProvider} from '../../../packages/adapters/src/mockNotification';
const id=(n:number)=>`66020000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenant=id(1),booking=id(2),stamp=Date.parse('2030-01-01T00:00:00Z');
const config={tenantId:tenant,locale:'en-US',timezone:'UTC',sender:{emailFrom:'synthetic@example.test',smsFrom:'+12065550123'},events:[{event:'booking.confirmed' as const,channels:['email','sms'] as Array<'email'|'sms'>}],reminders:[],templates:[{trigger:'booking.confirmed' as const,channel:'email' as const,locale:'en-US',body:'Saved {{tenantName}} {{total}}'},{trigger:'booking.confirmed' as const,channel:'sms' as const,locale:'en-US',body:'Saved {{bookingReference}}'}]};
function setup(){
 let stored:unknown=null,current=true,done=false;
 const snapshot={tenant:{id:tenant,name:'Synthetic business',status:'active',timezone:'UTC'},booking:{id:booking,tenantId:tenant,state:'confirmed',reference:'LMN-SYNTHETIC',customerId:id(3),serviceId:id(4),slotStart:'2035-01-01T09:00:00.000Z',slotEnd:'2035-01-01T10:00:00.000Z',total:{amount:12500,currency:'USD'}},customer:{id:id(3),tenantId:tenant,name:'Synthetic customer',email:'synthetic@example.test',phone:'+12065550123'},service:{id:id(4),tenantId:tenant,active:true,currency:'USD'},connection:{id:id(5),tenantId:tenant,provider:'mock-notification',status:'connected'}};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('save_notification_planner_config')){stored={schemaVersion:1,tenantId:tenant,revision:1,config:JSON.parse(args![3] as string)};return {rows:[{result:stored}]};}if(sql.includes('owner_notification_planner_config'))return{rows:[{result:stored}]};if(sql.startsWith('select jsonb_build_object'))return{rows:[{result:{...snapshot,planner:stored}}]};return{rows:[]};});
 const pool={connect:async()=>({query,release:vi.fn()})} as unknown as Pool;
 const loader=createConfirmationContextLoader(pool,{tenantId:tenant,connectionId:id(5),providerName:'mock-notification',supportedChannels:['email','sms']});
 const lease={id:id(6),tenant_id:tenant,booking_id:booking,dedup_key:booking,event_type:'booking.confirmed',payload:{},state:'leased' as const,lease_token:id(7),generation:1,lease_until:new Date(stamp+60000).toISOString(),attempts:1,max_attempts:5};
 const ledger=new Set<string>();
 const queue:ConfirmationQueue={leaseConfirmed:vi.fn(async()=>done?[]:[lease]),isCurrent:vi.fn(async()=>current),isDelivered:vi.fn(async key=>ledger.has(key)),recordDelivered:vi.fn(async(_lease,key)=>{if(!current)return false;ledger.add(key);return true;}),ack:vi.fn(async()=>{if(!current)return false;done=true;return true;}),retry:vi.fn(async()=>current)};
 const mock=createMockNotificationProvider(),provider:ConfirmationDeliveryProvider={async send(input){await mock.send(input);return{kind:'sent'};}};
 const worker=(p=provider)=>createConfirmationOutboxWorker({queue,provider:p,loadContext:loader,plan:(ctx,cfg,now)=>planNotifications('booking.confirmed',ctx,cfg,now),now:()=>stamp});
 return{api:createNotificationPlannerConfigApi(pool),query,snapshot,queue,ledger,mock,provider,worker,expire:()=>{current=false;},lease};
}
it('composes strict saved planner -> canonical loader -> rendered mock delivery -> channel receipts/ack and restart',async()=>{const h=setup();await h.api.save(id(8),tenant,{expectedRevision:0,config});expect((await h.worker().runBatch(tenant)).outcomes).toEqual(['completed']);expect(h.mock.sentMessages().map(m=>m.channel)).toEqual(['email','sms']);expect(h.mock.sentMessages()[0]!.variables.body).toContain('Saved Synthetic business');expect(h.ledger.size).toBe(2);expect(h.queue.ack).toHaveBeenCalledOnce();expect(h.query.mock.calls.some(([sql])=>sql.includes('public.runtime_notification_planner_config(b.tenant_id)'))).toBe(true);expect((await h.worker().runBatch(tenant)).outcomes).toEqual([]);expect(h.mock.sentMessages()).toHaveLength(2);});
it.each(['missing','disconnected','wrongtenant','wrongprovider'] as const)('never sends for %s persisted authority',async change=>{const h=setup();if(change!=='missing')await h.api.save(id(8),tenant,{expectedRevision:0,config});if(change==='disconnected')h.snapshot.connection.status='not_connected';if(change==='wrongtenant')h.snapshot.customer.tenantId=id(99);if(change==='wrongprovider')h.snapshot.connection.provider='other';expect((await h.worker().runBatch(tenant)).outcomes).toEqual(['retry']);expect(h.mock.sentMessages()).toHaveLength(0);expect(h.queue.recordDelivered).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();});
it('expired lease before loading produces no send/receipt/ack',async()=>{const h=setup();await h.api.save(id(8),tenant,{expectedRevision:0,config});h.expire();expect((await h.worker().runBatch(tenant)).outcomes).toEqual(['stale']);expect(h.mock.sentMessages()).toHaveLength(0);expect(h.queue.recordDelivered).not.toHaveBeenCalled();expect(h.queue.ack).not.toHaveBeenCalled();});
it('lease lost after mock send cannot produce a stale receipt or acknowledgement',async()=>{const h=setup();await h.api.save(id(8),tenant,{expectedRevision:0,config});const p:ConfirmationDeliveryProvider={async send(input,key){const result=await h.provider.send(input,key);h.expire();return result;}};expect((await h.worker(p).runBatch(tenant)).outcomes).toEqual(['stale']);expect(h.mock.sentMessages()).toHaveLength(1);expect(h.ledger.size).toBe(0);expect(h.queue.ack).not.toHaveBeenCalled();});
it('partial failure retains email receipt and retry sends only missing SMS without changing persisted configuration',async()=>{const h=setup();await h.api.save(id(8),tenant,{expectedRevision:0,config});let first=true;const p:ConfirmationDeliveryProvider={async send(input,key){if(input.channel==='sms'&&first){first=false;return{kind:'transient'};}return h.provider.send(input,key);}};expect((await h.worker(p).runBatch(tenant)).outcomes).toEqual(['retry']);expect(h.ledger.size).toBe(1);expect((await h.worker(p).runBatch(tenant)).outcomes).toEqual(['completed']);expect(h.mock.sentMessages().map(m=>m.channel)).toEqual(['email','sms']);expect((await h.api.read(id(8),tenant))?.config).toEqual(config);expect(h.query.mock.calls.filter(([sql])=>sql.includes('save_notification_planner_config'))).toHaveLength(1);});

// Execute the real entrypoint with invalid targets: each must stop at its
// assertion gates before any Pool connection or fixture mutation is possible.
// A resolver trap proves denial happens before any database or worker module
// loads, rather than merely hoping the heavy graph starts within the deadline.
const guardImportTrap='data:text/javascript,'+encodeURIComponent("import {register} from 'node:module'; register('data:text/javascript,'+encodeURIComponent(\"export async function resolve(specifier,context,next){if(specifier==='pg'||specifier.includes('notification-planner-config')||specifier.includes('confirmation-outbox-worker'))throw new Error('FIXTURE_RUNTIME_IMPORT_BEFORE_GUARD');return next(specifier,context);}\"));");
it.each([
 {CONFIRMATION_PLANNER_DELIVERY_LOCAL_TEST:'0'},
 {PGHOST:'example.com'},
 {PGPORT:'5432'},
 {PGDATABASE:'ordinary_database'},
 {CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST:'127.0.0.1'},
 {CI:'true',GITHUB_ACTIONS:'false',PGPORT:'5432',CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST:'172.18.0.2'},
 {CI:'true',GITHUB_ACTIONS:'true',PGPORT:'5432',CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST:'8.8.8.8'},
 {CI:'true',GITHUB_ACTIONS:'true',PGPORT:'5432',CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST:'not-an-ip'},
 {CI:'true',GITHUB_ACTIONS:'true',PGPORT:'55436',CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST:'172.18.0.2'},
 {PGOPTIONS:'-c search_path=public'},
 {CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE:'deliver'},
 {CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN:'1'},
 {CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN:'1',CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE:'unexpected'},
 {CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN:'1',CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE:'recover'},
])('refuses unsafe local/CI fixture configuration %# before database access',overrides=>{
 const env:NodeJS.ProcessEnv={...process.env,CI:'false',GITHUB_ACTIONS:'false',PGHOST:'127.0.0.1',PGPORT:'55436',PGDATABASE:'lumin_phase_a_confirmation_planner_delivery_guard_only',CONFIRMATION_PLANNER_DELIVERY_LOCAL_TEST:'1'};
 for(const key of ['DATABASE_URL','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','CONFIRMATION_PLANNER_DELIVERY_CI_SERVER_HOST','CONFIRMATION_PLANNER_DELIVERY_CHILD_MODE','CONFIRMATION_PLANNER_DELIVERY_CHILD_OPT_IN'])delete env[key];
 Object.assign(env,overrides);
 const result=spawnSync(process.execPath,['--import','tsx','--import',guardImportTrap,fileURLToPath(new URL('./confirmation-planner-delivery.integration.ts',import.meta.url))],{env,encoding:'utf8',timeout:15000});
 expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(result.stderr).toContain('ERR_ASSERTION');expect(result.stderr).not.toContain('FIXTURE_RUNTIME_IMPORT_BEFORE_GUARD');expect(result.stdout).toBe('');
});
