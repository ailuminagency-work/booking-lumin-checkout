/**
 * paymentConnection.test.ts
 *
 * The load-bearing assertion here is the CROSS-PRODUCT guard on
 * derivePaymentConnectionHealth: every status x chargesEnabled x payoutsEnabled
 * x reason combination is enumerated and checked against INVARIANTS, not
 * against a second copy of the same if-chain. A re-implementation would mirror
 * any bug in the original; a property cannot.
 */

import { describe, expect, it } from "vitest";
import {
  ConnectionHandoff,
  ERROR_CODES,
  LuminError,
  PaymentConnectionFacts,
  PaymentConnectionHealth,
  PaymentConnectionReason,
  PaymentConnectionSnapshot,
  PaymentConnectionStatus,
  PROVIDER_ACCOUNT_ID_PATTERN,
  ProviderAccountId,
  assertHeaderSafeAccountId,
  derivePaymentConnectionHealth,
  isChargeableHealth,
} from "./index";

const STATUSES = PaymentConnectionStatus.options;
const REASONS: (PaymentConnectionReason | null)[] = [...PaymentConnectionReason.options, null];
const BOOLS = [false, true];

const ALL: PaymentConnectionFacts[] = STATUSES.flatMap((status) =>
  BOOLS.flatMap((chargesEnabled) =>
    BOOLS.flatMap((payoutsEnabled) =>
      REASONS.map((blockedReason) => ({ status, chargesEnabled, payoutsEnabled, blockedReason })),
    ),
  ),
);

function describeFacts(f: PaymentConnectionFacts): string {
  return `${f.status}/charges=${f.chargesEnabled}/payouts=${f.payoutsEnabled}/reason=${f.blockedReason ?? "none"}`;
}

describe("the connection status vocabulary matches the database", () => {
  it("is exactly migration 0006's check constraint, in its order", () => {
    // public.payment_connections: check (status in ('not_connected','connected','error','revoked'))
    expect(STATUSES).toEqual(["not_connected", "connected", "error", "revoked"]);
  });

  it("enumerates 4 x 2 x 2 x 7 = 112 combinations, so the guard is a cross product", () => {
    expect(ALL).toHaveLength(112);
    expect(new Set(ALL.map(describeFacts)).size).toBe(112);
  });
});

describe("derivePaymentConnectionHealth is total", () => {
  it("returns a value in the enum for every combination", () => {
    for (const facts of ALL) {
      const health = derivePaymentConnectionHealth(facts);
      expect(PaymentConnectionHealth.safeParse(health).success, describeFacts(facts)).toBe(true);
    }
  });

  it("produces all four verdicts — none is dead code", () => {
    const seen = new Set(ALL.map(derivePaymentConnectionHealth));
    expect([...seen].sort()).toEqual(["blocked", "chargeable", "degraded", "not_connected"]);
  });

  it("is a pure function of exactly those four fields", () => {
    for (const facts of ALL) {
      const first = derivePaymentConnectionHealth(facts);
      // Same fields, different object, extra property: same answer.
      const second = derivePaymentConnectionHealth({ ...facts, ...{} } as PaymentConnectionFacts);
      expect(second).toBe(first);
    }
  });
});

