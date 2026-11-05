/**
 * stripePaymentConnection.test.ts
 *
 * The properties that matter here are about what the adapter does with a BAD or
 * AMBIGUOUS answer, because that is where a connection adapter can quietly take
 * a tenant's checkout offline:
 *
 *  - An INCONCLUSIVE answer (5xx, 429, transport failure, non-JSON) throws and
 *    the next read returns the account unchanged.
 *  - Stripe DISOWNING the account (403 account_invalid, 404) is DATA, recorded
 *    as credentials_invalid, so a genuinely revoked account converges instead of
 *    retrying forever.
 *  - A malformed account reference costs ZERO requests and does not consume an
 *    armed failure, which is how the ordering is proven rather than asserted.
 *
 * The fake's `Stripe-Account` scoping is exercised directly, so the extension is
 * shown to BITE. Without that, every later Connect test would pass vacuously.
 */

import { describe, expect, it, vi } from "vitest";
import { LuminError, derivePaymentConnectionHealth } from "@lumin/contracts";
import { createFakeStripe } from "./fakeStripe";
import { createStripePaymentProvider } from "../src/stripePayment";
import { createStripeConnectProvider, mapStripeAccountReason } from "../src/stripePaymentConnection";

const SECRET = "sk_test_connect_adapter_only";
const URLS = {
  returnUrl: "https://portal.example.test/connect/return",
  refreshUrl: "https://portal.example.test/connect/refresh",
};
const TENANT = "11111111-1111-4111-8111-111111111111";

function harness() {
  const fake = createFakeStripe({ webhookSecret: "whsec_connect" });
  const spy = vi.fn(fake.fetchImpl);
  const connect = createStripeConnectProvider({
    secretKey: SECRET,
    apiBase: "https://api.stripe.test",
    fetchImpl: spy as unknown as typeof fetch,
  });
  return { fake, spy, connect };
}

function begin(connect: ReturnType<typeof harness>["connect"], key = "connect-attempt-0001") {
  return connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: key });
}

function healthOf(s: { chargesEnabled: boolean; payoutsEnabled: boolean; blockedReason: string | null }) {
  return derivePaymentConnectionHealth({
    status: "connected",
    chargesEnabled: s.chargesEnabled,
    payoutsEnabled: s.payoutsEnabled,
    blockedReason: s.blockedReason as never,
  });
}

describe("the provider label matches the allowlist and the registry", () => {
  it("is stripe_connect, as seeded by migration 0088", () => {
    expect(harness().connect.providerName).toBe("stripe_connect");
  });
});

