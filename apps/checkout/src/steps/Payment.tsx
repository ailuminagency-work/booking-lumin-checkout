import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMoney,
  formatMoney,
  LuminError,
  PaymentError,
  type BookingRecord,
  type CreateBookingRequest,
  type PaymentIntentRef,
} from "@lumin/contracts";
import { getService, TENANT_ID } from "../config/demoTenant";
import { bookingEngine, confirmBookingAfterPayment, paymentProvider } from "../engines";
import { hasConfiguration } from "../state/validation";
import { useCheckout } from "../state/checkout";

const AVAILABILITY_CODES = new Set([
  "SLOT_UNAVAILABLE",
  "AVAILABILITY_UNVERIFIABLE",
  "LEAD_TIME_VIOLATION",
  "OUTSIDE_BOOKING_HORIZON",
]);

export function Payment() {
  const { state, dispatch } = useCheckout();
  const service = getService(state.selection?.serviceId);
  const startedRef = useRef(false);
  /** Counts fresh intents needed after terminal provider failures. */
  const retrySeq = useRef(0);
  const [working, setWorking] = useState(false);

  const handleEngineError = useCallback(
    (err: unknown) => {
      const code = err instanceof LuminError ? err.code : null;
      if (code && AVAILABILITY_CODES.has(code)) {
        dispatch({
          type: "RETURN_TO",
          step: "slot",
          message: "That time is no longer available. Please choose another time.",
          clearSlot: true,
        });
        return;
      }
      if (code === "INVALID_SELECTION" || code === "INVALID_REQUEST") {
        dispatch({
          type: "RETURN_TO",
          step: service && hasConfiguration(service) ? "configure" : "service",
          message: "Please review your selections — something is no longer valid.",
        });
        return;
      }
      dispatch({
        type: "PAYMENT_FAILED",
        message: "We couldn't complete the payment. You have not been charged — please try again.",
      });
    },
    [dispatch, service],
  );

  /**
   * Get an intent that can still be completed. The mock provider is
   * idempotent per key AND treats a failed intent as terminal, so the first
   * call reuses this session's key; after a declined attempt we derive a new
   * attempt-scoped key (`<sessionKey>:retryN`). The BOOKING idempotency key
   * never changes, and the dead intent can never charge — one charge max.
   */
  const obtainUsableIntent = useCallback(
    async (booking: BookingRecord): Promise<PaymentIntentRef> => {
      const amount = addMoney(booking.pricing.total, booking.pricing.deposit);
      const create = (key: string) =>
        paymentProvider.createIntent({
          tenantId: TENANT_ID,
          bookingId: booking.id,
          amount,
          idempotencyKey: key,
        });
      let intent = await create(state.idempotencyKey);
      let guard = 0;
      while (intent.state === "failed" && guard < 25) {
        retrySeq.current += 1;
        guard += 1;
        intent = await create(`${state.idempotencyKey}:retry${retrySeq.current}`);
      }
      if (intent.state === "failed") {
        throw new PaymentError("PAYMENT_FAILED", "no usable payment intent");
      }
      return intent;
    },
    [state.idempotencyKey],
  );

  /**
   * Idempotent setup: createBooking reuses this session's idempotencyKey, so
   * refreshes and duplicate submits always land on the same booking.
   */
  const ensureBookingAndIntent = useCallback(async () => {
    if (!state.selection || !state.slot || !state.customer) return;
    dispatch({ type: "PAYMENT_STATUS", status: "working" });
    try {
      const request: CreateBookingRequest = {
        tenantId: TENANT_ID,
        idempotencyKey: state.idempotencyKey,
        selection: state.selection,
        slotStart: state.slot.start,
        customer: state.customer,
        ...(state.address ? { address: state.address } : {}),
      };
      const booking = await bookingEngine.createBooking(request);
      dispatch({ type: "BOOKING_CREATED", booking });
      if (booking.state === "failed") {
        dispatch({
          type: "PAYMENT_FAILED",
          message: "The payment provider is unavailable right now. Please try again later.",
        });
        return;
      }
      const intent = await obtainUsableIntent(booking);
      dispatch({ type: "SET_INTENT", intentId: intent.intentId });
      dispatch({ type: "PAYMENT_STATUS", status: "idle" });
    } catch (err) {
      handleEngineError(err);
    }
  }, [dispatch, handleEngineError, obtainUsableIntent, state.address, state.customer, state.idempotencyKey, state.selection, state.slot]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!state.booking || !state.intentId) void ensureBookingAndIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const booking = state.booking;
  const ready = booking != null && state.intentId != null && state.paymentStatus !== "working";
  const chargeAmount = booking ? addMoney(booking.pricing.total, booking.pricing.deposit) : null;

  async function pay(outcome: "succeeded" | "failed") {
    if (!booking || working) return;
    setWorking(true);
    try {
      // Reuse the live intent; replace it only if it's gone or terminally failed.
      let intent = state.intentId ? await paymentProvider.getIntent(state.intentId) : null;
      if (!intent || intent.state === "failed") {
        intent = await obtainUsableIntent(booking);
        dispatch({ type: "SET_INTENT", intentId: intent.intentId });
      }
      if (intent.state === "requires_payment" || intent.state === "processing") {
        intent = await Promise.resolve(paymentProvider.completePayment(intent.intentId, outcome));
      }

      if (outcome === "failed") {
        dispatch({
          type: "PAYMENT_FAILED",
          message: "Your payment was declined (simulated). You have not been charged — try again.",
        });
        return;
      }

      const confirmed = await confirmBookingAfterPayment(booking.id, intent.intentId);
      dispatch({ type: "PAYMENT_SUCCEEDED", booking: confirmed });
    } catch (err) {
      handleEngineError(err);
    } finally {
      setWorking(false);
    }
  }

  if (!state.selection || !state.slot || !state.customer) {
    return (
      <section aria-labelledby="payment-heading">
        <h2 id="payment-heading">Payment</h2>
        <p className="empty">Your checkout session is incomplete.</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => dispatch({ type: "GOTO", step: "service" })}
        >
          Start over
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading">Payment</h2>
      {booking && (
        <p className="muted">
          Booking <strong>{booking.reference}</strong> is reserved — complete payment to confirm it.
        </p>
      )}

      {!booking ? (
        <div aria-hidden="true">
          <div className="skeleton card-skeleton" />
        </div>
      ) : (
        <div className="mock-card">
          <p className="mock-card-brand">Mock payment provider</p>
          <p className="mock-card-number" aria-hidden="true">
            •••• •••• •••• 4242
          </p>
          <p className="muted">This is a simulated payment — no real charge occurs.</p>
          <div className="mock-card-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!ready || working}
              onClick={() => void pay("succeeded")}
            >
              Pay {chargeAmount ? formatMoney(chargeAmount) : ""}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!ready || working}
              onClick={() => void pay("failed")}
            >
              Simulate failure
            </button>
          </div>
          {working && (
            <p role="status" className="muted">
              Processing…
            </p>
          )}
        </div>
      )}

      <div className="wizard-controls">
        <button
          type="button"
          className="btn secondary"
          disabled={working || state.paymentStatus === "working"}
          onClick={() => dispatch({ type: "GOTO", step: "customer" })}
        >
          Back
        </button>
      </div>
    </section>
  );
}
