import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMoney,
  formatMoney,
  LuminError,
  PaymentError,
  type BookingRecord,
  type CreateBookingRequest,
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
   * Create (or idempotently reuse) the booking and return the exact intent id
   * the engine minted for it. Payment must complete only intents the engine
   * knows about, so confirmation can be verified against the provider — the
   * app never mints its own intents on the side.
   *
   * A prior booking left terminally `failed` (declined payment) is superseded
   * by the engine on this same key (D5): a fresh booking + fresh intent.
   */
  const createBookingAndIntent = useCallback(async (): Promise<{
    booking: BookingRecord;
    intentId: string;
  } | null> => {
    if (!state.selection || !state.slot || !state.customer) return null;
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
      return null;
    }
    const intentId = bookingEngine.intentIdForBooking(booking.id);
    if (!intentId) {
      dispatch({
        type: "PAYMENT_FAILED",
        message: "We couldn't start the payment. Please try again.",
      });
      return null;
    }
    dispatch({ type: "SET_INTENT", intentId });
    return { booking, intentId };
  }, [dispatch, state.address, state.customer, state.idempotencyKey, state.selection, state.slot]);

  /** A live pending booking with a still-completable engine intent, or a fresh one. */
  const ensureUsable = useCallback(async (): Promise<{
    booking: BookingRecord;
    intentId: string;
  } | null> => {
    if (state.booking && state.booking.state === "pending_payment" && state.intentId) {
      const existing = await paymentProvider.getIntent(state.intentId);
      if (existing && existing.state !== "failed") {
        return { booking: state.booking, intentId: state.intentId };
      }
    }
    return createBookingAndIntent();
  }, [createBookingAndIntent, state.booking, state.intentId]);

  const ensureBookingAndIntent = useCallback(async () => {
    if (!state.selection || !state.slot || !state.customer) return;
    dispatch({ type: "PAYMENT_STATUS", status: "working" });
    try {
      const ready = await createBookingAndIntent();
      if (ready) dispatch({ type: "PAYMENT_STATUS", status: "idle" });
    } catch (err) {
      handleEngineError(err);
    }
  }, [createBookingAndIntent, dispatch, handleEngineError, state.customer, state.selection, state.slot]);

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
    if (working) return;
    setWorking(true);
    try {
      const usable = await ensureUsable();
      if (!usable) return; // failure/error already dispatched
      let intent = await paymentProvider.getIntent(usable.intentId);
      if (!intent) throw new PaymentError("PAYMENT_FAILED", "payment intent is no longer available");
      if (intent.state === "requires_payment" || intent.state === "processing") {
        intent = await Promise.resolve(paymentProvider.completePayment(intent.intentId, outcome));
      }

      if (outcome === "failed" || intent.state === "failed") {
        // Verify-and-fail: this drives the engine booking to terminal `failed`,
        // so the next attempt supersedes it under the same key. NEVER confirm.
        try {
          await confirmBookingAfterPayment(intent.intentId);
        } catch {
          // Expected: confirmFromPayment throws PAYMENT_FAILED for a failed intent.
        }
        dispatch({
          type: "BOOKING_CREATED",
          booking: bookingEngine.getBooking(usable.booking.id) ?? usable.booking,
        });
        dispatch({
          type: "PAYMENT_FAILED",
          message: "Your payment was declined (simulated). You have not been charged — try again.",
        });
        return;
      }

      // Confirmation is verified against the provider inside the engine.
      const confirmed = await confirmBookingAfterPayment(intent.intentId);
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
