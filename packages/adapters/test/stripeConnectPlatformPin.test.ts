/**
 * stripeConnectPlatformPin.test.ts
 *
 * The step-6 repair round's claims about the platform pin and the test-mode key,
 * each checked against the stand-in's REQUEST LOG rather than against the adapter's
 * own account of what it sent:
 *
 *  - a key that is not the pinned platform is refused before any merchant account is
 *    created, read or linked, and the refusal records nothing;
 *  - the platform is confirmed before every operation, so the first request of every
 *    operation is GET /v1/account;
 *  - the adapter refuses a live key, a non-test key, and a test key recorded under the
 *    live label, at construction, with ZERO requests;
 *  - the only requests the connection flow can make are the four it is allowed, and
 *    none of them carries a Stripe-Account header.
 */
import { describe, expect, it } from "vitest";
import { createFakeStripe, type FakeStripe } from "./fakeStripe";
import { createStripeConnectProvider, mapStripeAccountReason } from "../src/stripePaymentConnection";

const SECRET = "sk_test_pinnedplatformkey";
const PLATFORM = "acct_platform000001";
const FOREIGN = "acct_foreignplatform1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const URLS = {
  returnUrl: "https://portal.example.test/connect/return",
  refreshUrl: "https://portal.example.test/connect/refresh",
};

function fakeFor(platformAccountId: string): FakeStripe {
  return createFakeStripe({ webhookSecret: "whsec_pin", platformAccountId });
}

function connectWith(fetchImpl: typeof fetch, secretKey = SECRET) {
  return createStripeConnectProvider({
    secretKey,
    platformAccountId: PLATFORM,
    providerLabel: "stripe_connect_test",
    apiBase: "https://api.stripe.test",
    fetchImpl,
  });
}

/** Arms ONE outage on the first POST to `path`, so the outage lands on that request. */
function armBefore(fake: FakeStripe, path: string): typeof fetch {
  let armed = false;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!armed && String(input).endsWith(path) && (init?.method ?? "GET") === "POST") {
      armed = true;
      fake.armServerError(1);
    }
    return fake.fetchImpl(input, init);
  }) as unknown as typeof fetch;
}

/** The four requests the design allows, by method and path. Anything else is a defect. */
const ALLOWED: Array<[string, RegExp]> = [
  ["POST", /^\/v1\/accounts$/],
  ["POST", /^\/v1\/account_links$/],
  ["GET", /^\/v1\/accounts\/[^/]+$/],
  ["GET", /^\/v1\/account$/],
];

const URL_KEY = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe("a key that is not the pinned platform is refused before any merchant is touched", () => {
  it("begin creates no account when the key belongs to another platform", async () => {
    const fake = fakeFor(FOREIGN);
    const connect = connectWith(fake.fetchImpl);
    await expect(connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "pin-begin-0001" }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.accounts()).toHaveLength(0);
    expect(fake.requests().map(URL_KEY)).toEqual(["GET /v1/account"]);
  });

  it("a read refuses a key that has stopped being the pinned platform, before the merchant is asked about", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(fake.fetchImpl);
    const handoff = await connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "pin-read-0001" });
    fake.setPlatformAccountId(FOREIGN);
    const before = fake.requests().length;
    await expect(connect.resolveConnection(handoff.handoffId)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.requests().slice(before).map(URL_KEY)).toEqual(["GET /v1/account"]);
  });

  it("a fresh link refuses a key that is not the pinned platform, and requests no link", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(fake.fetchImpl);
    const handoff = await connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "pin-link-0001" });
    fake.setPlatformAccountId(FOREIGN);
    const before = fake.requests().length;
    await expect(connect.linkExistingAccount(handoff.handoffId, URLS))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.requests().slice(before).map(URL_KEY)).toEqual(["GET /v1/account"]);
  });
});

describe("the platform is confirmed before every operation, not only before a disowning is recorded", () => {
  it("the first request of every read is the platform check", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(fake.fetchImpl);
    const handoff = await connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "confirm-first-01" });
    for (const read of [
      () => connect.resolveConnection(handoff.handoffId),
      () => connect.inspectConnection(handoff.handoffId),
    ]) {
      const before = fake.requests().length;
      await read();
      const first = fake.requests().slice(before)[0];
      expect(first && URL_KEY(first)).toBe("GET /v1/account");
    }
  });

  it("the whole flow makes only the four allowed requests, and none is aimed at a connected account", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(fake.fetchImpl);
    const handoff = await connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "scope-flow-0001" });
    await connect.resolveConnection(handoff.handoffId);
    await connect.inspectConnection(handoff.handoffId);
    await connect.linkExistingAccount(handoff.handoffId, URLS);
    fake.driveAccount(handoff.handoffId, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null, currently_due: [], past_due: [] },
    });
    await connect.resolveConnection(handoff.handoffId);
    fake.disownAccount(handoff.handoffId);
    await connect.resolveConnection(handoff.handoffId);

    const seen = fake.requests();
    expect(seen.length).toBeGreaterThan(8);
    for (const r of seen) {
      expect(ALLOWED.some(([m, p]) => r.method === m && p.test(r.path)), URL_KEY(r)).toBe(true);
      expect(r.stripeAccount, `${URL_KEY(r)} carries a Stripe-Account header`).toBeNull();
    }
  });
});

