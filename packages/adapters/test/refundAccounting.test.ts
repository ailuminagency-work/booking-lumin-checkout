/**
 * refundAccounting.test.ts — F4 refund accounting decision logic. Proves
 * interpretRefundEvent (the pure decision the stripe-webhook applies) uses the
 * cumulative amount_refunded — NOT the full charge amount — to distinguish a
 * PARTIAL refund from a FULL one, and yields a STABLE dedupe key so a replayed
 * refund webhook is a no-op.
 */

import { describe, expect, it } from "vitest";
import { interpretRefundEvent } from "../src/stripePayment";

const SERVER_AMOUNT = 12_600; // the authoritative payments.amount (minor units)

/** A charge.refunded event body carrying a Charge object. */
function chargeRefunded(over: {
  amount?: number;
  amountRefunded: number;
  refundIds?: string[];
}) {
  const refunds = (over.refundIds ?? []).map((id, i) => ({ id, object: "refund", amount: i }));
  return {
    id: "evt_1",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        object: "charge",
        amount: over.amount ?? SERVER_AMOUNT,
        amount_refunded: over.amountRefunded,
        payment_intent: "pi_123",
        refunds: { object: "list", data: refunds },
      },
    },
  };
}

describe("F4: partial vs full refund classification", () => {
  it("a PARTIAL refund (amount_refunded < server amount) is NOT fully refunded", () => {
    const out = interpretRefundEvent(chargeRefunded({ amountRefunded: 5_000, refundIds: ["re_a"] }), SERVER_AMOUNT);
    expect(out.isFullyRefunded).toBe(false);
    expect(out.refundedTotal).toBe(5_000); // uses amount_refunded, not the full amount
    expect(out.refundId).toBe("re_a");
  });

  it("a FULL refund (amount_refunded == server amount) IS fully refunded", () => {
    const out = interpretRefundEvent(chargeRefunded({ amountRefunded: SERVER_AMOUNT, refundIds: ["re_a", "re_b"] }), SERVER_AMOUNT);
    expect(out.isFullyRefunded).toBe(true);
    expect(out.refundedTotal).toBe(SERVER_AMOUNT);
    expect(out.refundId).toBe("re_b"); // newest refund id in the list
  });

  it("cumulative over-refund (amount_refunded >= server amount) is treated as full", () => {
    const out = interpretRefundEvent(chargeRefunded({ amountRefunded: SERVER_AMOUNT, refundIds: ["re_x"] }), SERVER_AMOUNT);
    expect(out.isFullyRefunded).toBe(true);
  });

  it("never over-reads the full charge amount as the refund: two partials stay partial until they reach the total", () => {
    const first = interpretRefundEvent(chargeRefunded({ amountRefunded: 6_000, refundIds: ["re_1"] }), SERVER_AMOUNT);
    expect(first.isFullyRefunded).toBe(false);
    const second = interpretRefundEvent(chargeRefunded({ amountRefunded: 12_600, refundIds: ["re_1", "re_2"] }), SERVER_AMOUNT);
    expect(second.isFullyRefunded).toBe(true);
  });
});

describe("F4: dedupe key stability", () => {
  it("a replayed identical charge.refunded yields the SAME refund id (dedupe no-op)", () => {
    const ev = chargeRefunded({ amountRefunded: SERVER_AMOUNT, refundIds: ["re_dup"] });
    const a = interpretRefundEvent(ev, SERVER_AMOUNT);
    const b = interpretRefundEvent(JSON.parse(JSON.stringify(ev)), SERVER_AMOUNT);
    expect(a.refundId).toBe("re_dup");
    expect(b.refundId).toBe(a.refundId);
  });

  it("a bare refund object (refund.created) uses its own id and amount", () => {
    const ev = {
      id: "evt_2",
      type: "refund.created",
      data: { object: { id: "re_solo", object: "refund", amount: SERVER_AMOUNT, payment_intent: "pi_123", status: "succeeded" } },
    };
    const out = interpretRefundEvent(ev, SERVER_AMOUNT);
    expect(out.refundId).toBe("re_solo");
    expect(out.refundedTotal).toBe(SERVER_AMOUNT);
    expect(out.isFullyRefunded).toBe(true);
  });

  it("a missing/absent amount_refunded is not fully refunded (fail-closed on unknown)", () => {
    const ev = { id: "evt_3", type: "charge.refunded", data: { object: { id: "ch_9", object: "charge", amount: SERVER_AMOUNT } } };
    const out = interpretRefundEvent(ev, SERVER_AMOUNT);
    expect(out.refundedTotal).toBeNull();
    expect(out.isFullyRefunded).toBe(false);
  });
});
