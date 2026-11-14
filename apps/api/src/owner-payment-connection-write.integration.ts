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

  // ---- write-once: a second account cannot displace a live one ---------------
  const second = await begin(owner, tenant, {...URLS, idempotencyKey: 'conn-write-attempt-0002'});
  provider.completeHandoff(second.handoffId);
  await rejects(() => resolve(owner, tenant, {handoffId: second.handoffId}), 'FORBIDDEN',
    'a live connection cannot be repointed to a different account');
  assert.equal(only(await read(owner, tenant)).accountId, live.accountId, 'the account did not move');

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
