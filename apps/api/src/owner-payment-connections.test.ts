import {it, expect} from 'vitest';
import type {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {createOwnerPaymentConnectionsReader} from './owner-payment-connections';
import {FlowError} from './repository';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function conn(over: Record<string, unknown> = {}) {
  return {
    provider: 'stripe_connect',
    status: 'connected',
    accountId: 'acct_1PxYzAbCdEfGhIjK',
    chargesEnabled: true,
    payoutsEnabled: true,
    onboardingComplete: true,
    blockedReason: null,
    lastObservedAt: '2026-11-08T09:00:00.000Z',
    ...over,
  };
}

function fakePool(opts: {connections?: unknown[]; facts?: unknown; forbid?: boolean; missingRpc?: boolean} = {}) {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      queries.push(sql);
      if (values) params.push(values);
      if (sql.includes('payment_connection_facts')) {
        if (opts.forbid) throw Object.assign(new Error('forbidden'), {code: '42501'});
        if (opts.missingRpc) throw Object.assign(new Error('no such function'), {code: '42883'});
        return {rows: [{facts: opts.facts !== undefined ? opts.facts
          : {schemaVersion: 1, connections: opts.connections ?? []}}]};
      }
      return {rows: []};
    },
    release() {},
  };
  return {pool: {async connect() {return client;}} as unknown as Pool, queries, params};
}

it('authorizes through the RPC and returns the tenant\'s connections', async () => {
  const {pool, queries, params} = fakePool({connections: [conn()]});
  const out = await createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT);
  expect(queries.some((q) => q.includes('set local role service_role'))).toBe(true);
  expect(queries.some((q) => q.includes('begin isolation level repeatable read'))).toBe(true);
  // NOT read only: flow_actor inside the RPC takes FOR SHARE locks (25006).
  expect(queries.some((q) => q.includes('read only'))).toBe(false);
  expect(params.some((p) => p[0] === ACTOR && p[1] === TENANT)).toBe(true);
  expect(out.tenantId).toBe(TENANT);
  expect(out.connections).toHaveLength(1);
  expect(out.connections[0]!.health).toBe('chargeable');
});

it('derives each of the four health verdicts from the stored facts', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{}, 'chargeable'],
    [{payoutsEnabled: false, blockedReason: 'payouts_disabled'}, 'degraded'],
    [{chargesEnabled: false, blockedReason: 'requirements_past_due'}, 'blocked'],
    [{status: 'not_connected', accountId: null, chargesEnabled: false, payoutsEnabled: false,
      onboardingComplete: false, blockedReason: 'onboarding_incomplete', lastObservedAt: null}, 'not_connected'],
    // revoked/error are blocked regardless of the flags: those flags are stale.
    [{status: 'revoked', blockedReason: 'credentials_invalid', chargesEnabled: false}, 'blocked'],
    [{status: 'error'}, 'blocked'],
  ];
  for (const [over, expected] of cases) {
    const {pool} = fakePool({connections: [conn(over)]});
    const out = await createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT);
    expect(out.connections[0]!.health, JSON.stringify(over)).toBe(expected);
  }
});

it('a charging-but-stranded connection is degraded, never reported as fine', async () => {
  // The state a boolean would erase: money moves and then cannot be paid out.
  const {pool} = fakePool({connections: [conn({payoutsEnabled: false, blockedReason: 'payouts_disabled'})]});
  const out = await createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT);
  expect(out.connections[0]!.health).toBe('degraded');
  expect(out.connections[0]!.chargesEnabled).toBe(true);
});

it('refuses a status or reason this build does not understand', async () => {
  // Guessing a verdict for an unknown state is how a blocked connection would
  // read as fine. Both must refuse rather than fall back.
  for (const over of [{status: 'suspended'}, {blockedReason: 'because_reasons'}]) {
    const {pool} = fakePool({connections: [conn(over)]});
    await expect(createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT)).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
  }
});

it('maps a non-member to FORBIDDEN and a pre-0093 database to UNSUPPORTED_CONFIG', async () => {
  await expect(createOwnerPaymentConnectionsReader(fakePool({forbid: true}).pool)(ACTOR, TENANT))
    .rejects.toMatchObject({code: 'FORBIDDEN'});
  await expect(createOwnerPaymentConnectionsReader(fakePool({missingRpc: true}).pool)(ACTOR, TENANT))
    .rejects.toMatchObject({code: 'UNSUPPORTED_CONFIG'});
});

it('refuses a malformed actor or tenant before opening a transaction', async () => {
  const {pool, queries} = fakePool();
  await expect(createOwnerPaymentConnectionsReader(pool)('not-a-uuid', TENANT)).rejects.toBeInstanceOf(FlowError);
  await expect(createOwnerPaymentConnectionsReader(pool)(ACTOR, 'not-a-uuid')).rejects.toBeInstanceOf(FlowError);
  expect(queries).toEqual([]);
});

it('refuses an RPC envelope that is not the shape 0093 declares', async () => {
  for (const facts of [null, {}, {schemaVersion: 2, connections: []}, {schemaVersion: 1},
                       {schemaVersion: 1, connections: [{provider: 'x'}]},
                       {schemaVersion: 1, connections: [], extra: true}]) {
    const {pool} = fakePool({facts});
    await expect(createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT),
      JSON.stringify(facts)).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
  }
});

it('exposes no credential field, and no field whose name suggests one', async () => {
  const {pool} = fakePool({connections: [conn()]});
  const out = await createOwnerPaymentConnectionsReader(pool)(ACTOR, TENANT);
  for (const key of Object.keys(out.connections[0]!)) {
    expect(key, key).not.toMatch(/secret|key|token|password|credential/i);
  }
  // accountId IS present and is deliberately not a credential: it is useless
  // without the platform secret, which never leaves the server runtime.
  expect(out.connections[0]!.accountId).toBe('acct_1PxYzAbCdEfGhIjK');
});

it('issues only the facts RPC — no write RPC of 0093 is named in this file', () => {
  // The other three RPCs begin a handoff, bind an account and record an
  // observation. A reader that could reach one would be a writer.
  const src = readFileSync(new URL('./owner-payment-connections.ts', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  for (const rpc of ['begin_payment_connection', 'record_payment_connection', 'observe_payment_connection']) {
    expect(src, `must not name ${rpc}`).not.toContain(rpc);
  }
  expect(src).toContain('payment_connection_facts');
  // And no DML of its own.
  for (const verb of ['insert into', 'update public.', 'delete from', 'truncate']) {
    expect(src.toLowerCase(), `must not issue ${verb}`).not.toContain(verb);
  }
});

it('derives the verdict via the contracts authority, not a local copy', () => {
  const src = readFileSync(new URL('./owner-payment-connections.ts', import.meta.url), 'utf8');
  expect(src).toContain('derivePaymentConnectionHealth');
  // A second derivation here would be a second authority that could disagree
  // with the 112-combination-guarded one in @lumin/contracts.
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  for (const verdict of ["'chargeable'", "'degraded'", '"chargeable"', '"degraded"']) {
    expect(code, `must not hard-code ${verdict}`).not.toContain(verdict);
  }
});
