/**
 * The same structural guarantee for the richer merchant contract: an adapter may
 * DECLARE that its provider supports partial refunds (a fact about the provider)
 * and must still expose no operation for issuing one (permission this system does
 * not have). See packages/adapters/test/noRefundPrimitive.test.ts.
 */

import { describe, expect, it } from "vitest";
import { createMockMerchantProviderA, createMockMerchantProviderB } from "../src/mocks";

const ISSUING = ["refund", "partialRefund", "createRefund", "issueRefund", "refundCharge", "reverse"];

function members(value: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  }
  return [...names];
}

describe("no refund primitive exists on any merchant payment adapter", () => {
  for (const [name, adapter] of [
    ["merchant mock A", createMockMerchantProviderA()],
    ["merchant mock B", createMockMerchantProviderB()],
  ] as Array<[string, object]>) {
    it(`${name} exposes no refund-issuing member`, () => {
      expect(members(adapter).filter((m) => ISSUING.includes(m))).toEqual([]);
    });
  }

  it("provider B still declares its provider's partial-refund support", () => {
    expect(createMockMerchantProviderB().capability.supportsPartialRefund).toBe(true);
  });
});
