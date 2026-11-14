/**
 * Payment connection WRITE path, against a real disposable PostgreSQL.
 *
 * The unit tests use a fake pool, so they prove the ORDER of calls but not that
 * 0093 accepts them. This harness drives the whole owner flow against the real
 * migration: begin a handoff, resolve it, and watch the status the DATABASE
 * derives -- plus the refusals that matter, each of which is a property the
 * design claims rather than a line of code.
 */
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createMockPaymentConnectionProvider} from '@lumin/adapters';
import {
  createOwnerConnectionBeginWriter,
  createOwnerConnectionResolveWriter,
} from './owner-payment-connection-write';
import {createOwnerPaymentConnectionsReader} from './owner-payment-connections';

if (process.env.FLOW_TEST_DISPOSABLE !== '1' || !/^lumin_/.test(process.env.PGDATABASE ?? '') || process.env.PGHOST !== '127.0.0.1') {
  throw Error('disposable loopback database required');
}

const pool = new Pool({max: 4});
const id = (n: number) => `83000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), staff = id(2), stranger = id(3), otherOwner = id(4);
const tenant = id(10), other = id(11);
// A third business for the two concurrency cases below, so that `other` stays unconnected for the
// cross-tenant case further down.
const fifthOwner = id(5), third = id(12);
const URLS = {returnUrl: 'https://portal.example.test/r', refreshUrl: 'https://portal.example.test/f'};

type T = Awaited<ReturnType<ReturnType<typeof createOwnerPaymentConnectionsReader>>>['connections'][number];

const provider = createMockPaymentConnectionProvider();

/**
 * Counting wrapper around the READ half.
 *
 * provider.listHandoffs() only records beginConnection, so it cannot observe a
 * resolve at all: asserting it is unchanged after a refused resolve is an
 * assertion that cannot fail. The refusals below need to see whether the
 * provider was READ, so resolves are counted here.
 */
let providerReads = 0;
const counting = {
  providerName: provider.providerName,
  beginConnection: provider.beginConnection.bind(provider),
  async resolveConnection(id: string) {
    providerReads += 1;
    return provider.resolveConnection(id);
  },
  inspectConnection: provider.inspectConnection?.bind(provider),
};

const begin = createOwnerConnectionBeginWriter(pool, provider);
const resolve = createOwnerConnectionResolveWriter(pool, counting as never);
const read = createOwnerPaymentConnectionsReader(pool);

/**
 * The tenant's one connection row.
 *
 * Asserts the count as well as reading it: a second row for the same provider
 * would mean 0006's unique (tenant_id, provider) had stopped holding, and that
 * is worth failing on rather than silently reading [0].
 */
function only(view: {connections: readonly T[]}): T {
  assert.equal(view.connections.length, 1, 'exactly one connection row');
  const row = view.connections[0];
  assert.ok(row);
  return row;
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

/**
 * Waits until some backend is blocked on a lock inside the named function. That is the proof that a
 * second transaction is WAITING on the first, not merely late: the holder commits only after this has
 * been observed, so the interleaving under test is the one that runs.
 */
async function waitForLockWait(fragment: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const waiting = await pool.query(
      "select count(*)::int c from pg_stat_activity where wait_event_type = 'Lock' and query like $1",
      [`%${fragment}%`],
    );
    if ((waiting.rows[0] as {c: number}).c >= 1) return;
    if (Date.now() > deadline) throw new Error(`no backend waited on a lock inside ${fragment}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

