import { describe, expect, it } from "vitest";
import {
  ProviderCapability,
  providerCapabilities,
  selectProvider,
} from "../src/index";

describe("routing: capability-driven provider selection", () => {
  it("selects A for US/USD card", () => {
    const r = selectProvider({ country: "US", currency: "USD", methodPreference: "card" });
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("mock-merchant-a");
    expect(r.methodSatisfied).toBe(true);
  });

  it("selects B for MX/MXN local_scheme", () => {
    const r = selectProvider({ country: "MX", currency: "MXN", methodPreference: "local_scheme" });
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("mock-merchant-b");
    expect(r.methodSatisfied).toBe(true);
  });

  it("selects B for BR/BRL bank_transfer (A cannot serve LATAM at all)", () => {
    const r = selectProvider({ country: "BR", currency: "BRL", methodPreference: "bank_transfer" });
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("mock-merchant-b");
  });

  it("selects A for EU (DE) / EUR", () => {
    const r = selectProvider({ country: "DE", currency: "EUR" });
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("mock-merchant-a");
  });

  it("respects tenantPreference when that provider can serve the transaction", () => {
    // Both are country/currency-disjoint here, so preference only matters when
    // it is itself a valid candidate. Construct an overlap to prove it wins.
    const overlap: ProviderCapability[] = [
      { ...providerCapabilities[0]!, provider: "prov-x", countries: ["US"], currencies: ["USD"] },
      { ...providerCapabilities[0]!, provider: "prov-y", countries: ["US"], currencies: ["USD"] },
    ];
    const def = selectProvider({ country: "US", currency: "USD" }, overlap);
    expect(def.outcome).toBe("matched");
    if (def.outcome !== "matched") return;
    // Deterministic default is lexicographically-first "prov-x".
    expect(def.provider).toBe("prov-x");

    const pref = selectProvider(
      { country: "US", currency: "USD", tenantPreference: "prov-y" },
      overlap,
    );
    expect(pref.outcome).toBe("matched");
    if (pref.outcome !== "matched") return;
    expect(pref.provider).toBe("prov-y");
  });

  it("ignores tenantPreference that cannot serve the transaction, falling back to capability routing", () => {
    // Prefer A but request MX/MXN — A cannot serve it, so B must be chosen.
    const r = selectProvider({ country: "MX", currency: "MXN", tenantPreference: "mock-merchant-a" });
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("mock-merchant-b");
    expect(r.reason).toContain("mock-merchant-a");
  });

  it("returns NO_PROVIDER (NO_CURRENCY) for an unsupported currency", () => {
    // JPY is served by nobody in the registry.
    const r = selectProvider({ country: "US", currency: "JPY" });
    expect(r.outcome).toBe("no_provider");
    if (r.outcome !== "no_provider") return;
    expect(r.reason).toBe("NO_CURRENCY");
  });

  it("returns NO_PROVIDER (NO_COUNTRY) for an unserved country", () => {
    const r = selectProvider({ country: "JP", currency: "USD" });
    expect(r.outcome).toBe("no_provider");
    if (r.outcome !== "no_provider") return;
    expect(r.reason).toBe("NO_COUNTRY");
  });

  it("returns NO_PROVIDER (NO_METHOD) when no candidate presents the requested method", () => {
    // US/USD is served only by A, which does not present bank_transfer.
    const r = selectProvider({ country: "US", currency: "USD", methodPreference: "bank_transfer" });
    expect(r.outcome).toBe("no_provider");
    if (r.outcome !== "no_provider") return;
    expect(r.reason).toBe("NO_METHOD");
  });

  it("honors transactionGeography as a hard requirement (NO_GEOGRAPHY when unmet)", () => {
    // A serves US/USD, but not the MX transaction geography.
    const r = selectProvider({
      country: "US",
      currency: "USD",
      transactionGeography: "MX",
    });
    expect(r.outcome).toBe("no_provider");
    if (r.outcome !== "no_provider") return;
    expect(r.reason).toBe("NO_GEOGRAPHY");
  });

  it("is a pure function — does not mutate the capabilities array or its records", () => {
    const snapshot = JSON.stringify(providerCapabilities);
    selectProvider({ country: "US", currency: "USD", methodPreference: "card" });
    selectProvider({ country: "MX", currency: "MXN" });
    expect(JSON.stringify(providerCapabilities)).toBe(snapshot);
  });

  it("prefers the more specialized provider on a country/currency tie", () => {
    const caps: ProviderCapability[] = [
      { ...providerCapabilities[0]!, provider: "broad", countries: ["US", "CA", "GB"], currencies: ["USD", "CAD", "GBP"] },
      { ...providerCapabilities[0]!, provider: "narrow", countries: ["US"], currencies: ["USD"] },
    ];
    const r = selectProvider({ country: "US", currency: "USD" }, caps);
    expect(r.outcome).toBe("matched");
    if (r.outcome !== "matched") return;
    expect(r.provider).toBe("narrow");
  });
});
