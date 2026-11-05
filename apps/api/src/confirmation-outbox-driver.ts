import type {Pool, PoolClient} from 'pg';
// Relative source import (not a declared @lumin/api dependency): mirrors the
// proven specifier used by confirmation-planner-delivery.integration.ts so no
// apps/api package.json / lockfile edit is needed and `npm ci` stays intact.
import {planNotifications} from '../../../packages/notifications/src/index.js';
import {createConfirmationOutboxQueue} from './confirmation-outbox-queue.js';
import {createConfirmationContextLoader} from './confirmation-context-loader.js';
import {createConfirmationOutboxWorker, type ConfirmationDeliveryProvider} from './confirmation-outbox-worker.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tenant that currently has a connected provider AND a ready planner config. */
export interface DeliverableTenant {
  tenantId: string;
  connectionId: string;
  provider: string;
}

export interface ConfirmationOutboxDriver {
  /** Drain one batch per deliverable tenant. Single-flight: concurrent calls
   * collapse to the in-flight run and return 0. Resolves to tenants drained. */
  drainOnce(): Promise<number>;
  /** Begin periodic draining. Idempotent while running. */
  start(): void;
  /** Stop periodic draining and await any in-flight drain. */
  stop(): Promise<void>;
}

export interface ConfirmationOutboxDriverDependencies {
  discoverTenants(): Promise<DeliverableTenant[]>;
  drainTenant(tenant: DeliverableTenant): Promise<void>;
  intervalMs: number;
}

/**
 * Framework-neutral driver core. Discovery and per-tenant draining are injected
 * so the single-flight / isolation / scheduling logic is unit-testable without
 * a database. Never throws out of a tick and never logs row or PII detail.
 */
export function createConfirmationOutboxDriver(deps: ConfirmationOutboxDriverDependencies): ConfirmationOutboxDriver {
  let ticking = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<number> | undefined;

  function drainOnce(): Promise<number> {
    if (ticking) return inFlight ?? Promise.resolve(0);
    ticking = true;
    const run = (async (): Promise<number> => {
      let tenants: DeliverableTenant[];
      try {
        tenants = await deps.discoverTenants();
      } catch {
        return 0; // Discovery failure is transient; next tick retries.
      }
      let drained = 0;
      for (const tenant of tenants) {
        if (!uuid.test(tenant.tenantId) || !uuid.test(tenant.connectionId) || !tenant.provider.trim()) continue;
        try {
          await deps.drainTenant(tenant);
          drained += 1;
        } catch {
          // Isolate per-tenant failures; never surface or log detail (may embed PII).
        }
      }
      return drained;
    })();
    inFlight = run;
    return run.finally(() => {
      ticking = false;
      inFlight = undefined;
    });
  }

  return {
    drainOnce,
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void drainOnce();
      }, deps.intervalMs);
      timer.unref?.();
    },
    async stop(): Promise<void> {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // drainOnce never rejects, but stay defensive on shutdown.
        }
      }
    },
  };
}

// Deliverable tenants only: a connected provider connection AND a planner config
// the runtime getter will actually return. Unconfigured tenants are left out so
// their confirmed envelopes stay `ready` rather than dead-lettering.
const DISCOVER_SQL = `select c.tenant_id, c.id as connection_id, c.provider
 from public.notification_connections c
 where c.status = 'connected'
   and public.runtime_notification_planner_config(c.tenant_id) is not null`;

export interface ConfirmationOutboxDriverOptions {
  limit?: number;
  concurrency?: number;
  leaseSeconds?: number;
  intervalMs?: number;
}

/**
 * Pool-backed driver: discovers deliverable tenants via a read-only
 * service-role query, then composes the existing confirmation outbox worker
 * (queue + context loader + planner) per tenant and drains one batch each.
 */
export function createPoolConfirmationOutboxDriver(
  pool: Pool,
  provider: ConfirmationDeliveryProvider,
  options: ConfirmationOutboxDriverOptions = {},
): ConfirmationOutboxDriver {
  const limit = options.limit ?? 20;
  const concurrency = options.concurrency ?? 4;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const intervalMs = options.intervalMs ?? 15000;
  const plan = (
    context: Parameters<typeof planNotifications>[1],
    config: Parameters<typeof planNotifications>[2],
    now: string,
  ) => planNotifications('booking.confirmed', context, config, now);

  async function discoverTenants(): Promise<DeliverableTenant[]> {
    let client: PoolClient | undefined;
    let broken = false;
    try {
      client = await pool.connect();
      await client.query('begin read only');
      await client.query("set local statement_timeout='5s'");
      await client.query("set local lock_timeout='3s'");
      await client.query('set local role service_role');
      const result = await client.query(DISCOVER_SQL);
      await client.query('commit');
      return result.rows.map((row) => ({
        tenantId: String(row.tenant_id),
        connectionId: String(row.connection_id),
        provider: String(row.provider),
      }));
    } catch {
      try {
        await client?.query('rollback');
      } catch {
        broken = true;
      }
      return [];
    } finally {
      client?.release(broken);
    }
  }

  async function drainTenant(tenant: DeliverableTenant): Promise<void> {
    const binding = {
      tenantId: tenant.tenantId,
      connectionId: tenant.connectionId,
      providerName: tenant.provider,
      supportedChannels: ['email', 'sms'] as const,
    };
    const loadContext = createConfirmationContextLoader(pool, binding);
    const queue = createConfirmationOutboxQueue(pool, tenant.tenantId);
    const worker = createConfirmationOutboxWorker({queue, provider, loadContext, plan, now: Date.now});
    await worker.runBatch(tenant.tenantId, {limit, concurrency, leaseSeconds});
  }

  return createConfirmationOutboxDriver({discoverTenants, drainTenant, intervalMs});
}
