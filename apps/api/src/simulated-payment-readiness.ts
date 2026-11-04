import type {Pool, PoolClient} from 'pg';

/**
 * The app-side half of the payment-provenance gate (migration 0088).
 *
 * The database half -- `public.confirmable_payment_providers`, checked inside
 * `public.confirm_succeeded_payment` -- refuses to confirm a payment whose
 * provider this deployment has not declared confirmable. It cannot, on its own,
 * catch a staging database restored over production: the restore brings its own
 * allowlist rows with it, so "the row set IS the environment" stops being true
 * in exactly the scenario the gate defends against.
 *
 * So the running service checks the other direction. If this process is NOT a
 * staging process and the database it is attached to would confirm simulated
 * money, the pairing itself is wrong, and the service must stop serving rather
 * than sit in front of a database that will honour fake payments. It is
 * re-checked on a timer because a restore can happen under a long-running
 * process.
 *
 * Deliberately one-directional: UNSAFE is reported only for the dangerous
 * combination (non-staging process + simulated provider confirmable). A staging
 * process with simulated providers is the normal, expected case, and a database
 * that cannot be read is reported as UNKNOWN rather than safe -- a probe that
 * fails must never read as a clean bill of health, and must not brick a deploy
 * whose database has not had 0088 applied yet (there the in-database gate is
 * what refuses).
 *
 * Why `service_role`: the allowlist has RLS enabled AND forced with no policies
 * and SELECT granted only to `service_role`, which holds BYPASSRLS (0007_rls.sql
 * :15). Verified on a real cluster: `service_role` reads the rows, a granted
 * role without BYPASSRLS reads none, so the gate is unreadable and unwritable
 * through PostgREST by any tenant or owner.
 */

/** Providers that represent simulated, non-real money. */
export const SIMULATED_PROVIDERS = Object.freeze(['staging_mock'] as const);

export type SimulatedPaymentVerdict =
  | {status: 'safe'}
  | {status: 'unsafe'; providers: readonly string[]}
  | {status: 'unknown'};

const SQL = `select provider from public.confirmable_payment_providers
 where provider = any($1::text[]) order by provider`;

/**
 * Reads which simulated providers this database would confirm. Returns
 * 'unknown' rather than 'safe' when the question cannot be answered.
 */
export async function readSimulatedPaymentVerdict(
  pool: Pool,
  environment: string | undefined,
): Promise<SimulatedPaymentVerdict> {
  // A staging process is expected to confirm simulated payments; no DB round
  // trip, so the check costs a staging deploy nothing.
  if (environment === 'staging') return {status: 'safe'};
  let client: PoolClient | undefined;
  let broken = false;
  try {
    client = await pool.connect();
    await client.query('begin isolation level read committed read only');
    await client.query("set local statement_timeout='5s'");
    await client.query("set local lock_timeout='3s'");
    await client.query('set local role service_role');
    const result = await client.query(SQL, [SIMULATED_PROVIDERS as unknown as string[]]);
    await client.query('commit');
    const providers = result.rows.map((row) => String(row.provider));
    return providers.length === 0 ? {status: 'safe'} : {status: 'unsafe', providers};
  } catch {
    try {
      await client?.query('rollback');
    } catch {
      broken = true;
    }
    return {status: 'unknown'};
  } finally {
    client?.release(broken);
  }
}

export interface SimulatedPaymentGuard {
  /** False once a non-staging process is seen in front of a simulated-money database. */
  serving(): boolean;
  /** Why serving stopped, for an operator. Never a secret and never a row dump. */
  reason(): string | null;
  check(): Promise<SimulatedPaymentVerdict>;
  stop(): void;
}

export interface SimulatedPaymentGuardOptions {
  intervalMs?: number;
  /** Called at most once, the first time the pairing is found unsafe. */
  onUnsafe?: (reason: string, providers: readonly string[]) => void;
}

/**
 * Starts the guard. The caller awaits `check()` once before opening the socket
 * so a mispaired deployment is refused before it serves anything; later checks
 * run on a timer.
 *
 * Once unsafe, it stays unsafe. A database that was willing to confirm
 * simulated money has already invalidated this process's assumptions, and
 * recovering silently would hide the incident.
 */
export function createSimulatedPaymentGuard(
  pool: Pool,
  environment: string | undefined,
  options: SimulatedPaymentGuardOptions = {},
): SimulatedPaymentGuard {
  const rawInterval = options.intervalMs ?? 60000;
  const intervalMs = Number.isInteger(rawInterval) && rawInterval >= 1000 && rawInterval <= 900000 ? rawInterval : 60000;
  let unsafeReason: string | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const evaluate = async (): Promise<SimulatedPaymentVerdict> => {
    const verdict = await readSimulatedPaymentVerdict(pool, environment);
    if (verdict.status === 'unsafe' && unsafeReason === null) {
      unsafeReason = 'database confirms simulated payment providers while BOOKING_LUMIN_ENV is not staging';
      try {
        options.onUnsafe?.(unsafeReason, verdict.providers);
      } catch {
        // An operator-notification failure must not mask the refusal itself.
      }
    }
    return verdict;
  };

  timer = setInterval(() => {
    void evaluate();
  }, intervalMs);
  timer.unref?.();

  return {
    serving: () => unsafeReason === null,
    reason: () => unsafeReason,
    check: evaluate,
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
