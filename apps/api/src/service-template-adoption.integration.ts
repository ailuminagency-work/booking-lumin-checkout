/**
 * Disposable PostgreSQL proof for the service adoption intent boundary.
 * Run explicitly with LOCAL_HARNESS=1, FLOW_TEST_DISPOSABLE=1 and a loopback
 * PGDATABASE matching lumin_*. Vitest intentionally excludes *.integration.ts.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localPool, seedLocalFixtures, LOCAL_FIXTURE as F } from './fixtures';
import type { Pool, PoolClient } from 'pg';

const payload = {
  archetype: 'cart', name: 'W3 concurrency proof', basePrice: 0,
  durationMinutes: 60, taxRateBp: 0, items: [], addons: [], questions: [],
};
const tenant = F.tenantA;
const actor = F.ownerA;
const key = `w3_intent_${randomUUID().replaceAll('-', '')}`;
const sql = (text: string, values: unknown[] = []) => ({ text, values });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function role(client: PoolClient) {
  await client.query('SET ROLE service_role');
}

async function waitForAdvisoryWait(observer: Pool, pid: number) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const row = (await observer.query("SELECT granted FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted", [pid])).rows[0];
    if (row?.granted === false) return;
    await sleep(10);
  }
  const last = (await observer.query("SELECT granted,locktype FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [pid])).rows;
  throw Error(`backend ${pid} did not wait on tenant advisory lock: ${JSON.stringify(last)}`);
}

async function backendPid(client: PoolClient) {
  return Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
}

const c = async (pool: Pool, text: string, values: unknown[] = []) => (await pool.query(sql(text, values).text, sql(text, values).values)).rows;

const pool = localPool();
const clients: PoolClient[] = [];
let serviceId: string | undefined;
try {
  await seedLocalFixtures(pool);
  const first = await pool.connect(); clients.push(first); const second = await pool.connect(); clients.push(second);
  await Promise.all([first.query('BEGIN'), second.query('BEGIN')]);
  await Promise.all([role(first), role(second)]);
  const secondPid = await backendPid(second);

  // Hold the same tenant lock used by both SQL functions, then let B queue
  // behind A. The same-key begin calls must converge to one pending intent.
  await first.query('SELECT pg_advisory_xact_lock(hashtextextended($1,38421))', [tenant]);
  const beginA = await first.query('SELECT public.begin_service_draft_intent($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result', [actor, tenant, key, 'housekeeping', payload]);
  assert.equal(beginA.rows[0].result.state, 'pending');
  const beginB = second.query('SELECT public.begin_service_draft_intent($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result', [actor, tenant, key, 'housekeeping', payload]);
  await waitForAdvisoryWait(pool, secondPid);
  await first.query('COMMIT');
  const beginBResult = await beginB;
  assert.equal(beginBResult.rows[0].result.state, 'pending');
  await second.query('COMMIT');

  // A different canonical payload under the same key is a conflict, proving
  // the durable fingerprint is checked by PostgreSQL rather than by callers.
  const mismatch = await pool.connect(); clients.push(mismatch);
  try {
    await mismatch.query('BEGIN'); await role(mismatch);
    await assert.rejects(
      mismatch.query('SELECT public.begin_service_draft_intent($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result', [actor, tenant, key, 'housekeeping', { ...payload, name: 'fingerprint mismatch' }]),
      (error: any) => error?.code === '40001' && error?.message === 'SERVICE_DRAFT_CONFLICT',
    );
  } finally { await mismatch.query('ROLLBACK').catch(() => {}); }
  // Free the first proof's sessions before opening the second pair; the
  // guarded disposable pool intentionally has a small max size.
  for (const client of clients.splice(0, 3)) client.release();

  // Hold the tenant lock again while both ingestion calls use the same key.
  const ingestA = await pool.connect(); clients.push(ingestA); const ingestB = await pool.connect(); clients.push(ingestB);
  await Promise.all([ingestA.query('BEGIN'), ingestB.query('BEGIN')]); await Promise.all([role(ingestA), role(ingestB)]);
  const ingestBPid = await backendPid(ingestB);
  await ingestA.query('SELECT pg_advisory_xact_lock(hashtextextended($1,38421))', [tenant]);
  const callA = ingestA.query('SELECT public.ingest_service_draft($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result', [actor, tenant, key, 'housekeeping', payload]);
  const callAResult = await callA;
  serviceId = callAResult.rows[0].result.serviceId;
  const callB = ingestB.query('SELECT public.ingest_service_draft($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) AS result', [actor, tenant, key, 'housekeeping', payload]);
  await waitForAdvisoryWait(pool, ingestBPid);
  await ingestA.query('COMMIT');
  const callBResult = await callB;
  assert.equal(callBResult.rows[0].result.serviceId, serviceId);
  await ingestB.query('COMMIT');

  await ingestA.query('RESET ROLE');
  const counts = (await ingestA.query('SELECT (SELECT count(*) FROM public.service_draft_intents WHERE tenant_id=$1 AND idempotency_key=$2) AS intents, (SELECT count(*) FROM public.service_draft_ingestions WHERE tenant_id=$1 AND idempotency_key=$2) AS ingestions, (SELECT count(*) FROM public.services WHERE tenant_id=$1 AND id=$3) AS services', [tenant, key, serviceId])).rows;
  assert.deepEqual(counts[0], { intents: '1', ingestions: '1', services: '1' });
  console.log('PASS service adoption intent: same-key advisory race converges, payload fingerprint conflicts, and ingestion creates one service');
} finally {
  for (const client of clients) await client.query('ROLLBACK').catch(() => {});
  const cleanup = clients[0];
  if (cleanup) {
    await cleanup.query('RESET ROLE').catch(() => {});
    if (serviceId) await cleanup.query('DELETE FROM public.service_draft_ingestions WHERE tenant_id=$1 AND idempotency_key=$2', [tenant, key]);
    await cleanup.query('DELETE FROM public.service_draft_intents WHERE tenant_id=$1 AND idempotency_key=$2', [tenant, key]);
    if (serviceId) await cleanup.query('DELETE FROM public.services WHERE tenant_id=$1 AND id=$2', [tenant, serviceId]);
  }
  for (const client of clients) client.release();
  await pool.end();
}