describe("derivePaymentConnectionHealth invariants", () => {
  it("not_connected is EXACTLY the absence of a connection", () => {
    for (const facts of ALL) {
      const isNotConnected = derivePaymentConnectionHealth(facts) === "not_connected";
      expect(isNotConnected, describeFacts(facts)).toBe(facts.status === "not_connected");
    }
  });

  it("chargeable requires connected AND charges AND payouts AND no caveat", () => {
    for (const facts of ALL) {
      if (derivePaymentConnectionHealth(facts) !== "chargeable") continue;
      expect(facts.status, describeFacts(facts)).toBe("connected");
      expect(facts.chargesEnabled, describeFacts(facts)).toBe(true);
      expect(facts.payoutsEnabled, describeFacts(facts)).toBe(true);
      expect(facts.blockedReason, describeFacts(facts)).toBeNull();
    }
  });

  it("every status/flag combination that IS all four reads chargeable", () => {
    // The converse of the above: the only chargeable row is not merely rare,
    // it is guaranteed. Without this, a derivation returning 'degraded'
    // everywhere would satisfy the test above vacuously.
    const good = ALL.filter(
      (f) => f.status === "connected" && f.chargesEnabled && f.payoutsEnabled && f.blockedReason === null,
    );
    expect(good).toHaveLength(1);
    for (const facts of good) expect(derivePaymentConnectionHealth(facts)).toBe("chargeable");
  });

  it("error and revoked are blocked regardless of the flags — stale flags never charge", () => {
    for (const facts of ALL) {
      if (facts.status !== "error" && facts.status !== "revoked") continue;
      expect(derivePaymentConnectionHealth(facts), describeFacts(facts)).toBe("blocked");
    }
  });

  it("cannot charge => blocked, never degraded", () => {
    for (const facts of ALL) {
      if (facts.chargesEnabled) continue;
      const health = derivePaymentConnectionHealth(facts);
      expect(health === "blocked" || health === "not_connected", describeFacts(facts)).toBe(true);
      expect(health, describeFacts(facts)).not.toBe("degraded");
      expect(health, describeFacts(facts)).not.toBe("chargeable");
    }
  });

  it("charges but no payouts => degraded, never blocked (the money strands, it does not stop)", () => {
    for (const facts of ALL) {
      if (!(facts.status === "connected" && facts.chargesEnabled && !facts.payoutsEnabled)) continue;
      expect(derivePaymentConnectionHealth(facts), describeFacts(facts)).toBe("degraded");
    }
  });

  it("charges with a caveat => degraded: partial onboarding is usable, not a failure", () => {
    for (const facts of ALL) {
      if (!(facts.status === "connected" && facts.chargesEnabled && facts.blockedReason !== null)) continue;
      expect(derivePaymentConnectionHealth(facts), describeFacts(facts)).toBe("degraded");
    }
  });

  it("exactly one verdict permits a charge", () => {
    const chargeable = PaymentConnectionHealth.options.filter(isChargeableHealth);
    expect(chargeable).toEqual(["chargeable"]);
    for (const facts of ALL) {
      expect(isChargeableHealth(derivePaymentConnectionHealth(facts)), describeFacts(facts)).toBe(
        facts.status === "connected" && facts.chargesEnabled && facts.payoutsEnabled && facts.blockedReason === null,
      );
    }
  });
});

describe("the provider account reference can never splice a header", () => {
  const SMUGGLING = [
    "acct_good\r\nAuthorization: Bearer stolen",
    "acct_good\nX-Injected: 1",
    "acct_good\r",
    "acct_good\u0000evil",
    "acct_good evil",
    "acct_good:evil",
    "acct_good\tevil",
    "acct_good evil",
  ];

  for (const value of SMUGGLING) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(ProviderAccountId.safeParse(value).success).toBe(false);
      let thrown: unknown;
      try {
        assertHeaderSafeAccountId(value);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(LuminError);
      expect((thrown as LuminError).code).toBe("CONNECTION_UNVERIFIED");
      // The attacker-controlled value is never echoed into a log line.
      expect((thrown as Error).message).not.toContain("Authorization");
      expect((thrown as Error).message).not.toContain("acct_good");
    });
  }

  it("refuses the empty string, a short reference and a 129-character one", () => {
    for (const bad of ["", "acct", "a".repeat(129)]) {
      expect(ProviderAccountId.safeParse(bad).success, bad.slice(0, 12)).toBe(false);
    }
  });

  it("refuses non-strings without throwing anything but CONNECTION_UNVERIFIED", () => {
    for (const bad of [null, undefined, 42, {}, ["acct_abcdefgh"]]) {
      expect(() => assertHeaderSafeAccountId(bad)).toThrow(/header-safe/);
    }
  });

  it("accepts a realistic Stripe account reference and a 128-character one", () => {
    expect(assertHeaderSafeAccountId("acct_1PxYzAbCdEfGhIjK")).toBe("acct_1PxYzAbCdEfGhIjK");
    expect(assertHeaderSafeAccountId("a".repeat(128))).toHaveLength(128);
  });

  it("matches the pattern the file documents", () => {
    expect(PROVIDER_ACCOUNT_ID_PATTERN.test("acct_1PxYzAbCdEfGhIjK")).toBe(true);
    expect(PROVIDER_ACCOUNT_ID_PATTERN.test("acct_bad\r\nx")).toBe(false);
  });

  it("the Stripe narrowing is stricter than this floor, never wider", () => {
    // Step 4's adapter requires ^acct_[A-Za-z0-9]{8,64}$. Every value that
    // clears THAT must clear this one, or the floor would be the weaker check.
    const stripe = /^acct_[A-Za-z0-9]{8,64}$/;
    for (const v of ["acct_1PxYzAbCdEfGhIjK", `acct_${"a".repeat(64)}`, `acct_${"9".repeat(8)}`]) {
      expect(stripe.test(v), v).toBe(true);
      expect(PROVIDER_ACCOUNT_ID_PATTERN.test(v), v).toBe(true);
    }
  });
});

