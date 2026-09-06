import { z } from "zod";
import { Money, TenantId } from "@lumin/contracts";
import { PlanCatalog, getPlan } from "./plans";
import {
  PlanChange,
  Subscription,
  SubscriptionError,
  cancelAtPeriodEnd,
  cancelImmediately,
  changePlan,
  clearScheduledCancel,
  transition,
} from "./subscription";

/**
 * PlatformBilling — Provider contract (provider-neutral)
 *
 * `BillingProvider` is the seam every real processor implements as a FUTURE
 * adapter (Stripe, Paddle, Mercado Pago, Mollie, PayPal). The interface speaks
 * only in Lumin's own types — Subscription, PlanChange, Money — and in
 * NORMALIZED events. A provider adapter's sole coupling point is
 * `syncFromProviderEvent`, which takes an already-normalized event: the raw
 * provider webhook is parsed and verified INSIDE the adapter and never crosses
 * this boundary.
 *
 * Mock-first: `createMockBillingProvider` is the deterministic in-memory
 * implementation used everywhere until a real provider is the LAST activation
 * step. It drives the subscription state machine exactly as a real adapter must.
 */

/** A usage record for metered/usage billing (e.g. bookings over quota). */
export const UsageRecord = z.object({
  subscriptionId: z.string().min(1),
  /** Metric name (opaque; e.g. "bookings"). */
  metric: z.string().min(1),
  /** Non-negative integer quantity in this reporting call. */
  quantity: z.number().int().nonnegative(),
  /** ISO-8601 timestamp of the usage. */
  at: z.string().datetime(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

/** A billing document. Amounts are integer minor units, per MoneyContract. */
export const Invoice = z.object({
  id: z.string().min(1),
  subscriptionId: z.string().min(1),
  amount: Money,
  status: z.enum(["paid", "open", "void"]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type Invoice = z.infer<typeof Invoice>;

/**
 * NORMALIZED billing events. This is the vendor-neutral vocabulary a provider
 * adapter must map its webhooks onto. There is intentionally NO `raw` provider
 * payload and NO provider name here — normalization is the adapter's job, done
 * before the event reaches the platform.
 *
 *  - renewal_succeeded: a period renewed and was paid.
 *  - renewal_failed:    a renewal payment failed (→ past_due).
 *  - payment_recovered: a previously failed renewal was paid (→ active).
 *  - canceled:          the subscription terminated at the provider.
 *  - trial_will_end / trial_ended: trial lifecycle signals.
 */
export const NormalizedBillingEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("renewal_succeeded"),
    subscriptionId: z.string().min(1),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("renewal_failed"),
    subscriptionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("payment_recovered"),
    subscriptionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("trial_ended"),
    subscriptionId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("canceled"),
    subscriptionId: z.string().min(1),
    at: z.string().datetime(),
  }),
]);
export type NormalizedBillingEvent = z.infer<typeof NormalizedBillingEvent>;

export interface CreateSubscriptionInput {
  tenantId: TenantId;
  planKey: string;
  addonKeys?: string[];
  /** Period anchor (ISO-8601). The mock derives the period window from this. */
  startAt: string;
}

/**
 * Provider-neutral billing operations. Every method speaks Lumin types; none
 * exposes a provider object. Real adapters implement this; the mock below is
 * the reference implementation.
 */
export interface BillingProvider {
  readonly providerName: string;

  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>;
  changePlan(subscriptionId: string, change: PlanChange): Promise<Subscription>;
  /** Cancel at period end (default) or immediately. */
  cancel(subscriptionId: string, opts?: { immediately?: boolean; at?: string }): Promise<Subscription>;
  /** Undo a scheduled period-end cancel, or recover a past_due subscription. */
  reactivate(subscriptionId: string): Promise<Subscription>;
  /** Record metered usage for usage billing. */
  recordUsage(usage: UsageRecord): Promise<void>;
  listInvoices(subscriptionId: string): Promise<Invoice[]>;
  /**
   * Apply an ALREADY-NORMALIZED provider event to platform state, driving the
   * subscription state machine. Raw webhook parsing/verification happens in the
   * adapter before this call.
   */
  syncFromProviderEvent(event: NormalizedBillingEvent): Promise<Subscription>;
}

/** Days between two ISO timestamps -> a new ISO timestamp (period math helper). */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** The mock exposes inspection + simulation on top of the neutral contract. */
export interface MockBillingProvider extends BillingProvider {
  /** Inspection: current record for a subscription (throws if unknown). */
  get(subscriptionId: string): Subscription;
  /** Inspection: every subscription created, in creation order. */
  list(): Subscription[];
  /** Inspection: usage records reported for a subscription. */
  listUsage(subscriptionId: string): UsageRecord[];
  /**
   * Simulate the periodic renewal job. success=true renews the period and
   * (from trialing/past_due) moves to active; success=false marks past_due.
   * A subscription flagged cancelAtPeriodEnd is canceled instead of renewed.
   */
  simulateRenewal(subscriptionId: string, success: boolean): Subscription;
  /** Shorthand for a failed renewal (→ past_due). */
  simulatePastDue(subscriptionId: string): Subscription;
}

export interface MockBillingProviderOptions {
  catalog: PlanCatalog;
  /** Period length in days used when renewing (default 30). */
  periodDays?: number;
  /** Deterministic id seed. */
  idPrefix?: string;
}

/**
 * Deterministic, in-memory BillingProvider. NO real processor, NO network, NO
 * credentials. Ids are sequential. It is the single reference that exercises
 * the subscription state machine end to end; real providers are future adapters
 * that must reproduce these state moves.
 */
export function createMockBillingProvider(opts: MockBillingProviderOptions): MockBillingProvider {
  const { catalog } = opts;
  const periodDays = opts.periodDays ?? 30;
  const idPrefix = opts.idPrefix ?? "sub";

  const subs = new Map<string, Subscription>();
  const usage = new Map<string, UsageRecord[]>();
  const invoices = new Map<string, Invoice[]>();
  let counter = 0;

  function must(id: string): Subscription {
    const s = subs.get(id);
    if (!s) throw new SubscriptionError("ILLEGAL_TRANSITION", `unknown subscription ${id}`);
    return s;
  }

  function put(s: Subscription): Subscription {
    subs.set(s.id, s);
    return s;
  }

  function addInvoice(s: Subscription, status: Invoice["status"]): void {
    const plan = getPlan(catalog, s.planKey);
    const list = invoices.get(s.id) ?? [];
    list.push({
      id: `inv_${s.id}_${list.length + 1}`,
      subscriptionId: s.id,
      amount: { amount: plan.amount, currency: plan.currency },
      status,
      periodStart: s.currentPeriodStart,
      periodEnd: s.currentPeriodEnd,
    });
    invoices.set(s.id, list);
  }

  return {
    providerName: "mock",

    async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
      const plan = getPlan(catalog, input.planKey);
      const permitted = new Set(plan.addonKeys);
      const addonKeys = (input.addonKeys ?? []).filter((k) => permitted.has(k));
      for (const k of input.addonKeys ?? []) {
        if (!permitted.has(k)) {
          throw new SubscriptionError("INVALID_ADDON", `plan ${plan.key} does not permit add-on ${k}`);
        }
      }
      counter += 1;
      const id = `${idPrefix}_${counter}`;
      const trialing = plan.trialDays > 0;
      const periodEnd = addDays(input.startAt, trialing ? plan.trialDays : periodDays);
      const sub: Subscription = {
        id,
        tenantId: input.tenantId,
        planKey: plan.key,
        status: trialing ? "trialing" : "active",
        currentPeriodStart: input.startAt,
        currentPeriodEnd: periodEnd,
        trialEnd: trialing ? periodEnd : undefined,
        cancelAtPeriodEnd: false,
        addonKeys,
      };
      put(sub);
      addInvoice(sub, trialing ? "open" : "paid");
      return sub;
    },

    async changePlan(subscriptionId: string, change: PlanChange): Promise<Subscription> {
      const current = must(subscriptionId);
      const toPlan = getPlan(catalog, change.toPlanKey);
      const { subscription } = changePlan(current, change, toPlan.addonKeys);
      return put(subscription);
    },

    async cancel(subscriptionId: string, cancelOpts?: { immediately?: boolean; at?: string }): Promise<Subscription> {
      const current = must(subscriptionId);
      if (cancelOpts?.immediately) {
        return put(cancelImmediately(current, cancelOpts.at ?? current.currentPeriodEnd));
      }
      return put(cancelAtPeriodEnd(current));
    },

    async reactivate(subscriptionId: string): Promise<Subscription> {
      const current = must(subscriptionId);
      if (current.status === "past_due") {
        return put(transition(current, "active"));
      }
      return put(clearScheduledCancel(current));
    },

    async recordUsage(record: UsageRecord): Promise<void> {
      const parsed = UsageRecord.parse(record);
      must(parsed.subscriptionId); // usage against a real subscription only
      const list = usage.get(parsed.subscriptionId) ?? [];
      list.push(parsed);
      usage.set(parsed.subscriptionId, list);
    },

    async listInvoices(subscriptionId: string): Promise<Invoice[]> {
      must(subscriptionId);
      return [...(invoices.get(subscriptionId) ?? [])];
    },

    async syncFromProviderEvent(event: NormalizedBillingEvent): Promise<Subscription> {
      const parsed = NormalizedBillingEvent.parse(event);
      const current = must(parsed.subscriptionId);
      switch (parsed.kind) {
        case "renewal_succeeded": {
          // Renewing from trialing/past_due/incomplete lands on active; the
          // transition table validates the move (a self-move active→active is
          // not in the table, so keep active as-is).
          const base = current.status === "active" ? current : transition(current, "active");
          const renewed: Subscription = {
            ...base,
            currentPeriodStart: parsed.periodStart,
            currentPeriodEnd: parsed.periodEnd,
            trialEnd: undefined,
          };
          const stored = put(renewed);
          addInvoice(stored, "paid");
          return stored;
        }
        case "renewal_failed":
          return put(transition(current, "past_due"));
        case "payment_recovered":
          return put(transition(current, "active"));
        case "trial_ended":
          return put(current.status === "trialing" ? transition(current, "past_due") : current);
        case "canceled":
          return put(cancelImmediately(current, parsed.at));
      }
    },

    get(subscriptionId: string): Subscription {
      return must(subscriptionId);
    },

    list(): Subscription[] {
      return [...subs.values()];
    },

    listUsage(subscriptionId: string): UsageRecord[] {
      must(subscriptionId);
      return [...(usage.get(subscriptionId) ?? [])];
    },

    simulateRenewal(subscriptionId: string, success: boolean): Subscription {
      const current = must(subscriptionId);
      if (current.cancelAtPeriodEnd) {
        return put(cancelImmediately(current, current.currentPeriodEnd));
      }
      if (!success) {
        return put(transition(current, "past_due"));
      }
      // A successful renewal from trialing/past_due lands on active via the
      // transition table; active→active stays as-is.
      const base = current.status === "active" ? current : transition(current, "active");
      const newStart = base.currentPeriodEnd;
      const renewed: Subscription = {
        ...base,
        currentPeriodStart: newStart,
        currentPeriodEnd: addDays(newStart, periodDays),
        trialEnd: undefined,
      };
      const stored = put(renewed);
      addInvoice(stored, "paid");
      return stored;
    },

    simulatePastDue(subscriptionId: string): Subscription {
      return put(transition(must(subscriptionId), "past_due"));
    },
  };
}
