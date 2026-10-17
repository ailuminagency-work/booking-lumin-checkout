import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {baseConfig} from '../../../packages/notifications/test/fixtures.js';
import {planNotifications} from '../../../packages/notifications/src/index.js';
import {createConfirmationContextLoader,validateConfirmationContextSnapshot,ConfirmationContextError,type ConfirmationContextBinding} from './confirmation-context-loader.js';
const tenant='11111111-1111-1111-1111-111111111111',booking='22222222-2222-2222-2222-222222222222';
const customer='33333333-3333-3333-3333-333333333333',service='44444444-4444-4444-4444-444444444444';
const connection='55555555-5555-5555-5555-555555555555',foreign='99999999-9999-9999-9999-999999999999';
const binding:ConfirmationContextBinding={tenantId:tenant,connectionId:connection,providerName:'controlled-test-provider',supportedChannels:['email','sms']};
function plannerConfig(overrides:Parameters<typeof baseConfig>[0]={}){const config=baseConfig(overrides);config.templates=config.templates.filter(template=>template.locale===config.locale);return config;}
function snapshot(){return {
 tenant:{id:tenant,name:'Persisted business',status:'active',timezone:'UTC'},
 booking:{id:booking,tenantId:tenant,state:'confirmed',reference:'LMN-SAVED',customerId:customer,serviceId:service,
  slotStart:'2035-01-01T09:00:00.000Z',slotEnd:'2035-01-01T10:00:00.000Z',total:{amount:12900,currency:'USD'}},
 customer:{id:customer,tenantId:tenant,name:'Persisted customer',email:'persisted@example.test',phone:'+15125550111' as string|null},
 service:{id:service,tenantId:tenant,active:true,currency:'USD'},
 connection:{id:connection,tenantId:tenant,provider:binding.providerName,status:'connected'},
 planner:{schemaVersion:1,tenantId:tenant,revision:1,config:plannerConfig({timezone:'UTC'}) as unknown},
};}
type Snapshot=ReturnType<typeof snapshot>;
function harness(rows:unknown[]=[{result:snapshot()}]){
 const client={query:vi.fn(async(sql:string,_values?:unknown[])=>({rows:sql.startsWith('select')?rows:[]})),release:vi.fn()};
 const connect=vi.fn(async()=>client);const pool={connect} as unknown as Pool;
 return {client,connect,loader:createConfirmationContextLoader(pool,binding),pool};
}
function expectCode(fn:()=>unknown,code:ConfirmationContextError['code']){
 try{fn();throw new Error('accepted invalid context');}catch(error){expect(error).toBeInstanceOf(ConfirmationContextError);expect((error as ConfirmationContextError).code).toBe(code);}
}
describe('trusted persisted confirmation context (unwired, no configuration defaults)',()=>{
 it('maps exact stored customer and booking total into the existing planner contract',()=>{
  const loaded=validateConfirmationContextSnapshot(snapshot(),binding,booking);
  expect(loaded.bookingTenantId).toBe(tenant);
  expect(loaded.context.booking).toMatchObject({id:booking,reference:'LMN-SAVED',customerName:'Persisted customer',customerEmail:'persisted@example.test',customerPhone:'+15125550111',total:{amount:12900,currency:'USD'}});
  const plan=planNotifications('booking.confirmed',loaded.context,loaded.config,'2030-01-01T00:00:00Z');
  expect(plan.map(message=>message.to)).toEqual(['persisted@example.test','+15125550111']);
  expect(loaded).not.toHaveProperty('customer');expect(loaded).not.toHaveProperty('connection');
 });
 it.each([
  ['tenant',(s:Snapshot)=>{s.tenant.id=foreign;}],['booking tenant',(s:Snapshot)=>{s.booking.tenantId=foreign;}],
  ['booking id',(s:Snapshot)=>{s.booking.id=foreign;}],['customer tenant',(s:Snapshot)=>{s.customer.tenantId=foreign;}],
  ['customer id',(s:Snapshot)=>{s.customer.id=foreign;}],['service tenant',(s:Snapshot)=>{s.service.tenantId=foreign;}],
  ['service id',(s:Snapshot)=>{s.service.id=foreign;}],['inactive service',(s:Snapshot)=>{s.service.active=false;}],
  ['suspended tenant',(s:Snapshot)=>{s.tenant.status='suspended';}],['inactive tenant',(s:Snapshot)=>{s.tenant.status='inactive';}],
  ['unconfirmed booking',(s:Snapshot)=>{s.booking.state='draft';}],['cancelled booking',(s:Snapshot)=>{s.booking.state='cancelled';}],
 ] as const)('rejects %s binding/state',(_,change)=>{const s=snapshot();change(s);expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'NOT_AVAILABLE');});
 it.each(['not_connected','error','revoked'])('rejects persisted connection status %s',status=>{
  const s=snapshot();s.connection.status=status;expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it.each(['id','tenantId','provider'] as const)('requires the exact trusted connection %s',field=>{
  const s=snapshot();s.connection[field]=foreign;expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it.each([undefined,null,{}, {apiKey:'secret-value'}, {locale:'en-US'}, {tenantId:foreign}])('blocks absent/provider-only planner configuration',config=>{
  const s=snapshot();s.planner.config=config;expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it.each([null,undefined,{}, {schemaVersion:2,tenantId:tenant,revision:1,config:plannerConfig({timezone:'UTC'})},
  {schemaVersion:1,tenantId:foreign,revision:1,config:plannerConfig({timezone:'UTC'})},
  ...[0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1'].map(revision=>({schemaVersion:1,tenantId:tenant,revision,config:plannerConfig({timezone:'UTC'})})),
  {schemaVersion:1,tenantId:tenant,revision:1,config:plannerConfig({timezone:'UTC'}),provider:'override'}])('rejects absent or malformed canonical planner envelope',planner=>{
  const s={...snapshot(),planner};expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it('never falls back to provider configuration when the canonical planner is missing',()=>{
  const s={...snapshot(),planner:null,connection:{...snapshot().connection,config:plannerConfig({timezone:'UTC'})}};
  expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it('requires the canonical saved-locale and template grammar rather than the broader planner input contract',()=>{
  for(const change of [(config:ReturnType<typeof plannerConfig>)=>{config.templates[0]!.locale='es-MX';},(config:ReturnType<typeof plannerConfig>)=>{config.templates[0]!.body='{{unsupportedVariable}}';}]){
   const s=snapshot();const config=plannerConfig({timezone:'UTC'});change(config);s.planner.config=config;
   expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
  }
 });
 it('rejects recipient or credential overrides rather than stripping them or using defaults',()=>{
  for(const extra of [{recipient:'caller@example.test'},{apiKey:'secret-value'}]){
   const s=snapshot();s.planner.config={...(s.planner.config as object),...extra};
   expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
  }
  const s=snapshot();const config=plannerConfig({timezone:'UTC'});config.sender={...config.sender,apiKey:'nested-secret'} as typeof config.sender;
  s.planner.config=config;expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
 });
 it('rejects config tenant/zone mismatches and invalid locale/zone without guessed fallback',()=>{
  for(const override of [{tenantId:foreign},{timezone:'America/Los_Angeles'},{locale:'bad_locale'},{timezone:'Not/AZone'}]){
   const s=snapshot();s.planner.config=plannerConfig({timezone:'UTC',...override});
   if(override.timezone==='Not/AZone')s.tenant.timezone='Not/AZone';
   expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
  }
 });
 it('requires declared provider support and persisted sender/template for every confirmation channel',()=>{
  expectCode(()=>validateConfirmationContextSnapshot(snapshot(),{...binding,supportedChannels:['email']},booking),'CONFIG_NOT_READY');
  for(const change of [(c:ReturnType<typeof plannerConfig>)=>{c.sender.emailFrom=undefined;},(c:ReturnType<typeof plannerConfig>)=>{c.sender.smsFrom=undefined;},(c:ReturnType<typeof plannerConfig>)=>{c.templates=c.templates.filter(t=>t.channel!=='sms');},(c:ReturnType<typeof plannerConfig>)=>{c.events=c.events.filter(e=>e.event!=='booking.confirmed');}]){
   const s=snapshot();const config=plannerConfig({timezone:'UTC'});change(config);s.planner.config=config;
   expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'CONFIG_NOT_READY');
  }
 });
 it('honors explicitly disabled confirmation channels without enabling another channel',()=>{
  const s=snapshot();s.planner.config=plannerConfig({timezone:'UTC',events:[{event:'booking.confirmed',channels:[]}]});s.customer.phone=null;
  const loaded=validateConfirmationContextSnapshot(s,binding,booking);
  expect(planNotifications('booking.confirmed',loaded.context,loaded.config,'2030-01-01T00:00:00Z')).toEqual([]);
 });
 it('rejects missing SMS recipient, invalid persisted email and missing/unsafe stored totals',()=>{
  for(const change of [(s:Snapshot)=>{s.customer.phone=null;},(s:Snapshot)=>{s.customer.email='invalid';},(s:Snapshot)=>{s.booking.total.amount=Number.MAX_SAFE_INTEGER+1;},(s:Snapshot)=>{s.service.currency='EUR';},(s:Snapshot)=>{s.booking.slotEnd=s.booking.slotStart;}]){
   const s=snapshot();change(s);expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'NOT_AVAILABLE');
  }
  const s=snapshot();delete (s.booking as Partial<Snapshot['booking']>).total;
  expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'NOT_AVAILABLE');
 });
 it('rejects a negative final booking total before producing notification context',()=>{
  const s=snapshot();s.booking.total.amount=-1;
  expectCode(()=>validateConfirmationContextSnapshot(s,binding,booking),'NOT_AVAILABLE');
 });
 it('preserves a valid zero final booking total without replacing or repricing it',()=>{
  const s=snapshot();s.booking.total.amount=0;
  const loaded=validateConfirmationContextSnapshot(s,binding,booking);
  expect(loaded.context.booking.total).toEqual({amount:0,currency:'USD'});
  expect(planNotifications('booking.confirmed',loaded.context,loaded.config,'2030-01-01T00:00:00Z')).toHaveLength(2);
 });
 it('reads one exact tenant/booking/connection snapshot under existing service read authority',async()=>{
  const h=harness();await h.loader(tenant,booking);
  const calls=h.client.query.mock.calls;expect(calls[0]![0]).toBe('begin isolation level repeatable read read only');
  expect(calls.map(([sql])=>sql)).toContain('set local role service_role');
  const [sql,args]=calls.find(([sql])=>sql.startsWith('select'))!;
  expect(args).toEqual([tenant,booking,connection]);
  expect(sql).toContain('c.tenant_id=b.tenant_id');expect(sql).toContain('s.tenant_id=b.tenant_id');expect(sql).toContain('n.tenant_id=b.tenant_id');
  expect(sql).toContain('public.runtime_notification_planner_config(b.tenant_id)');expect(sql).not.toContain('n.config');expect(sql).not.toContain('connection_secrets');expect(sql).not.toContain('last_error');expect(sql).not.toContain('customer_payload');
  expect(calls.at(-1)![0]).toBe('commit');expect(h.client.release).toHaveBeenCalledWith(false);
 });
 it('rejects wrong tenant/invalid booking before opening a database connection',async()=>{
  const h=harness();await expect(h.loader(foreign,booking)).rejects.toMatchObject({code:'INVALID_BINDING'});
  await expect(h.loader(tenant,'caller-booking')).rejects.toMatchObject({code:'INVALID_BINDING'});expect(h.connect).not.toHaveBeenCalled();
 });
 it('never substitutes missing/ambiguous rows and rolls back invalid persisted configuration',async()=>{
  for(const rows of [[],[{result:snapshot()},{result:snapshot()}]]){
   const h=harness(rows);await expect(h.loader(tenant,booking)).rejects.toMatchObject({code:'NOT_AVAILABLE'});
   expect(h.client.query.mock.calls.at(-1)![0]).toBe('rollback');
  }
  const s=snapshot();s.planner.config={};const h=harness([{result:s}]);
  await expect(h.loader(tenant,booking)).rejects.toMatchObject({code:'CONFIG_NOT_READY'});expect(h.client.query.mock.calls.at(-1)![0]).toBe('rollback');
 });
 it('masks database errors and logs no contacts, configuration or credentials',async()=>{
  const h=harness();vi.mocked(h.client.query).mockRejectedValue(new Error('private@example.test raw-db-secret'));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{await expect(h.loader(tenant,booking)).rejects.toThrow('CONFIRMATION_CONTEXT_UNAVAILABLE');expect(log).not.toHaveBeenCalled();expect(h.client.release).toHaveBeenCalledWith(true);}finally{log.mockRestore();}
 });
 it('copies trusted constructor bindings so later caller mutation cannot choose another connection',async()=>{
  const h=harness();const mutable={...binding,supportedChannels:[...binding.supportedChannels]};const loader=createConfirmationContextLoader(h.pool,mutable);
  mutable.connectionId=foreign;mutable.supportedChannels.length=0;
  await loader(tenant,booking);expect(h.client.query.mock.calls.find(([sql])=>sql.startsWith('select'))![1]).toEqual([tenant,booking,connection]);
 });
});