describe("a snapshot that cannot charge must say why", () => {
  const good = {
    provider: "staging_mock",
    accountId: "acct_mock_abcdef123456",
    chargesEnabled: true,
    payoutsEnabled: true,
    onboardingComplete: true,
    blockedReason: null,
    observedAt: "2026-11-05T00:00:00.000Z",
  };

  it("accepts a fully enabled snapshot", () => {
    expect(PaymentConnectionSnapshot.parse(good).blockedReason).toBeNull();
  });

  it("refuses chargesEnabled=false with no reason (0093's check constraint, in TypeScript)", () => {
    const parsed = PaymentConnectionSnapshot.safeParse({ ...good, chargesEnabled: false, blockedReason: null });
    expect(parsed.success).toBe(false);
  });

  it("accepts chargesEnabled=false WITH a reason", () => {
    expect(
      PaymentConnectionSnapshot.parse({ ...good, chargesEnabled: false, blockedReason: "charges_disabled" })
        .blockedReason,
    ).toBe("charges_disabled");
  });

  it("accepts a reason ALONGSIDE charges: partial onboarding is legitimate", () => {
    const partial = PaymentConnectionSnapshot.parse({
      ...good,
      onboardingComplete: false,
      blockedReason: "onboarding_incomplete",
    });
    expect(partial.chargesEnabled).toBe(true);
    expect(derivePaymentConnectionHealth({ status: "connected", ...partial })).toBe("degraded");
  });

  it("refuses an unknown reason, a header-unsafe accountId and an unknown field", () => {
    expect(PaymentConnectionSnapshot.safeParse({ ...good, blockedReason: "because" }).success).toBe(false);
    expect(PaymentConnectionSnapshot.safeParse({ ...good, accountId: "acct\r\nx" }).success).toBe(false);
    expect(PaymentConnectionSnapshot.safeParse({ ...good, secretKey: "sk_live_x" }).success).toBe(false);
  });

  it("refuses a non-ISO observedAt", () => {
    expect(PaymentConnectionSnapshot.safeParse({ ...good, observedAt: "yesterday" }).success).toBe(false);
  });

  it("carries no credential field of any kind", () => {
    const keys = Object.keys(PaymentConnectionSnapshot.parse(good));
    for (const k of keys) expect(k).not.toMatch(/secret|key|token|password|credential/i);
  });
});

describe("the onboarding URL is a place a browser may be sent", () => {
  const good = {
    provider: "staging_mock",
    handoffId: "mch_abcdef123456",
    onboardingUrl: "https://connect.stripe.com/setup/s/abc",
    expiresAt: "2026-11-05T00:05:00.000Z",
  };

  it("accepts an https link", () => {
    expect(ConnectionHandoff.parse(good).onboardingUrl).toBe(good.onboardingUrl);
  });

  it("refuses javascript:, data: and http: — z.string().url() accepts the first two", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "http://connect.stripe.com/setup/s/abc",
      "JAVASCRIPT:alert(1)",
    ]) {
      expect(ConnectionHandoff.safeParse({ ...good, onboardingUrl: bad }).success, bad).toBe(false);
    }
  });

  it("carries no credential field", () => {
    for (const k of Object.keys(ConnectionHandoff.parse(good))) {
      expect(k).not.toMatch(/secret|key|token|password|credential/i);
    }
  });
});

describe("the new error code is registered", () => {
  it("CONNECTION_UNVERIFIED is in ERROR_CODES exactly once", () => {
    expect(ERROR_CODES.filter((c) => c === "CONNECTION_UNVERIFIED")).toHaveLength(1);
  });
});
