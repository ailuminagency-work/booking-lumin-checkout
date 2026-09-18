/** Disposable local/CI native HTTP acceptance only. Root supervisor must CREATE a fresh,
 * migrated disposable database; this harness neither creates nor migrates it.
 * Synthetic fixture identities are not production authentication certification.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Pool, type PoolConfig } from 'pg';
import { textDraftTestProfile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
import { createFlowHttpServer } from './http';
import { createFlowRepository, type FlowRepository } from './repository';
import { createTextFieldDraftRepository } from './text-field-drafts-repository';
import { createTextFieldDraftClient, type TextFieldDraftClient } from '../../flow-ui/src/textFieldDraftClient';
import type { TextFieldDraftHttpDependencies } from './text-field-drafts-http';
const OWNER_ORIGIN = 'https://text-draft-owner.example.test';
const CUSTOMER_ORIGIN = 'https://text-draft-customer.example.test';
export function nativeConfiguration(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): PoolConfig {
  assert.equal(env.TEXT_DRAFT_HTTP_APPROVED, '1');
  const profile = textDraftTestProfile(env, 'TEXT_DRAFT_HTTP_DATABASE', platform);
  return { ...profile.connection, max: 2, idleTimeoutMillis: 1000,
    statement_timeout: 4000, lock_timeout: 3000, idle_in_transaction_session_timeout: 6000,
    query_timeout: 6000, application_name: 'lumin_text_draft_native_http' };
}
export function fixtureDefinition() { return { schemaVersion: 1, fields: [{ key: 'notes', kind: 'text', required: true, minLength: 1, maxLength: 100 }] }; }
export function fixturePromptDefinition() {
  return { ...fixtureDefinition(), fields: fixtureDefinition().fields.map(field => ({ ...field, prompt: '  Question \u{1f600} e\u0301 <b>plain text</b>  ' })) };
}
const authoring = () => ({ authoringVersion: 2, config: { key: 'native', steps: [{ key: 'count', questionKey: 'count', kind: 'question', required: true }] }, questionOverrides: {} });
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('TIME_BOUND')), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** Register before connection activity: end() resolution and the client's end
 * event are distinct observations in pg, so neither substitutes for the other. */
