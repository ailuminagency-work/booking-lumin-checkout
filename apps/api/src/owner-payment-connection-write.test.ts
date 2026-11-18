import {it, expect, vi} from 'vitest';
import type {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {createMockPaymentConnectionProvider} from '@lumin/adapters';
import {PaymentError} from '@lumin/contracts';
import {
  createOwnerConnectionBeginWriter,
  createOwnerConnectionResolveWriter,
} from './owner-payment-connection-write';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const URLS = {returnUrl: 'https://portal.example.test/r', refreshUrl: 'https://portal.example.test/f'};
const KEY = 'begin-attempt-000001';

const LEDGER_EXPIRY = '2026-11-09T12:00:00+00:00';

function fakePool(opts: {
  beginReceipt?: (givenHandoffId: string) => unknown;
  ledgerRow?: unknown;
  recordReceipt?: unknown;
  forbid?: boolean;
} = {}) {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (values) params.push(values);
      if (sql.includes('flow_actor')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        return {rows: [{}]};
      }
      if (sql.includes('begin_payment_connection')) {
        // Echo the handoff id it was given, as the real RPC does on a fresh
        // insert (it returns `existing.handoff_id`, which IS p_handoff_id).
        // A fixture that answered with some other id made every begin test run
        // against a ledger/adapter mismatch without saying so.
        const given = String(values?.[4] ?? '');
        // The ledger's own expiry, in the shape jsonb gives it (+00:00, not Z),
        // and deliberately NOT the one the adapter just returned.
        const base = {handoffId: given, replayed: false, expiresAt: LEDGER_EXPIRY};
        return {rows: [{receipt: opts.beginReceipt ? opts.beginReceipt(given) : base}]};
      }
      if (sql.includes('payment_connection_handoffs')) {
        return {rows: opts.ledgerRow === null ? [] : [opts.ledgerRow ?? {handoff_id: 'mch_from_the_ledger', provider: 'staging_mock'}]};
      }
      if (sql.includes('record_payment_connection')) {
        return {rows: [{receipt: opts.recordReceipt ?? {status: 'connected', replayed: false}}]};
      }
      return {rows: []};
    },
    release() {},
  };
  return {pool: {async connect() {return client;}} as unknown as Pool, queries, params};
}

it('begin calls the provider, then ledgers it, and returns the LEDGER\'s handoff id', async () => {
  const {pool, queries, params} = fakePool();
  const provider = createMockPaymentConnectionProvider();
  const out = await createOwnerConnectionBeginWriter(pool, provider)(ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  expect(queries.some((q) => q.includes('set local role service_role'))).toBe(true);
  // Owner-only: flow_actor's third argument must be true.
  expect(queries.some((q) => q.includes('flow_actor'))).toBe(true);
  // The id the receipt carries is the one the LEDGER returned, and the ledger
  // was given the adapter's. The next test covers them disagreeing.
  const ledgered = params.find((p) => p.length === 6);
  expect(out.handoffId).toBe(String(ledgered?.[4]));
  expect(out.handoffId).toMatch(/^mch_[0-9a-f]{24}$/);
  expect(out.provider).toBe('staging_mock');
  expect(out.onboardingUrl).toMatch(/^https:\/\//);
  expect(out.replayed).toBe(false);
});

it('begin asks flow_actor for OWNER authority, not mere membership', async () => {
  const {pool, params} = fakePool();
  await createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  const actorCall = params.find((p) => p.length === 3 && typeof p[2] === 'boolean');
  expect(actorCall?.[2]).toBe(true);
});

it('begin surfaces the ledger\'s replay rather than inventing one', async () => {
  // A second submit of the same key. An idempotent adapter hands back the same
  // handoff, so the ledger's id and the adapter's agree and the only difference
  // is the flag.
  const {pool, params} = fakePool({beginReceipt: (given) => ({handoffId: given, replayed: true, expiresAt: LEDGER_EXPIRY})});
  const out = await createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  expect(out.replayed).toBe(true);
  expect(out.handoffId).toBe(String(params.find((p) => p.length === 6)?.[4]));
});

it('begin refuses when the ledger\'s handoff is not the one the URL opens', async () => {
  // The adapter broke its idempotency contract: the ledger kept an earlier
  // handoff while the adapter minted a new account and returned a link to IT.
  // Returning that pair would send the owner to finish account A while resolve
  // reads account B -- onboarding appears to work and checkout stays off. The
  // writer must refuse rather than hand back a receipt that cannot be completed.
  const {pool} = fakePool({beginReceipt: () => ({handoffId: 'acct_an_earlier_one_0001', replayed: true, expiresAt: LEDGER_EXPIRY})});
  await expect(createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY})).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
});

