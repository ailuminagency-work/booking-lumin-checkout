import {
  NotificationConfig, NotificationContext, RenderedNotification,
  type NotificationChannel, type NotificationInput,
} from '@lumin/contracts';

// Orchestration only: no database/provider activation and no financial writes.
// A future dispatcher must route other outbox event types to their own handler.
export interface ConfirmationLease {
  id: string; tenant_id: string; booking_id: string; dedup_key: string;
  event_type: string; payload: unknown; state: 'leased'; lease_token: string;
  // Normalize RPC bigint generation to a safe integer at the adapter boundary.
  generation: number; lease_until: string; attempts: number; max_attempts: number;
}
export type RetryReason = 'transient' | 'rate_limited' | 'permanent';
export interface ConfirmationQueue {
  // Must lease only confirmed envelopes through a filtered RPC/dispatcher.
  // Existing unfiltered outbox_lease is NOT a safe direct adapter: it increments
  // attempts for requested/changed events even when this handler skips them.
  leaseConfirmed(tenantId: string, limit: number, seconds: number): Promise<unknown[]>;
  // Must compare tenant/id/token/generation/state/deadline against current DB
  // state, not just the row originally returned by outbox_lease.
  isCurrent(lease: ConfirmationLease): Promise<boolean>;
  isDelivered(key: string): Promise<boolean>;
  // Durable per-channel ledger. Must atomically fence against the current lease.
  recordDelivered(lease: ConfirmationLease, key: string): Promise<boolean>;
  // Match outbox_ack/outbox_retry: false means lost/expired lease. Retry RPC
  // owns backoff and dead-lettering (permanent or attempts >= max_attempts).
  ack(lease: ConfirmationLease): Promise<boolean>;
  retry(lease: ConfirmationLease, reason: RetryReason): Promise<boolean>;
}
export interface ConfirmationDeliveryProvider {
  // Compatible NotificationInput; adapters can wrap NotificationProvider.send.
  // The stable key must be forwarded when the provider supports idempotency.
  send(input: NotificationInput, idempotencyKey: string): Promise<
    {kind: 'sent'} | {kind: RetryReason}
  >;
}
export interface ConfirmationWorkerDependencies {
  queue: ConfirmationQueue;
  provider: ConfirmationDeliveryProvider;
  loadContext(tenantId: string, bookingId: string): Promise<{
    // NotificationContext's booking projection has no tenantId: require the
    // loader to independently bind the persisted booking to its tenant.
    bookingTenantId: string; context: unknown; config: unknown;
  }>;
  plan(context: NotificationContext, config: NotificationConfig, now: string): RenderedNotification[];
  now(): number;
}
export type ConfirmationOutcome = 'completed' | 'retry' | 'dead' | 'stale' | 'duplicate' | 'unsupported' | 'invalid' | 'unavailable' | 'busy';
export interface ConfirmationBatchResult { outcomes: ConfirmationOutcome[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function parseLease(value: unknown): ConfirmationLease | undefined {
  if (!record(value)) return;
  for (const key of ['id','tenant_id','booking_id','dedup_key','lease_token']) {
    if (typeof value[key] !== 'string' || !uuid.test(value[key])) return;
  }
  if (typeof value.event_type !== 'string' || value.state !== 'leased' ||
      typeof value.lease_until !== 'string' || !Number.isFinite(Date.parse(value.lease_until)) ||
      !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 ||
      !Number.isInteger(value.max_attempts) || (value.max_attempts as number) < 1 || (value.max_attempts as number) > 10 ||
      !Number.isInteger(value.attempts) || (value.attempts as number) < 1 || (value.attempts as number) > (value.max_attempts as number)) return;
  return value as unknown as ConfirmationLease;
}
export function confirmationDeliveryKey(tenant: string, booking: string, channel: NotificationChannel): string {
  return `${tenant}:${booking}:booking.confirmed:${channel}`;
}

export function createConfirmationOutboxWorker(dependencies: ConfirmationWorkerDependencies) {
  const {queue, provider, now} = dependencies;
  const active = new Set<string>();
  let running = false;
  async function current(lease: ConfirmationLease): Promise<boolean> {
    const deadline = Date.parse(lease.lease_until);
    return now() < deadline && await queue.isCurrent(lease) && now() < deadline;
  }
  async function fail(lease: ConfirmationLease, reason: RetryReason): Promise<ConfirmationOutcome> {
    if (!await current(lease)) return 'stale';
    if (!await queue.retry(lease, reason)) return 'stale';
    return reason === 'permanent' || lease.attempts >= lease.max_attempts ? 'dead' : 'retry';
  }
  async function process(value: unknown, tenant: string): Promise<ConfirmationOutcome> {
    const lease = parseLease(value);
    if (!lease || lease.tenant_id !== tenant) return 'invalid';
    if (lease.event_type !== 'booking.confirmed') return 'unsupported';
    // Tenant+row identity also suppresses duplicate generations within this
    // worker. DB fencing remains necessary across processes and later batches.
    const identity = `${tenant}:${lease.id}`;
    if (active.has(identity)) return 'duplicate';
    active.add(identity);
    try {
      if (!await current(lease)) return 'stale';
      if (lease.dedup_key !== lease.booking_id || !record(lease.payload) || Object.keys(lease.payload).length !== 0) return await fail(lease,'permanent');
      const loaded = await dependencies.loadContext(tenant, lease.booking_id);
      const context = NotificationContext.safeParse(loaded.context);
      const config = NotificationConfig.safeParse(loaded.config);
      if (!context.success || !config.success || loaded.bookingTenantId !== tenant ||
          context.data.tenant.id !== tenant || context.data.booking.id !== lease.booking_id ||
          context.data.booking.state !== 'confirmed' || config.data.tenantId !== tenant) return await fail(lease,'permanent');
      const policies = config.data.events.filter(policy => policy.event === 'booking.confirmed');
      if (policies.length !== 1) return await fail(lease,'permanent');
      const required = [...new Set(policies[0]!.channels)];
      const planned = dependencies.plan(context.data, config.data, new Date(now()).toISOString());
      // Validate the complete plan before any send. The standard planner skips
      // missing templates/recipients; a required channel must never silently ack.
      const messages = new Map<NotificationChannel, RenderedNotification>();
      for (const candidate of planned) {
        const parsed = RenderedNotification.safeParse(candidate);
        if (!parsed.success) return await fail(lease,'permanent');
        const message = parsed.data;
        const recipient = message.channel === 'email' ? context.data.booking.customerEmail : context.data.booking.customerPhone;
        if (!required.includes(message.channel) || messages.has(message.channel) || message.tenantId !== tenant ||
            message.bookingId !== lease.booking_id || message.trigger !== 'booking.confirmed' || message.reminderId !== undefined ||
            message.providerTemplate !== 'booking_confirmed' || message.to !== recipient ||
            message.dedupeKey !== confirmationDeliveryKey(tenant,lease.booking_id,message.channel)) return await fail(lease,'permanent');
        messages.set(message.channel,message);
      }
      if (messages.size !== required.length) return await fail(lease,'permanent');
      for (const channel of required) {
        const key = confirmationDeliveryKey(tenant,lease.booking_id,channel);
        if (!await current(lease)) return 'stale';
        if (await queue.isDelivered(key)) continue;
        const message = messages.get(channel)!;
        if (!await current(lease)) return 'stale';
        const input: NotificationInput = {tenantId: tenant,channel,to: message.to,template: message.providerTemplate,
          variables: {...message.variables,body: message.body,...(message.subject === undefined ? {} : {subject: message.subject})}};
        const result = await provider.send(input,key);
        if (result.kind !== 'sent') return await fail(lease,
          result.kind === 'permanent' || result.kind === 'rate_limited' ? result.kind : 'transient');
        // External send precedes durable receipt. Crashes/lost leases here may
        // repeat delivery unless the provider honors key. Never claim exactly-once.
        if (!await current(lease) || !await queue.recordDelivered(lease,key)) return 'stale';
      }
      if (!await current(lease)) return 'stale';
      return await queue.ack(lease) ? 'completed' : 'stale';
    } catch {
      // Unknown thrown errors are transient. Never return/log raw errors or PII.
      try { return await fail(lease,'transient'); } catch { return 'unavailable'; }
    } finally { active.delete(identity); }
  }
  return {
    async runBatch(tenantId: string, options: {limit?: number; concurrency?: number; leaseSeconds?: number} = {}): Promise<ConfirmationBatchResult> {
      const {limit = 10, concurrency = 2, leaseSeconds = 60} = options;
      if (!uuid.test(tenantId) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
          !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
          !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw new Error('INVALID_CONFIRMATION_WORKER_OPTIONS');
      // Overlapping polling calls must not multiply the worker's concurrency.
      if (running) return {outcomes:['busy']};
      running = true;
      try {
        let rows: unknown[];
        try { rows = await queue.leaseConfirmed(tenantId,limit,leaseSeconds); } catch { return {outcomes:['unavailable']}; }
        if (!Array.isArray(rows) || rows.length > limit) return {outcomes:['invalid']};
        const outcomes: ConfirmationOutcome[] = new Array(rows.length);
        let next = 0;
        await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async () => {
          while (next < rows.length) { const index = next++; outcomes[index] = await process(rows[index],tenantId); }
        }));
        return {outcomes};
      } finally { running = false; }
    },
  };
}
