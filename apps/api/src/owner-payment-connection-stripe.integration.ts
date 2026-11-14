/**
 * P1 step 6 -- the owner write path, driven through the REAL Stripe Connect adapter.
 *
 * The mock harness proves the write path's ordering and its database contract. This
 * one proves the same path with the adapter that will talk to Stripe, against a
 * disposable PostgreSQL. It checks what the mock cannot:
 *
 *   1. the requests the adapter actually makes are what the database expects, and
 *      the handoff is the account Stripe minted, bound to this business there, and
 *      recorded under the TEST-MODE label;
 *   2. an account Stripe reports as chargeable lands as chargeable; a 500 from
 *      Stripe changes nothing recorded; and a 500 on the onboarding link leaves a
 *      retry with the same key that works, on the account already minted;
 *   3. a merchant Stripe disowns is recorded as revoked, and the owner can connect a
 *      DIFFERENT account afterwards -- the 0093 recovery path, with the real adapter.
 *      A key that belongs to another platform is refused the same way for every
 *      merchant, and that refusal is an outage: it records nothing;
 *   4. the whole connection flow asks Stripe for exactly four kinds of request, none
 *      of which moves money, and no platform secret reaches a receipt or a row. A
 *      database that does not declare the test label refuses the connection BEFORE
 *      Stripe is asked anything.
 *
 * Stripe is an in-process stand-in (below) because this sandbox cannot reach
 * api.stripe.com. It serves the requests the adapter makes and records anything
 * else as unexpected, so a request the flow had no business making fails the harness.
 */
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {
  createOwnerConnectionBeginWriter,
  createOwnerConnectionResolveWriter,
} from './owner-payment-connection-write';
import {createOwnerPaymentConnectionsReader} from './owner-payment-connections';
import {
  PAYMENT_CONNECTION_PROVIDER_ENV,
  STRIPE_PLATFORM_ACCOUNT_ENV,
  STRIPE_PLATFORM_KEY_ENV,
  STRIPE_TEST_PROVIDER_LABEL,
  selectPaymentConnectionProvider,
} from './payment-connection-provider';

if (process.env.FLOW_TEST_DISPOSABLE !== '1' || !/^lumin_/.test(process.env.PGDATABASE ?? '') || process.env.PGHOST !== '127.0.0.1') {
  throw Error('disposable loopback database required');
}

// Built at runtime so the repository never holds a literal secret-shaped value.
const TEST_KEY = ['sk', 'test', 'fixturePlatformKey0000'].join('_');
/** The platform account the test key belongs to: what the operator pins. */
const PLATFORM = 'acct_platform000001';
const pool = new Pool({max: 4});
const id = (n: number) => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), staff = id(2), stranger = id(3);
const tenant = id(10);
const URLS = {returnUrl: 'https://portal.example.test/r', refreshUrl: 'https://portal.example.test/f'};

