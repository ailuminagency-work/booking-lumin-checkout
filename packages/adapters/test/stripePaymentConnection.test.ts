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

const SECRET = "sk_test_connectadapteronly";
/** The platform account this deployment is pinned to. The fake's key belongs to it. */
const PLATFORM = "acct_platform000001";
const URLS = {
  returnUrl: "https://portal.example.test/connect/return",
  refreshUrl: "https://portal.example.test/connect/refresh",
};
const TENANT = "11111111-1111-4111-8111-111111111111";

/**
 * The adapter with the TEST-mode label filled in, as the selector builds it. A test
 * that names its own label exercises that label instead, because the spread comes last.
 */
function connectFor(
  opts: Omit<Parameters<typeof createStripeConnectProvider>[0], "providerLabel"> & { providerLabel?: string },
) {
  return createStripeConnectProvider({ providerLabel: "stripe_connect_test", ...opts });
}

function harness() {
  const fake = createFakeStripe({ webhookSecret: "whsec_connect", platformAccountId: PLATFORM });
  const spy = vi.fn(fake.fetchImpl);
  const connect = connectFor({
    secretKey: SECRET,
    platformAccountId: PLATFORM,
    apiBase: "https://api.stripe.test",
    fetchImpl: spy as unknown as typeof fetch,
  });
  return { fake, spy, connect };
}

/** A plain Stripe-shaped answer, for tests that script each response themselves. */
function stripeJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