it('begin publishes the LEDGER\'s expiry, not the adapter\'s', async () => {
  // record_payment_connection gates the bind on the ledger's expires_at, and
  // begin_payment_connection never refreshes it on a replay. Publishing the
  // adapter's fresh expiry would advertise a window longer than the one that
  // will be enforced: the owner finishes inside the advertised window and
  // resolve refuses it as expired.
  const {pool} = fakePool();
  const provider = createMockPaymentConnectionProvider();
  const out = await createOwnerConnectionBeginWriter(pool, provider)(ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  expect(out.expiresAt).toBe(LEDGER_EXPIRY);
  // The adapter's own answer is a different, later instant -- and is not what
  // the owner is told.
  const adapterExpiry = (await provider.beginConnection({tenantId: TENANT, ...URLS, idempotencyKey: 'another-key-0000001'})).expiresAt;
  expect(out.expiresAt).not.toBe(adapterExpiry);
});

it('begin refuses an expiry the ledger did not supply', async () => {
  const {pool} = fakePool({beginReceipt: (given) => ({handoffId: given, replayed: false})});
  await expect(createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY})).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
});

it('begin refuses when the ledger answers with no handoff at all', async () => {
  const {pool} = fakePool({beginReceipt: () => ({replayed: false, expiresAt: LEDGER_EXPIRY})});
  await expect(createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY})).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
});

it('begin writes no ledger row when the provider refuses', async () => {
  const {pool, queries} = fakePool();
  const provider = createMockPaymentConnectionProvider();
  // A bad redirect URL is refused by the adapter before any request.
  await expect(createOwnerConnectionBeginWriter(pool, provider)(
    ACTOR, TENANT, {...URLS, returnUrl: 'javascript:alert(1)', idempotencyKey: KEY})).rejects.toBeInstanceOf(FlowError);
  // The authority check HAS run by now -- that is deliberate, and the test
  // above pins it. What must not have happened is the ledger write: a handoff
  // the provider never issued has no business being recorded.
  expect(queries.some((q) => q.includes('begin_payment_connection'))).toBe(false);
  expect(queries.some((q) => q.includes('flow_actor'))).toBe(true);
});

it('resolve reads the LEDGER before it touches the provider', async () => {
  // The decisive ordering test. A handoff id the caller does not own must never
  // reach the adapter -- for Stripe that id IS an account reference, so the call
  // would be a request about a stranger's account.
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(),
    inspectConnection: vi.fn(),
  };
  const {pool, queries} = fakePool({ledgerRow: null});
  await expect(createOwnerConnectionResolveWriter(pool, provider as never)(
    ACTOR, TENANT, {handoffId: 'mch_not_this_tenants'})).rejects.toMatchObject({code: 'NOT_AVAILABLE'});
  expect(provider.resolveConnection).not.toHaveBeenCalled();
  expect(queries.some((q) => q.includes('payment_connection_handoffs'))).toBe(true);
  expect(queries.some((q) => q.includes('record_payment_connection'))).toBe(false);
});

it('resolve hands the adapter the LEDGER\'s id, never the caller\'s', async () => {
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => ({
      provider: 'staging_mock', accountId: 'acct_mock_abcdef123456',
      chargesEnabled: true, payoutsEnabled: true, onboardingComplete: true,
      blockedReason: null, observedAt: '2026-11-09T10:00:00.000Z',
    })),
    inspectConnection: vi.fn(),
  };
  const {pool} = fakePool({ledgerRow: {handoff_id: 'mch_the_real_one', provider: 'staging_mock'}});
  // The caller names a DIFFERENT id from the one the ledger holds. Passing the
  // same id in both places made this assertion unable to tell them apart, so it
  // passed just as happily when the writer forwarded the caller's value -- the
  // exact substitution it exists to forbid.
  await createOwnerConnectionResolveWriter(pool, provider as never)(ACTOR, TENANT, {handoffId: 'mch_the_callers_one'});
  expect(provider.resolveConnection).toHaveBeenCalledWith('mch_the_real_one');
  expect(provider.resolveConnection).not.toHaveBeenCalledWith('mch_the_callers_one');
});

