import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInstallationContracts, parseInstallationOrigin } from '@lumin/contracts';
import { localPool, profile, fixture, rpc, transaction, rejection, publish, install, apply, policy, recover, secondVersion, snapshot, begin, observedWait, capture, succeeded, denied, key } from './mode-installations-fixtures.js';

// Independent test author: /root/allocator_harness_builder. Actual SQL only.
// Acceptance: role/tenant/current-authority boundaries; V1/V2 publication; actor-specific
// idempotency; both independent CAS axes; immutable history and late failure rollback;
// actual waiter/holder PID races including archive/recovery both orders; public T1 parity.
const pool = localPool();
const contracts = createInstallationContracts([profile]);
let passed = 0;
async function test(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
async function prepared() {
  const f = await fixture(pool);
  const published = await transaction(pool, c => publish(c, f));
  const installed = await transaction(pool, c => install(c, f, published.versionId));
  return { f, published, installed };
}
try {
  const layout = (await pool.query("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'")).rows[0]?.nspname;
  assert.equal(layout, process.env.MODE_INSTALLATIONS_CRYPTO_LAYOUT);
  assert.equal((await pool.query('select count(*)::int as n from lumin.installation_profiles')).rows[0].n, 0, 'fresh fixture registry required');
  await pool.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5)', [profile.profileVersion, profile.rendererOrigin, profile.apiOrigin, profile.portalOrigin, 'a'.repeat(64)]);

  await test('publication is separate, exact receipts, V1 and V2 reuse', async () => {
    const f = await fixture(pool), operationKey = key();
    const p = await transaction(pool, c => publish(c, f, 1, operationKey));
    assert.deepEqual(Object.keys(p).sort(), ['schemaVersion','operation','actorId','flowId','versionId','sourceRevision','renderSchemaVersion'].sort());
    assert.equal(p.actorId, f.actor); assert.equal(p.renderSchemaVersion, 1); assert.equal(p.sourceRevision, 1);
    const s = await snapshot(pool, f); assert.deepEqual(s.flow_installations, []); assert.deepEqual(s.mode_flow_installations, []); assert.deepEqual(s.flow_sessions, []); assert.deepEqual(s.flow_requests, []);
    assert.deepEqual(await transaction(pool, c => publish(c, f, 1, operationKey)), p);
    await rejection(() => transaction(pool, c => publish(c, f, 2, operationKey)), '40001');
    await transaction(pool, c => rpc(c, 'save_configurable_flow_draft', [f.actor, f.tenant, f.flow, f.service, 1, 'Configurable', JSON.stringify({authoringVersion:2,config:{key:'request',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]},questionOverrides:{count:{minQty:2,maxQty:4}}})]));
    const p2 = await transaction(pool, c => publish(c, f, 2)); assert.equal(p2.renderSchemaVersion, 2); assert.notEqual(p.versionId, p2.versionId);
    assert.deepEqual(await transaction(pool, c => recover(c, f, 'publish', operationKey)), p);
  });

  await test('explicit hosted and iframe installations, public projection and paging', async () => {
    const { f, published, installed } = await prepared();
    const hosted = await transaction(pool, c => install(c, f, published.versionId, key(), 'hosted'));
    const raw = await transaction(pool, c => rpc(c, 'mode_public_installation_policy', [installed.installationId]));
    assert.deepEqual(contracts.parsePolicy(raw), raw);
    assert.equal(raw.currentVersionId, published.versionId); assert.equal(raw.targetRevision, 1); assert.equal(raw.policyRevision, 1);
    const hostedPolicy = await transaction(pool, c => rpc(c, 'mode_public_installation_policy', [hosted.installationId]));
    assert.equal(contracts.composeInstall(hostedPolicy).kind, 'hosted');
    const first = await transaction(pool, c => rpc(c, 'mode_owner_installations', [f.actor, f.tenant, f.flow, null, 1]));
    assert.equal(first.installations.length, 1); assert.equal(first.nextCursor, first.installations[0].installationId);
    const next = await transaction(pool, c => rpc(c, 'mode_owner_installations', [f.actor, f.tenant, f.flow, first.nextCursor, 1]));
    assert.equal(next.installations.length, 1); assert.equal(next.nextCursor, null); assert.notEqual(first.installations[0].installationId, next.installations[0].installationId);
    const history = await transaction(pool, c => rpc(c, 'mode_owner_installation_history', [f.actor, f.tenant, f.flow, installed.installationId, null, 1]));
    assert.equal(history.history[0].sequence, 1); assert.equal(history.history[0].operation, 'install'); assert.equal(history.nextCursor, null);
  });

  await test('current authority, tenant substitution, raw roles and private registry denial', async () => {
    const { f, installed } = await prepared();
    for (const actor of [f.staff, f.foreignActor]) await rejection(() => transaction(pool, c => rpc(c,'mode_owner_installations',[actor,f.tenant,f.flow,null,20])), '42501');
    await rejection(() => transaction(pool,c=>rpc(c,'mode_owner_installations',[f.actor,f.foreignTenant,f.flow,null,20])), '42501');
    for (const role of ['anon','authenticated','service_role']) for (const table of ['lumin.installation_profiles','public.mode_flow_installations','public.mode_flow_owner_operations','public.mode_flow_installation_history']) {
      await rejection(() => transaction(pool,c=>c.query(`select * from ${table}`),role),'42501');
      await rejection(() => transaction(pool,c=>c.query(`delete from ${table}`),role),'42501');
      await rejection(() => transaction(pool,c=>c.query(`insert into ${table} default values`),role),'42501');
      const column=table==='lumin.installation_profiles'?'version':'flow_id';
      await rejection(() => transaction(pool,c=>c.query(`update ${table} set ${column}=${column}`),role),'42501');
    }
    for(const role of ['anon','authenticated','service_role']) await rejection(()=>transaction(pool,c=>c.query('select lumin.mode_origin($1)',['https://example.test']),role),'42501');
    for (const role of ['anon','authenticated']) await rejection(() => transaction(pool,c=>rpc(c,'mode_public_installation_policy',[installed.installationId]),role),'42501');
    await rejection(()=>transaction(pool,c=>rpc(c,'mode_public_installation_policy',[null])),'22023');
    const unknown=await capture(transaction(pool,c=>rpc(c,'mode_public_installation_policy',[randomUUID()]))); denied(unknown,'P0002');
  });

  await test('independent target/policy revisions, no-op receipts, historical actor-scoped recovery', async () => {
    const { f, published, installed } = await prepared(), p2 = await secondVersion(pool,f);
    const applied=await transaction(pool,c=>apply(c,f,installed.installationId,published.versionId,p2.versionId));
    assert.equal(applied.targetRevision,2); assert.equal(applied.policyRevision,1); assert.equal(applied.changed,true);
    const operationKey=key();
    const noOp=await transaction(pool,c=>apply(c,f,installed.installationId,p2.versionId,p2.versionId,2,operationKey));
    assert.equal(noOp.changed,false); assert.equal(noOp.targetRevision,2);
    const updated=await transaction(pool,c=>policy(c,f,installed.installationId)); assert.equal(updated.targetRevision,2); assert.equal(updated.policyRevision,2);
    const before=await snapshot(pool,f);
    assert.deepEqual(await transaction(pool,c=>apply(c,f,installed.installationId,p2.versionId,p2.versionId,2,operationKey)),noOp);
    assert.deepEqual(await snapshot(pool,f),before);
    await rejection(()=>transaction(pool,c=>recover(c,f,'apply',operationKey,f.owner2)),'P0002');
    const owner2=await transaction(pool,c=>apply(c,f,installed.installationId,p2.versionId,p2.versionId,2,operationKey,f.owner2)); assert.equal(owner2.actorId,f.owner2);
    await rejection(()=>transaction(pool,c=>apply(c,f,installed.installationId,published.versionId,p2.versionId,1)),'40001');
    await rejection(()=>transaction(pool,c=>rpc(c,'mode_public_installation_policy',[installed.installationId])),'P0002');
    const h=await transaction(pool,c=>rpc(c,'mode_owner_installation_history',[f.actor,f.tenant,f.flow,installed.installationId,null,100])); assert.deepEqual(h.history.map((x:any)=>x.sequence),[3,2,1]);
    await pool.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2",[f.tenant,f.actor]);
    await rejection(()=>transaction(pool,c=>recover(c,f,'apply',operationKey)),'42501');
  });

  for (const axis of ['target','policy','mixed','same-key','different-payload'] as const) await test(`observed concurrent ${axis} writers`, async()=>{
    const {f,published,installed}=await prepared(),p2=await secondVersion(pool,f),operationKey=key();
    const a=await begin(pool),b=await begin(pool); let pending: ReturnType<typeof capture<Record<string,any>>>|undefined;
    try {
      const first=axis==='policy'?await policy(a,f,installed.installationId):await apply(a,f,installed.installationId,published.versionId,p2.versionId,1,operationKey);
      pending=capture(axis==='policy'||axis==='mixed'?policy(b,f,installed.installationId):apply(b,f,installed.installationId,published.versionId,axis==='different-payload'?published.versionId:p2.versionId,1,axis==='same-key'||axis==='different-payload'?operationKey:key()));
      await observedWait(pool,b,a); assert.equal((await a.query('COMMIT')).command,'COMMIT');
      const result=await pending;
      if(axis==='same-key'){assert.deepEqual(succeeded(result),first);assert.equal((await b.query('COMMIT')).command,'COMMIT');}
      else if(axis==='mixed'){const second=succeeded(result);assert.equal(second.targetRevision,2);assert.equal(second.policyRevision,2);assert.equal((await b.query('COMMIT')).command,'COMMIT');}
      else {denied(result,'40001');assert.equal((await b.query('COMMIT')).command,'ROLLBACK','known aborted COMMIT is not success or unknown');}
      const h=await transaction(pool,c=>rpc(c,'mode_owner_installation_history',[f.actor,f.tenant,f.flow,installed.installationId,null,100])); assert.equal(h.history.length,axis==='mixed'?3:2);
    } finally {await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  for(const archiveFirst of [true,false]) await test(`archive recovery actual lock order ${archiveFirst?'archive first':'recovery first'}`,async()=>{
    const f=await fixture(pool),operationKey=key(),published=await transaction(pool,c=>publish(c,f,1,operationKey));
    const a=await begin(pool,'owner'),b=await begin(pool,archiveFirst?'service_role':'owner'); let pending:Promise<any>|undefined;
    try {
      if(archiveFirst){
        await a.query("update public.flows set status='archived' where tenant_id=$1 and id=$2",[f.tenant,f.flow]);
        pending=capture(recover(b,f,'publish',operationKey));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');denied(await pending,'P0002');await b.query('ROLLBACK');
      }else{
        await a.query('SET LOCAL ROLE service_role');assert.deepEqual(await recover(a,f,'publish',operationKey),published);
        // Trusted disposable fixture writer: no archive API is invented by this test.
        pending=capture(b.query("update public.flows set status='archived' where tenant_id=$1 and id=$2",[f.tenant,f.flow]));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');succeeded(await pending);assert.equal((await b.query('COMMIT')).command,'COMMIT');
      }
      await rejection(()=>transaction(pool,c=>recover(c,f,'publish',operationKey)),'P0002');
    }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  await test('publish-first blocks stale install and preserves publication-only behavior',async()=>{
    const {f,published}=await prepared();
    await transaction(pool,c=>rpc(c,'save_bound_flow_draft',[f.actor,f.tenant,f.flow,f.service,1,'Next',JSON.stringify({key:'request',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]})]));
    const a=await begin(pool),b=await begin(pool);let pending:Promise<any>|undefined;
    try{await publish(a,f,2);pending=capture(install(b,f,published.versionId));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');denied(await pending,'40001');await b.query('ROLLBACK');}
    finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
    const s=await snapshot(pool,f);assert.equal((s.mode_flow_installations as unknown[]).length,1);assert.deepEqual(s.flow_installations,[]);
  });

  await test('installation-first publication keeps committed installation version pinned',async()=>{
    const f=await fixture(pool),published=await transaction(pool,c=>publish(c,f));
    await transaction(pool,c=>rpc(c,'save_bound_flow_draft',[f.actor,f.tenant,f.flow,f.service,1,'Next',JSON.stringify({key:'request',steps:[{key:'count',questionKey:'count',kind:'question',required:true}]})]));
    const a=await begin(pool),b=await begin(pool);let pending:Promise<any>|undefined;
    try{const receipt=await install(a,f,published.versionId);pending=capture(publish(b,f,2));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');const p2=succeeded(await pending) as any;assert.notEqual(p2.versionId,published.versionId);assert.equal((await b.query('COMMIT')).command,'COMMIT');const current=await transaction(pool,c=>rpc(c,'mode_public_installation_policy',[receipt.installationId]));assert.equal(current.currentVersionId,published.versionId);assert.equal(current.targetRevision,1);}
    finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  await test('same actor installation key converges to one stable installation under actual contention',async()=>{
    const f=await fixture(pool),p=await transaction(pool,c=>publish(c,f)),operationKey=key();
    const a=await begin(pool),b=await begin(pool);let pending:Promise<any>|undefined;
    try{const first=await install(a,f,p.versionId,operationKey);pending=capture(install(b,f,p.versionId,operationKey));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');assert.deepEqual(succeeded(await pending),first);assert.equal((await b.query('COMMIT')).command,'COMMIT');const after=await snapshot(pool,f);assert.equal((after.mode_flow_installations as any[]).length,1);assert.equal((after.mode_flow_installation_history as any[]).length,1);assert.equal((after.mode_flow_owner_operations as any[]).filter(x=>x.operation==='install').length,1);}
    finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  await test('policy-first target update preserves independent committed policy revision',async()=>{
    const {f,published,installed}=await prepared(),p2=await secondVersion(pool,f);
    const a=await begin(pool),b=await begin(pool);let pending:Promise<any>|undefined;
    try{await policy(a,f,installed.installationId);pending=capture(apply(b,f,installed.installationId,published.versionId,p2.versionId));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');const target=succeeded(await pending) as any;assert.equal(target.targetRevision,2);assert.equal(target.policyRevision,2);assert.equal((await b.query('COMMIT')).command,'COMMIT');const state=(await snapshot(pool,f)).mode_flow_installations as any[];assert.equal(state[0].enabled,false);assert.equal(state[0].current_version_id,p2.versionId);assert.equal(state[0].target_revision,2);assert.equal(state[0].policy_revision,2);}
    finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  for(const authority of ['tenant','member','service'] as const) for(const revokeFirst of [true,false]) await test(`actual ${authority} revocation ${revokeFirst?'revocation first':'installation first'}`,async()=>{
    const f=await fixture(pool),p=await transaction(pool,c=>publish(c,f));
    const update=authority==='tenant'?"update public.tenants set status='inactive' where id=$1":authority==='member'?"update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2":"update public.services set active=false where id=$1";
    const args=authority==='tenant'?[f.tenant]:authority==='member'?[f.tenant,f.actor]:[f.service];
    const a=await begin(pool,revokeFirst?'owner':'service_role'),b=await begin(pool,revokeFirst?'service_role':'owner');let pending:Promise<any>|undefined;
    try{
      if(revokeFirst){await a.query(update,args);pending=capture(install(b,f,p.versionId));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');denied(await pending,authority==='service'?'P0002':'42501');await b.query('ROLLBACK');assert.deepEqual((await snapshot(pool,f)).mode_flow_installations,[]);}
      else{const receipt=await install(a,f,p.versionId);pending=capture(b.query(update,args));await observedWait(pool,b,a);assert.equal((await a.query('COMMIT')).command,'COMMIT');succeeded(await pending);assert.equal((await b.query('COMMIT')).command,'COMMIT');const after=await snapshot(pool,f); const rows=after.mode_flow_installations as any[]; assert.equal(rows.length,1); assert.equal(rows[0].id,receipt.installationId); assert.equal(rows[0].current_version_id,p.versionId); assert.equal(rows[0].target_revision,1); assert.equal(rows[0].policy_revision,1); assert.equal(rows[0].enabled,true); assert.deepEqual(rows[0].allowed_parent_origins,['https://merchant.example.test']); assert.equal((after.mode_flow_installation_history as any[]).length,1); assert.deepEqual((after.mode_flow_owner_operations as any[]).find(x=>x.operation==='install').receipt,receipt);await rejection(()=>transaction(pool,c=>install(c,f,p.versionId)),authority==='service'?'P0002':'42501');assert.ok(receipt.installationId);}
    }finally{await a.query('ROLLBACK');await b.query('ROLLBACK');if(pending)await pending;a.release();b.release();}
  });

  await test('late history and operation insert failures rollback every flow surface',async()=>{
    for(const table of ['mode_flow_installation_history','mode_flow_owner_operations']){
      const {f,published,installed}=await prepared(),p2=await secondVersion(pool,f),before=await snapshot(pool,f);
      // A transaction-local trusted trigger is rolled back with the failed mutation.
      const c=await begin(pool,'owner');
      try{
        await c.query(`create function pg_temp.fail_mode_write() returns trigger language plpgsql as $$begin raise exception using errcode='P0001',message='independent late write fault';end$$`);
        await c.query(`create trigger independent_mode_fault before insert on public.${table} for each row when (new.flow_id='${f.flow}'::uuid) execute function pg_temp.fail_mode_write()`);
        await c.query('SET LOCAL ROLE service_role');
        await assert.rejects(()=>apply(c,f,installed.installationId,published.versionId,p2.versionId),(e:any)=>e.code==='P0001'&&e.message==='independent late write fault');
        assert.equal((await c.query('COMMIT')).command,'ROLLBACK');
      }finally{await c.query('ROLLBACK');c.release();}
      assert.deepEqual(await snapshot(pool,f),before);
      assert.equal((await transaction(pool,c=>apply(c,f,installed.installationId,published.versionId,p2.versionId))).changed,true);
    }
  });

  await test('late publication receipt and initial installation history faults leave no partial rows',async()=>{
    for(const operation of ['publish','install'] as const){
      const f=await fixture(pool),p=operation==='install'?await transaction(pool,c=>publish(c,f)):null,before=await snapshot(pool,f);
      const c=await begin(pool,'owner');
      try{
        await c.query(`create function pg_temp.fail_mode_initial() returns trigger language plpgsql as $$begin raise exception using errcode='P0001',message='independent initial write fault';end$$`);
        const table=operation==='publish'?'mode_flow_owner_operations':'mode_flow_installation_history';
        await c.query(`create trigger independent_initial_fault before insert on public.${table} for each row when (new.flow_id='${f.flow}'::uuid) execute function pg_temp.fail_mode_initial()`);
        await c.query('SET LOCAL ROLE service_role');
        await assert.rejects(()=>operation==='publish'?publish(c,f):install(c,f,p!.versionId),(e:any)=>e.code==='P0001'&&e.message==='independent initial write fault');
        assert.equal((await c.query('COMMIT')).command,'ROLLBACK');
      }finally{await c.query('ROLLBACK');c.release();}
      assert.deepEqual(await snapshot(pool,f),before);
      await transaction(pool,c=>operation==='publish'?publish(c,f):install(c,f,p!.versionId));
    }
  });

  await test('distribution restrictions, retained rollback, inactive-service disable and no-op history',async()=>{
    const {f,published,installed}=await prepared(),p2=await secondVersion(pool,f);
    for(const parents of [[],[profile.rendererOrigin],[profile.apiOrigin],[profile.portalOrigin],['https://merchant.example.test','https://merchant.example.test']])
      await rejection(()=>transaction(pool,c=>policy(c,f,installed.installationId,1,true,parents)),'22023');
    const first=await transaction(pool,c=>apply(c,f,installed.installationId,published.versionId,p2.versionId));assert.equal(first.targetRevision,2);
    const rollback=await transaction(pool,c=>apply(c,f,installed.installationId,p2.versionId,published.versionId,2));assert.equal(rollback.targetRevision,3);
    const before=(await snapshot(pool,f)).mode_flow_installation_history;
    const same=await transaction(pool,c=>policy(c,f,installed.installationId,1,true));assert.equal(same.changed,false);
    assert.deepEqual((await snapshot(pool,f)).mode_flow_installation_history,before);
    await pool.query('update public.services set active=false where id=$1',[f.service]);
    assert.equal((await transaction(pool,c=>policy(c,f,installed.installationId))).changed,true);
    await rejection(()=>transaction(pool,c=>policy(c,f,installed.installationId,2,true)),'P0002');
  });

  await test('S1 DNS subset and T1 supported/unsupported boundaries use actual registry constraints',async()=>{
    const positives=['https://localhost','https://example.test','https://x.example:8443','https://0xg','https://a-b.example','https://0xabc.example'];
    const negatives=['https://0x7f000001','https://0x','https://example.0xabc','https://127.0.0.1','https://[::1]','https://xn--a.example','https://xn--abc.example','https://xn--bcher-kva.example','https://www.xn--bcher-kva.example','https://*.example','https://a;.example','https://example.test:443','https://example.test/','https://EXAMPLE.test'];
    for(const origin of positives){assert.equal(parseInstallationOrigin(origin),origin);await transaction(pool,c=>c.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5)',[`positive-${randomUUID()}`,origin,profile.apiOrigin,profile.portalOrigin,'b'.repeat(64)]),'owner');}
    for(const origin of negatives) await rejection(()=>transaction(pool,c=>c.query('insert into lumin.installation_profiles(version,renderer_origin,api_origin,portal_origin,loader_sha256) values($1,$2,$3,$4,$5)',[`negative-${randomUUID()}`,origin,profile.apiOrigin,profile.portalOrigin,'b'.repeat(64)]),'owner'),'23514');
    assert.equal(parseInstallationOrigin('https://127.0.0.1'),'https://127.0.0.1');assert.equal(parseInstallationOrigin('https://xn--bcher-kva.example'),'https://xn--bcher-kva.example');
  });
  console.log(`PASS independent mode-installation scenarios=${passed} layout=${layout}`);
} finally { await pool.end(); }