/** The platform's own account, as GET /v1/account reports it for the pinned key. A fresh Response per call: a body can be read once. */
function platformAnswer(): Response {
  return stripeJson({ object: "account", id: PLATFORM }, 200);
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

describe("the provider label is the one the handoff records, and it is configurable", () => {
  it("has no default: a label is required, and the live label is refused for a test key", () => {
    // @ts-expect-error -- the label is required; the runtime refusal is what this proves
    expect(() => createStripeConnectProvider({ secretKey: SECRET, platformAccountId: PLATFORM })).toThrow(/providerLabel/);
    expect(() =>
      createStripeConnectProvider({ secretKey: SECRET, platformAccountId: PLATFORM, providerLabel: "stripe_connect" }),
    ).toThrow(/_test/);
    expect(harness().connect.providerName).toBe("stripe_connect_test");
  });

  it("writes the label it is given on every handoff and snapshot, so a test-mode connection says so", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_connect", platformAccountId: PLATFORM });
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      providerLabel: "stripe_connect_test",
      apiBase: "https://api.stripe.test",
      fetchImpl: fake.fetchImpl,
    });
    expect(connect.providerName).toBe("stripe_connect_test");
    const handoff = await begin(connect);
    expect(handoff.provider).toBe("stripe_connect_test");
    expect((await connect.resolveConnection(handoff.handoffId)).provider).toBe("stripe_connect_test");
    fake.disownAccount(handoff.handoffId);
    expect((await connect.inspectConnection(handoff.handoffId)).provider).toBe("stripe_connect_test");
  });

  it("refuses a label outside the adapter's own shape, and a platform id that is not an account, at construction", () => {
    for (const providerLabel of ["Stripe_Connect", "x", "stripe-connect", "stripe_connect;drop", "a".repeat(61)]) {
      expect(
        () => connectFor({ secretKey: SECRET, platformAccountId: PLATFORM, providerLabel }),
        providerLabel,
      ).toThrow(/providerLabel/);
    }
    for (const platformAccountId of ["", "acct_short", "pk_test_nope0001", " acct_platform000001", "mch_platform0001"]) {
      expect(
        () => connectFor({ secretKey: SECRET, platformAccountId }),
        JSON.stringify(platformAccountId),
      ).toThrow(/platformAccountId/);
    }
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

    expect(handoff.provider).toBe("stripe_connect_test");
    // The handoff id IS the account reference; the adapter keeps no state.
    expect(handoff.handoffId).toBe(account.id);
    expect(handoff.onboardingUrl).toMatch(/^https:\/\/connect\.stripe\.com\/setup\//);
    expect(Date.parse(handoff.expiresAt)).toBeGreaterThan(0);

    const snapshot = await connect.resolveConnection(handoff.handoffId);
    expect(snapshot.chargesEnabled).toBe(false);
    expect(snapshot.onboardingComplete).toBe(false);
    // Stripe marks a brand-new account's disabled_reason as requirements.past_due, and
    // the fake does too. That is an owner who has not finished, NOT a past-due merchant:
    // read as requirements_past_due, the derivation would record this unfinished account
    // as CONNECTED. The reason is onboarding_incomplete, which becomes not_connected.
    expect(snapshot.blockedReason).toBe("onboarding_incomplete");
  });

  it("is idempotent: the same key never creates a second merchant account", async () => {
    const { fake, connect } = harness();
    const first = await begin(connect, "same-key-aaaaaaaaaaa");
    const second = await begin(connect, "same-key-aaaaaaaaaaa");
    expect(second.handoffId).toBe(first.handoffId);
    expect(fake.accounts()).toHaveLength(1);
  });

  it("sends NO idempotency key on the onboarding link", async () => {
    // A keyed link replays an expired URL, and Stripe saves a keyed 500 for a day.
    // The account stays keyed; the link must not be.
    const { spy, connect } = harness();
    await begin(connect, "link-key-check-0001");
    const linkCalls = spy.mock.calls.filter(([input]) => String(input).endsWith("/v1/account_links"));
    expect(linkCalls).toHaveLength(1);
    expect(new Headers((linkCalls[0]![1] as RequestInit).headers).get("Idempotency-Key")).toBeNull();
  });

  it("a retry with the same key returns the same account and a FRESH link", async () => {
    // The first link is single-use and expires within minutes. A retry that handed
    // back the same URL would be a dead link presented as a live one.
    const { fake, connect } = harness();
    const first = await begin(connect, "retry-key-aaaaaaaa1");
    const retry = await begin(connect, "retry-key-aaaaaaaa1");
    expect(retry.handoffId).toBe(first.handoffId);
    expect(retry.onboardingUrl).not.toBe(first.onboardingUrl);
    expect(fake.accounts()).toHaveLength(1);
  });

  it("a 500 on the link leg leaves the same key a working retry, on the same account", async () => {
    // Before this change, the keyed link replayed that 500 for the whole window,
    // so the owner was refused until the key expired. The account is replayed by
    // its own key, so the retry lands on the same account, and no second is made.
    const fake = createFakeStripe({ webhookSecret: "whsec_connect", platformAccountId: PLATFORM });
    let failNextLink = true;
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (failNextLink && String(input).endsWith("/v1/account_links")) {
          failNextLink = false;
          return stripeJson({ error: { type: "api_error" } }, 500);
        }
        return fake.fetchImpl(input, init);
      }) as unknown as typeof fetch,
    });
    await expect(begin(connect, "link-leg-failure-01")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const retried = await begin(connect, "link-leg-failure-01");
    expect(retried.onboardingUrl).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(fake.accounts()).toHaveLength(1);
  });

  it("never sends a Stripe-Account header: account management is a platform act", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    await connect.inspectConnection(handoff.handoffId);
    expect(fake.stripeAccountHeaders().every((h) => h === null)).toBe(true);
  });

  it("refuses a return or refresh URL that is not absolute http(s), before any request", async () => {
    const { spy, connect } = harness();
    // The keys here are deliberately VALID: the idempotency key is validated
    // first, so reusing the bad URL as part of the key would make this test pass
    // on the wrong error.
    for (const [i, bad] of ["/relative", "javascript:alert(1)", "", "not a url"].entries()) {
      await expect(
        connect.beginConnection({ tenantId: TENANT, ...URLS, returnUrl: bad, idempotencyKey: `url-check-key-${i}` }),
      ).rejects.toThrow(/absolute URL|http\(s\) URL/);
      await expect(
        connect.beginConnection({ tenantId: TENANT, ...URLS, refreshUrl: bad, idempotencyKey: `url-check-rk-${i}` }),
      ).rejects.toThrow(/absolute URL|http\(s\) URL/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a return or refresh URL carrying userinfo", async () => {
    // Stripe hands these to the owner's browser, and userinfo is a classic way
    // to make a hostile host look trusted in an address bar.
    const { spy, connect } = harness();
    for (const [i, bad] of [
      "https://user:pass@evil.test/return",
      "https://victim.test@evil.test/return",
      "http://u@evil.test/",
    ].entries()) {
      await expect(
        connect.beginConnection({ tenantId: TENANT, ...URLS, returnUrl: bad, idempotencyKey: `userinfo-key-${i}` }),
      ).rejects.toThrow(/userinfo/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an idempotency key that is not header-safe, before any request", async () => {
    // The key is sent as a header VALUE and is also the basis of the derived
    // `${key}:link` key, so a CR or LF in it reached two endpoints and surfaced
    // as a raw TypeError from the fetch layer rather than a PaymentError.
    const { spy, connect } = harness();
    for (const bad of ["k\r\nX: 1", "k\n", "short", "", "has space", "k;v", "k".repeat(201)]) {
      await expect(
        connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: bad }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
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

  it("a charging account Stripe still marks disabled is not reported as clean", async () => {
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: "under_review", currently_due: [], past_due: [] },
    });
    expect(s.blockedReason).toBe("charges_disabled");
    expect(healthOf(s)).toBe("degraded");
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
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a non-JSON body is inconclusive", async () => {
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async () => new Response("<html>502 Bad Gateway</html>", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a BARE 404 with no Stripe error object is inconclusive, NOT a disowned account", async () => {
    // This was the serious one: any 404 was read as "Stripe disowned this
    // account" and recorded as credentials_invalid, which the database derives
    // to 'revoked'. A misconfigured apiBase or any intermediary answering 404
    // therefore took merchants offline.
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 })) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a 403 without Stripe's own error shape is inconclusive too", async () => {
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch,
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a 200 that is not the requested account is inconclusive, not all-false facts", async () => {
    // Every boolean is read with === true, so an unexpected 200 body produced
    // all-false facts and quietly moved a live connection to not_connected.
    for (const body of [{}, { object: "account" }, { object: "account", id: "acct_someoneelse01" }, { object: "customer", id: "acct_test00000001" }]) {
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        fetchImpl: (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
      });
      await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
    }
  });

  it("an onboarding link that is not https, or has an unusable expiry, is refused", async () => {
    const cases = [
      { url: "http://connect.stripe.test/setup/s/x", expires_at: 1_900_000_000 },
      { url: "javascript:alert(1)", expires_at: 1_900_000_000 },
      { url: "https://connect.stripe.com/setup/s/x", expires_at: 0 },
      { url: "https://connect.stripe.com/setup/s/x", expires_at: 8.64e15 },
    ];
    for (const link of cases) {
      let calls = 0;
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        fetchImpl: (async (input: any) => {
          calls += 1;
          const url = String(input);
          // The pin is confirmed first, then the account is created, then the link is
          // asked for. The refusal must come from the LINK, so the platform answers as
          // the pinned platform here.
          if (url.endsWith("/v1/account")) return platformAnswer();
          return url.endsWith("/v1/accounts")
            ? new Response(JSON.stringify({ object: "account", id: "acct_test00000001" }), { status: 200 })
            : new Response(JSON.stringify({ object: "account_link", ...link }), { status: 200 });
        }) as unknown as typeof fetch,
      });
      await expect(begin(connect, "link-shape-key-01")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
      expect(calls).toBe(3);
    }
  });

  it("EVERY unexpected status stays inconclusive — including a rotated platform key", async () => {
    // The old suite exercised only 500 / 429 / transport / non-JSON, so widening
    // disownsAccount to 400 and 401 went undetected (proven by the review). The
    // scenario that makes it serious: the platform key is rotated or disabled, so
    // GET /v1/accounts answers 401 api_key_expired for EVERY tenant at once, and
    // each one is read as disowned -> credentials_invalid -> revoked.
    const cases: Array<[number, unknown]> = [
      [400, { error: { type: "invalid_request_error", code: "parameter_invalid_empty" } }],
      [401, { error: { type: "invalid_request_error", code: "api_key_expired" } }],
      [401, { error: { type: "authentication_error", message: "Invalid API Key provided" } }],
      [402, { error: { type: "card_error", code: "card_declined" } }],
      [409, { error: { type: "idempotency_error" } }],
      [500, { error: { type: "api_error" } }],
      [502, {}],
      [503, { error: { type: "api_error" } }],
    ];
    for (const [status, body] of cases) {
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        fetchImpl: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
      });
      await expect(
        connect.inspectConnection("acct_test00000001"),
        `status ${status} must be inconclusive`,
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
  });

  it("ONLY Stripe's own two disown codes become data", async () => {
    // The complement of the above, so the pair pins the boundary from both sides.
    for (const [status, code] of [
      [404, "resource_missing"],
      [403, "account_invalid"],
      [404, "account_invalid"],
    ] as Array<[number, string]>) {
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        // The pinned platform is who is asking; it is the one party that may disown.
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/v1/account")
            ? platformAnswer()
            : new Response(JSON.stringify({ error: { type: "invalid_request_error", code } }), {
                status,
              })) as unknown as typeof fetch,
      });
      const snapshot = await connect.inspectConnection("acct_test00000001");
      expect(snapshot.blockedReason, `${status}/${code}`).toBe("credentials_invalid");
    }
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

  it("a read confirms the pinned platform FIRST, and a disown is recorded from that read", async () => {
    // The platform is confirmed before the merchant is asked about, with the same key,
    // so a disowning is only ever the pinned platform's own word.
    const calls: string[] = [];
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        return url.endsWith("/v1/account")
          ? platformAnswer()
          : stripeJson({ error: { type: "invalid_request_error", code: "account_invalid" } }, 403);
      }) as unknown as typeof fetch,
    });
    const snapshot = await connect.inspectConnection("acct_test00000001");
    expect(snapshot.blockedReason).toBe("credentials_invalid");
    expect(calls.map((u) => new URL(u).pathname)).toEqual(["/v1/account", "/v1/accounts/acct_test00000001"]);
  });

  it("a disown the pinned platform cannot confirm is an outage, and records nothing", async () => {
    // Three ways the platform check can fail: a refused key, a different platform,
    // and an outage. Each leaves the stored row alone.
    const disown = { error: { type: "invalid_request_error", code: "account_invalid" } };
    const platformAnswers: Array<[string, () => Response]> = [
      ["the key is refused", () => stripeJson({ error: { type: "authentication_error" } }, 401)],
      ["a different platform", () => stripeJson({ object: "account", id: "acct_someoneelse01" }, 200)],
      ["the platform check is down", () => stripeJson({ error: { type: "api_error" } }, 500)],
    ];
    for (const [why, answer] of platformAnswers) {
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/v1/account") ? answer() : stripeJson(disown, 403)) as unknown as typeof fetch,
      });
      await expect(connect.inspectConnection("acct_test00000001"), why)
        .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
  });

  it("a FOREIGN key's disown is an outage, not a verdict on the merchant", async () => {
    // The defect this closes. The key now belongs to another platform, so Stripe
    // refuses every account it is asked about with the same 403. The merchant is
    // still connected to us; recording the 403 would have revoked a healthy row.
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.disownAccount(handoff.handoffId);
    fake.setPlatformAccountId("acct_foreignplatform01");
    await expect(connect.inspectConnection(handoff.handoffId)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    // Once the pinned key is back, the same disown is a verdict again.
    fake.setPlatformAccountId(PLATFORM);
    expect((await connect.inspectConnection(handoff.handoffId)).blockedReason).toBe("credentials_invalid");
  });

  it("404 on an account this platform never created is the same answer", async () => {
    const { connect } = harness();
    const snapshot = await connect.inspectConnection("acct_neverexisted01");
    expect(snapshot.blockedReason).toBe("credentials_invalid");
  });

  // The disowned snapshot is built from literals and parsed by a .strict() schema, whose
  // blockedReason is a closed vocabulary. A mutation that put Stripe's body text into the
  // snapshot would make that parse THROW, and this test fails with it. So this assertion
  // can fail; the schema is the second guard, against a field or a value it does not know.
  it("the disowned snapshot carries no provider prose (a mutation that adds it fails the parse)", async () => {
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
    // Template literals COUNT. This used to require a double-quoted path, and a
    // review proved the hole by adding `call(`/v1/accounts/${id}`, {method:
    // "POST"})` -- Stripe's Update-an-Account endpoint, a write against a live
    // connected account -- which all three guards missed. The file already uses
    // a template literal for its GET, so that is the established idiom here.
    const src = readSource();
    const posts = [...src.matchAll(/call\(\s*[`"](\/v1\/[^`"]*)[`"]\s*,\s*\{[^}]*?method:\s*"POST"/gs)].map(
      (m) => (m[1] ?? "").replace(/\$\{[^}]*\}/g, "{}"),
    );
    expect(posts.length, "the guard must find the POSTs it is checking").toBeGreaterThan(0);
    expect(new Set(posts)).toEqual(new Set(["/v1/accounts", "/v1/account_links"]));
  });

  it("every call() in the file is one of the four known request shapes", () => {
    // The positive form of the guard above: enumerate EVERY call() site, so a
    // new one cannot be invisible merely by not matching a denylist. The fourth is
    // the platform's own account, read to confirm a disown; it is a GET.
    const src = readSource();
    const sites = [...src.matchAll(/call\(\s*[`"](\/v1\/[^`"]*)[`"]/g)].map((m) =>
      (m[1] ?? "").replace(/\$\{[^}]*\}/g, "{}"),
    );
    expect(sites.length).toBe(4);
    expect(new Set(sites)).toEqual(
      new Set(["/v1/accounts", "/v1/account_links", "/v1/accounts/{}", "/v1/account"]),
    );
  });

  it("exposes no member whose name suggests writing to an account", () => {
    // A regex companion to the exact-name list: that list could not have caught
    // a member called `quietlyRepoint`, which is what the review added.
    const p = harness().connect as unknown as Record<string, unknown>;
    const ALLOWED = new Set([
      "providerName",
      "beginConnection",
      "linkExistingAccount",
      "resolveConnection",
      "inspectConnection",
    ]);
    const unexpected = Object.keys(p).filter((m) => !ALLOWED.has(m));
    expect(unexpected, `unexpected member(s): ${unexpected.join(", ")}`).toEqual([]);
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
