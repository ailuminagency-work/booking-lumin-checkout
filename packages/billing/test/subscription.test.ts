import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_TRANSITIONS,
  Subscription,
  SubscriptionError,
  canTransition,
  cancelAtPeriodEnd,
  cancelImmediately,
  changePlan,
  clearScheduledCancel,
  transition,
} from "../src/index";

const TENANT = "11111111-1111-1111-1111-111111111111";

function baseSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
    tenantId: TENANT,
    planKey: "pro",
    status: "trialing",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-01-15T00:00:00.000Z",
    trialEnd: "2026-01-15T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    addonKeys: ["sms"],
    ...overrides,
  };
}

describe("subscription status state machine", () => {
  it("declares canceled as terminal and no self-transitions", () => {
    expect(SUBSCRIPTION_TRANSITIONS.canceled).toEqual([]);
    for (const [from, tos] of Object.entries(SUBSCRIPTION_TRANSITIONS)) {
      expect(tos).not.toContain(from); // no status lists itself
    }
  });

  it("drives trialing → active → past_due → active", () => {
    let s = baseSub();
    s = transition(s, "active");
    expect(s.status).toBe("active");
    s = transition(s, "past_due");
    expect(s.status).toBe("past_due");
    s = transition(s, "active");
    expect(s.status).toBe("active");
  });

  it("allows active → canceled", () => {
    const s = transition(baseSub({ status: "active" }), "canceled");
    expect(s.status).toBe("canceled");
  });

  it("throws ILLEGAL_TRANSITION on an illegal move (canceled → active)", () => {
    const canceled = baseSub({ status: "canceled" });
    expect(() => transition(canceled, "active")).toThrowError(SubscriptionError);
    try {
      transition(canceled, "active");
    } catch (e) {
      expect((e as SubscriptionError).code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("throws on a self-transition (active → active)", () => {
    try {
      transition(baseSub({ status: "active" }), "active");
      expect.unreachable("self-transition should throw");
    } catch (e) {
      expect((e as SubscriptionError).code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("canTransition matches the declared table", () => {
    expect(canTransition("trialing", "past_due")).toBe(true);
    expect(canTransition("incomplete", "past_due")).toBe(false);
    expect(canTransition("canceled", "active")).toBe(false);
  });
});

describe("cancellation: period-end vs immediate", () => {
  it("cancelAtPeriodEnd sets the flag but keeps status", () => {
    const s = cancelAtPeriodEnd(baseSub({ status: "active" }));
    expect(s.cancelAtPeriodEnd).toBe(true);
    expect(s.status).toBe("active"); // still entitled until period end
  });

  it("cancelImmediately moves to canceled and clamps the period end", () => {
    const asOf = "2026-01-05T00:00:00.000Z";
    const s = cancelImmediately(baseSub({ status: "active" }), asOf);
    expect(s.status).toBe("canceled");
    expect(s.currentPeriodEnd).toBe(asOf);
  });

  it("clearScheduledCancel undoes a period-end cancel", () => {
    const scheduled = cancelAtPeriodEnd(baseSub({ status: "active" }));
    const s = clearScheduledCancel(scheduled);
    expect(s.cancelAtPeriodEnd).toBe(false);
  });

  it("cannot un-cancel a canceled subscription", () => {
    try {
      clearScheduledCancel(baseSub({ status: "canceled" }));
      expect.unreachable("un-cancel should throw");
    } catch (e) {
      expect((e as SubscriptionError).code).toBe("ILLEGAL_TRANSITION");
    }
  });
});

describe("plan change (upgrade/downgrade) carries proration as data", () => {
  it("records the new plan and prunes now-forbidden add-ons", () => {
    const { subscription, change } = changePlan(
      baseSub({ status: "active", planKey: "pro", addonKeys: ["sms", "extra_seats"] }),
      { toPlanKey: "starter", direction: "downgrade", proration: "at_period_end" },
      /* allowedAddonKeys of the target plan */ [],
    );
    expect(subscription.planKey).toBe("starter");
    expect(subscription.addonKeys).toEqual([]); // starter permits no add-ons
    expect(subscription.status).toBe("active"); // plan change does not move lifecycle
    expect(change.proration).toBe("at_period_end");
  });

  it("keeps proration amount as caller-supplied integer minor units", () => {
    const { change } = changePlan(
      baseSub({ status: "active" }),
      { toPlanKey: "scale", direction: "upgrade", proration: "prorate", prorationMinorUnits: 10000 },
      ["sms", "extra_seats", "usage_bookings"],
    );
    expect(change.prorationMinorUnits).toBe(10000);
    expect(Number.isInteger(change.prorationMinorUnits!)).toBe(true);
  });

  it("refuses a plan change on a canceled subscription", () => {
    try {
      changePlan(baseSub({ status: "canceled" }), { toPlanKey: "pro", direction: "upgrade", proration: "none" }, []);
      expect.unreachable("plan change on canceled should throw");
    } catch (e) {
      expect((e as SubscriptionError).code).toBe("INVALID_PLAN_CHANGE");
    }
  });
});
