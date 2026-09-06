import { describe, expect, it } from "vitest";
import {
  createMockBillingProvider,
  entitlements,
  getPlan,
  sampleCatalog,
} from "../src/index";

const catalog = sampleCatalog();
const TENANT = "33333333-3333-3333-3333-333333333333";
const START = "2026-01-01T00:00:00.000Z";

function newProvider() {
  return createMockBillingProvider({ catalog, periodDays: 30 });
}

describe("mock billing provider is deterministic and credential-free", () => {
  it("assigns sequential ids and creates a trialing pro subscription", async () => {
    const billing = newProvider();
    const a = await billing.createSubscription({ tenantId: TENANT, planKey: "pro", startAt: START });
    const b = await billing.createSubscription({ tenantId: TENANT, planKey: "starter", startAt: START });
    expect(a.id).toBe("sub_1");
    expect(b.id).toBe("sub_2");
    expect(a.status).toBe("trialing"); // pro has trialDays
    expect(a.trialEnd).toBeDefined();
    expect(b.status).toBe("active"); // starter has no trial
  });

  it("rejects an add-on the plan does not permit at creation", async () => {
    const billing = newProvider();
    await expect(
      billing.createSubscription({ tenantId: TENANT, planKey: "starter", addonKeys: ["sms"], startAt: START }),
    ).rejects.toThrow(/does not permit/);
  });

  it("drives a full lifecycle: create trial → renew → active → renew fail → past_due → cancel", async () => {
    const billing = newProvider();
    const created = await billing.createSubscription({ tenantId: TENANT, planKey: "pro", startAt: START });
    const id = created.id;
    expect(billing.get(id).status).toBe("trialing");

    // Renewal succeeds → active, period advances, paid invoice added.
    const renewed = billing.simulateRenewal(id, true);
    expect(renewed.status).toBe("active");
    expect(renewed.currentPeriodStart).toBe(created.currentPeriodEnd);
    expect(new Date(renewed.currentPeriodEnd) > new Date(renewed.currentPeriodStart)).toBe(true);

    // Renewal fails → past_due (still entitled during grace).
    const pastDue = billing.simulatePastDue(id);
    expect(pastDue.status).toBe("past_due");
    const plan = getPlan(catalog, "pro");
    expect(entitlements(pastDue, plan).isActive).toBe(true);

    // Recover, then cancel immediately → canceled, entitlement gone.
    const recovered = await billing.reactivate(id);
    expect(recovered.status).toBe("active");
    const canceled = await billing.cancel(id, { immediately: true, at: "2026-04-01T00:00:00.000Z" });
    expect(canceled.status).toBe("canceled");
    expect(entitlements(canceled, plan).isActive).toBe(false);

    // Invoices: one open (trial) + one paid (the single successful renewal).
    // Recovery/reactivation does not itself renew a period, so mints no invoice.
    const invoices = await billing.listInvoices(id);
    expect(invoices.length).toBe(2);
    expect(invoices.filter((i) => i.status === "paid").length).toBe(1);
    expect(invoices.filter((i) => i.status === "open").length).toBe(1);
    for (const inv of invoices) expect(Number.isInteger(inv.amount.amount)).toBe(true);
  });

  it("syncFromProviderEvent drives the state machine from NORMALIZED events", async () => {
    const billing = newProvider();
    const created = await billing.createSubscription({ tenantId: TENANT, planKey: "pro", startAt: START });
    const id = created.id;

    const failed = await billing.syncFromProviderEvent({ kind: "renewal_failed", subscriptionId: id });
    expect(failed.status).toBe("past_due");

    const recovered = await billing.syncFromProviderEvent({ kind: "payment_recovered", subscriptionId: id });
    expect(recovered.status).toBe("active");

    const renewed = await billing.syncFromProviderEvent({
      kind: "renewal_succeeded",
      subscriptionId: id,
      periodStart: "2026-02-01T00:00:00.000Z",
      periodEnd: "2026-03-01T00:00:00.000Z",
    });
    expect(renewed.status).toBe("active");
    expect(renewed.currentPeriodEnd).toBe("2026-03-01T00:00:00.000Z");

    const canceled = await billing.syncFromProviderEvent({
      kind: "canceled",
      subscriptionId: id,
      at: "2026-02-10T00:00:00.000Z",
    });
    expect(canceled.status).toBe("canceled");
  });

  it("cancelAtPeriodEnd keeps entitlement, then simulateRenewal terminates it", async () => {
    const billing = newProvider();
    const created = await billing.createSubscription({ tenantId: TENANT, planKey: "pro", startAt: START });
    const active = billing.simulateRenewal(created.id, true);
    expect(active.status).toBe("active");

    const scheduled = await billing.cancel(created.id); // period-end
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.status).toBe("active"); // still entitled

    // At the next renewal boundary a scheduled cancel terminates instead of renewing.
    const terminated = billing.simulateRenewal(created.id, true);
    expect(terminated.status).toBe("canceled");
  });

  it("changePlan (downgrade) prunes forbidden add-ons and changes entitlements", async () => {
    const billing = newProvider();
    const created = await billing.createSubscription({
      tenantId: TENANT,
      planKey: "pro",
      addonKeys: ["sms", "extra_seats"],
      startAt: START,
    });
    expect(created.addonKeys).toEqual(["sms", "extra_seats"]);

    const downgraded = await billing.changePlan(created.id, {
      toPlanKey: "starter",
      direction: "downgrade",
      proration: "at_period_end",
    });
    expect(downgraded.planKey).toBe("starter");
    expect(downgraded.addonKeys).toEqual([]); // starter permits none

    const ent = entitlements(downgraded, getPlan(catalog, "starter"));
    expect(ent.features.has("analytics")).toBe(false);
    expect(ent.activeAddons.size).toBe(0);
  });

  it("records usage for usage billing and exposes it for inspection", async () => {
    const billing = newProvider();
    const created = await billing.createSubscription({ tenantId: TENANT, planKey: "scale", startAt: START });
    await billing.recordUsage({ subscriptionId: created.id, metric: "bookings", quantity: 12, at: START });
    await billing.recordUsage({ subscriptionId: created.id, metric: "bookings", quantity: 3, at: START });

    const usage = billing.listUsage(created.id);
    expect(usage.length).toBe(2);
    expect(usage.reduce((n, u) => n + u.quantity, 0)).toBe(15);
    expect(usage.every((u) => Number.isInteger(u.quantity))).toBe(true);
  });

  it("usage against an unknown subscription throws", async () => {
    const billing = newProvider();
    await expect(
      billing.recordUsage({ subscriptionId: "nope", metric: "bookings", quantity: 1, at: START }),
    ).rejects.toThrow();
  });
});
