import {afterEach, it, expect, vi} from 'vitest';
import type {Pool} from 'pg';
import {
  SIMULATED_PROVIDERS,
  createSimulatedPaymentGuard,
  readSimulatedPaymentVerdict,
} from './simulated-payment-readiness';

afterEach(() => {vi.useRealTimers();});

interface Recorder {
  pool: Pool;
  sql: string[];
  params: unknown[][];
  connects: number;
  released: boolean[];
}

/** Fake pool whose allowlist SELECT returns the given providers. */
function fakePool(options: {rows?: string[][]; failOn?: string; failConnect?: boolean} = {}): Recorder {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const released: boolean[] = [];
  let call = 0;
  const recorder = {
    sql, params, released, connects: 0,
    pool: {
      async connect() {
        recorder.connects += 1;
        if (options.failConnect) throw new Error('pool exhausted');
        return {
          async query(text: string, values?: unknown[]) {
            sql.push(text);
            if (values) params.push(values);
            if (options.failOn && text.includes(options.failOn)) throw new Error('query failed');
            if (text.includes('confirmable_payment_providers')) {
              const rows = (options.rows ?? [])[Math.min(call, (options.rows ?? []).length - 1)] ?? [];
              call += 1;
              return {rows: rows.map((provider) => ({provider}))};
            }
            return {rows: []};
          },
          release(broken?: boolean) {released.push(broken === true);},
        };
      },
    } as unknown as Pool,
  };
  return recorder;
}

it('never touches the database for a staging process', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'staging')).toEqual({status: 'safe'});
  expect(r.connects).toBe(0);
});

it('asks the allowlist read-only, as service_role, for exactly the simulated providers', async () => {
  const r = fakePool({rows: [[]]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'production')).toEqual({status: 'safe'});
  expect(r.sql[0]).toBe('begin isolation level read committed read only');
  expect(r.sql).toContain('set local role service_role');
  expect(r.sql.at(-1)).toBe('commit');
  // The question asked is parameterized and names only simulated providers, so
  // the gate can neither be widened by a value nor write anything.
  expect(r.params).toEqual([[SIMULATED_PROVIDERS]]);
  expect(r.sql.some((text) => text.startsWith('select provider from public.confirmable_payment_providers'))).toBe(true);
  expect(r.sql.join(' ')).not.toMatch(/insert|update|delete/i);
  expect(r.released).toEqual([false]);
});

it('reports UNSAFE when a non-staging process can confirm simulated money', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  expect(await readSimulatedPaymentVerdict(r.pool, 'production')).toEqual({status: 'unsafe', providers: ['staging_mock']});
  // An unset environment is not staging either: the dangerous default is covered.
  expect(await readSimulatedPaymentVerdict(fakePool({rows: [['staging_mock']]}).pool, undefined))
    .toEqual({status: 'unsafe', providers: ['staging_mock']});
});

it('reports UNKNOWN, never safe, when the question cannot be answered', async () => {
  // A database without 0088 applied, or an unreachable one, must not read as a
  // clean bill of health -- and must not brick a deploy either.
  const missing = fakePool({failOn: 'confirmable_payment_providers'});
  expect(await readSimulatedPaymentVerdict(missing.pool, 'production')).toEqual({status: 'unknown'});
  expect(missing.sql).toContain('rollback');
  expect(missing.released).toEqual([false]);
  const unreachable = fakePool({failConnect: true});
  expect(await readSimulatedPaymentVerdict(unreachable.pool, 'production')).toEqual({status: 'unknown'});
  // A connection that cannot even roll back is discarded rather than reused.
  const discarded: boolean[] = [];
  const broken = {
    async connect() {
      return {
        async query(text: string) {
          if (text.includes('select provider') || text === 'rollback') throw new Error('socket gone');
          return {rows: []};
        },
        release(flag?: boolean) {discarded.push(flag === true);},
      };
    },
  } as unknown as Pool;
  expect(await readSimulatedPaymentVerdict(broken, 'production')).toEqual({status: 'unknown'});
  expect(discarded).toEqual([true]);
});

it('stops serving once unsafe and reports a reason with no row dump or secret', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  const onUnsafe = vi.fn();
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 60_000, onUnsafe});
  expect(guard.serving()).toBe(true);
  expect(guard.reason()).toBeNull();
  expect(await guard.check()).toEqual({status: 'unsafe', providers: ['staging_mock']});
  expect(guard.serving()).toBe(false);
  expect(guard.reason()).toBe('database confirms simulated payment providers while BOOKING_LUMIN_ENV is not staging');
  expect(onUnsafe).toHaveBeenCalledTimes(1);
  expect(onUnsafe).toHaveBeenCalledWith(guard.reason(), ['staging_mock']);
  guard.stop();
});

it('latches: a later clean read does not resume serving, and does not re-notify', async () => {
  // Restores are not undone by the allowlist changing afterwards; the process
  // has already been seen in front of a simulated-money database.
  const r = fakePool({rows: [['staging_mock'], []]});
  const onUnsafe = vi.fn();
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 60_000, onUnsafe});
  await guard.check();
  expect(await guard.check()).toEqual({status: 'safe'});
  expect(guard.serving()).toBe(false);
  expect(onUnsafe).toHaveBeenCalledTimes(1);
  guard.stop();
});

it('a notification failure does not mask the refusal', async () => {
  const r = fakePool({rows: [['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {
    onUnsafe: () => {throw new Error('logger exploded');},
  });
  await expect(guard.check()).resolves.toEqual({status: 'unsafe', providers: ['staging_mock']});
  expect(guard.serving()).toBe(false);
  guard.stop();
});

it('re-checks on the timer so a restore under a running process is caught, and stop() ends it', async () => {
  vi.useFakeTimers();
  const r = fakePool({rows: [[], ['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs: 1000});
  expect(await guard.check()).toEqual({status: 'safe'});
  expect(guard.serving()).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(guard.serving()).toBe(false);
  const connectsAtTrip = r.connects;
  guard.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(r.connects).toBe(connectsAtTrip);
});

it('a staging guard costs no connection even on the timer', async () => {
  vi.useFakeTimers();
  const r = fakePool({rows: [['staging_mock']]});
  const guard = createSimulatedPaymentGuard(r.pool, 'staging', {intervalMs: 1000});
  expect(await guard.check()).toEqual({status: 'safe'});
  await vi.advanceTimersByTimeAsync(3000);
  expect(r.connects).toBe(0);
  expect(guard.serving()).toBe(true);
  guard.stop();
});

it('clamps an out-of-range interval instead of spinning or never checking', async () => {
  vi.useFakeTimers();
  for (const intervalMs of [0, -1, 1.5, 10_000_000, Number.NaN]) {
    const r = fakePool({rows: [[]]});
    const guard = createSimulatedPaymentGuard(r.pool, 'production', {intervalMs});
    await vi.advanceTimersByTimeAsync(59_000);
    expect(r.connects).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.connects).toBe(1);
    guard.stop();
  }
});