type ConnectionRow = {status: string; health: string; accountId: string | null; blockedReason: string | null};
function only(view: {connections: readonly ConnectionRow[]}): ConnectionRow {
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
 * An in-process stand-in for the Stripe REST calls the adapter makes.
 *
 * It serves four routes: POST /v1/accounts, POST /v1/account_links, GET /v1/accounts/{id}
 * and GET /v1/account (the platform's own account, read to confirm a disown). Each has
 * Stripe's documented behaviour, including that an Idempotency-Key replays the object as
 * it was CREATED, not as it is now, and that a keyed 500 is saved and replayed. Anything
 * else is recorded as unexpected and answered with a 500, so a request the flow did not
 * need fails the harness rather than being quietly served.
 */
interface StandInRequest {
  method: string;
  path: string;
  stripeAccount: string | null;
  idempotencyKey: string | null;
}

function standIn() {
  const accounts = new Map<string, Record<string, unknown>>();
  const disowned = new Set<string>();
  // The answer kept for each keyed request, a 500 included, as Stripe keeps it.
  const replays = new Map<string, {status: number; body: unknown}>();
  const requests: StandInRequest[] = [];
  const unexpected: string[] = [];
  /** What GET /v1/account reports for the key. Changed only to model a foreign key. */
  let platform = PLATFORM;
  let armedFailures = 0;
  let armedPath: string | null = null;
  let seq = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  const stripeError = (status: number, code: string) =>
    json({error: {type: 'invalid_request_error', code, message: 'stand-in'}}, status);

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const idempotencyKey = headers.get('Idempotency-Key');
    requests.push({method, path: url.pathname, stripeAccount: headers.get('Stripe-Account'), idempotencyKey});
    if (armedFailures > 0 && (armedPath === null || url.pathname === armedPath)) {
      armedFailures -= 1;
      const outage = {error: {type: 'api_error', message: 'stand-in outage'}};
      // Stripe keeps the answer to a keyed request, a 500 included: the retry with that key gets it back.
      if (idempotencyKey && method === 'POST' && (url.pathname === '/v1/accounts' || url.pathname === '/v1/account_links')) {
        replays.set(`${url.pathname}:${idempotencyKey}`, {status: 500, body: outage});
      }
      return json(outage, 500);
    }
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');

    if (method === 'POST' && url.pathname === '/v1/accounts') {
      if (idempotencyKey && replays.has(`/v1/accounts:${idempotencyKey}`)) {
        const kept = replays.get(`/v1/accounts:${idempotencyKey}`)!;
        return json(structuredClone(kept.body), kept.status);
      }
      seq += 1;
      const accountId = `acct_standin${String(seq).padStart(12, '0')}`;
      const account = {
        id: accountId,
        object: 'account',
        type: 'standard',
        country: form.get('country'),
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        metadata: {tenantId: form.get('metadata[tenantId]')},
        requirements: {disabled_reason: 'requirements.pending_verification', currently_due: ['external_account'], past_due: []},
      };
      accounts.set(accountId, account);
      // A replay is the account AS CREATED. Storing the live object would let a later
      // drive() rewrite what a replay returns, and Stripe does not do that.
      if (idempotencyKey) replays.set(`/v1/accounts:${idempotencyKey}`, {status: 200, body: structuredClone(account)});
      return json(account);
    }

    if (method === 'POST' && url.pathname === '/v1/account_links') {
      const target = form.get('account') ?? '';
      if (!accounts.has(target)) return stripeError(404, 'resource_missing');
      if (idempotencyKey && replays.has(`/v1/account_links:${idempotencyKey}`)) {
        const kept = replays.get(`/v1/account_links:${idempotencyKey}`)!;
        return json(structuredClone(kept.body), kept.status);
      }
      seq += 1;
      const link = {
        object: 'account_link',
        url: `https://connect.stripe.com/setup/s/standin${seq}`,
        expires_at: Math.floor(Date.now() / 1000) + 300,
      };
      if (idempotencyKey) replays.set(`/v1/account_links:${idempotencyKey}`, {status: 200, body: link});
      return json(link);
    }

    if (method === 'GET' && url.pathname === '/v1/account') {
      return json({id: platform, object: 'account', type: 'standard'});
    }

    const read = /^\/v1\/accounts\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && read) {
      const accountId = decodeURIComponent(read[1] ?? '');
      if (disowned.has(accountId)) return stripeError(403, 'account_invalid');
      const account = accounts.get(accountId);
      return account ? json(account) : stripeError(404, 'resource_missing');
    }

    unexpected.push(`${method} ${url.pathname}`);
    return json({error: {type: 'api_error', message: 'unexpected request'}}, 500);
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    requests,
    unexpected,
    accounts: () => [...accounts.values()],
    /** The outside world moving: what Stripe says about an account from now on. */
    drive(accountId: string, facts: {chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean}) {
      const account = accounts.get(accountId);
      assert.ok(account, 'the stand-in holds the account it is asked to change');
      Object.assign(account, {
        charges_enabled: facts.chargesEnabled,
        payouts_enabled: facts.payoutsEnabled,
        details_submitted: facts.detailsSubmitted,
        requirements: {
          disabled_reason: facts.chargesEnabled && facts.payoutsEnabled ? null : 'requirements.pending_verification',
          currently_due: facts.detailsSubmitted ? [] : ['external_account'],
          past_due: [],
        },
      });
    },
    disown(accountId: string) {
      disowned.add(accountId);
    },
    /** Make the next N requests a 500, optionally only those to one path. */
    armServerError(times = 1, path: string | null = null) {
      armedFailures = times;
      armedPath = path;
    },
    /** The key now belongs to this platform account instead. */
    setPlatformAccount(accountId: string) {
      platform = accountId;
    },
  };
}