it('resolve asks flow_actor for OWNER authority, not mere membership', async () => {
  // Nothing pinned this. Asking for membership instead of owner authority --
  // one boolean -- passed every unit test and the whole pg harness.
  //
  // It would not let staff BIND an account: record_payment_connection repeats
  // flow_actor with owner authority in SQL (0093:386), so the write is refused
  // either way. What it would let a staff member do is make this service read
  // the provider about their business's merchant account -- learning whether it
  // can charge, and spending a provider request -- before that refusal. The API
  // is not entitled to ask on their behalf, so the gate belongs here too.
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => ({
      provider: 'staging_mock', accountId: 'acct_mock_abcdef123456',
      chargesEnabled: true, payoutsEnabled: true, onboardingComplete: true,
      blockedReason: null, observedAt: '2026-11-09T10:00:00.000Z',
    })),
    inspectConnection: vi.fn(),
  };
  const {pool, params} = fakePool();
  await createOwnerConnectionResolveWriter(pool, provider as never)(ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'});
  // flow_actor is the only 3-argument call whose third parameter is a boolean:
  // the ledger SELECT takes 2, begin_payment_connection 6, record 9.
  const actorCalls = params.filter((c) => c.length === 3 && typeof c[2] === 'boolean');
  expect(actorCalls.length, 'both phases authorize').toBeGreaterThanOrEqual(2);
  for (const call of actorCalls) expect(call[2], 'owner-only').toBe(true);
});

it('an adapter failure keeps its own meaning instead of collapsing to a server fault', async () => {
  // mapError reads SQLSTATEs; a PaymentError's code is a word, so every adapter
  // condition used to fall through to INTERNAL_ERROR. An owner's mistyped return
  // URL, an upstream outage, and a handoff the provider does not know were all
  // reported as 500 -- and all indistinguishable from the genuinely serious
  // INTERNAL_ERROR this writer raises when an adapter breaks idempotency.
  const cases: Array<[string, string]> = [
    ['INVALID_REQUEST', 'INVALID_REQUEST'],
    ['PROVIDER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
    ['CONNECTION_UNVERIFIED', 'NOT_AVAILABLE'],
  ];
  for (const [thrown, expected] of cases) {
    const begin = createOwnerConnectionBeginWriter(fakePool().pool, {
      providerName: 'staging_mock',
      beginConnection: vi.fn(async () => {throw new PaymentError(thrown as never, 'staged');}),
      resolveConnection: vi.fn(), inspectConnection: vi.fn(),
    } as never);
    await expect(begin(ACTOR, TENANT, {...URLS, idempotencyKey: KEY}), `begin/${thrown}`)
      .rejects.toMatchObject({code: expected});

    const resolve = createOwnerConnectionResolveWriter(fakePool().pool, {
      providerName: 'staging_mock',
      beginConnection: vi.fn(),
      resolveConnection: vi.fn(async () => {throw new PaymentError(thrown as never, 'staged');}),
      inspectConnection: vi.fn(),
    } as never);
    await expect(resolve(ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'}), `resolve/${thrown}`)
      .rejects.toMatchObject({code: expected});
  }
});

it('a relative return url is the caller\'s mistake, not a server fault', async () => {
  // The whole point, in the shape an owner would actually hit it.
  const {pool} = fakePool();
  await expect(createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, returnUrl: '/connections/return', idempotencyKey: KEY}))
    .rejects.toMatchObject({code: 'INVALID_REQUEST'});
});

it('refuses an idempotency key the ledger could not store', async () => {
  // min(16) counts UTF-16 code units; 0093's column counts characters. Eight
  // astral characters are 16 units but 8 characters: accepted here, refused by
  // the column, and surfacing as a check violation rather than a bad request.
  const {pool, queries} = fakePool();
  const begin = createOwnerConnectionBeginWriter(pool, createMockPaymentConnectionProvider());
  for (const key of ['\u{1F600}'.repeat(8), 'has spaces in it xx', 'key\r\nX-Injected: 1', 'é'.repeat(20)]) {
    await expect(begin(ACTOR, TENANT, {...URLS, idempotencyKey: key}), JSON.stringify(key))
      .rejects.toMatchObject({code: 'INVALID_REQUEST'});
  }
  expect(queries).toEqual([]);
});

it('AN INCONCLUSIVE PROVIDER ANSWER NEVER REACHES THE RECORDING RPC', async () => {
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => {throw new PaymentError('PROVIDER_UNAVAILABLE', 'armed');}),
    inspectConnection: vi.fn(),
  };
  const {pool, queries} = fakePool();
  await expect(createOwnerConnectionResolveWriter(pool, provider as never)(
    ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'})).rejects.toBeInstanceOf(FlowError);
  expect(queries.some((q) => q.includes('record_payment_connection'))).toBe(false);
});

it('resolve refuses when the handoff belongs to a different provider', async () => {
  const provider = {
    providerName: 'stripe_connect',
    beginConnection: vi.fn(), resolveConnection: vi.fn(), inspectConnection: vi.fn(),
  };
  // A VALID-length id: 'mch_x' is 5 chars and would be refused by the schema
  // first, which would make this assertion pass on the wrong guard.
  const {pool} = fakePool({ledgerRow: {handoff_id: 'mch_other_provider', provider: 'staging_mock'}});
  await expect(createOwnerConnectionResolveWriter(pool, provider as never)(
    ACTOR, TENANT, {handoffId: 'mch_other_provider'})).rejects.toMatchObject({code: 'UNSUPPORTED_CONFIG'});
  expect(provider.resolveConnection).not.toHaveBeenCalled();
});

it('resolve takes the status FROM THE DATABASE and derives health from it', async () => {
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => ({
      provider: 'staging_mock', accountId: 'acct_mock_abcdef123456',
      chargesEnabled: true, payoutsEnabled: false, onboardingComplete: true,
      blockedReason: 'payouts_disabled' as const, observedAt: '2026-11-09T10:00:00.000Z',
    })),
    inspectConnection: vi.fn(),
  };
  const {pool} = fakePool({recordReceipt: {status: 'connected', replayed: false}});
  const out = await createOwnerConnectionResolveWriter(pool, provider as never)(ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'});
  expect(out.status).toBe('connected');
  // Charging but stranded: the state a boolean would erase.
  expect(out.health).toBe('degraded');
  expect(out.chargesEnabled).toBe(true);
});