export function observeTextDraftConnectionEnd(client: { once(event: 'end', listener: () => void): unknown }) {
  let observed = false;
  const closed = new Promise<void>(resolve => { client.once('end', () => { observed = true; resolve(); }); });
  return { closed, observed: () => observed };
}
export async function awaitTextDraftConnectionCleanup(endCalls: Promise<unknown>[], observations: ReturnType<typeof observeTextDraftConnectionEnd>[], timeout = 7000): Promise<void> {
  await bounded(Promise.all([...endCalls, ...observations.map(value => value.closed)]), timeout);
  assert.ok(observations.every(value => value.observed()));
}
async function denied(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code);
}
export async function runTextDraftNativeIntegration(): Promise<number> {
  const result = { schemaVersion: 1, kind: 'TEXT_DRAFT_NATIVE_HTTP', status: 'failed', category: 'CONFIGURATION_FAILED', groups: 0, httpRequests: 0, textCalls: 0, legacyCalls: 0, serverClosed: false, connectionsClosed: false };
  let pool: Pool | undefined, observer: Client | undefined;
  let observerConnected = false, connectionFault = false;
  let observerEnd: ReturnType<typeof observeTextDraftConnectionEnd> | undefined;
  const servers: Server[] = [], sockets = new Set<Socket>(), pooled = new Map<Client, ReturnType<typeof observeTextDraftConnectionEnd>>();
  const inFlight = new Set<Promise<unknown>>(), clients: TextFieldDraftClient[] = [];
  let finished = false;
  const watchdog = setTimeout(() => { if (!finished) { writeSync(1, JSON.stringify({ ...result, status: 'failed', category: 'CLEANUP_UNOBSERVED' }) + '\n'); process.exit(1); } }, 120000);
  const tracked = <T>(start: () => Promise<T>): Promise<T> => {
    const task = Promise.resolve().then(start); inFlight.add(task);
    void task.finally(() => inFlight.delete(task)).catch(() => undefined);
    return task;
  };
  try {
    const config = nativeConfiguration(process.env);
    pool = new Pool(config);
    pool.on('error', () => { connectionFault = true; });
    pool.on('connect', client => { pooled.set(client, observeTextDraftConnectionEnd(client)); });
    observer = new Client(config); observer.on('error', () => { connectionFault = true; }); observerEnd = observeTextDraftConnectionEnd(observer);
    result.category = 'CONNECTION_FAILED'; await observer.connect(); observerConnected = true;
    await verifyTextDraftDatabase(observer, textDraftTestProfile(process.env, 'TEXT_DRAFT_HTTP_DATABASE'));
    result.category = 'FIXTURE_FAILED';
    const f = { ownerA: randomUUID(), ownerB: randomUUID(), staff: randomUUID(), tenantA: randomUUID(), tenantB: randomUUID(), serviceA: randomUUID(), serviceB: randomUUID(), flowA: randomUUID(), flowB: randomUUID(), legacy: randomUUID() };
    await observer.query('begin');
    try {
      for (const actor of [f.ownerA, f.ownerB, f.staff]) await observer.query('insert into auth.users(id,email) values($1,$2)', [actor, 'text-http-' + actor + '@example.test']);
      for (const [tenant, actor, service, flow] of [[f.tenantA, f.ownerA, f.serviceA, f.flowA], [f.tenantB, f.ownerB, f.serviceB, f.flowB]] as const) {
        await observer.query('insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)', [tenant, 'Synthetic HTTP', 'text-http-' + tenant, 'UTC', 'USD']);
        await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [tenant, actor]);
        await observer.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,'simple','Synthetic HTTP','USD',0)", [service, tenant]);
        await observer.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')", [tenant, service]);
        await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)', [actor, tenant, flow, service, 'Synthetic HTTP', JSON.stringify(authoring())]);
      }
      await observer.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_STAFF')", [f.tenantA, f.staff]);
      await observer.query('select public.save_bound_flow_draft($1,$2,$3,$4,0,$5,$6::jsonb)', [f.ownerA, f.tenantA, f.legacy, f.serviceA, 'Synthetic legacy', JSON.stringify(authoring().config)]);
      await observer.query('commit');
    } catch (error) { await observer.query('rollback'); throw error; }
    const tokenA = 'fixture-owner-a-' + randomUUID(), tokenB = 'fixture-owner-b-' + randomUUID(), staffToken = 'fixture-staff-' + randomUUID();
    const identityTokens = new Map([[tokenA, f.ownerA], [tokenB, f.ownerB], [staffToken, f.staff]]);
    const legacyRepository = createFlowRepository(pool), textRepository = createTextFieldDraftRepository(pool);
    const legacy: FlowRepository = { call(name, params) { result.legacyCalls++; return tracked(() => legacyRepository.call(name, params)); } };
    const text: Pick<TextFieldDraftHttpDependencies, 'call'> = { call(name, params) { result.textCalls++; return tracked(() => textRepository.call(name, params)); } };
    async function start(enabled: boolean, allowLocalTextPromptWrites = false) {
      const server = createFlowHttpServer({ repository: legacy, allowLocalTextPromptWrites, ...(enabled ? { textFieldDraftRepository: text } : {}), authenticateOwner: async token => identityTokens.get(token) ?? null, ownerOrigins: [OWNER_ORIGIN], customerOrigins: [CUSTOMER_ORIGIN] });
      servers.push(server); server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      await bounded(new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); }), 5000);
      const address = server.address(); assert.ok(address && typeof address === 'object'); return `http://127.0.0.1:${address.port}`;
    }
    const base = await start(true);
    const fetcher: typeof fetch = (input, init) => {
      assert.equal(typeof input, 'string'); assert.equal(new URL(input as string).origin, base);
      const headers = new Headers(init?.headers); headers.set('Origin', OWNER_ORIGIN);
      result.httpRequests++; return fetch(input, { ...init, headers });
    };
    const client = createTextFieldDraftClient(base, true, fetcher); clients.push(client);
    async function raw(origin: string, route: string, body?: unknown) {
      result.httpRequests++;
      const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: OWNER_ORIGIN, Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000), redirect: 'error' });
      assert.ok(response.body); const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const value = await reader.read(); if (value.done) break; size += value.value.length; assert.ok(size <= 32768); chunks.push(value.value); } }
      finally { await reader.cancel(); reader.releaseLock(); }
      return { status: response.status, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) };
    }
    const request = (revision: number, parent: number) => ({ textDraftVersion: 1, parentAuthoringVersion: 2, expectedRevision: revision, expectedFlowRevision: parent, definition: fixtureDefinition() });
    result.category = 'CASE_FAILED';
    assert.deepEqual(await client.read(tokenA, f.tenantA, f.flowA), { status: 'missing', textDraftVersion: 1, parentAuthoringVersion: 2, currentParentRevision: 1, runtimePublishable: false }); result.groups++;
    const created = await client.save(tokenA, f.tenantA, f.flowA, request(0, 1)); assert.equal(created.draftRevision, 1); assert.equal(created.stale, false); assert.deepEqual(created.definition, fixtureDefinition());
    const loaded = await client.read(tokenA, f.tenantA, f.flowA); assert.equal(loaded.status, 'present'); if (loaded.status === 'present') assert.deepEqual(loaded.receipt, created);
    assert.equal((await client.save(tokenA, f.tenantA, f.flowA, request(1, 1))).draftRevision, 2); result.groups++;
    await denied(client.save(tokenA, f.tenantA, f.flowA, request(0, 1)), 'CONFLICT'); await denied(client.save(tokenA, f.tenantA, f.flowA, request(1, 1)), 'CONFLICT'); result.groups++;
    const parentRoute = `/api/configurable-flows/${f.flowA}/draft?tenantId=${f.tenantA}`;
    assert.equal((await raw(base, parentRoute, { expectedRevision: 1, serviceId: f.serviceA, name: 'Edited synthetic parent', authoring: authoring() })).status, 200);
    const stale = await client.read(tokenA, f.tenantA, f.flowA); assert.equal(stale.status, 'present'); if (stale.status === 'present') { assert.equal(stale.receipt.stale, true); assert.equal(stale.receipt.savedParentRevision, 1); assert.equal(stale.receipt.currentParentRevision, 2); }
    await denied(client.save(tokenA, f.tenantA, f.flowA, request(2, 1)), 'CONFLICT'); assert.equal((await client.save(tokenA, f.tenantA, f.flowA, request(2, 2))).stale, false); result.groups++;
    for (const token of [staffToken, tokenB]) { await denied(client.read(token, f.tenantA, f.flowA), 'FORBIDDEN'); await denied(client.save(token, f.tenantA, f.flowA, request(3, 2)), 'FORBIDDEN'); }
    await denied(client.read(tokenB, f.tenantB, f.flowA), 'NOT_AVAILABLE'); await denied(client.save(tokenB, f.tenantB, f.flowA, request(0, 1)), 'NOT_AVAILABLE'); assert.equal((await client.read(tokenB, f.tenantB, f.flowB)).status, 'missing'); result.groups++;
    for (const extra of [{ actorId: f.ownerB }, { tenantId: f.tenantB }]) assert.equal((await raw(base, `/api/text-field-drafts/${f.flowA}?tenantId=${f.tenantA}`, { ...request(3, 2), ...extra })).status, 400);
    const unchanged = await client.read(tokenA, f.tenantA, f.flowA); assert.equal(unchanged.status, 'present'); if (unchanged.status === 'present') assert.equal(unchanged.receipt.draftRevision, 3); result.groups++;
    const legacyRoute = `/api/flows/${f.legacy}/draft?tenantId=${f.tenantA}`;
    for (const route of [legacyRoute, parentRoute]) assert.equal((await raw(base, route)).status, 200);
    const disabledBase = await start(false);
    assert.equal((await raw(disabledBase, `/api/text-field-drafts/${f.flowA}?tenantId=${f.tenantA}`)).status, 404);
    for (const route of [legacyRoute, parentRoute]) assert.equal((await raw(disabledBase, route)).status, 200); result.groups++;
    // Isolated B flow: capability gating is enforced before the repository call.
    const promptedRequest = (revision: number, parent: number) => ({ ...request(revision, parent), definition: fixturePromptDefinition() });
    const beforePromptCalls = result.textCalls;
    await denied(client.save(tokenB, f.tenantB, f.flowB, promptedRequest(0, 1)), 'UNSUPPORTED_CONFIG');
    assert.equal(result.textCalls, beforePromptCalls);
    assert.equal((await observer.query('select count(*)::integer as count from public.text_field_drafts where tenant_id=$1 and flow_id=$2', [f.tenantB, f.flowB])).rows[0].count, 0);
    const promptBase = await start(true, true);
    const promptFetcher: typeof fetch = (input, init) => {
      assert.equal(typeof input, 'string'); assert.equal(new URL(input as string).origin, promptBase);
      const headers = new Headers(init?.headers); headers.set('Origin', OWNER_ORIGIN);
      result.httpRequests++; return fetch(input, { ...init, headers });
    };
    const promptClient = createTextFieldDraftClient(promptBase, true, promptFetcher); clients.push(promptClient);
    const promptSaved = await promptClient.save(tokenB, f.tenantB, f.flowB, promptedRequest(0, 1));
    assert.equal(promptSaved.draftRevision, 1); assert.deepEqual(promptSaved.definition, fixturePromptDefinition());
    const promptRead = await promptClient.read(tokenB, f.tenantB, f.flowB);
    assert.equal(promptRead.status, 'present'); if (promptRead.status === 'present') assert.deepEqual(promptRead.receipt, promptSaved);
    await denied(promptClient.save(tokenB, f.tenantB, f.flowB, promptedRequest(0, 1)), 'CONFLICT');
    await observer.query('select public.save_configurable_flow_draft($1,$2,$3,$4,1,$5,$6::jsonb)', [f.ownerB, f.tenantB, f.flowB, f.serviceB, 'Edited prompt parent', JSON.stringify(authoring())]);
    await denied(promptClient.save(tokenB, f.tenantB, f.flowB, promptedRequest(1, 1)), 'CONFLICT');
    const promptStale = await promptClient.read(tokenB, f.tenantB, f.flowB);
    assert.equal(promptStale.status, 'present');
    if (promptStale.status === 'present') {
      assert.equal(promptStale.receipt.stale, true); assert.equal(promptStale.receipt.draftRevision, 1);
      assert.equal(promptStale.receipt.savedParentRevision, 1); assert.equal(promptStale.receipt.currentParentRevision, 2);
      assert.deepEqual(promptStale.receipt.definition, fixturePromptDefinition());
    }
    result.groups++;
    await observer.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2", [f.tenantA, f.ownerA]);
    await denied(client.read(tokenA, f.tenantA, f.flowA), 'FORBIDDEN'); await denied(client.save(tokenA, f.tenantA, f.flowA, request(3, 2)), 'FORBIDDEN'); result.groups++;
    assert.equal((await observer.query('select draft_revision::integer as revision from public.text_field_drafts where tenant_id=$1 and flow_id=$2', [f.tenantA, f.flowA])).rows[0].revision, 3);
    assert.equal(connectionFault, false); assert.equal(result.groups, 9); assert.ok(result.textCalls > 0 && result.legacyCalls > 0); result.status = 'passed'; result.category = 'COMPLETE';
  } catch { result.status = 'failed'; }
  finally {
    for (const client of clients) client.invalidate();
    let failed = false;
    const closing = servers.map(server => new Promise<void>((resolve, reject) => {
      if (!server.listening) { resolve(); return; }
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    }));
    try { await bounded(Promise.all(closing), 7000); assert.equal(sockets.size, 0); result.serverClosed = true; } catch { failed = true; }
    try { await bounded(Promise.allSettled([...inFlight]), 10000); assert.equal(inFlight.size, 0); } catch { failed = true; }
    if (observerConnected && observer) { try { await bounded(observer.query('rollback'), 7000); } catch { failed = true; } }
    const ends: Promise<unknown>[] = [];
    if (pool) ends.push(pool.end()); if (observer) ends.push(observer.end());
    try {
      await awaitTextDraftConnectionCleanup(ends, [...pooled.values(), ...(observerEnd ? [observerEnd] : [])]);
      assert.ok([...pooled.values()].every(value => value.observed()));
      assert.ok(!observer || observerEnd?.observed());
      result.connectionsClosed = true;
    } catch { failed = true; }
    if (failed) { result.status = 'failed'; result.category = 'CLEANUP_UNOBSERVED'; }
    if (connectionFault) { result.status = 'failed'; if (result.category === 'COMPLETE') result.category = 'CONNECTION_FAILED'; }
    finished = true; clearTimeout(watchdog);
  }
  writeSync(1, JSON.stringify(result) + '\n'); return result.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const terminal = () => { writeSync(1, '{"schemaVersion":1,"kind":"TEXT_DRAFT_NATIVE_HTTP","status":"failed","category":"CLEANUP_UNOBSERVED","groups":0,"httpRequests":0,"textCalls":0,"legacyCalls":0,"serverClosed":false,"connectionsClosed":false}\n'); process.exit(1); };
  process.on('uncaughtException', terminal); process.on('unhandledRejection', terminal);
  void runTextDraftNativeIntegration().then(code => { process.exitCode = code; }, terminal);
}
