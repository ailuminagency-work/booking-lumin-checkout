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

/**
 * A fetch whose PLATFORM check (GET /v1/account) answers as the pinned platform, and whose
 * MERCHANT read answers what `merchant` returns. A test about the merchant read must use this.
 * If the platform check got the same response, confirmPlatform would throw before the merchant
 * read is reached, and the test would pass whatever the classifier did.
 */
function withPinnedPlatform(merchant: () => Response): typeof fetch {
  return (async (input: RequestInfo | URL) =>
    new URL(String(input)).pathname === "/v1/account" ? platformAnswer() : merchant()) as unknown as typeof fetch;
}

/** An adapter whose merchant read answers `merchant`, with the pinned platform answering the platform check. */
function connectMerchant(merchant: () => Response) {
  return connectFor({
    secretKey: SECRET,
    platformAccountId: PLATFORM,
    apiBase: "https://api.stripe.test",
    fetchImpl: withPinnedPlatform(merchant),
  });
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
    // The stand-in gives a brand-new account requirements.past_due as its disabled_reason,
    // and an unfinished account can carry that in practice. It is an owner who has not
    // finished, NOT a past-due merchant: read as requirements_past_due, the derivation would
    // record this unfinished account as CONNECTED. The reason is onboarding_incomplete, which
    // becomes not_connected.
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
    // The 500 is the stand-in's own: a path-scoped outage on the link endpoint, which the
    // stand-in keeps under a key exactly as Stripe keeps a keyed 500. The link is sent
    // unkeyed, so the retry is answered with a fresh link. Keying the link would replay the
    // 500 for the whole window and fail the retry. The account is replayed by its own key,
    // so the retry lands on the same account, and no second is made.
    const fake = createFakeStripe({ webhookSecret: "whsec_connect", platformAccountId: PLATFORM });
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: fake.fetchImpl,
    });
    fake.armServerError(1, { method: "POST", path: "/v1/account_links" });
    const failure = await begin(connect, "link-leg-failure-01").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    // The failure is the LINK leg's: the account was created and the link request is what failed.
    expect((failure as Error).message).toContain("did not issue an onboarding link");
    expect(fake.outagesServed()).toBe(1);
    const retried = await begin(connect, "link-leg-failure-01");
    expect(retried.onboardingUrl).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(retried.handoffId).toBe(fake.accounts()[0]!.id);
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

