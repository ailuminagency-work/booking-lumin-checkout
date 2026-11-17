/**
 * mockPaymentConnection.test.ts
 *
 * The properties this pins are the ones the P1 decision rests on, so they are
 * asserted on the adapter rather than described in a comment:
 *
 *  - Beginning a handoff grants NO payment capability. Only a person finishing
 *    it does.
 *  - An INCONCLUSIVE provider answer throws and changes nothing. A transient
 *    5xx must never be able to take a tenant's checkout offline.
 *  - A provider saying "this account is invalid" is DATA, not an outage, so a
 *    genuinely revoked account converges instead of retrying forever.
 *  - A header-unsafe account reference is refused BEFORE anything could reach a
 *    provider.
 *  - The adapter has no member that disables, disconnects or repoints a
 *    connection, and no network call of any kind.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LuminError, derivePaymentConnectionHealth } from "@lumin/contracts";
import { createMockPaymentConnectionProvider } from "../src/mockPaymentConnection";

const NOW = "2026-11-05T00:00:00.000Z";
const ORIGINS = {
  returnUrl: "https://portal.example.test/connect/return",
  refreshUrl: "https://portal.example.test/connect/refresh",
};
const TENANT = "11111111-1111-4111-8111-111111111111";

function provider() {
  return createMockPaymentConnectionProvider({ now: () => NOW, handoffTtlSeconds: 300 });
}

function begin(p: ReturnType<typeof provider>, key = "connect-attempt-0001") {
  return p.beginConnection({ tenantId: TENANT, ...ORIGINS, idempotencyKey: key });
}

/** Read the health verdict a snapshot's flags imply if the row said connected. */
function healthOf(snapshot: {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  blockedReason: string | null;
}) {
  return derivePaymentConnectionHealth({
    status: "connected",
    chargesEnabled: snapshot.chargesEnabled,
    payoutsEnabled: snapshot.payoutsEnabled,
    blockedReason: snapshot.blockedReason as never,
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error("the mock connection provider must never make a request");
  });
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the provider label is the one 0088 gates", () => {
  it("is staging_mock, so a hosted database cannot record it unbootstrapped", () => {
    expect(provider().providerName).toBe("staging_mock");
  });
});

describe("beginning a handoff grants nothing", () => {
  it("returns an owner-facing link and an un-chargeable account", async () => {
    const p = provider();
    const handoff = await begin(p);
    expect(handoff.provider).toBe("staging_mock");
    expect(handoff.onboardingUrl).toContain(handoff.handoffId);
    expect(handoff.expiresAt).toBe("2026-11-05T00:05:00.000Z");

    const snapshot = await p.resolveConnection(handoff.handoffId);
    expect(snapshot.chargesEnabled).toBe(false);
    expect(snapshot.payoutsEnabled).toBe(false);
    expect(snapshot.onboardingComplete).toBe(false);
    expect(snapshot.blockedReason).toBe("onboarding_incomplete");
    // Even if a row somehow said 'connected', these flags cannot charge.
    expect(healthOf(snapshot)).toBe("blocked");
  });

  it("is idempotent: the same key never begins a second handoff", async () => {
    const p = provider();
    const first = await begin(p, "same-key");
    const second = await begin(p, "same-key");
    expect(second).toEqual(first);
    expect(p.listHandoffs()).toHaveLength(1);
    const third = await begin(p, "different-key");
    expect(third.handoffId).not.toBe(first.handoffId);
    expect(p.listHandoffs()).toHaveLength(2);
  });

  it("scopes idempotency BY TENANT: one tenant's key never replays another's handoff", async () => {
    // Keyed on the key alone, tenant B presenting tenant A's key was handed A's
    // handoff -- and so A's minted account. The database ledger is scoped
    // correctly, but an adapter must not rely on something downstream to keep
    // tenants apart.
    const p = provider();
    const OTHER = "99999999-9999-4999-8999-999999999999";
    const a = await p.beginConnection({ tenantId: TENANT, ...ORIGINS, idempotencyKey: "shared-key-000001" });
    const b = await p.beginConnection({ tenantId: OTHER, ...ORIGINS, idempotencyKey: "shared-key-000001" });
    expect(b.handoffId).not.toBe(a.handoffId);
    expect(p.listHandoffs()).toHaveLength(2);
    const [sa, sb] = [await p.resolveConnection(a.handoffId), await p.resolveConnection(b.handoffId)];
    expect(sb.accountId).not.toBe(sa.accountId);
  });

  it("still replays within one tenant", async () => {
    const p = provider();
    const first = await begin(p, "same-tenant-key-01");
    const again = await begin(p, "same-tenant-key-01");
    expect(again).toEqual(first);
    expect(p.listHandoffs()).toHaveLength(1);
  });

  it("mints a distinct account per handoff, so two attempts never share one", async () => {
    const p = provider();
    const a = await p.resolveConnection((await begin(p, "key-a")).handoffId);
    const b = await p.resolveConnection((await begin(p, "key-b")).handoffId);
    expect(a.accountId).not.toBe(b.accountId);
  });

  it("refuses a return or refresh URL that is not absolute http(s)", async () => {
    const p = provider();
    for (const bad of ["/relative", "javascript:alert(1)", "not a url", ""]) {
      await expect(
        p.beginConnection({ tenantId: TENANT, ...ORIGINS, returnUrl: bad, idempotencyKey: `k-${bad}` }),
      ).rejects.toThrow();
      await expect(
        p.beginConnection({ tenantId: TENANT, ...ORIGINS, refreshUrl: bad, idempotencyKey: `r-${bad}` }),
      ).rejects.toThrow();
    }
  });

  it("carries no credential in the handoff", async () => {
    const handoff = await begin(provider());
    for (const key of Object.keys(handoff)) {
      expect(key).not.toMatch(/secret|key|token|password|credential/i);
    }
  });
});

