/**
 * connectionCapability.test.ts
 *
 * Two things are pinned here that policy alone cannot hold:
 *
 *  1. "Do not store a tenant's payment secret" is enforced by the SCHEMA:
 *     `perTenantSecretRequired` is typed `false`, so a capability record that
 *     requires one is unrepresentable. The test proves it is unrepresentable
 *     rather than merely absent.
 *  2. The connection registry and the CHARGE capability registry stay separate.
 *     A later edit that merged them would make every routing decision depend on
 *     onboarding facts; these assertions fail on it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PaymentConnectionCapability,
  connectionCapabilityFor,
  isSimulatedConnectionProvider,
  paymentConnectionCapabilities,
  providerCapabilities,
} from "../src/index";

describe("a per-tenant payment secret is unrepresentable", () => {
  const valid = {
    provider: "example",
    model: "direct_charges" as const,
    perTenantSecretRequired: false as const,
    requiresOwnerHandoff: true,
    supportsAccountInspection: true,
    simulatedMoney: false,
  };

  it("accepts the record with perTenantSecretRequired false", () => {
    expect(PaymentConnectionCapability.parse(valid).perTenantSecretRequired).toBe(false);
  });

  it("REFUSES the same record with perTenantSecretRequired true", () => {
    const parsed = PaymentConnectionCapability.safeParse({ ...valid, perTenantSecretRequired: true });
    expect(parsed.success).toBe(false);
  });

  it("refuses the field being omitted — the registry must state it", () => {
    const { perTenantSecretRequired: _omitted, ...without } = valid;
    expect(PaymentConnectionCapability.safeParse(without).success).toBe(false);
  });

  it("refuses an unknown field, so a credential cannot be smuggled into a record", () => {
    expect(PaymentConnectionCapability.safeParse({ ...valid, secretKey: "sk_live_x" }).success).toBe(false);
    expect(PaymentConnectionCapability.safeParse({ ...valid, apiKey: "x" }).success).toBe(false);
  });

  it("no registered provider requires a tenant secret", () => {
    for (const cap of paymentConnectionCapabilities) {
      expect(cap.perTenantSecretRequired, cap.provider).toBe(false);
    }
  });

  it("the only credential-shaped field is the one that forbids credentials", () => {
    // `perTenantSecretRequired` names a secret in order to refuse one, so it is
    // the single permitted exception; any OTHER such field would be a place a
    // credential could live.
    for (const cap of paymentConnectionCapabilities) {
      const suspects = Object.keys(cap).filter(
        (k) => /secret|key|token|password|credential/i.test(k) && k !== "perTenantSecretRequired",
      );
      expect(suspects, cap.provider).toEqual([]);
    }
  });

  it("no capability VALUE is a credential-shaped string", () => {
    for (const cap of paymentConnectionCapabilities) {
      for (const [key, value] of Object.entries(cap)) {
        if (typeof value !== "string") continue;
        expect(value, `${cap.provider}.${key}`).not.toMatch(/^(sk|rk|pk|whsec)_/);
      }
    }
  });
});

describe("the connection registry", () => {
  it("every entry parses", () => {
    for (const cap of paymentConnectionCapabilities) {
      expect(PaymentConnectionCapability.safeParse(cap).success, cap.provider).toBe(true);
    }
  });

  it("has unique provider labels", () => {
    const labels = paymentConnectionCapabilities.map((c) => c.provider);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("registers the real provider as direct charges, not simulated", () => {
    const stripe = connectionCapabilityFor("stripe_connect");
    expect(stripe).toBeDefined();
    expect(stripe!.model).toBe("direct_charges");
    expect(stripe!.simulatedMoney).toBe(false);
    expect(stripe!.requiresOwnerHandoff).toBe(true);
  });

  it("registers the mock as simulated money", () => {
    const mock = connectionCapabilityFor("staging_mock");
    expect(mock).toBeDefined();
    expect(mock!.model).toBe("simulated");
    expect(mock!.simulatedMoney).toBe(true);
  });

  it("requires an owner handoff for every registered provider", () => {
    // No provider may be connectable without a person. If one ever claims to
    // be, that has to arrive as a reviewable change to this assertion.
    for (const cap of paymentConnectionCapabilities) {
      expect(cap.requiresOwnerHandoff, cap.provider).toBe(true);
    }
  });

  it("answers a lookup miss with undefined", () => {
    expect(connectionCapabilityFor("not-a-provider")).toBeUndefined();
  });
});

describe("isSimulatedConnectionProvider is default-closed", () => {
  it("calls an UNKNOWN provider simulated — the dangerous direction is 'real'", () => {
    expect(isSimulatedConnectionProvider("who-is-this")).toBe(true);
    expect(isSimulatedConnectionProvider("")).toBe(true);
  });

  it("answers the registered providers from the registry", () => {
    expect(isSimulatedConnectionProvider("stripe_connect")).toBe(false);
    expect(isSimulatedConnectionProvider("staging_mock")).toBe(true);
  });

  it("is case-sensitive: a near-miss label is not quietly accepted as real", () => {
    expect(isSimulatedConnectionProvider("Stripe_Connect")).toBe(true);
  });
});

describe("the two registries stay separate", () => {
  it("they are different arrays with no shared entry", () => {
    expect(paymentConnectionCapabilities as unknown).not.toBe(providerCapabilities as unknown);
    for (const conn of paymentConnectionCapabilities) {
      for (const charge of providerCapabilities) {
        expect(conn as unknown).not.toBe(charge as unknown);
      }
    }
  });

  it("the charge registry is untouched: still exactly the two mock merchants", () => {
    expect(providerCapabilities.map((c) => c.provider)).toEqual(["mock-merchant-a", "mock-merchant-b"]);
  });

  it("no connection capability carries a charge-capability field, or the reverse", () => {
    const chargeOnly = ["countries", "currencies", "methods", "supportsAuthCapture", "supportsMarketplace"];
    const connectionOnly = ["model", "perTenantSecretRequired", "requiresOwnerHandoff", "simulatedMoney"];
    for (const conn of paymentConnectionCapabilities) {
      for (const field of chargeOnly) expect(Object.keys(conn), conn.provider).not.toContain(field);
    }
    for (const charge of providerCapabilities) {
      for (const field of connectionOnly) expect(Object.keys(charge), charge.provider).not.toContain(field);
    }
  });

  it("connectionCapability.ts does not import or name the charge registry", () => {
    const src = readFileSync(new URL("../src/connectionCapability.ts", import.meta.url), "utf8");
    const code = src
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toContain("providerCapabilities");
    expect(code).not.toContain("./capability");
    expect(code).not.toContain("capabilityFor(");
  });
});

describe("the registry labels agree with migration 0088", () => {
  // 0088 seeds public.confirmable_payment_providers, which is reused as the
  // connect-time gate. A registry label the migration never seeds would be a
  // provider this deployment can describe but can never record.
  // Comment lines are stripped FIRST. 0088's own prose names both provider
  // labels, so matching the raw file would pass on the comment and say nothing
  // about what the migration actually seeds.
  const sql = readFileSync(
    new URL("../../../supabase/migrations/0088_payment_provider_provenance.sql", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  for (const cap of paymentConnectionCapabilities) {
    it(`0088 seeds ${cap.provider}`, () => {
      expect(sql).toContain(`'${cap.provider}'`);
    });
  }

  it("the real provider is seeded unconditionally and the mock only on a disposable database", () => {
    const guard = sql.indexOf("current_database() ~ '^lumin_'");
    expect(guard).toBeGreaterThan(-1);
    // stripe_connect is seeded BEFORE the disposable-only guard block.
    expect(sql.indexOf("'stripe_connect'")).toBeLessThan(guard);
    // staging_mock only after it, so a hosted database cannot record a mock
    // connection unless someone deliberately bootstrapped the row.
    expect(sql.indexOf("'staging_mock'")).toBeGreaterThan(guard);
  });
});
