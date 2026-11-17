import { interpretRefundEvent, shouldIgnoreStalePaymentFailure } from "./stripe.ts";

Deno.test("stale failure events cannot regress terminal payment states", () => {
  for (const state of ["processing", "succeeded", "refunded", "partially_refunded"]) {
    if (!shouldIgnoreStalePaymentFailure(state)) throw new Error(`expected terminal state to be ignored: ${state}`);
  }
});

Deno.test("only requires_payment remains eligible for failure handling", () => {
  if (shouldIgnoreStalePaymentFailure("requires_payment")) {
    throw new Error("requires_payment must remain eligible for failure handling");
  }
  if (shouldIgnoreStalePaymentFailure("failed")) {
    throw new Error("failed is already idempotent and should not be classified as stale");
  }
});

Deno.test("refund event shape distinguishes cumulative Charge totals from bare Refund deltas", () => {
  const charge = interpretRefundEvent({
    type: "charge.refunded",
    data: { object: { object: "charge", amount_refunded: 30, refunds: { data: [{ id: "re_charge" }] } } },
  }, 100);
  if (!charge.isCumulative || charge.refundedTotal !== 30 || charge.refundId !== "re_charge") {
    throw new Error("charge.refunded must expose its cumulative amount and refund id");
  }

  const bare = interpretRefundEvent({
    type: "refund.created",
    data: { object: { object: "refund", id: "re_bare", amount: 70 } },
  }, 100);
  if (bare.isCumulative || bare.refundedTotal !== 70 || bare.refundId !== "re_bare") {
    throw new Error("bare Refund must expose its individual amount and refund id");
  }
});

Deno.test("refund interpretation fails closed when a Charge amount is unavailable", () => {
  const outcome = interpretRefundEvent({
    type: "charge.refunded",
    data: { object: { object: "charge", id: "ch_missing_amount" } },
  }, 100);
  if (outcome.refundedTotal !== null || outcome.isCumulative || outcome.isFullyRefunded) {
    throw new Error("a missing charge refund amount must not be treated as a cumulative full refund");
  }
});