const stripe = standIn();
// The selector builds the adapter exactly as production does. Only the transport differs.
const provider = selectPaymentConnectionProvider(
  {
    [PAYMENT_CONNECTION_PROVIDER_ENV]: 'stripe_connect',
    [STRIPE_PLATFORM_KEY_ENV]: TEST_KEY,
    [STRIPE_PLATFORM_ACCOUNT_ENV]: PLATFORM,
    // The test-mode provider is a staging capability; this harness stands in for staging.
    BOOKING_LUMIN_ENV: 'staging',
  },
  {fetchImpl: stripe.fetchImpl},
);
assert.equal(provider.providerName, STRIPE_TEST_PROVIDER_LABEL, 'the selector built the Stripe adapter, under the test label');
const begin = createOwnerConnectionBeginWriter(pool, provider);
const resolve = createOwnerConnectionResolveWriter(pool, provider);
const read = createOwnerPaymentConnectionsReader(pool);

try {
  await pool.query(
    "insert into auth.users(id,email) select id,'stripe-'||i||'@example.test' from unnest($1::uuid[]) with ordinality t(id,i)",
    [[owner, staff, stranger]],
  );
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'Stripe Co','stripe-connect-t','UTC','USD')",
    [tenant],
  );
  await pool.query(
    "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER'),($1,$3,'BUSINESS_STAFF')",
    [tenant, owner, staff],
  );

  // ---- begin: the owner starts Stripe Connect onboarding --------------------
  const begun = await begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-attempt-0000001'});
  assert.equal(begun.provider, STRIPE_TEST_PROVIDER_LABEL, 'a test-mode connection says so, in the row it is stored under');
  assert.match(begun.handoffId, /^acct_standin\d{12}$/, 'the handoff is the account reference Stripe minted');
  assert.match(begun.onboardingUrl, /^https:\/\/connect\.stripe\.com\//, 'the owner is sent to Stripe');
  assert.equal(begun.replayed, false);
  assert.equal(stripe.accounts().length, 1, 'one merchant account was created');
  const created = stripe.accounts()[0]!;
  assert.equal(created.id, begun.handoffId);
  assert.equal((created.metadata as {tenantId?: string}).tenantId, tenant, 'the account is bound to this business at Stripe');

  const ledger = (await pool.query(
    'select expires_at from public.payment_connection_handoffs where handoff_id=$1', [begun.handoffId])).rows[0];
  // The receipt states the ENFORCED bind deadline: the ledger's expiry plus the one-hour grace.
  assert.equal(Date.parse(begun.expiresAt), new Date(ledger.expires_at).getTime() + 3_600_000,
    'the receipt states the bind deadline the database enforces: the ledger expiry plus one hour');

  // ---- begin is idempotent at Stripe, and so in the ledger ------------------
  const again = await begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-attempt-0000001'});
  assert.equal(again.replayed, true);
  assert.equal(again.handoffId, begun.handoffId);
  // A replay is the same ACCOUNT with a FRESH link. The first link is single-use and
  // expires within minutes, so handing it back would be a dead link.
  assert.notEqual(again.onboardingUrl, begun.onboardingUrl, 'a replay mints a fresh link, because the first one expires');
  assert.equal(stripe.accounts().length, 1, 'a double submit did not create a second merchant account');

  // ---- before the owner finishes: honest, and not connected ----------------
  const early = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(early.status, 'not_connected', 'an unfinished onboarding is not a connection');
  assert.equal(early.health, 'not_connected');
  assert.equal(early.blockedReason, 'onboarding_incomplete');

  // ---- the owner finishes at Stripe; resolve binds a chargeable account -----
  stripe.drive(begun.handoffId, {chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true});
  const live = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(live.status, 'connected');
  assert.equal(live.health, 'chargeable');
  assert.equal(live.accountId, begun.handoffId);
  assert.equal(live.replayed, true, 'this handoff had been recorded before, by the early resolve');
  assert.equal(only(await read(staff, tenant)).accountId, live.accountId, 'the reader agrees');

  // A replay of the account create, made AFTER the owner finished, still shows the
  // account as it was created. Stripe does the same, and a stand-in that did not would
  // certify behaviour Stripe does not have.
  const probe = await stripe.fetchImpl('https://api.stripe.com/v1/accounts', {
    method: 'POST',
    headers: {'Idempotency-Key': 'stripe-attempt-0000001', 'Content-Type': 'application/x-www-form-urlencoded'},
    body: 'type=standard&country=US',
  });
  const replayed = await probe.json() as {id: string; charges_enabled: boolean};
  assert.equal(replayed.id, begun.handoffId, 'the replay is the original account');
  assert.equal(replayed.charges_enabled, false, 'the replay shows the account as it was created, not as it is now');

  // ---- a 500 from Stripe is an outage, and changes nothing recorded --------
  stripe.armServerError(1);
  await rejects(() => resolve(owner, tenant, {handoffId: begun.handoffId}), 'PROVIDER_UNAVAILABLE',
    'a 500 from Stripe is an outage, not a verdict');
  const afterOutage = only(await read(owner, tenant));
  assert.equal(afterOutage.status, 'connected', 'the recorded connection survived the outage');
  assert.equal(afterOutage.accountId, live.accountId);

  // ---- the bind window closes; the account already held is still refreshed --------
  // Two hours past its link expiry this handoff can no longer bind a NEW account. The
  // account it holds is this owner's, so a refresh of it must still be recorded. The
  // window that refused that was a defect this round repairs (0095).
  await pool.query(
    "update public.payment_connection_handoffs set expires_at = now() - interval '2 hours' where handoff_id = $1",
    [begun.handoffId],
  );
  const refreshed = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(refreshed.status, 'connected', 'a refresh of the bound account is accepted after its window');
  assert.equal(refreshed.accountId, begun.handoffId);

  // ---- refusals happen before Stripe is asked anything ---------------------
  const beforeRefusals = stripe.requests.length;
  await rejects(() => begin(staff, tenant, {...URLS, idempotencyKey: 'stripe-staff-000001'}), 'FORBIDDEN',
    'staff cannot begin');
  await rejects(() => begin(stranger, tenant, {...URLS, idempotencyKey: 'stripe-stranger-0001'}), 'FORBIDDEN',
    'a non-member cannot begin');
  await rejects(() => resolve(staff, tenant, {handoffId: begun.handoffId}), 'FORBIDDEN',
    'staff cannot resolve');
  assert.equal(stripe.requests.length, beforeRefusals, 'no refused request reached Stripe');

  // ---- a key that now belongs to ANOTHER platform does not disown merchants ----
  // Stripe answers 403 account_invalid for every account a foreign key is asked
  // about. Read as a verdict, that would revoke a merchant who is still connected.
  stripe.disown(begun.handoffId);
  stripe.setPlatformAccount('acct_foreignplat01');
  await rejects(() => resolve(owner, tenant, {handoffId: begun.handoffId}), 'PROVIDER_UNAVAILABLE',
    'a 403 from a foreign key is an outage, not a verdict on the merchant');
  assert.equal(only(await read(owner, tenant)).status, 'connected',
    'nothing was recorded from the foreign key: the merchant is still connected');
  // A foreign key is refused at BEGIN too, before any merchant account is created under it.
  const accountsBeforeForeignBegin = stripe.accounts().length;
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-foreign-begin-1'}), 'PROVIDER_UNAVAILABLE',
    'a foreign key is refused before a merchant account is created');
  assert.equal(stripe.accounts().length, accountsBeforeForeignBegin, 'no merchant account was created under a foreign key');
  stripe.setPlatformAccount(PLATFORM);

  // ---- Stripe disowns the merchant: revoked, and the owner can reconnect ----
  const revoked = await resolve(owner, tenant, {handoffId: begun.handoffId});
  assert.equal(revoked.status, 'revoked', 'a disowned account is recorded as revoked');
  assert.equal(revoked.health, 'blocked');

  const reconnect = await begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-reconnect-0001'});
  assert.notEqual(reconnect.handoffId, begun.handoffId, 'a fresh handoff is a fresh merchant account');
  stripe.drive(reconnect.handoffId, {chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true});
  const rebound = await resolve(owner, tenant, {handoffId: reconnect.handoffId});
  assert.equal(rebound.status, 'connected');
  assert.equal(rebound.health, 'chargeable');
  assert.equal(rebound.accountId, reconnect.handoffId);
  assert.equal(rebound.replayed, false, 'a brand-new handoff binding a different account is not a replay');
  assert.equal(only(await read(owner, tenant)).accountId, reconnect.handoffId, 'the account moved, and the reader says so');

  // ---- a 500 on the onboarding link: nothing is recorded, and the retry works ----
  // The account is minted before the link is asked for, so a failed link leaves an
  // account behind. The retry with the SAME key must land on that account, not mint a
  // second one, and must be sent a working link.
  stripe.armServerError(1, '/v1/account_links');
  const linkKey = 'stripe-linkfail-0001';
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: linkKey}), 'PROVIDER_UNAVAILABLE',
    'a 500 on the onboarding link is an outage, not a handoff');
  const minted = stripe.accounts().at(-1)!;
  assert.equal(
    (await pool.query('select 1 from public.payment_connection_handoffs where idempotency_key = $1', [linkKey])).rowCount,
    0,
    'nothing was ledgered for the failed attempt',
  );
  const retried = await begin(owner, tenant, {...URLS, idempotencyKey: linkKey});
  assert.equal(retried.handoffId, minted.id, 'the retry lands on the account the failed attempt minted');
  assert.match(retried.onboardingUrl, /^https:\/\/connect\.stripe\.com\//, 'the retry is sent a working link');
  assert.equal(stripe.accounts().length, 3, 'the retry made no second merchant account');

  // ---- a keyed 500 on the account create is kept, as Stripe keeps it ----------
  // The retry with the SAME key gets the same 500, so only a NEW key starts a new attempt.
  stripe.armServerError(1, '/v1/accounts');
  const outageKey = 'stripe-acctfail-0001';
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: outageKey}), 'PROVIDER_UNAVAILABLE',
    'a 500 on the account create is an outage');
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: outageKey}), 'PROVIDER_UNAVAILABLE',
    'the same key replays the keyed 500');
  assert.equal(stripe.accounts().length, 3, 'the keyed 500 created no merchant account');
  const fresh = await begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-acctfail-0002'});
  assert.match(fresh.handoffId, /^acct_standin\d{12}$/, 'a new key is a new attempt');
  assert.equal(stripe.accounts().length, 4, 'a new key creates the one account it needs');

  // ---- a database that does not declare the test label refuses it BEFORE Stripe ----
  // This is a production database. The label is seeded only where the name is lumin_*,
  // so the harness removes the declaration to stand in for one, and the begin must be
  // refused without Stripe being asked anything. Otherwise a test account is minted
  // on a database that will not record it.
  await pool.query("delete from public.confirmable_payment_providers where provider = $1", [STRIPE_TEST_PROVIDER_LABEL]);
  const beforeUndeclared = stripe.requests.length;
  await rejects(() => begin(owner, tenant, {...URLS, idempotencyKey: 'stripe-undeclared-0001'}), 'INVALID_REQUEST',
    'an undeclared test label is refused');
  assert.equal(stripe.requests.length, beforeUndeclared, 'the undeclared label was refused before Stripe was asked anything');
  // The same for a RESOLVE: a handoff begun while the label was declared is not read back
  // on a database that no longer declares it, and Stripe is not asked either.
  const beforeUndeclaredResolve = stripe.requests.length;
  await rejects(() => resolve(owner, tenant, {handoffId: begun.handoffId}), 'UNSUPPORTED_CONFIG',
    'an undeclared test label is refused on resolve');
  assert.equal(stripe.requests.length, beforeUndeclaredResolve, 'the undeclared label was refused on resolve before Stripe was asked');
  await pool.query(
    "insert into public.confirmable_payment_providers (provider, note) values ($1, 'restored by the harness') on conflict (provider) do nothing",
    [STRIPE_TEST_PROVIDER_LABEL],
  );

  // ---- an abandoned onboarding does not lock a business out ----------------------
  // The owner returns from Stripe before finishing, so the account is bound as not
  // connected. A second attempt that finishes must bind its own account. On 0093 that
  // second bind was refused for ever. A business belongs to one owner (0092), so the
  // second business has its own.
  const second = id(11);
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'Stripe Co Two','stripe-connect-t2','UTC','USD')",
    [second],
  );
  await pool.query(
    "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",
    [second, stranger],
  );
  const abandoned = await begin(stranger, second, {...URLS, idempotencyKey: 'stripe-abandon-00001'});
  const unfinished = await resolve(stranger, second, {handoffId: abandoned.handoffId});
  assert.equal(unfinished.status, 'not_connected', 'the abandoned attempt is bound, and is not a connection');
  const retry = await begin(stranger, second, {...URLS, idempotencyKey: 'stripe-abandon-00002'});
  stripe.drive(retry.handoffId, {chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true});
  const finished = await resolve(stranger, second, {handoffId: retry.handoffId});
  assert.equal(finished.status, 'connected', 'a finished second attempt binds over the abandoned one');
  assert.equal(finished.accountId, retry.handoffId, 'the business is bound to the account the second attempt made');
  assert.equal(finished.replayed, false, 'the second attempt is a new handoff, not a replay');

  // ---- two resolves of ONE handoff at once: exactly one is the first --------------
  // Both read the ledger before the provider is asked, so a flag read there would tell
  // both of them they were first. The record call locks the handoff, so one of them is.
  const fourth = id(4), raceTenant = id(12);
  await pool.query("insert into auth.users(id,email) values ($1,'stripe-4@example.test')", [fourth]);
  await pool.query(
    "insert into public.tenants(id,name,slug,timezone,currency) values($1,'Stripe Co Race','stripe-connect-t3','UTC','USD')",
    [raceTenant],
  );
  await pool.query(
    "insert into public.tenant_members(tenant_id,user_id,role) values($1,$2,'BUSINESS_OWNER')",
    [raceTenant, fourth],
  );
  const raced = await begin(fourth, raceTenant, {...URLS, idempotencyKey: 'stripe-race-000001'});
  stripe.drive(raced.handoffId, {chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true});
  const [raceA, raceB] = await Promise.all([
    resolve(fourth, raceTenant, {handoffId: raced.handoffId}),
    resolve(fourth, raceTenant, {handoffId: raced.handoffId}),
  ]);
  assert.deepEqual([raceA.replayed, raceB.replayed].sort(), [false, true],
    'of two concurrent resolves of one handoff, exactly one is the first');
  assert.equal(raceA.accountId, raced.handoffId);
  assert.equal(raceB.accountId, raced.handoffId);

  // ---- zero money moved: the flow asked Stripe for exactly four things -----
  const paths = new Set(stripe.requests.map(
    (r) => `${r.method} ${r.path.replace(/^\/v1\/accounts\/[^/]+$/, '/v1/accounts/{id}')}`));
  assert.deepEqual(
    [...paths].sort(),
    ['GET /v1/account', 'GET /v1/accounts/{id}', 'POST /v1/account_links', 'POST /v1/accounts'].sort(),
    'the connection flow made only account, onboarding-link and platform-identity requests',
  );
  // The link is never keyed: a replayed link is dead, and a key is not reused across endpoints.
  assert.ok(
    stripe.requests.filter((r) => r.path === '/v1/account_links').every((r) => r.idempotencyKey === null),
    'an onboarding link is never sent under an idempotency key',
  );
  assert.deepEqual(stripe.unexpected, [], 'nothing the flow did not expect was requested');
  assert.ok(stripe.requests.every((r) => r.stripeAccount === null),
    'the flow acts as the platform, never as a connected account');

  // ---- no platform secret in any receipt or any stored row -----------------
  const receipts = JSON.stringify([begun, again, early, live, afterOutage, revoked, reconnect, rebound, retried]);
  const stored = JSON.stringify([
    (await pool.query('select * from public.payment_connections')).rows,
    (await pool.query('select * from public.payment_connection_handoffs')).rows,
  ]);
  for (const [label, text] of [['receipts', receipts], ['stored rows', stored]] as const) {
    assert.ok(!text.includes(TEST_KEY), `the platform secret appears in ${label}`);
    assert.ok(!/sk_(test|live)_/.test(text), `a secret-shaped value appears in ${label}`);
  }

  console.log('PASS owner-payment-connection-stripe.integration');
} finally {
  await pool.end();
}