it('resolve refuses a status the database returns that this build does not know', async () => {
  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => ({
      provider: 'staging_mock', accountId: 'acct_mock_abcdef123456',
      chargesEnabled: true, payoutsEnabled: true, onboardingComplete: true,
      blockedReason: null, observedAt: '2026-11-09T10:00:00.000Z',
    })),
    inspectConnection: vi.fn(),
  };
  const {pool} = fakePool({recordReceipt: {status: 'suspended', replayed: false}});
  await expect(createOwnerConnectionResolveWriter(pool, provider as never)(
    ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'})).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
});

it('a non-member is FORBIDDEN on both operations, and the PROVIDER is never contacted', async () => {
  // Asserting the error code alone is not enough, and nearly was not: the
  // provider call used to happen BEFORE flow_actor, so a refused caller still
  // caused an account to be minted for a tenant they have no authority over.
  // Against Stripe that is a real Connect account with caller-chosen metadata,
  // orphaned because the ledger write never happens. The refusal must land
  // before the provider hears about it, so the provider's own state is the
  // assertion that matters here.
  const provider = createMockPaymentConnectionProvider();
  await expect(createOwnerConnectionBeginWriter(fakePool({forbid: true}).pool, provider)(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY})).rejects.toMatchObject({code: 'FORBIDDEN'});
  expect(provider.listHandoffs()).toEqual([]);

  // The resolve half needs a SPY, not listHandoffs(): only beginConnection
  // writes that map, so asserting it is still empty after a refused resolve
  // cannot fail and says nothing about whether the provider was read.
  const spy = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(), resolveConnection: vi.fn(), inspectConnection: vi.fn(),
  };
  await expect(createOwnerConnectionResolveWriter(fakePool({forbid: true}).pool, spy as never)(
    ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'})).rejects.toMatchObject({code: 'FORBIDDEN'});
  expect(spy.resolveConnection).not.toHaveBeenCalled();
});

