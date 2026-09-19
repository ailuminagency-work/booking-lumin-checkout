/** Inert on import. Only a root-supervised, freshly migrated disposable database.
 * Deadlines bound observation, not mutation cancellation. No application activation. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { parseFieldDocumentV3 } from '@lumin/workflow';
import { blocked } from './text-field-drafts-concurrency.integration';
import { textDraftTestProfile, verifyTextDraftDatabase } from './text-field-drafts-test-profile';
import { observeTextDraftConnectionEnd, awaitTextDraftConnectionCleanup } from './text-field-drafts.integration';
export const CASE_COUNT = 30;
export const SNAPSHOT_SQL = 'select pg_current_snapshot()';
export function initialReceipt() { return { schemaVersion: 1, kind: 'FIELD_DRAFT_V3_CONCURRENCY', status: 'failed', category: 'CONFIGURATION_FAILED', cases: 0, parityCases: 0, connectionsClosed: false }; }
export function configuration(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform) {
 assert.equal(env.FIELD_DRAFT_V3_CONCURRENCY_APPROVED, '1'); assert.equal(env.TEXT_DRAFT_CONCURRENCY_APPROVED, '1');
 const profile = textDraftTestProfile(env, 'TEXT_DRAFT_CONCURRENCY_DATABASE', platform);
 return { ...profile.connection, statement_timeout: 7000, lock_timeout: 5000, idle_in_transaction_session_timeout: 10000, query_timeout: 9000, application_name: 'lumin_field_v3_concurrency' };
}
type Family = 1 | 2 | 3;
const definition = (family: Family = 3) => family === 3 ? { schemaVersion: 3, fields: [{ key: 'service', kind: 'dropdown', required: true, prompt: 'Choose service', choices: [{ id: 'standard', label: ' Standard 🌍 ' }] }] } : { schemaVersion: family, fields: [{ key: 'notes', kind: family === 1 ? 'text' : 'textarea', prompt: 'Synthetic question', required: false, minLength: 0, maxLength: 4096 }] };
export function corpus(): unknown[] {
 const choice = { id: 'standard', label: ' Standard 🌍 ' };
 const field = { key: 'service', kind: 'dropdown', required: true, choices: [choice] };
 const doc = (value: unknown) => ({ schemaVersion: 3, fields: [value] });
 const options = (count: number) => Array.from({ length: count }, (_, i) => ({ id: 'c' + i, label: 'Choice ' + i }));
 return [null, [], {}, definition(), { schemaVersion: 3, fields: [] }, definition(1), definition(2),
 ...['text', 'textarea'].map(kind => doc({ key: 'notes', kind, required: false, minLength: 0, maxLength: 4096 })),
 ...[0, 1, 32, 33].map(n => doc({ ...field, choices: options(n) })),
 ...['a'.repeat(64), 'a'.repeat(65), 'constructor', 'a\n', 'é'].map(id => doc({ ...field, choices: [{ ...choice, id }] })),
 ...['  exact 🌍  ', '', ' ', 'x\ny', 'x\ry', 'x\u2028y', 'x\u2029y', '🌍'.repeat(200), '🌍'.repeat(201)].map(label => doc({ ...field, choices: [{ ...choice, label }] })),
 doc({ ...field, choices: [choice, choice] }), doc({ ...field, default: 'standard' }), doc({ ...field, choices: [{ ...choice, price: 10 }] }),
 ...[64, 65].map(length => ({ schemaVersion: 3, fields: Array.from({ length }, (_, i) => ({ ...field, key: 'q' + i })) })),
 ...[256, 257].map(total => ({ schemaVersion: 3, fields: Array.from({ length: Math.ceil(total / 32) }, (_, i) => ({ ...field, key: 'q' + i, choices: options(Math.min(32, total - i * 32)) })) })),
 doc({ ...field, prompt: ' Exact e\u0301 ' }), doc({ ...field, minLength: 0 }), doc({ ...field, choices: null }),
 ];
}
export const PARITY_COUNT = 37;

type Fixture = { actor: string; tenant: string; flow: string; service: string };
type Isolation = 'READ COMMITTED' | 'REPEATABLE READ';
function pending<T>(promise: Promise<T>) { let done = false; const outcome = promise.then(value => { done = true; return { ok: true as const, value }; }, (error: unknown) => { done = true; return { ok: false as const, code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN' }; }); return { outcome, settled: () => done }; }
async function success<T>(task: ReturnType<typeof pending<T>>) { assert.equal((await task.outcome).ok, true); }
async function rejected<T>(task: ReturnType<typeof pending<T>>, code: string) { const result = await task.outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, code); }
async function begin(client: Client, isolation: Isolation = 'READ COMMITTED', role = true) { await client.query(`begin isolation level ${isolation}`); if (role) await client.query('set local role service_role'); }
async function save(client: Client, f: Fixture, family: Family, revision = 0, parentRevision = 1) {
 const sql = family === 1 ? 'select public.save_text_field_draft($1,$2,$3,$4,$5,$6::jsonb)' : family === 2 ? 'select public.save_field_draft_v2($1,$2,$3,$4,$5,$6::jsonb)' : 'select public.save_field_draft_v3($1,$2,$3,$4,$5,$6::jsonb)';
 return client.query(sql, [f.actor, f.tenant, f.flow, revision, parentRevision, JSON.stringify(definition(family))]);
}
async function parent(client: Client, f: Fixture, revision: number) {
 return client.query('select public.save_configurable_flow_draft($1,$2,$3,$4,$5,$6,$7::jsonb)', [f.actor, f.tenant, f.flow, f.service, revision, 'Synthetic V2 race', JSON.stringify({ authoringVersion: 2, config: { key: 'parent', steps: [{ key: 'count', questionKey: 'count', kind: 'question', required: true }] }, questionOverrides: {} })]);
}
async function fixture(client: Client): Promise<Fixture> {
 const f = { actor: randomUUID(), tenant: randomUUID(), flow: randomUUID(), service: randomUUID() };
 await client.query('begin');
 try {
  await client.query('insert into auth.users(id,email) values($1,$2)', [f.actor, 'field-race-' + f.actor + '@example.test']);
  await client.query('insert into public.tenants(id,name,slug,timezone,currency) values($1,$2,$3,$4,$5)', [f.tenant, 'Synthetic fields', 'field-race-' + f.tenant, 'UTC', 'USD']);
  await client.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [f.tenant, f.actor]);
  await client.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price) values($1,$2,'simple','Synthetic fields','USD',0)", [f.service, f.tenant]);
  await client.query("insert into public.service_questions(tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,choices) values($1,$2,'count','Count','quantity',true,0,1,5,'[]')", [f.tenant, f.service]);
  await parent(client, f, 0); await client.query('commit'); return f;
 } catch (error) { await client.query('rollback'); throw error; }
}
async function assertFamily(observer: Client, f: Fixture, family: Family, revision = 1) {
 const result = (await observer.query('select (select count(*)::integer from public.text_field_drafts where tenant_id=$1 and flow_id=$2) as v1,(select count(*)::integer from public.field_drafts_v2 where tenant_id=$1 and flow_id=$2) as v2,(select count(*)::integer from public.field_drafts_v3 where tenant_id=$1 and flow_id=$2) as v3,(select family from public.field_draft_families where tenant_id=$1 and flow_id=$2) as family', [f.tenant, f.flow])).rows[0];
 assert.equal(result.v1, family === 1 ? 1 : 0); assert.equal(result.v2, family === 2 ? 1 : 0); assert.equal(result.v3, family === 3 ? 1 : 0); assert.equal(result.family, family);
 const table = family === 1 ? 'public.text_field_drafts' : family === 2 ? 'public.field_drafts_v2' : 'public.field_drafts_v3';
 assert.equal((await observer.query(`select draft_revision::integer as revision from ${table} where tenant_id=$1 and flow_id=$2`, [f.tenant, f.flow])).rows[0].revision, revision);
}
async function opposing(a: Client, b: Client, observer: Client, pids: { a: number; b: number }, isolation: Isolation, first: Family, second: Family, rollback: boolean) {
 const f = await fixture(observer);
 await begin(b, isolation); // Establish a snapshot before the winner's claim, including under RR.
 await b.query(SNAPSHOT_SQL);
 await begin(a, isolation); await save(a, f, first);
 const waiter = pending(save(b, f, second)); await blocked(observer, pids.b, pids.a, waiter.settled);
 await a.query(rollback ? 'rollback' : 'commit');
 if (rollback) { await success(waiter); await b.query('commit'); await assertFamily(observer, f, second); }
 else { await rejected(waiter, isolation === 'REPEATABLE READ' ? '40001' : '23514'); await b.query('rollback'); await assertFamily(observer, f, first); }
}
async function sameFamily(a: Client, b: Client, observer: Client, pids: { a: number; b: number }, existing: boolean) {
 const f = await fixture(observer), revision = existing ? 1 : 0;
 if (existing) await save(observer, f, 3);
 await begin(a); await save(a, f, 3, revision); await begin(b);
 const waiter = pending(save(b, f, 3, revision)); await blocked(observer, pids.b, pids.a, waiter.settled);
 await a.query('commit'); await rejected(waiter, '40001'); await b.query('rollback'); await assertFamily(observer, f, 3, revision + 1);
}
async function ordered(a: Client, b: Client, observer: Client, pids: { a: number; b: number }, kind: 'parent' | 'revoke', saveFirst: boolean) {
 const f = await fixture(observer);
 const other = (client: Client) => kind === 'parent' ? parent(client, f, 1) : client.query("update public.tenant_members set role='BUSINESS_STAFF' where tenant_id=$1 and user_id=$2", [f.tenant, f.actor]);
 await begin(a, 'READ COMMITTED', saveFirst || kind === 'parent'); await (saveFirst ? save(a, f, 3) : other(a));
 await begin(b, 'READ COMMITTED', !saveFirst || kind === 'parent');
 const waiter = pending(saveFirst ? other(b) : save(b, f, 3)); await blocked(observer, pids.b, pids.a, waiter.settled);
 await a.query('commit');
 if (saveFirst) {
  await success(waiter); await b.query('commit'); await assertFamily(observer, f, 3);
  if (kind === 'revoke') await rejected(pending(save(observer, f, 3, 1)), '42501');
  else { const row = (await observer.query('select public.get_field_draft_v3($1,$2,$3) as result', [f.actor, f.tenant, f.flow])).rows[0].result.receipt; assert.equal(row.savedParentRevision, 1); assert.equal(row.currentParentRevision, 2); }
 } else {
  await rejected(waiter, kind === 'parent' ? '40001' : '42501'); await b.query('rollback');
  assert.equal((await observer.query('select count(*)::integer as count from public.field_drafts_v3 where tenant_id=$1 and flow_id=$2', [f.tenant, f.flow])).rows[0].count, 0);
 }
}
export async function main() {
 const result = initialReceipt();
 const clients: Client[] = [], ends: ReturnType<typeof observeTextDraftConnectionEnd>[] = []; let fault = false, finished = false;
 const watchdog = setTimeout(() => { if (!finished) { writeSync(1, JSON.stringify({ ...result, status: 'failed', category: 'CLEANUP_UNOBSERVED' }) + '\n'); process.exit(1); } }, 90000);
 try {
  assert.equal(process.argv.length, 2); const config = configuration(process.env); result.category = 'CONNECTION_FAILED';
  for (let i = 0; i < 3; i++) { const client = new Client(config); clients.push(client); ends.push(observeTextDraftConnectionEnd(client)); client.on('error', () => { fault = true; }); await client.connect(); }
  const [a, b, observer] = clients as [Client, Client, Client]; await verifyTextDraftDatabase(observer, textDraftTestProfile(process.env, 'TEXT_DRAFT_CONCURRENCY_DATABASE'));
  const pids = { a: (await a.query('select pg_backend_pid() as pid')).rows[0].pid, b: (await b.query('select pg_backend_pid() as pid')).rows[0].pid };
  result.category = 'PARITY_FAILED';
  for (const input of corpus()) { let accepted = false; try { parseFieldDocumentV3(input); accepted = true; } catch {} const sql = (await observer.query('select lumin.field_definition_v3_valid($1::jsonb) as accepted', [JSON.stringify(input)])).rows[0].accepted; assert.equal(sql, accepted); result.parityCases++; }
  assert.equal(result.parityCases, PARITY_COUNT); result.category = 'CASE_FAILED';
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ'] as const) for (const pair of [[1, 2], [1, 3], [2, 3]] as const) for (const reverse of [false, true]) for (const rollback of [false, true]) { await opposing(a, b, observer, pids, isolation, reverse ? pair[1] : pair[0], reverse ? pair[0] : pair[1], rollback); assert.equal(fault, false); result.cases++; }
  for (const existing of [false, true]) { await sameFamily(a, b, observer, pids, existing); result.cases++; }
  for (const kind of ['parent', 'revoke'] as const) for (const first of [false, true]) { await ordered(a, b, observer, pids, kind, first); result.cases++; }
  assert.equal(result.cases, CASE_COUNT); assert.equal(fault, false); result.status = 'passed'; result.category = 'COMPLETE';
 } catch { result.status = 'failed'; }
 finally {
  const rollbacks = await Promise.allSettled(clients.map(client => client.query('rollback')));
  try { await awaitTextDraftConnectionCleanup(clients.map(client => client.end()), ends, 7000); result.connectionsClosed = clients.length === 3 && rollbacks.every(item => item.status === 'fulfilled'); } catch {}
  if (!result.connectionsClosed && clients.length) { result.status = 'failed'; result.category = 'CLEANUP_UNOBSERVED'; }
  if (fault) { result.status = 'failed'; if (result.category === 'COMPLETE') result.category = 'CONNECTION_FAILED'; }
  finished = true; clearTimeout(watchdog);
 }
 writeSync(1, JSON.stringify(result) + '\n'); return result.status === 'passed' ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const fatal = () => { writeSync(1, '{"schemaVersion":1,"kind":"FIELD_DRAFT_V3_CONCURRENCY","status":"failed","category":"CLEANUP_UNOBSERVED","cases":0,"parityCases":0,"connectionsClosed":false}\n'); process.exit(1); };
 process.on('uncaughtException', fatal); process.on('unhandledRejection', fatal); process.exitCode = await main();
}
