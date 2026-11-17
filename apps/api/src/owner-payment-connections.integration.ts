/**
 * Payment connection reader, against a real disposable PostgreSQL.
 *
 * The unit test proves the mapping and the HTTP test proves the route; neither
 * runs a line of 0093. This harness is what shows the reader actually works
 * against the migration: that the RPC exists with the signature the reader
 * calls, that lumin.flow_actor inside it admits members and refuses everyone
 * else, that the transaction mode is legal (a `read only` transaction fails
 * 25006 against the real FOR SHARE locks), and that the four health verdicts
 * come out of facts a real provider path would have written.
 *
 * It drives the connection through the RPCs rather than inserting rows, because
 * 0093 revoked every direct write verb -- including from service_role. Writing
 * the fixtures any other way would be proving something the product cannot do.
 */
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createOwnerPaymentConnectionsReader} from './owner-payment-connections';

if (process.env.FLOW_TEST_DISPOSABLE !== '1' || !/^lumin_/.test(process.env.PGDATABASE ?? '') || process.env.PGHOST !== '127.0.0.1') {
  throw Error('disposable loopback database required');
}

const pool = new Pool({max: 4});
const id = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), staff = id(2), stranger = id(3), otherOwner = id(4);
const tenant = id(10), other = id(11);
const read = createOwnerPaymentConnectionsReader(pool);

/** service_role is how apps/api reaches the definer RPCs. */
async function asService(sql: string, params: unknown[] = []): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const r = await client.query(sql, params);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function rejects(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const actual = (error as {code?: string}).code;
    assert.equal(actual, code, `${label}: expected ${code}, got ${String(actual)}`);
    return;
  }
  assert.fail(`${label}: expected ${code}, resolved instead`);
}

try {
  await pool.query(
    "insert into auth.users(id,email) select id,'conn-'||i||'@example.test' from unnest($1::uuid[]) with ordinality t(id,i)",
    [[owner, staff, stranger, otherOwner]],
  );
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'Conn','conn-reader-t','UTC','USD'),($2,'Other','conn-reader-o','UTC','USD')",
    [tenant, other],
  );
  // 0092: one account belongs to exactly one business, so each tenant has its own owner.
  await pool.query(
    "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')",
    [tenant, owner, staff],
  );
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [other, otherOwner]);

  // 0088 is the connect-time gate. 'staging_mock' is seeded only on a lumin_*
  // database, which is exactly where this harness runs.
  const allowed = await pool.query('select provider from public.confirmable_payment_providers order by provider');
  assert.ok(
    allowed.rows.some((r: {provider: string}) => r.provider === 'staging_mock'),
    'this disposable database must have 0088 seeded staging_mock',
  );

  // ---- nothing connected yet -------------------------------------------------
  const empty = await read(owner, tenant);
  assert.deepEqual(empty, {schemaVersion: 1, tenantId: tenant, connections: []});

  // ---- an owner begins a handoff: visible, and grants nothing -----------------
  await asService(
    "select public.begin_payment_connection($1::uuid,$2::uuid,'staging_mock',$3,$4,now()+interval '5 minutes')",
    [owner, tenant, 'conn-reader-attempt-0001', 'mch_conn_reader_0001'],
  );
  const begun = await read(owner, tenant);
  assert.equal(begun.connections.length, 1);
  assert.equal(begun.connections[0]!.provider, 'staging_mock');
  assert.equal(begun.connections[0]!.status, 'not_connected');
  assert.equal(begun.connections[0]!.accountId, null);
  assert.equal(begun.connections[0]!.chargesEnabled, false);
  // THE verdict for "an owner pressed connect and nothing else has happened".
  assert.equal(begun.connections[0]!.health, 'not_connected');

  // ---- bound and healthy -> chargeable ---------------------------------------
  await asService(
    "select public.record_payment_connection($1::uuid,$2::uuid,$3,$4,true,true,true,null,now())",
    [owner, tenant, 'mch_conn_reader_0001', 'acct_conn_reader_000001'],
  );
  const live = await read(owner, tenant);
  assert.equal(live.connections[0]!.status, 'connected');
  assert.equal(live.connections[0]!.accountId, 'acct_conn_reader_000001');
  assert.equal(live.connections[0]!.health, 'chargeable');
  assert.equal(live.connections[0]!.blockedReason, null);
  assert.ok(live.connections[0]!.lastObservedAt !== null, 'a bound connection records when it was observed');

  // ---- payouts fail -> DEGRADED, and it is still charging ---------------------
  // The state a boolean would erase: money moves and then strands.
  await asService(
    "select public.observe_payment_connection($1::uuid,$2,true,false,true,'payouts_disabled',now())",
    [tenant, 'acct_conn_reader_000001'],
  );
  const degraded = await read(staff, tenant);
  assert.equal(degraded.connections[0]!.health, 'degraded');
  assert.equal(degraded.connections[0]!.chargesEnabled, true);
  assert.equal(degraded.connections[0]!.payoutsEnabled, false);
  assert.equal(degraded.connections[0]!.blockedReason, 'payouts_disabled');
  assert.equal(degraded.connections[0]!.status, 'connected', 'a payouts problem must not disconnect the merchant');

  // ---- restricted merchant -> BLOCKED, still 'connected' ---------------------
  await asService(
    "select public.observe_payment_connection($1::uuid,$2,false,true,true,'requirements_past_due',now())",
    [tenant, 'acct_conn_reader_000001'],
  );
  const blocked = await read(owner, tenant);
  assert.equal(blocked.connections[0]!.health, 'blocked');
  assert.equal(blocked.connections[0]!.status, 'connected', 'a restricted merchant stays connected; the verdict carries it');

  // ---- the provider disowns the account -> revoked, and still BLOCKED --------
  await asService(
    "select public.observe_payment_connection($1::uuid,$2,false,false,true,'credentials_invalid',now())",
    [tenant, 'acct_conn_reader_000001'],
  );
  const revoked = await read(owner, tenant);
  assert.equal(revoked.connections[0]!.status, 'revoked');
  assert.equal(revoked.connections[0]!.health, 'blocked');

  // ---- authority -------------------------------------------------------------
  // Staff may see it: a business whose checkout is failing must not need the
  // owner personally to discover it.
  assert.equal((await read(staff, tenant)).connections.length, 1);
  // Nobody else may, however the tenant id is supplied.
  await rejects(() => read(stranger, tenant), 'FORBIDDEN', 'a non-member is refused');
  await rejects(() => read(otherOwner, tenant), 'FORBIDDEN', "another business's owner is refused");
  await rejects(() => read(owner, other), 'FORBIDDEN', 'an owner cannot read another tenant');
  // And the other tenant genuinely has its own, empty view.
  assert.deepEqual((await read(otherOwner, other)).connections, []);

  // ---- the reader cannot write, even though service_role is the role ---------
  // 0093 revoked every direct write verb from service_role too, so this is what
  // the reader would hit if it ever tried.
  await rejects(
    () => asService("update public.payment_connections set status='connected' where tenant_id=$1::uuid", [tenant]),
    '42501',
    'service_role cannot UPDATE the connection directly',
  );
  await rejects(
    () => asService('truncate public.payment_connections'),
    '42501',
    'service_role cannot TRUNCATE the connection table',
  );

  // ---- the handoff ledger is not readable through the reader's surface -------
  // It is service_role SELECT only, and nothing in the reader's output carries it.
  assert.ok(!JSON.stringify(revoked).includes('mch_conn_reader_0001'), 'no handoff id is exposed to a member');

  console.log('PASS owner-payment-connections.integration');
} finally {
  await pool.end();
}
