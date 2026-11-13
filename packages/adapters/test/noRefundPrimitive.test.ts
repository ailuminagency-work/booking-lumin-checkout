/**
 * noRefundPrimitive.test.ts — the structural half of "Booking Lumin never issues
 * a refund".
 *
 * scripts/no-auto-refund-check.sh already fails CI on a call to a provider refund
 * endpoint, but a shell grep can be edited in the same commit that reintroduces
 * the call. These assertions fail instead on the SHAPE of the adapter: it is
 * inspected for a refund-issuing member, prototype chain included, so adding one
 * back breaks a test rather than silently widening what the system can do.
 *
 * What is deliberately NOT asserted: refund RECONCILIATION. Observing a refund
 * someone issued in the provider's own dashboard is allowed, and is tested in
 * refundAccounting.test.ts (interpretRefundEvent) and by the stripe-webhook's
 * charge.refunded path.
 */

import { describe, expect, it } from "vitest";
import { createMockPaymentProvider } from "../src/mockPayment";
import { createStripePaymentProvider } from "../src/stripePayment";
import { createStripeConnectProvider } from "../src/stripePaymentConnection";

/** Member names that would mean "this system can move money back". */
const ISSUING = ["refund", "partialRefund", "createRefund", "issueRefund", "refundCharge", "reverse"];

function members(value: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = value; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
    for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  }
  return [...names];
}

const adapters: Array<[string, object]> = [
  ["mock payment", createMockPaymentProvider()],
  [
    "stripe payment",
    createStripePaymentProvider({
      secretKey: "sk_test_shape_only_no_request_is_made",
      webhookSecret: "whsec_shape_only",
      fetchImpl: () => {
        throw new Error("no request may be made by a shape test");
      },
    }),
  ],
  [
    // The connection adapter moves no money at all, so a refund member on it
    // would be doubly wrong. Asserted rather than assumed.
    "stripe connect",
    createStripeConnectProvider({
      secretKey: "sk_test_shape_only_no_request_is_made",
      platformAccountId: "acct_shapeonlyplatform",
      fetchImpl: () => {
        throw new Error("no request may be made by a shape test");
      },
    }),
  ],
];

describe("no refund primitive exists on any payment adapter", () => {
  for (const [name, adapter] of adapters) {
    it(`${name} exposes no refund-issuing member`, () => {
      const found = members(adapter).filter((m) => ISSUING.includes(m));
      expect(found, `${name} must not expose ${found.join(", ")}`).toEqual([]);
    });

    it(`${name} exposes no other callable whose name means issuing a refund`, () => {
      const suspects = members(adapter).filter(
        (m) =>
          /refund/i.test(m) &&
          typeof (adapter as unknown as Record<string, unknown>)[m] === "function" &&
          // Reading what the provider already refunded is reconciliation.
          !/^(list|get|read|observe|interpret)/i.test(m),
      );
      expect(suspects, `${name} must not expose ${suspects.join(", ")}`).toEqual([]);
    });
  }
});