describe("a person finishing the handoff is what grants capability", () => {
  it("completeHandoff produces a chargeable account", async () => {
    const p = provider();
    const handoff = await begin(p);
    const completed = p.completeHandoff(handoff.handoffId);
    expect(completed.chargesEnabled).toBe(true);
    expect(completed.payoutsEnabled).toBe(true);
    expect(completed.onboardingComplete).toBe(true);
    expect(completed.blockedReason).toBeNull();
    expect(healthOf(completed)).toBe("chargeable");

    // And re-reading the account agrees.
    expect(await p.inspectConnection(completed.accountId)).toEqual(completed);
    expect(await p.resolveConnection(handoff.handoffId)).toEqual(completed);
  });

  it("can finish with charges enabled but onboarding still open — legitimate, degraded", async () => {
    const p = provider();
    const handoff = await begin(p);
    const partial = p.completeHandoff(handoff.handoffId, {
      onboardingComplete: false,
      blockedReason: "onboarding_incomplete",
    });
    expect(partial.chargesEnabled).toBe(true);
    expect(healthOf(partial)).toBe("degraded");
  });

  it("refuses to stage 'cannot charge with no reason' — the database could not hold it", async () => {
    const p = provider();
    const handoff = await begin(p);
    expect(() => p.completeHandoff(handoff.handoffId, { chargesEnabled: false, blockedReason: null })).toThrow(
      /must carry a reason/,
    );
  });

  it("refuses a handoff it never issued", async () => {
    const p = provider();
    await expect(p.resolveConnection("mch_never_issued")).rejects.toMatchObject({
      code: "CONNECTION_UNVERIFIED",
    });
    expect(() => p.completeHandoff("mch_never_issued")).toThrow(/unknown handoff/);
  });
});