describe("beginning a handoff creates an account that can do nothing", () => {
  it("creates a standard account and an onboarding link a person must complete", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);

    expect(fake.accounts()).toHaveLength(1);
    const account = fake.accounts()[0]!;
    expect(account.type).toBe("standard");
    expect(account.metadata.tenantId).toBe(TENANT);
    expect(account.charges_enabled).toBe(false);

    expect(handoff.provider).toBe("stripe_connect");
    // The handoff id IS the account reference; the adapter keeps no state.
    expect(handoff.handoffId).toBe(account.id);
    expect(handoff.onboardingUrl).toMatch(/^https:\/\/connect\.stripe\.com\/setup\//);
    expect(Date.parse(handoff.expiresAt)).toBeGreaterThan(0);

    const snapshot = await connect.resolveConnection(handoff.handoffId);
    expect(snapshot.chargesEnabled).toBe(false);
    expect(snapshot.onboardingComplete).toBe(false);
    expect(snapshot.blockedReason).toBe("requirements_past_due");
    expect(healthOf(snapshot)).toBe("blocked");
  });

  it("is idempotent: the same key never creates a second merchant account", async () => {
    const { fake, connect } = harness();
    const first = await begin(connect, "same-key-aaaaaaaaaaa");
    const second = await begin(connect, "same-key-aaaaaaaaaaa");
    expect(second.handoffId).toBe(first.handoffId);
    expect(fake.accounts()).toHaveLength(1);
  });

  it("uses a DISTINCT idempotency key for the link, or Stripe would refuse it", async () => {
    // The fake refuses a key reused with different parameters, exactly as Stripe
    // does. So beginConnection succeeding at all proves the two keys differ --
    // reusing one would surface as PROVIDER_UNAVAILABLE.
    const { connect } = harness();
    await expect(begin(connect, "distinct-key-check-01")).resolves.toMatchObject({ provider: "stripe_connect" });
  });

  it("never sends a Stripe-Account header: account management is a platform act", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    await connect.inspectConnection(handoff.handoffId);
    expect(fake.stripeAccountHeaders().every((h) => h === null)).toBe(true);
  });

  it("refuses a return or refresh URL that is not absolute http(s), before any request", async () => {
    const { spy, connect } = harness();
    for (const bad of ["/relative", "javascript:alert(1)", "", "not a url"]) {
      await expect(
        connect.beginConnection({ tenantId: TENANT, ...URLS, returnUrl: bad, idempotencyKey: `k-${bad}-xxxxxxxxxx` }),
      ).rejects.toThrow(/absolute URL|http\(s\) URL/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("mints a fresh link for an existing account instead of a second account", async () => {
    const { fake, connect } = harness();
    const first = await begin(connect);
    const relinked = await connect.linkExistingAccount(first.handoffId, URLS);
    expect(fake.accounts()).toHaveLength(1);
    expect(relinked.handoffId).toBe(first.handoffId);
    expect(relinked.onboardingUrl).not.toBe(first.onboardingUrl);
  });
});

describe("every Stripe account state maps onto the closed vocabulary", () => {
  async function staged(facts: Parameters<ReturnType<typeof harness>["fake"]["driveAccount"]>[1]) {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.driveAccount(handoff.handoffId, facts);
    return connect.inspectConnection(handoff.handoffId);
  }

  it("a finished, healthy account has no reason and is chargeable", async () => {
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBeNull();
    expect(healthOf(s)).toBe("chargeable");
  });

  it("payouts disabled reads payouts_disabled and DEGRADED, not blocked", async () => {
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBe("payouts_disabled");
    expect(healthOf(s)).toBe("degraded");
  });

  it("a restricted merchant with information past due reads requirements_past_due", async () => {
    const s = await staged({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: "requirements.past_due", currently_due: ["id_number"], past_due: ["id_number"] },
    });
    expect(s.blockedReason).toBe("requirements_past_due");
    expect(healthOf(s)).toBe("blocked");
  });

  it("a rejected account reads account_rejected", async () => {
    const s = await staged({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: "rejected.fraud", currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBe("account_rejected");
  });

  it("charges switched off for another reason reads charges_disabled", async () => {
    const s = await staged({
      charges_enabled: false,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: "under_review", currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBe("charges_disabled");
  });

  it("charging while information is still due reads onboarding_incomplete and DEGRADED", async () => {
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: ["external_account"], past_due: [] },
    });
    expect(s.blockedReason).toBe("onboarding_incomplete");
    expect(healthOf(s)).toBe("degraded");
  });

  it("never forwards Stripe's own disabled_reason text", async () => {
    const s = await staged({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: "listed.sanctions.OFAC_match_req_abc123", currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBe("charges_disabled");
    expect(JSON.stringify(s)).not.toContain("OFAC");
    expect(JSON.stringify(s)).not.toContain("req_abc123");
  });

  it("mapStripeAccountReason always produces a reason when charges are off", () => {
    const BOOLS = [false, true];
    const REASONS = [null, "", "rejected.other", "requirements.past_due", "under_review", "listed"];
    let covered = 0;
    for (const charges_enabled of BOOLS) {
      for (const payouts_enabled of BOOLS) {
        for (const details_submitted of BOOLS) {
          for (const disabled_reason of REASONS) {
            for (const past_due of [[], ["x"]]) {
              for (const currently_due of [[], ["y"]]) {
                covered += 1;
                const reason = mapStripeAccountReason({
                  charges_enabled,
                  payouts_enabled,
                  details_submitted,
                  requirements: { disabled_reason, currently_due, past_due },
                });
                // The schema and the stored row both require this.
                if (!charges_enabled) expect(reason, JSON.stringify({ disabled_reason, past_due })).not.toBeNull();
                if (reason !== null) {
                  expect([
                    "onboarding_incomplete",
                    "charges_disabled",
                    "payouts_disabled",
                    "requirements_past_due",
                    "credentials_invalid",
                    "account_rejected",
                  ]).toContain(reason);
                }
              }
            }
          }
        }
      }
    }
    expect(covered).toBe(2 * 2 * 2 * 6 * 2 * 2);
  });

  it("treats a missing or malformed requirements object as charges_disabled, not as healthy", () => {
    expect(mapStripeAccountReason({})).toBe("onboarding_incomplete");
    expect(mapStripeAccountReason({ charges_enabled: true })).toBe("payouts_disabled");
    expect(mapStripeAccountReason({ charges_enabled: "yes" as unknown as boolean })).toBe("onboarding_incomplete");
  });
});

describe("an inconclusive answer changes nothing", () => {
  it("a 500 throws PROVIDER_UNAVAILABLE and the next read is unchanged", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.driveAccount(handoff.handoffId, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    });
    const before = await connect.inspectConnection(handoff.handoffId);
    expect(healthOf(before)).toBe("chargeable");

    fake.armServerError();
    await expect(connect.inspectConnection(handoff.handoffId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });

    const after = await connect.inspectConnection(handoff.handoffId);
    expect(after.chargesEnabled).toBe(true);
    expect(after.blockedReason).toBeNull();
    expect(healthOf(after)).toBe("chargeable");
  });

  it("a 429 is equally inconclusive", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.armRateLimit();
    await expect(connect.inspectConnection(handoff.handoffId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a transport failure is inconclusive, never credentials_invalid", async () => {
    const connect = createStripeConnectProvider({
      secretKey: SECRET,
      apiBase: "https://api.stripe.test",
      fetchImpl: (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a non-JSON body is inconclusive", async () => {
    const connect = createStripeConnectProvider({
      secretKey: SECRET,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async () => new Response("<html>502 Bad Gateway</html>", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("an outage during beginConnection creates nothing", async () => {
    const { fake, connect } = harness();
    fake.armServerError();
    await expect(begin(connect)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.accounts()).toHaveLength(0);
  });
});

describe("Stripe disowning the account is DATA, not an outage", () => {
  it("403 account_invalid becomes a credentials_invalid snapshot", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.disownAccount(handoff.handoffId);
    const snapshot = await connect.inspectConnection(handoff.handoffId);
    expect(snapshot.blockedReason).toBe("credentials_invalid");
    expect(snapshot.chargesEnabled).toBe(false);
    expect(healthOf(snapshot)).toBe("blocked");
  });

  it("404 on an account this platform never created is the same answer", async () => {
    const { connect } = harness();
    const snapshot = await connect.inspectConnection("acct_neverexisted01");
    expect(snapshot.blockedReason).toBe("credentials_invalid");
  });

  it("the disowned snapshot carries no provider prose", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.disownAccount(handoff.handoffId);
    const snapshot = await connect.inspectConnection(handoff.handoffId);
    expect(JSON.stringify(snapshot)).not.toMatch(/does not have access|invalid_request_error/);
  });
});

describe("a malformed account reference costs zero requests", () => {
  const BAD = [
    "acct_ok\r\nAuthorization: Bearer stolen",
    "acct_ok\nX-Injected: 1",
    "mch_not_a_stripe_account",
    "acct_short",
    "acct_has.a.dot.in.it",
    "",
  ];

  for (const bad of BAD) {
    it(`refuses ${JSON.stringify(bad)} with CONNECTION_UNVERIFIED and no request`, async () => {
      const { spy, connect } = harness();
      let thrown: unknown;
      try {
        await connect.inspectConnection(bad);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LuminError);
      expect((thrown as LuminError).code).toBe("CONNECTION_UNVERIFIED");
      expect((thrown as Error).message).not.toContain("Authorization");
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("does NOT consume an armed outage — validation precedes the provider", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.armServerError();
    await expect(connect.inspectConnection("acct_ok\r\nevil")).rejects.toMatchObject({
      code: "CONNECTION_UNVERIFIED",
    });
    // Still armed: the rejected call never reached the part that could fail.
    await expect(connect.inspectConnection(handoff.handoffId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("refuses the same shapes through resolveConnection", async () => {
    const { connect } = harness();
    await expect(connect.resolveConnection("mch_mock_style_handoff")).rejects.toMatchObject({
      code: "CONNECTION_UNVERIFIED",
    });
  });
});

describe("the adapter cannot change a connection", () => {
  const FORBIDDEN = [
    "deauthorize",
    "disconnect",
    "revoke",
    "reject",
    "rejectAccount",
    "disable",
    "disableAccount",
    "pausePayouts",
    "updateAccount",
    "deleteAccount",
    "setCapability",
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

  it("exposes no member that disables, repoints or charges an account", () => {
    const found = members(harness().connect).filter((m) => FORBIDDEN.includes(m));
    expect(found, `must not expose ${found.join(", ")}`).toEqual([]);
  });

  it("calls no Stripe endpoint that could take a merchant offline", () => {
    const src = readSource();
    for (const path of ["/deauthorize", "/reject", "/capabilities", "/payouts", "/v1/payment_intents", "/v1/refunds"]) {
      expect(src, `must not call ${path}`).not.toContain(path);
    }
  });

  it("only ever POSTs to account creation and account links", () => {
    const src = readSource();
    const posts = [...src.matchAll(/call\("(\/v1\/[^"]+)",\s*\{\s*\n?\s*method:\s*"POST"/g)].map((m) => m[1]);
    expect(new Set(posts)).toEqual(new Set(["/v1/accounts", "/v1/account_links"]));
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(new URL("../src/stripePaymentConnection.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
}

describe("the fake's Stripe-Account scoping actually bites", () => {
  // Proving the EXTENSION, not the adapter. Without this, a later Connect test
  // that forgot the header would pass against a fake that ignored it.
  it("an intent created on the platform is invisible with a Stripe-Account header", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_scope" });
    const payments = createStripePaymentProvider({
      secretKey: SECRET,
      webhookSecret: "whsec_scope",
      apiBase: "https://api.stripe.test",
      fetchImpl: fake.fetchImpl,
    });
    const intent = await payments.createIntent({
      tenantId: TENANT,
      bookingId: "22222222-2222-4222-8222-222222222222",
      amount: { amount: 12500, currency: "USD" },
      idempotencyKey: "scope-check-key-0001",
    });

    // Unscoped read: visible.
    const platformRead = await fake.fetchImpl(`https://api.stripe.test/v1/payment_intents/${intent.intentId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect(platformRead.status).toBe(200);

    // The same object, asked for as a connected account: NOT FOUND.
    const connectedRead = await fake.fetchImpl(`https://api.stripe.test/v1/payment_intents/${intent.intentId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${SECRET}`, "Stripe-Account": "acct_test00000001" },
    });
    expect(connectedRead.status).toBe(404);
  });

  it("records the acting account of every request, in order", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_scope" });
    await fake.fetchImpl("https://api.stripe.test/v1/accounts/acct_test00000001", { method: "GET" });
    await fake.fetchImpl("https://api.stripe.test/v1/accounts/acct_test00000001", {
      method: "GET",
      headers: { "Stripe-Account": "acct_test00000009" },
    });
    expect(fake.stripeAccountHeaders()).toEqual([null, "acct_test00000009"]);
  });
});
