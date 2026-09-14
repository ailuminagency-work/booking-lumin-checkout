import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

// Independent synthetic fixtures. No hosted URL or application credentials are accepted.
export function localPool() {
  if (process.env.LOCAL_HARNESS !== '1' || process.env.FLOW_TEST_DISPOSABLE !== '1' || process.env.MODE_INSTALLATIONS_TEST_DISPOSABLE !== '1'
    || !['127.0.0.1', 'localhost'].includes(process.env.PGHOST ?? '') || !/^lumin_installation_s1_[a-z0-9_]+$/.test(process.env.PGDATABASE ?? '')
    || !['public', 'extensions'].includes(process.env.MODE_INSTALLATIONS_CRYPTO_LAYOUT ?? '') || process.env.DATABASE_URL)
    throw new Error('Explicit disposable loopback mode-installation configuration required');
  return new Pool({ max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 3000, statement_timeout: 5000, application_name: 'independent-mode-installations' });
}
export type Db = Pick<PoolClient, 'query'>;
export const profile = { profileVersion: 'local-s1', rendererOrigin: 'https://renderer.example.test', apiOrigin: 'https://api.example.test', portalOrigin: 'https://portal.example.test', loaderUrl: `https://renderer.example.test/assets/booking-lumin-loader.${'a'.repeat(64)}.js` };
export const config = { key: 'request', steps: [{ key: 'count', questionKey: 'count', kind: 'question', required: true }] };
export type Fixture = { tenant: string; actor: string; owner2: string; staff: string; foreignTenant: string; foreignActor: string; service: string; flow: string };
export const key = () => randomUUID();
export async function rpc(db: Db, name: string, args: unknown[]): Promise<Record<string, any>> {
  assert.match(name, /^(mode_(publish_flow|install_flow|apply_flow_version|update_flow_policy|public_installation_policy|owner_installations|owner_installation_history|owner_operation)|save_bound_flow_draft|save_configurable_flow_draft)$/);
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)).rows[0].result;
}
export async function begin(pool: Pool, role = 'service_role') {
  assert.ok(['service_role', 'authenticated', 'anon', 'owner'].includes(role));
  const c = await pool.connect();
  try { await c.query('BEGIN ISOLATION LEVEL READ COMMITTED'); if (role !== 'owner') await c.query(`SET LOCAL ROLE ${role}`); return c; }
  catch (e) { c.release(true); throw e; }
}
export async function transaction<T>(pool: Pool, body: (c: PoolClient) => Promise<T>, role = 'service_role'): Promise<T> {
  const c = await begin(pool, role);
  try { const result = await body(c); assert.equal((await c.query('COMMIT')).command, 'COMMIT'); return result; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function rejection(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (e: unknown) => { assert.equal((e as { code?: string }).code, code); return true; });
}
export async function fixture(pool: Pool): Promise<Fixture> {
  const f: Fixture = { tenant: randomUUID(), actor: randomUUID(), owner2: randomUUID(), staff: randomUUID(), foreignTenant: randomUUID(), foreignActor: randomUUID(), service: randomUUID(), flow: randomUUID() };
  await transaction(pool, async c => {
    for (const id of [f.tenant, f.foreignTenant]) await c.query("insert into public.tenants(id,name,slug,timezone,currency) values($1,'Independent local fixture',$2,'UTC','USD')", [id, `s1-${id}`]);
    for (const id of [f.actor, f.owner2, f.staff, f.foreignActor]) await c.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    for (const [tenant, actor, role] of [[f.tenant, f.actor, 'BUSINESS_OWNER'], [f.tenant, f.owner2, 'BUSINESS_OWNER'], [f.tenant, f.staff, 'BUSINESS_STAFF'], [f.foreignTenant, f.foreignActor, 'BUSINESS_OWNER']])
      await c.query('insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,$3)', [tenant, actor, role]);
    await c.query("insert into public.services(id,tenant_id,archetype,name,currency,base_price,duration_minutes,tax_rate_bp) values($1,$2,'simple','Local zero-price request','USD',0,60,0)", [f.service, f.tenant]);
    await c.query("insert into public.service_questions(id,tenant_id,service_id,question_key,prompt,kind,required,unit_price,min_qty,max_qty,sort_order) values($1,$2,$3,'count','How many?','quantity',true,0,1,5,0)", [randomUUID(), f.tenant, f.service]);
  }, 'owner');
  await transaction(pool, c => rpc(c, 'save_bound_flow_draft', [f.actor, f.tenant, f.flow, f.service, 0, 'Independent flow', JSON.stringify(config)]));
  return f;
}
export const publish = (db: Db, f: Fixture, revision = 1, operationKey = key(), actor = f.actor) => rpc(db, 'mode_publish_flow', [actor, f.tenant, f.flow, revision, operationKey]);
export const install = (db: Db, f: Fixture, version: string, operationKey = key(), mode = 'iframe', parents = ['https://merchant.example.test']) => rpc(db, 'mode_install_flow', [f.actor, f.tenant, f.flow, version, version, mode, profile.profileVersion, JSON.stringify(mode === 'hosted' ? [] : parents), operationKey]);
export const apply = (db: Db, f: Fixture, id: string, oldVersion: string, newVersion: string, revision = 1, operationKey = key(), actor = f.actor) => rpc(db, 'mode_apply_flow_version', [actor, f.tenant, f.flow, id, revision, oldVersion, newVersion, operationKey]);
export const policy = (db: Db, f: Fixture, id: string, revision = 1, enabled = false, parents = ['https://merchant.example.test'], operationKey = key()) => rpc(db, 'mode_update_flow_policy', [f.actor, f.tenant, f.flow, id, revision, enabled, JSON.stringify(parents), operationKey]);
export const recover = (db: Db, f: Fixture, operation: string, operationKey: string, actor = f.actor) => rpc(db, 'mode_owner_operation', [actor, f.tenant, f.flow, operation, operationKey]);
export async function secondVersion(pool: Pool, f: Fixture) {
  await transaction(pool, c => rpc(c, 'save_bound_flow_draft', [f.actor, f.tenant, f.flow, f.service, 1, 'Second revision', JSON.stringify(config)]));
  return transaction(pool, c => publish(c, f, 2));
}
export async function snapshot(pool: Pool, f: Fixture) {
  const out: Record<string, unknown> = {};
  for (const table of ['flows', 'flow_drafts', 'flow_versions', 'bound_flow_versions', 'flow_installations', 'mode_flow_installations', 'mode_flow_owner_operations', 'mode_flow_installation_history', 'flow_sessions', 'flow_requests']) {
    if (table === 'flow_requests') {
      out[table] = (await pool.query("select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') as rows from public.flow_requests r join public.flow_sessions s on s.tenant_id=r.tenant_id and s.id=r.session_id where s.tenant_id=$1 and s.flow_id=$2", [f.tenant, f.flow])).rows[0].rows;
      continue;
    }
    const column = table === 'flows' ? 'id' : 'flow_id';
    out[table] = (await pool.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from public.${table} t where tenant_id=$1 and ${column}=$2`, [f.tenant, f.flow])).rows[0].rows;
  }
  return out;
}
export async function observedWait(pool: Pool, waiter: PoolClient, holder: PoolClient) {
  const wp = (waiter as unknown as { processID: number }).processID;
  const hp = (holder as unknown as { processID: number }).processID;
  assert.ok(Number.isInteger(wp) && Number.isInteger(hp) && wp !== hp);
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    const row = (await pool.query('select wait_event_type,pg_blocking_pids(pid) as blockers from pg_stat_activity where pid=$1', [wp])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.includes(hp)) { console.log(`OBSERVED LOCK waiter=${wp} holder=${hp}`); return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Missing actual Lock wait ${wp} on ${hp}`);
}
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
export const capture = <T>(p: Promise<T>): Promise<Outcome<T>> => p.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
export function succeeded<T>(outcome: Outcome<T>): T { if (!outcome.ok) throw outcome.error; return outcome.value; }
export function denied(outcome: Outcome<unknown>, code: string) { assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal((outcome.error as { code?: string }).code, code); }