describe("this build is test mode only, and the key's mode must match the label", () => {
  // Construction takes no request. The fetch below proves it: any call fails the test.
  const attempt = (secretKey: string, providerLabel: string) => () =>
    createStripeConnectProvider({
      secretKey,
      platformAccountId: PLATFORM,
      providerLabel,
      fetchImpl: (() => {
        throw new Error("no request may be made at construction");
      }) as unknown as typeof fetch,
    });

  it("refuses a live key by name, including one with surrounding whitespace", () => {
    expect(attempt("sk_live_abcdefgh12345678", "stripe_connect_test")).toThrow(/live/);
    expect(attempt(" sk_live_abcdefgh12345678\n", "stripe_connect_test")).toThrow(/live/);
  });

  it("refuses any secret that is not a test-mode secret key", () => {
    for (const key of [
      "rk_test_abcdefgh12345678",
      "pk_test_abcdefgh12345678",
      "sk_test_has_underscores",
      "sk_test_short",
      " sk_test_abcdefgh12345678",
    ]) {
      expect(attempt(key, "stripe_connect_test"), key).toThrow(/sk_test/);
    }
  });

  it("refuses a test key recorded under the live label", () => {
    expect(attempt("sk_test_abcdefgh12345678", "stripe_connect")).toThrow(/_test/);
  });

  it("accepts a test key under a test label", () => {
    expect(attempt("sk_test_abcdefgh12345678", "stripe_connect_test")).not.toThrow();
  });
});

describe("the reason read from Stripe for an owner who never finished", () => {
  it("is onboarding_incomplete, even when Stripe lists past-due items", () => {
    expect(mapStripeAccountReason({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["external_account"],
        past_due: ["individual.verification.document"],
      },
    })).toBe("onboarding_incomplete");
  });

  it("stays requirements_past_due for a merchant who submitted and is now past due", () => {
    expect(mapStripeAccountReason({
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: "requirements.past_due", currently_due: [], past_due: ["external_account"] },
    })).toBe("requirements_past_due");
  });
});

describe("only Stripe's own disowning is a verdict, and a refused redirect is refused before any request", () => {
  /** Answers the platform check as the pinned platform, and every merchant read with what `answer` returns. */
  const merchantAnswers = (answer: () => Response) =>
    connectWith((async (input: RequestInfo | URL) =>
      String(input).endsWith("/v1/account")
        ? new Response(JSON.stringify({ object: "account", id: PLATFORM }), { status: 200 })
        : answer()) as unknown as typeof fetch);
  const body = (value: unknown, status: number) => () =>
    new Response(JSON.stringify(value), { status });

  it("a 403 for a missing resource is an outage, not a disowning", async () => {
    await expect(
      merchantAnswers(body({ error: { type: "invalid_request_error", code: "resource_missing" } }, 403))
        .resolveConnection("acct_merchant00001"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("a 404 with Stripe's account_invalid code is a disowning, once the pin is confirmed", async () => {
    await expect(
      merchantAnswers(body({ error: { type: "invalid_request_error", code: "account_invalid" } }, 404))
        .resolveConnection("acct_merchant00001"),
    ).resolves.toMatchObject({ blockedReason: "credentials_invalid" });
  });

  it("a 404 with no error object is an intermediary, and an outage", async () => {
    await expect(
      merchantAnswers(() => new Response("not found", { status: 404 })).resolveConnection("acct_merchant00001"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("a refresh URL with userinfo is refused before any request is made", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(fake.fetchImpl);
    await expect(connect.beginConnection({
      tenantId: TENANT,
      returnUrl: URLS.returnUrl,
      refreshUrl: "https://user:secret@portal.example.test/f",
      idempotencyKey: "userinfo-refresh-01",
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fake.requests()).toHaveLength(0);
  });
});

describe("a keyed outage is kept, as Stripe keeps it", () => {
  it("a retry with the SAME key replays the 500, so only a NEW key starts a new attempt", async () => {
    const fake = fakeFor(PLATFORM);
    const connect = connectWith(armBefore(fake, "/v1/accounts"));
    await expect(connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "keyed-outage-01" }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    // The outage is exhausted, but Stripe keeps the keyed 500 for the window: the same key still fails.
    await expect(connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "keyed-outage-01" }))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.accounts()).toHaveLength(0);
    // A new key is a new attempt, and it creates the one account.
    const handoff = await connect.beginConnection({ tenantId: TENANT, ...URLS, idempotencyKey: "keyed-outage-02" });
    expect(handoff.onboardingUrl).toMatch(/^https:\/\//);
    expect(fake.accounts()).toHaveLength(1);
  });
});