describe("an inconclusive answer changes nothing", () => {
  it("throws PROVIDER_UNAVAILABLE and leaves the account exactly as it was", async () => {
    const p = provider();
    const handoff = await begin(p);
    const before = p.completeHandoff(handoff.handoffId);

    p.armUnavailable();
    let thrown: unknown;
    try {
      await p.inspectConnection(before.accountId);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(LuminError);
    expect((thrown as LuminError).code).toBe("PROVIDER_UNAVAILABLE");

    // The decisive assertion: the very next read is the untouched snapshot. A
    // transient failure did NOT downgrade a working connection.
    const after = await p.inspectConnection(before.accountId);
    expect(after).toEqual(before);
    expect(healthOf(after)).toBe("chargeable");
  });

  it("the arm is one-shot, on resolveConnection too", async () => {
    const p = provider();
    const handoff = await begin(p);
    p.completeHandoff(handoff.handoffId);
    p.armUnavailable();
    await expect(p.resolveConnection(handoff.handoffId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(p.resolveConnection(handoff.handoffId)).resolves.toMatchObject({ chargesEnabled: true });
  });

  it("an invalid ACCOUNT is data, not an outage: credentials_invalid, no throw", async () => {
    const p = provider();
    const snapshot = await p.inspectConnection("acct_mock_never_existed");
    expect(snapshot.blockedReason).toBe("credentials_invalid");
    expect(snapshot.chargesEnabled).toBe(false);
    expect(healthOf(snapshot)).toBe("blocked");
  });
});

describe("a header-unsafe reference is refused before any provider contact", () => {
  const SMUGGLING = ["acct_ok\r\nAuthorization: Bearer stolen", "acct_ok\nX-Injected: 1", "acct_ok evil", ""];

  for (const bad of SMUGGLING) {
    it(`refuses ${JSON.stringify(bad)} with CONNECTION_UNVERIFIED`, async () => {
      await expect(provider().inspectConnection(bad)).rejects.toMatchObject({
        code: "CONNECTION_UNVERIFIED",
      });
    });
  }

  it("does NOT consume an armed failure — validation precedes the provider", async () => {
    const p = provider();
    const handoff = await begin(p);
    const good = p.completeHandoff(handoff.handoffId);

    p.armUnavailable();
    await expect(p.inspectConnection("acct_ok\r\nevil")).rejects.toMatchObject({
      code: "CONNECTION_UNVERIFIED",
    });
    // Still armed: the rejected call never reached the part that could fail.
    await expect(p.inspectConnection(good.accountId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("mints only header-safe references of its own", async () => {
    const p = provider();
    for (const key of ["k1", "k2", "k3", "k4", "k5"]) {
      const snapshot = await p.resolveConnection((await begin(p, key)).handoffId);
      expect(snapshot.accountId).toMatch(/^acct_mock_[0-9a-f]{24}$/);
    }
  });
});

describe("the adapter cannot change a connection and cannot reach the network", () => {
  /** Member names that would mean automation can take payments offline. */
  const MUTATING = [
    "disconnect",
    "revoke",
    "revokeConnection",
    "disable",
    "disableConnection",
    "deauthorize",
    "setStatus",
    "recordHealth",
    "repoint",
    "updateConnection",
    "deleteConnection",
    "refund",
    "createCharge",
    "createIntent",
  ];

  function members(value: object): string[] {
    const names = new Set<string>();
    for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
      for (const k of Object.getOwnPropertyNames(o)) names.add(k);
    }
    return [...names];
  }

  it("exposes no member that changes or charges a connection", () => {
    const found = members(provider()).filter((m) => MUTATING.includes(m));
    expect(found, `must not expose ${found.join(", ")}`).toEqual([]);
  });

  it("exposes no other callable whose name means taking a connection offline", () => {
    const p = provider() as unknown as Record<string, unknown>;
    const suspects = members(p).filter(
      (m) => /revoke|disconnect|disable|deauth|repoint/i.test(m) && typeof p[m] === "function",
    );
    expect(suspects, `must not expose ${suspects.join(", ")}`).toEqual([]);
  });

  it("makes no request across a full begin / resolve / complete / inspect cycle", async () => {
    const p = provider();
    const handoff = await begin(p);
    await p.resolveConnection(handoff.handoffId);
    const done = p.completeHandoff(handoff.handoffId);
    await p.inspectConnection(done.accountId);
    p.providerWillReport(done.accountId, { payoutsEnabled: false });
    await p.inspectConnection(done.accountId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the outside world changing is how states are staged", () => {
  it("a merchant losing payouts reads degraded, not blocked", async () => {
    const p = provider();
    const handoff = await begin(p);
    const good = p.completeHandoff(handoff.handoffId);
    p.providerWillReport(good.accountId, { payoutsEnabled: false, blockedReason: "payouts_disabled" });
    const after = await p.inspectConnection(good.accountId);
    expect(after.chargesEnabled).toBe(true);
    expect(healthOf(after)).toBe("degraded");
  });

  it("a merchant becoming restricted reads blocked", async () => {
    const p = provider();
    const handoff = await begin(p);
    const good = p.completeHandoff(handoff.handoffId);
    p.providerWillReport(good.accountId, { chargesEnabled: false, blockedReason: "requirements_past_due" });
    expect(healthOf(await p.inspectConnection(good.accountId))).toBe("blocked");
  });

  it("every reason in the closed vocabulary can be staged and read back", async () => {
    const p = provider();
    const handoff = await begin(p);
    const good = p.completeHandoff(handoff.handoffId);
    for (const reason of [
      "onboarding_incomplete",
      "charges_disabled",
      "payouts_disabled",
      "requirements_past_due",
      "credentials_invalid",
      "account_rejected",
    ] as const) {
      p.providerWillReport(good.accountId, { chargesEnabled: false, blockedReason: reason });
      expect((await p.inspectConnection(good.accountId)).blockedReason).toBe(reason);
    }
  });
});