it('begin authorizes before it calls the provider, not after', async () => {
  // The ordering itself, pinned. The only way to say "before the provider" is
  // to mark WHERE the provider was entered in the query log, so the spy records
  // queries.length at that instant and the assertions run on the prefix. An
  // earlier version of this test sliced `queries` to its own length -- the whole
  // array -- and so passed happily with the authority check moved after the
  // provider call, which is the exact defect it was written to catch.
  let atProvider = -1;
  const provider = createMockPaymentConnectionProvider();
  const spied = {
    providerName: provider.providerName,
    async beginConnection(input: Parameters<typeof provider.beginConnection>[0]) {
      atProvider = queries.length;
      return provider.beginConnection(input);
    },
    resolveConnection: provider.resolveConnection.bind(provider),
    inspectConnection: provider.inspectConnection?.bind(provider),
  };
  const {pool, queries} = fakePool();
  await createOwnerConnectionBeginWriter(pool, spied as never)(ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  expect(atProvider, 'the provider was called').toBeGreaterThanOrEqual(0);
  const beforeProvider = queries.slice(0, atProvider);
  // Authority had already been established when the provider was entered...
  expect(beforeProvider.some((q) => q.includes('flow_actor'))).toBe(true);
  // ...and nothing had been written to the ledger yet.
  expect(beforeProvider.some((q) => q.includes('begin_payment_connection'))).toBe(false);
  // The ledger write happens after the provider answers.
  expect(queries.slice(atProvider).some((q) => q.includes('begin_payment_connection'))).toBe(true);
});

it('refuses a malformed actor, tenant, key or handoff before any work', async () => {
  const {pool, queries} = fakePool();
  const provider = createMockPaymentConnectionProvider();
  const begin = createOwnerConnectionBeginWriter(pool, provider);
  await expect(begin('not-a-uuid', TENANT, {...URLS, idempotencyKey: KEY})).rejects.toBeInstanceOf(FlowError);
  await expect(begin(ACTOR, 'not-a-uuid', {...URLS, idempotencyKey: KEY})).rejects.toBeInstanceOf(FlowError);
  // The ledger's own column requires >= 16 characters.
  await expect(begin(ACTOR, TENANT, {...URLS, idempotencyKey: 'short'})).rejects.toBeInstanceOf(FlowError);
  await expect(createOwnerConnectionResolveWriter(pool, provider)(ACTOR, TENANT, {handoffId: 'tiny'}))
    .rejects.toBeInstanceOf(FlowError);
  expect(queries).toEqual([]);
});

it('neither receipt carries a credential-shaped field', async () => {
  // "Neither" means both. Only the begin receipt used to be scanned, so a
  // credential-named field added to the RESOLVE contract passed this test.
  const CREDENTIAL = /secret|key|token|password|credential/i;
  const begun = await createOwnerConnectionBeginWriter(fakePool().pool, createMockPaymentConnectionProvider())(
    ACTOR, TENANT, {...URLS, idempotencyKey: KEY});
  for (const field of Object.keys(begun)) expect(field, `begin.${field}`).not.toMatch(CREDENTIAL);

  const provider = {
    providerName: 'staging_mock',
    beginConnection: vi.fn(),
    resolveConnection: vi.fn(async () => ({
      provider: 'staging_mock', accountId: 'acct_mock_abcdef123456',
      chargesEnabled: true, payoutsEnabled: true, onboardingComplete: true,
      blockedReason: null, observedAt: '2026-11-09T10:00:00.000Z',
    })),
    inspectConnection: vi.fn(),
  };
  const resolved = await createOwnerConnectionResolveWriter(fakePool().pool, provider as never)(
    ACTOR, TENANT, {handoffId: 'mch_from_the_ledger'});
  for (const field of Object.keys(resolved)) expect(field, `resolve.${field}`).not.toMatch(CREDENTIAL);
});

it('NO status is ever passed to the database, and no money primitive is named', () => {
  const src = readFileSync(new URL('./owner-payment-connection-write.ts', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  // The derivation is the database's. A writer that passed a status would be
  // asserting what only the provider's own report may decide.
  expect(src).not.toMatch(/status\s*[:=]\s*['"](connected|revoked|not_connected|error)['"]/);
  // No money: this path creates no charge, intent or refund.
  for (const forbidden of ['payment_intents', 'createIntent', 'createCharge', 'refund', 'confirm_succeeded_payment']) {
    expect(src, `must not name ${forbidden}`).not.toContain(forbidden);
  }
  // And it must not call the no-actor health RPC: that one exists for a
  // background refresh, not for an owner action.
  expect(src).not.toContain('observe_payment_connection');
});