describe("linking an existing account refuses a bad redirect before any request", () => {
  it("a return URL carrying userinfo is INVALID_REQUEST, and the stand-in records no request at all", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    const before = fake.requests().length;
    await expect(
      connect.linkExistingAccount(handoff.handoffId, {
        ...URLS,
        returnUrl: "https://user:pass@portal.example.test/return",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    // Not even the platform check: the URL is refused before the pin is confirmed.
    expect(fake.requests().slice(before)).toEqual([]);
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

  it("a rejected account that still charges reads account_rejected, not a caveat", async () => {
    // The rejection is checked before the charging branch. A caveat (charges_disabled) would have
    // left a charging account connected, and the derivation revokes an account_rejected one.
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: "rejected.fraud", currently_due: [], past_due: [] },
    });
    expect(s.chargesEnabled).toBe(true);
    expect(s.blockedReason).toBe("account_rejected");
  });

  it("a charging account whose owner never finished reads onboarding_incomplete, even with items past due", async () => {
    // An unsubmitted account is named before any past-due item, as it is when charges are off.
    const s = await staged({
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: false,
      requirements: { disabled_reason: null, currently_due: [], past_due: ["individual.verification.document"] },
    });
    expect(s.blockedReason).toBe("onboarding_incomplete");
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

  it("treats a missing or malformed account as unfinished or unpaid, never as healthy", () => {
    expect(mapStripeAccountReason({})).toBe("onboarding_incomplete");
    // No details_submitted means the owner has not finished: that is named before the payouts flag.
    expect(mapStripeAccountReason({ charges_enabled: true })).toBe("onboarding_incomplete");
    expect(mapStripeAccountReason({ charges_enabled: true, details_submitted: true })).toBe("payouts_disabled");
    expect(mapStripeAccountReason({ charges_enabled: "yes" as unknown as boolean })).toBe("onboarding_incomplete");
  });

  it("a charging account whose owner never finished is onboarding_incomplete, whatever the payouts say", () => {
    expect(mapStripeAccountReason({ charges_enabled: true, payouts_enabled: false, details_submitted: false })).toBe(
      "onboarding_incomplete",
    );
    expect(mapStripeAccountReason({ charges_enabled: true, payouts_enabled: true, details_submitted: false })).toBe(
      "onboarding_incomplete",
    );
    // Past-due items do not outrank an unfinished owner: the same answer as the cases above.
    expect(
      mapStripeAccountReason({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: false,
        requirements: { past_due: ["individual.dob"] },
      }),
    ).toBe("onboarding_incomplete");
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

  it("a transport failure on the merchant read is inconclusive, never credentials_invalid", async () => {
    // The platform check answers; the merchant read is the request that fails, and only that one.
    const connect = connectMerchant(() => {
      throw new Error("ECONNRESET");
    });
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a non-JSON body on the merchant read is inconclusive", async () => {
    const connect = connectMerchant(() => new Response("<html>502 Bad Gateway</html>", { status: 200 }));
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a BARE 404 on the merchant read is inconclusive, NOT a disowned account", async () => {
    // This was the serious one: any 404 was read as "Stripe disowned this account" and recorded
    // as credentials_invalid, which the database derives to 'revoked'. A misconfigured apiBase,
    // or any intermediary answering 404, took merchants offline. The pinned platform answers the
    // platform check here, so the merchant read is the only request that can fail.
    const connect = connectMerchant(() => stripeJson({ message: "not found" }, 404));
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a merchant-read 400 or 404 without Stripe's disown code is inconclusive", async () => {
    // Only the two disown codes become data. These statuses carry Stripe's error envelope, with
    // a code that is not one of them, so only the status and code checks stand between them and
    // a disowning. The pinned platform answers the platform check.
    const cases: Array<[number, unknown]> = [
      [400, { error: { type: "invalid_request_error", code: "parameter_invalid_empty" } }],
      [404, { error: { type: "invalid_request_error", code: "url_invalid" } }],
    ];
    for (const [status, body] of cases) {
      const connect = connectMerchant(() => stripeJson(body, status));
      await expect(connect.inspectConnection("acct_test00000001"), `status ${status}`).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
    }
  });

  it("a 403 without Stripe's own error shape is inconclusive too", async () => {
    const connect = connectMerchant(() => new Response("{}", { status: 403 }));
    await expect(connect.inspectConnection("acct_test00000001")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a merchant-read 200 that is not the requested account is inconclusive, not all-false facts", async () => {
    // Every boolean is read with === true, so an unexpected 200 body produced all-false facts and
    // quietly moved a live connection to not_connected. The pinned platform answers the platform
    // check, so the identity check on the merchant read is the only thing that can refuse these.
    const bodies: unknown[] = [
      {},
      { object: "account" },
      { object: "account", id: "acct_someoneelse01" },
      { object: "customer", id: "acct_test00000001" },
    ];
    for (const body of bodies) {
      const connect = connectMerchant(() => stripeJson(body, 200));
      await expect(connect.inspectConnection("acct_test00000001"), JSON.stringify(body)).rejects.toMatchObject({
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

  it("every merchant-read status other than Stripe's two disown answers is inconclusive", async () => {
    // The pinned platform answers the platform check, so every status below reaches the merchant
    // read's classifier. A widening that covers one of these answers fails this test, for example a 401
    // under invalid_request_error, or a 404 under a code other than Stripe's two. A refused platform
    // check is the next test's subject.
    const cases: Array<[number, unknown]> = [
      [400, { error: { type: "invalid_request_error", code: "parameter_invalid_empty" } }],
      [401, { error: { type: "invalid_request_error", code: "api_key_expired" } }],
      [401, { error: { type: "authentication_error", message: "Invalid API Key provided" } }],
      [402, { error: { type: "card_error", code: "card_declined" } }],
      [404, { error: { type: "invalid_request_error", code: "url_invalid" } }],
      [409, { error: { type: "idempotency_error" } }],
      [429, { error: { type: "rate_limit_error", code: "rate_limit" } }],
      [500, { error: { type: "api_error" } }],
      [502, {}],
      [503, { error: { type: "api_error" } }],
      // The two disown codes under the WRONG status or the WRONG type: each would be credentials_invalid if the
      // classifier checked the code alone (the type check, or the status check, deleted), so each is a negative.
      [400, { error: { type: "invalid_request_error", code: "account_invalid" } }],
      [401, { error: { type: "invalid_request_error", code: "account_invalid" } }],
      [429, { error: { type: "invalid_request_error", code: "account_invalid" } }],
      [500, { error: { type: "invalid_request_error", code: "account_invalid" } }],
      [403, { error: { type: "invalid_request_error", code: "resource_missing" } }],
      [403, { error: { type: "api_error", code: "account_invalid" } }],
      [404, { error: { type: "api_error", code: "resource_missing" } }],
    ];
    for (const [status, body] of cases) {
      const connect = connectMerchant(() => stripeJson(body, status));
      await expect(
        connect.inspectConnection("acct_test00000001"),
        `status ${status} ${JSON.stringify(body)} must be inconclusive`,
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

  it("the platform pin needs the pinned id AND the account object, never the id alone", async () => {
    // The object check on the platform answer is the only thing that refuses a customer that carries the
    // platform's id. Without it, the pin passes and the merchant read below succeeds, so the key is taken to
    // be the platform on the strength of an id alone.
    for (const body of [
      { object: "customer", id: PLATFORM },
      { object: "account", id: "acct_someoneelse01" },
    ]) {
      const connect = connectFor({
        secretKey: SECRET,
        platformAccountId: PLATFORM,
        apiBase: "https://api.stripe.test",
        fetchImpl: (async (input: RequestInfo | URL) =>
          String(input).endsWith("/v1/account")
            ? stripeJson(body, 200)
            : stripeJson(
                { object: "account", id: "acct_test00000001", charges_enabled: true, payouts_enabled: true, details_submitted: true },
                200,
              )) as unknown as typeof fetch,
      });
      await expect(connect.inspectConnection("acct_test00000001"), JSON.stringify(body)).rejects.toMatchObject({
        code: "PROVIDER_UNAVAILABLE",
      });
    }
  });

  it("an outage during beginConnection creates nothing", async () => {
    const { fake, connect } = harness();
    fake.armServerError();
    await expect(begin(connect)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.accounts()).toHaveLength(0);
  });

  it("a 200 from account creation with a header-safe id that is not an account is PROVIDER_UNAVAILABLE, and no link is requested", async () => {
    // The reference passes the header-safety floor, so only the account check refuses it. Without that check
    // the adapter would ask for an onboarding link for a reference that is not a Stripe account.
    const paths: string[] = [];
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path === "/v1/account") return platformAnswer();
        if (path === "/v1/accounts") return stripeJson({ object: "account", id: "mch_platform0001" }, 200);
        throw new Error(`unexpected request to ${path}`);
      }) as unknown as typeof fetch,
    });
    await expect(begin(connect)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(paths, "no onboarding link is requested").not.toContain("/v1/account_links");
  });

  it("a 200 from account creation with no account id is PROVIDER_UNAVAILABLE, and no link is requested", async () => {
    // A provider fault, not an unverifiable reference (which the API answers as NOT_AVAILABLE).
    // Nothing is handed to the owner, so no onboarding link is asked for.
    const paths: string[] = [];
    const connect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        return path === "/v1/account" ? platformAnswer() : stripeJson({}, 200);
      }) as unknown as typeof fetch,
    });
    await expect(begin(connect, "no-account-id-key-01")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(paths).toEqual(["/v1/account", "/v1/accounts"]);
  });
});

describe("an outage on the MERCHANT read is inconclusive, and the outage is the request that fails", () => {
  // Each outage is scoped to the one merchant path, so the platform check cannot be the request
  // that fails. The outage count proves the merchant read was the request that was hit.
  it("a 500 on the merchant read throws PROVIDER_UNAVAILABLE and yields no snapshot", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.armServerError(1, { method: "GET", path: `/v1/accounts/${handoff.handoffId}` });
    const failure = await connect.inspectConnection(handoff.handoffId).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((failure as Error).message).toContain("account read failed (500)");
    expect(fake.outagesServed()).toBe(1);
  });

  it("a 429 on the merchant read is equally inconclusive", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.armRateLimit(1, { method: "GET", path: `/v1/accounts/${handoff.handoffId}` });
    const failure = await connect.inspectConnection(handoff.handoffId).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((failure as Error).message).toContain("account read failed (429)");
    expect(fake.outagesServed()).toBe(1);
  });
});

describe("the observation time is stamped when Stripe's answer arrives", () => {
  it("observedAt is at least 40 ms after the read began, when the merchant answer takes 60 ms", async () => {
    // The stamp is taken after the answer. A stamp taken before the call would sit at the start
    // of the read, and this lower bound would fail. Lower bound only: nothing says how late is wrong.
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fake.fetchImpl(input, init);
      if (new URL(String(input)).pathname.startsWith("/v1/accounts/")) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return res;
    }) as unknown as typeof fetch;
    const slowConnect = connectFor({
      secretKey: SECRET,
      platformAccountId: PLATFORM,
      apiBase: "https://api.stripe.test",
      fetchImpl: slow,
    });
    const started = Date.now();
    const snapshot = await slowConnect.inspectConnection(handoff.handoffId);
    expect(Date.parse(snapshot.observedAt) - started).toBeGreaterThanOrEqual(40);
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

  // WHAT THIS TEST CATCHES. The disowned snapshot is a literal parsed by a .strict() schema. A
  // closed field (blockedReason, an enum) rejects any value it does not know, so a mutation that
  // wrote Stripe's text there makes the parse throw; that catch belongs to the schema, not to this
  // test. `provider` is NOT closed: it is z.string().min(1), so a one-word value such as an error
  // code passes the parse. The provider equality below is what catches that. The regex catches
  // only Stripe's two known phrases, anywhere in the serialised snapshot. It is not a general
  // check on prose.
  it("the disowned snapshot carries the exact configured provider label and neither of Stripe's two phrases", async () => {
    const { fake, connect } = harness();
    const handoff = await begin(connect);
    fake.disownAccount(handoff.handoffId);
    const snapshot = await connect.inspectConnection(handoff.handoffId);
    expect(snapshot.provider).toBe("stripe_connect_test");
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

  it("calls no Stripe endpoint that could take a merchant offline or move money", () => {
    const src = readSource();
    for (const path of [
      "/deauthorize",
      "/reject",
      "/capabilities",
      "/payouts",
      "/v1/payouts",
      "/v1/payment_intents",
      "/v1/refunds",
      "/v1/transfers",
      "/v1/charges",
      "external_accounts",
    ]) {
      expect(src, `must not call ${path}`).not.toContain(path);
    }
  });

  it("only ever POSTs to account creation and account links, each with a literal method and path", () => {
    // Template literals COUNT. This used to require a double-quoted path, and a review proved the
    // hole by adding `call(`/v1/accounts/${id}`, {method: "POST"})` -- Stripe's Update-an-Account
    // endpoint, a write against a live connected account -- which all three guards missed. The
    // guard now counts EVERY call() site, so a site whose path or method is a variable is counted
    // and refused, rather than invisible.
    const { invocations, literal } = requestSites(readSource());
    const posts = literal.filter((s) => s.startsWith("POST "));
    expect(posts.length, "the guard must find the POSTs it is checking").toBeGreaterThan(0);
    expect(literal.length, "every call() must name a literal method and a literal path").toBe(invocations);
    expect(new Set(posts)).toEqual(new Set(["POST /v1/accounts", "POST /v1/account_links"]));
  });

  it("every call() in the file is one of the four known request shapes, and fetch has one funnel", () => {
    // The positive form of the guard above: enumerate EVERY call() site, so a new one cannot be
    // invisible merely by not matching a denylist. The fourth is the platform's own account, read
    // to confirm the pin before every operation; it is a GET. Stripe is reached through one fetch
    // call, the one inside call(), so no site can bypass the failure taxonomy or the auth header.
    const src = readSource();
    const { invocations, literal } = requestSites(src);
    expect(invocations).toBe(4);
    expect(literal).toHaveLength(4);
    expect(new Set(literal)).toEqual(
      new Set(["GET /v1/account", "GET /v1/accounts/{}", "POST /v1/accounts", "POST /v1/account_links"]),
    );
    const fetches = [...src.matchAll(/(?<![\w.])(?:doFetch|fetch)\s*\(/g)].length;
    expect(fetches, "one fetch call, inside call()").toBe(1);
    expect(src).toMatch(/doFetch\(\s*`\$\{apiBase\}\$\{path\}`/);
    // No alias either: the request function and the fetch are named only where they are called
    // or declared. A `const send = call;` or `const f = fetch;` would hide a site from the counts.
    expect([...src.matchAll(/(?<!function\s+)\bcall\b(?!\s*\()/g)], "call is only ever called").toHaveLength(0);
    expect([...src.matchAll(/(?<!const\s+)\bdoFetch\b(?!\s*\()/g)], "doFetch is only ever called").toHaveLength(0);
    // Every name of the global fetch, including a member access such as globalThis.fetch( that the regexes
    // above exclude. It is named once, as the funnel's default; a second use is a second request path.
    expect(
      [...src.matchAll(/(?<!typeof\s+)\bfetch\b/g)],
      "the global fetch is named once, as the funnel's default; no second request path",
    ).toHaveLength(1);
    // The injected transport is named twice: its declared type and its default in the funnel. A call such as
    // opts.fetchImpl!( adds a third name, which is a request path the guard above would not otherwise count.
    expect([...src.matchAll(/\bfetchImpl\b/g)], "the injected transport is named once in the type and once in the funnel").toHaveLength(2);
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

/**
 * Every request site the adapter can make, read from its source. A site is found by its `call(`
 * text, so one whose path or method is a variable is still COUNTED. `invocations` counts every
 * call( except the function's own declaration. `literal` lists the METHOD and path of each site
 * whose path is a literal string and whose method is a literal first property. A site in
 * `invocations` but not in `literal` is one the guard cannot read, and the tests refuse it.
 */
function requestSites(src: string): { invocations: number; literal: string[] } {
  const invocations = [...src.matchAll(/(?<!function\s+)\bcall\s*\(/g)].length;
  const literal = [...src.matchAll(/\bcall\s*\(\s*[`"](\/v1\/[^`"]*)[`"]\s*,\s*\{\s*method:\s*"(GET|POST)"/g)].map(
    (m) => `${m[2]} ${(m[1] ?? "").replace(/\$\{[^}]*\}/g, "{}")}`,
  );
  return { invocations, literal };
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

describe("the stand-in replays keyed requests the way Stripe does", () => {
  const INTENTS = "https://api.stripe.test/v1/payment_intents";
  const ACCOUNTS = "https://api.stripe.test/v1/accounts";
  const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
  const keyed = (body: string, key: string): RequestInit => ({
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": key,
    },
    body,
  });

  it("a keyed PaymentIntent replay answers the object as it was created, and a changed copy cannot reach the store", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_replay" });
    const body = "amount=12600&currency=usd&metadata[bookingId]=b-replay-1";
    const created = await (await fake.fetchImpl(INTENTS, keyed(body, "replay-copy-key-01"))).json();
    fake.drive(created.id, "succeeded");

    // The replay is what Stripe returns for the same request: the object as it was created.
    const replayed = await (await fake.fetchImpl(INTENTS, keyed(body, "replay-copy-key-01"))).json();
    expect(replayed.id).toBe(created.id);
    expect(replayed.status).toBe("requires_payment_method");
    expect(fake.getIntent(created.id)!.status).toBe("succeeded");

    // The replayed object is the caller's own copy: changing it reaches neither the store nor a later replay.
    replayed.status = "canceled";
    replayed.amount = 1;
    replayed.metadata.injected = "1";
    const again = await (await fake.fetchImpl(INTENTS, keyed(body, "replay-copy-key-01"))).json();
    expect(again.amount).toBe(12600);
    expect(again.metadata.injected).toBeUndefined();
    expect(fake.getIntent(created.id)!.amount).toBe(12600);
    expect(fake.intents()).toHaveLength(1);
  });

  it("a keyed account creation replayed with DIFFERENT parameters is refused with idempotency_error", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_replay", platformAccountId: PLATFORM });
    const create = (tenant: string) =>
      keyed(
        new URLSearchParams({ type: "standard", country: "US", "metadata[tenantId]": tenant }).toString(),
        "account-params-key-1",
      );
    const first = await fake.fetchImpl(ACCOUNTS, create(TENANT));
    expect(first.status).toBe(200);
    const original = await first.json();

    const changed = await fake.fetchImpl(ACCOUNTS, create(OTHER_TENANT));
    expect(changed.status).toBe(400);
    expect(await changed.json()).toMatchObject({ error: { type: "idempotency_error" } });
    expect(fake.accounts()).toHaveLength(1);

    // The same parameters are a replay of the original account, not a refusal.
    const same = await fake.fetchImpl(ACCOUNTS, create(TENANT));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ id: original.id });
  });

  it("a second tenant that reuses an account key is refused, and is not handed the first tenant's account", async () => {
    const fake = createFakeStripe({ webhookSecret: "whsec_replay", platformAccountId: PLATFORM });
    const adapter = () =>
      connectFor({ secretKey: SECRET, platformAccountId: PLATFORM, apiBase: "https://api.stripe.test", fetchImpl: fake.fetchImpl });
    const handoff = await begin(adapter(), "shared-tenant-key-01");
    await expect(
      adapter().beginConnection({ tenantId: OTHER_TENANT, ...URLS, idempotencyKey: "shared-tenant-key-01" }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.accounts()).toHaveLength(1);
    expect(fake.accounts()[0]!.id).toBe(handoff.handoffId);
  });
});
