import {readFileSync} from "node:fs";
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
  ConnectionHandoffId,
  HANDOFF_ID_PATTERN,
  OnboardingUrl,
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

  it("reads ONLY those four fields — an extra property cannot change the verdict", () => {
    // `{ ...facts, ...{} }` used to stand in for "extra property", which adds
    // nothing, so this could never fail. A review proved the point by adding a
    // hidden fifth input that forces 'chargeable' and watching all 34 tests pass.
    // PaymentConnectionFacts is a STRUCTURAL interface and TypeScript's
    // excess-property check does not apply to a variable of a wider type, so the
    // step-3 reader can hand a database row with extra columns straight in.
    const DECOYS: Record<string, unknown> = {
      overrideChargeable: true,
      health: "chargeable",
      chargeable: true,
      status_override: "connected",
      charges_enabled: true,
      id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "22222222-2222-4222-8222-222222222222",
    };
    for (const facts of ALL) {
      const first = derivePaymentConnectionHealth(facts);
      for (const [key, value] of Object.entries(DECOYS)) {
        const widened = { ...facts, [key]: value } as unknown as PaymentConnectionFacts;
        expect(derivePaymentConnectionHealth(widened), `${describeFacts(facts)} + ${key}`).toBe(first);
      }
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

describe("a handoff reference is header-safe and matches the ledger", () => {
  // The id arrives from a browser and, for Stripe, IS the connected account
  // reference that travels in a `Stripe-Account` request header. The pattern is
  // the same one 0093 puts on payment_connection_handoffs.handoff_id, so an API
  // that accepts one can always store it.
  const good = {
    provider: "staging_mock",
    handoffId: "mch_abcdef123456",
    onboardingUrl: "https://connect.stripe.com/setup/s/abc",
    expiresAt: "2026-11-05T00:05:00.000Z",
  };

  it("accepts the references the adapters actually mint", () => {
    for (const id of ["mch_abcdef123456", "acct_mock_0123456789abcdef01234567", "acct_1PxYzAbCdEfGhIjK", "a.b-c_d12"]) {
      expect(ConnectionHandoffId.safeParse(id).success, id).toBe(true);
    }
  });

  it("refuses anything a header would not carry", () => {
    for (const bad of [
      "acct_000\r\nX-Injected: 1",
      "acct_000\nX-Injected: 1",
      "acct_000 with space",
      "acct_000\tTab",
      "acct/../../etc",
      "acct_000;drop",
      "acct_\u0000null",
      "acct_é00000",
    ]) {
      expect(ConnectionHandoffId.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(ConnectionHandoff.safeParse({ ...good, handoffId: bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a reference the ledger could not store", () => {
    // 8..200, the column constraint exactly. A looser API would accept an id,
    // call a provider with it, and only then fail to record the result.
    expect(ConnectionHandoffId.safeParse("mch_123").success, "7 chars").toBe(false);
    expect(ConnectionHandoffId.safeParse("m".repeat(8)).success, "8 chars").toBe(true);
    expect(ConnectionHandoffId.safeParse("m".repeat(200)).success, "200 chars").toBe(true);
    expect(ConnectionHandoffId.safeParse("m".repeat(201)).success, "201 chars").toBe(false);
    expect(ConnectionHandoffId.safeParse("").success, "empty").toBe(false);
  });

  it("is the SAME check the ledger's column applies", () => {
    // Read the constraint out of the migration rather than restating it: if one
    // side is ever loosened without the other, this fails.
    const sql = readFileSync(
      new URL("../../../supabase/migrations/0093_payment_connection_authority.sql", import.meta.url),
      "utf8",
    );
    const column = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .find((line) => /handoff_id\s+text primary key/.test(line));
    expect(column, "0093 still declares handoff_id").toBeTruthy();
    const pattern = /~ '(\^[^']+\$)'/.exec(column ?? "");
    expect(pattern?.[1]).toBe(HANDOFF_ID_PATTERN.source);
  });
});

describe("OnboardingUrl is one authority, not a check each layer repeats", () => {
  it("is exported so the API receipt uses the same rule as the adapter boundary", () => {
    expect(OnboardingUrl.safeParse("https://connect.stripe.com/s/a").success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://connect.stripe.com/s/a", "not a url"]) {
      expect(OnboardingUrl.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("the new error code is registered", () => {
  it("CONNECTION_UNVERIFIED is in ERROR_CODES exactly once", () => {
    expect(ERROR_CODES.filter((c) => c === "CONNECTION_UNVERIFIED")).toHaveLength(1);
  });
});