try {
  await pool.query(
    "insert into auth.users(id,email) select id,'cw-'||i||'@example.test' from unnest($1::uuid[]) with ordinality t(id,i)",
    [[owner, staff, stranger, otherOwner]],
  );
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'CW','conn-write-t','UTC','USD'),($2,'Other','conn-write-o','UTC','USD')",
    [tenant, other],
  );
  // 0092: one account, one business.
  await pool.query(
    "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')",
    [tenant, owner, staff],
  );
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [other, otherOwner]);
  await pool.query("insert into auth.users(id,email) values ($1,'cw-5@example.test')", [fifthOwner]);
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'CW Three','conn-write-third','UTC','USD')",
    [third],
  );
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [third, fifthOwner]);

  // ---- begin: an owner starts a handoff --------------------------------------
  const begun = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0001'});
  assert.equal(begun.provider, 'staging_mock');
  assert.equal(begun.replayed, false);
  assert.ok(begun.onboardingUrl.startsWith('https://'), 'the owner gets an https link to visit');

  // The ledger holds exactly one row, and the connection grants nothing yet.
  assert.equal((await pool.query('select count(*)::int c from public.payment_connection_handoffs where tenant_id=$1', [tenant])).rows[0].c, 1);
  const beforeResolve = await read(owner, tenant);
  assert.equal(only(beforeResolve).status, 'not_connected');
  assert.equal(only(beforeResolve).health, 'not_connected');
  assert.equal(only(beforeResolve).accountId, null);

  // The expiry the owner is told is the BIND DEADLINE the database enforces: the ledger's
  // expiry plus the one-hour grace (0095). It is a real instant.
  assert.ok(!Number.isNaN(Date.parse(begun.expiresAt)), 'the expiry parses');
  const ledgerExpiry = new Date((await pool.query(
    'select expires_at from public.payment_connection_handoffs where handoff_id=$1', [begun.handoffId])).rows[0].expires_at);
  assert.equal(Date.parse(begun.expiresAt), ledgerExpiry.getTime() + 3_600_000,
    'the receipt states the bind deadline: the stored expiry plus one hour');

  // ---- begin is idempotent, at the provider AND in the ledger ---------------
  const again = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0001'});
  assert.equal(again.replayed, true, 'the same key replays');
  assert.equal(again.handoffId, begun.handoffId, 'and returns the ORIGINAL handoff id');
  // begin_payment_connection never refreshes expires_at, and the receipt must
  // not claim it did: record_payment_connection enforces the stored value.
  assert.equal(again.expiresAt, begun.expiresAt, 'a replay does not extend the advertised window');
  assert.equal((await pool.query('select count(*)::int c from public.payment_connection_handoffs where tenant_id=$1', [tenant])).rows[0].c, 1,
    'a double-click leaves one handoff, not two');

  // ---- two begins with ONE key: the one that loses the insert is a replay (review 03, 31) -------------------------
  // A holder begins the key and does NOT commit. A second begin of the same key must WAIT for it, and
  // once the holder commits it loses the insert and is a replay of the holder's handoff. The wait is
  // observed in pg_stat_activity before the holder commits, so the loser path is always the one run.
  // (A Promise.all of two begins could finish in turn, never reach the loser path, and pass without
  // testing it: the mutation that made the loser report replayed:false passed that way.)
  const beginSql = 'select public.begin_payment_connection($1::uuid,$2::uuid,$3,$4,$5,$6::timestamptz) as receipt';
  const beginArgs = [fifthOwner, third, 'staging_mock', 'conn-write-race-0001', 'acct_race_000000001', '2035-01-01T00:05:00Z'];
  const beginHolder = await pool.connect();
  const beginLoser = await pool.connect();
  try {
    await beginHolder.query('begin');
    await beginHolder.query('set local role service_role');
    await beginHolder.query(beginSql, beginArgs);
    await beginLoser.query('begin');
    await beginLoser.query('set local role service_role');
    const losing = beginLoser.query(beginSql, beginArgs);
    await waitForLockWait('begin_payment_connection');
    await beginHolder.query('commit');
    const loser = (await losing).rows[0]?.receipt as {handoffId?: unknown; replayed?: unknown} | undefined;
    await beginLoser.query('commit');
    assert.equal(loser?.handoffId, 'acct_race_000000001', 'the loser returns the handoff the holder created');
    assert.equal(loser?.replayed, true, 'a begin that lost the insert to a concurrent begin of the same key is a replay');
  } finally {
    await beginHolder.query('rollback').catch(() => undefined);
    await beginLoser.query('rollback').catch(() => undefined);
    beginHolder.release();
    beginLoser.release();
  }

  // A handoff begun while the connection is still UNBOUND. It is recorded only after the link
  // goes live, so it is the one that reaches record_payment_connection's write-once rule.
  const second = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0002'});

  // ---- resolve BEFORE the person finishes: honest, and still not connected ---
  // The mock reports an unfinished handoff rather than throwing, so the status
  // the DATABASE derives must stay not_connected.
  const early = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(early.status, 'not_connected', 'an unfinished handoff does not become a connection');
  assert.equal(early.blockedReason, 'onboarding_incomplete');
  assert.equal(early.health, 'not_connected');
  assert.equal(early.replayed, false, 'the first recording of this handoff is not a replay');

  // ---- a PERSON finishes, then resolve binds a chargeable account ------------
  provider.completeHandoff(begun.handoffId);
  const live = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(live.replayed, true, 'this handoff HAS been recorded before -- what the field means');
  assert.equal(live.status, 'connected');
  assert.equal(live.health, 'chargeable');
  assert.equal(live.chargesEnabled, true);
  assert.ok(/^acct_mock_[0-9a-f]{24}$/.test(live.accountId), 'the bound account is the one the provider minted');

  // The reader agrees -- one authority for the verdict, two surfaces.
  const seen = await read(staff, tenant);
  assert.equal(only(seen).status, 'connected');
  assert.equal(only(seen).health, 'chargeable');
  assert.equal(only(seen).accountId, live.accountId);

  // ---- AN INCONCLUSIVE ANSWER CHANGES NOTHING -------------------------------
  // The property the whole design rests on, proven end to end: a provider that
  // cannot answer must leave the recorded row exactly as it was.
  provider.armUnavailable();
  await rejects(() => resolve(owner, tenant, {handoffId: begun.handoffId}), 'PROVIDER_UNAVAILABLE',
    'an inconclusive provider answer fails the request as an upstream outage, not a server fault');
  const afterOutage = await read(owner, tenant);
  assert.equal(only(afterOutage).status, 'connected', 'the row kept its status through the outage');
  assert.equal(only(afterOutage).health, 'chargeable');
  assert.equal(only(afterOutage).accountId, live.accountId);

  // ---- write-once, at the DATABASE: the handoff begun before the link went live -----------
  // A connected tenant is refused a NEW handoff by the writer (next block), so the handoff begun
  // while unbound is the one that reaches record_payment_connection. It is refused as a conflict,
  // and the account does not move.
  provider.completeHandoff(second.handoffId);
  await rejects(() => resolve(owner, tenant, {handoffId: second.handoffId}), 'CONFLICT',
    'a live connection cannot be repointed to a different account');
  assert.equal(only(await read(owner, tenant)).accountId, live.accountId, 'the account did not move');

  // ---- a connected tenant starts no NEW handoff: refused before the provider is asked ----
  // A new key here would make the provider create a second account that the ledger refuses to bind.
  const handoffsBeforeNew = provider.listHandoffs().length;
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0003'}), 'CONFLICT',
    'a connected tenant starts no new handoff');
  assert.equal(provider.listHandoffs().length, handoffsBeforeNew, 'the provider was not asked for a second account');
  // A retried begin with the tenant's own key still gets its handoff: that is a replay, not a new account.
  const replayOnConnected = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0001'});
  assert.equal(replayOnConnected.handoffId, begun.handoffId, 'a retried begin on a connected tenant gets its own handoff');

  // ---- the handoff lock decides replayed under contention (review 26) -------------
  // The first record binds an account and does NOT commit. A second record of the same handoff must WAIT
  // for it, and once the first commits it reports replayed:true: the handoff was recorded before this
  // call. The lock is what makes that true. Without the handoff row lock, the second record reads the
  // handoff before the first commits, reports replayed:false, and this fails. (A short lock timeout
  // alone proves only that the record waits somewhere: the handoff UPDATE below also waits.)
  // The handoff the race case above began, on the third business. It is unrecorded, and its first record
  // binds the account the second record names, so the two records are the same handoff and the same account.
  const recordSql = 'select public.record_payment_connection($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::timestamptz) as receipt';
  const firstArgs = [fifthOwner, third, 'acct_race_000000001', 'acct_contend_000001', true, true, true, null, '2035-01-01T00:10:00Z'];
  const secondArgs = [fifthOwner, third, 'acct_race_000000001', 'acct_contend_000001', true, true, true, null, '2035-01-01T00:11:00Z'];
  const recordHolder = await pool.connect();
  const recordLoser = await pool.connect();
  try {
    await recordHolder.query('begin');
    await recordHolder.query('set local role service_role');
    const first = (await recordHolder.query(recordSql, firstArgs)).rows[0]?.receipt as {replayed?: unknown} | undefined;
    assert.equal(first?.replayed, false, 'the first record of the handoff is not a replay');
    await recordLoser.query('begin');
    await recordLoser.query('set local role service_role');
    const losing = recordLoser.query(recordSql, secondArgs);
    await waitForLockWait('record_payment_connection');
    await recordHolder.query('commit');
    const late = (await losing).rows[0]?.receipt as {status?: unknown; replayed?: unknown; accountId?: unknown} | undefined;
    await recordLoser.query('commit');
    assert.equal(late?.replayed, true, 'a record that waited for the first record of the same handoff is a replay');
    assert.equal(late?.status, 'connected', 'the waiting record reads the committed state');
    assert.equal(late?.accountId, 'acct_contend_000001', 'and it names the account the first record bound');
  } finally {
    await recordHolder.query('rollback').catch(() => undefined);
    await recordLoser.query('rollback').catch(() => undefined);
    recordHolder.release();
    recordLoser.release();
  }

  // ---- two DIFFERENT handoffs race for the connection row, and two observations race (review 37) ------------
  // Each record takes its OWN handoff lock, so two records of two handoffs never meet there. The connection row
  // is the lock they share: the first binds account A and does not commit; the second names account B for a
  // different handoff, must WAIT for the row, and then finds A bound and is refused. Without the connection-row
  // lock it reads the row before the first commits, passes write-once, and its update replaces A with B.
  const rowOwner = id(106), rowTenant = id(107);
  await pool.query("insert into auth.users(id,email) values ($1,'cw-106@example.test')", [rowOwner]);
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'CW Row','conn-write-row','UTC','USD')",
    [rowTenant],
  );
  await pool.query("insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')", [rowTenant, rowOwner]);
  const rowFirst = await begin(rowOwner, rowTenant, {...URLS, idempotencyKey: 'conn-write-row-0001'});
  const rowSecond = await begin(rowOwner, rowTenant, {...URLS, idempotencyKey: 'conn-write-row-0002'});
  const rowHolder = await pool.connect();
  const rowLoser = await pool.connect();
  try {
    await rowHolder.query('begin');
    await rowHolder.query('set local role service_role');
    await rowHolder.query(recordSql, [rowOwner, rowTenant, rowFirst.handoffId, 'acct_row_a000001', true, true, true, null, '2035-01-01T00:10:00Z']);
    await rowLoser.query('begin');
    await rowLoser.query('set local role service_role');
    const losing = rowLoser.query(recordSql, [rowOwner, rowTenant, rowSecond.handoffId, 'acct_row_b000001', true, true, true, null, '2035-01-01T00:11:00Z'])
      .then(() => null, (error: {code?: string; message?: string}) => error);
    await waitForLockWait('record_payment_connection');
    await rowHolder.query('commit');
    const refusal = await losing;
    await rowLoser.query('rollback').catch(() => undefined);
    assert.ok(refusal, 'a second handoff naming ANOTHER account is refused once the first has bound the connection');
    assert.equal(refusal?.code, '23505', 'as a conflict');
    assert.match(String(refusal?.message), /PAYMENT_CONNECTION_ALREADY_BOUND/);
  } finally {
    await rowHolder.query('rollback').catch(() => undefined);
    await rowLoser.query('rollback').catch(() => undefined);
    rowHolder.release();
    rowLoser.release();
  }
  assert.equal(only(await read(rowOwner, rowTenant)).accountId, 'acct_row_a000001', 'the connection still holds the first account');

  // Two observations of one account. The newer one holds the row and does not commit; the older one must WAIT for
  // it, and once it commits the older answer is stale and changes nothing. Without the connection-row lock the
  // older one reads the state before the newer commits, passes the stale check, and writes its older facts over them.
  const obsSql = 'select public.observe_payment_connection($1::uuid,$2,$3::boolean,$4::boolean,$5::boolean,$6,$7::timestamptz) as receipt';
  const obsHolder = await pool.connect();
  const obsLoser = await pool.connect();
  try {
    await obsHolder.query('begin');
    await obsHolder.query('set local role service_role');
    await obsHolder.query(obsSql, [rowTenant, 'acct_row_a000001', true, true, true, null, '2035-01-01T00:20:00Z']);
    await obsLoser.query('begin');
    await obsLoser.query('set local role service_role');
    const older = obsLoser.query(obsSql, [rowTenant, 'acct_row_a000001', false, false, false, 'charges_disabled', '2035-01-01T00:15:00Z'])
      .then((result) => result.rows[0]?.receipt as {statusChanged?: unknown} | undefined);
    await waitForLockWait('observe_payment_connection');
    await obsHolder.query('commit');
    const olderReceipt = await older;
    await obsLoser.query('commit');
    assert.equal(olderReceipt?.statusChanged, false, 'the older observation changed nothing');
  } finally {
    await obsHolder.query('rollback').catch(() => undefined);
    await obsLoser.query('rollback').catch(() => undefined);
    obsHolder.release();
    obsLoser.release();
  }
  const stored = (await pool.query(
    'select charges_enabled, blocked_reason, last_observed_at from public.payment_connections where tenant_id=$1',
    [rowTenant],
  )).rows[0] as {charges_enabled: boolean; blocked_reason: string | null; last_observed_at: Date};
  assert.equal(stored.charges_enabled, true, 'the newer observation is the one the row holds');
  assert.equal(stored.blocked_reason, null);
  assert.equal(new Date(stored.last_observed_at).toISOString(), '2035-01-01T00:20:00.000Z');

  // ---- the recovery path 0093 relaxes write-once for ------------------------
  // The provider disowns the account. Automation records that (status derives to
  // 'revoked'), and the OWNER may then connect a different account -- which is
  // the whole reason the write-once rule is lifted for a dead connection.
  provider.providerWillReport(live.accountId, {chargesEnabled: false, blockedReason: 'credentials_invalid'});
  const revoked = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(revoked.status, 'revoked', 'a disowned account derives to revoked');
  assert.equal(revoked.health, 'blocked');

  const reconnect = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-reconnect-01'});
  provider.completeHandoff(reconnect.handoffId);
  const rebound = await resolve(owner, tenant, {handoffId: reconnect.handoffId});
  assert.notEqual(rebound.accountId, live.accountId, 'the owner reconnected a DIFFERENT account');
  assert.equal(rebound.status, 'connected', 'and the connection is alive again');
  assert.equal(rebound.health, 'chargeable');
  // THE POINT OF THIS BLOCK. The underlying RPC reports `replayed` as "the
  // connection already had an account", which is true here and would describe
  // the tenant's money moving to another merchant as "already recorded". The
  // receipt reports the handoff's own history instead, so this reads false.
  assert.equal(rebound.replayed, false, 'a brand-new handoff is not a replay, even on a rebind');
  assert.equal(only(await read(owner, tenant)).accountId, rebound.accountId, 'the reader agrees the account moved');

  // ---- authority -------------------------------------------------------------
  // Staff may READ (proven above) but must not WRITE: connecting a merchant
  // account is owner authority.
  //
  // Each refusal is checked TWICE: the error code, and that the provider was
  // never asked to do anything. The second half is the one that matters. The
  // code refused while the provider had already minted an account would look
  // identical here, and against Stripe it would be a real Connect account
  // created for a business the caller has no authority over.
  const handoffsBefore = provider.listHandoffs().length;
  const readsBefore = providerReads;
  const refusedWrites: Array<[string, () => Promise<unknown>]> = [
    ['staff cannot begin a handoff', () => begin(staff, tenant, {...URLS, idempotencyKey: 'conn-write-staff-00001'})],
    ['staff cannot resolve a handoff', () => resolve(staff, tenant, {handoffId: begun.handoffId})],
    ['a non-member cannot begin a handoff', () => begin(stranger, tenant, {...URLS, idempotencyKey: 'conn-write-stranger-001'})],
    ["another business's owner cannot begin a handoff here", () => begin(otherOwner, tenant, {...URLS, idempotencyKey: 'conn-write-foreign-0001'})],
    ['a non-member cannot resolve a handoff', () => resolve(stranger, tenant, {handoffId: begun.handoffId})],
    ["another business's owner cannot resolve this tenant's handoff", () => resolve(otherOwner, tenant, {handoffId: begun.handoffId})],
  ];
  for (const [label, attempt] of refusedWrites) {
    await rejects(attempt, 'FORBIDDEN', label);
    // BOTH halves, because neither counter can see the other: begin writes the
    // handoff map and never reads, resolve reads and never writes the map. The
    // resolve rows used to be checked against the handoff map alone, which they
    // cannot change, so they asserted nothing.
    assert.equal(provider.listHandoffs().length, handoffsBefore, `${label}: no handoff was begun`);
    assert.equal(providerReads, readsBefore, `${label}: the provider was not read`);
  }

  // ---- a handoff of ANOTHER tenant is not resolvable, and never reaches the
  // provider: the ledger lookup is scoped and refuses first.
  await begin(otherOwner, other, {...URLS, idempotencyKey: 'conn-write-other-00001'});
  const foreignHandoff = String(
    (await pool.query('select handoff_id from public.payment_connection_handoffs where tenant_id=$1', [other])).rows[0].handoff_id,
  );
  await rejects(() => resolve(owner, tenant, {handoffId: foreignHandoff}), 'NOT_AVAILABLE',
    "another tenant's handoff is not resolvable");

  // ---- the writer cannot write the table directly ---------------------------
  // 0093 revoked every direct verb from service_role, so the RPCs are the only
  // path and their bodies are the only constraint that matters.
  const direct = await pool.connect();
  try {
    await direct.query('begin');
    await direct.query('set local role service_role');
    let refused = false;
    try {
      await direct.query("update public.payment_connections set account_id='acct_sneaky_00000001' where tenant_id=$1::uuid", [tenant]);
    } catch (e) {
      refused = (e as {code?: string}).code === '42501';
    }
    await direct.query('rollback');
    assert.ok(refused, 'service_role cannot UPDATE the connection table directly');
  } finally {
    direct.release();
  }

  console.log('PASS owner-payment-connection-write.integration');
} finally {
  await pool.end();
}
