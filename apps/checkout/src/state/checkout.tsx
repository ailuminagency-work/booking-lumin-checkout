import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type {
  Address,
  BookingRecord,
  CustomerDetails,
  Selection,
  Service,
  Slot,
} from "@lumin/contracts";
import { emptyCustomerDraft, hasConfiguration, type CustomerDraft } from "./validation";

export type Step =
  | "service"
  | "configure"
  | "summary"
  | "slot"
  | "customer"
  | "payment"
  | "confirmation";

export const STEP_ORDER: readonly Step[] = [
  "service",
  "configure",
  "summary",
  "slot",
  "customer",
  "payment",
  "confirmation",
];

export type PaymentStatus = "idle" | "working" | "failed" | "succeeded";

export interface StepMessage {
  step: Step;
  text: string;
}

export interface CheckoutState {
  step: Step;
  selection: Selection | null;
  slot: Slot | null;
  customerDraft: CustomerDraft;
  customer: CustomerDetails | null;
  address: Address | null;
  /** Steps where the user pressed Continue while invalid → show inline errors. */
  attempted: Partial<Record<Step, boolean>>;
  /**
   * Stable per-checkout-session key (≥16 chars). Generated ONCE and reused
   * across retries so duplicate submits cannot double-book or double-charge.
   * It only rotates when an already-created booking's request materially
   * changes (new slot/selection), which is a new request — never on a retry.
   */
  idempotencyKey: string;
  booking: BookingRecord | null;
  intentId: string | null;
  paymentStatus: PaymentStatus;
  stepMessage: StepMessage | null;
}

export type CheckoutAction =
  | { type: "SELECT_SERVICE"; service: Service }
  | { type: "SET_SELECTION"; selection: Selection }
  | { type: "SET_SLOT"; slot: Slot }
  | { type: "SET_CUSTOMER_DRAFT"; patch: Partial<CustomerDraft> }
  | { type: "CONFIRM_CUSTOMER"; customer: CustomerDetails; address: Address | null }
  | { type: "GOTO"; step: Step }
  | { type: "ATTEMPT"; step: Step }
  | { type: "BOOKING_CREATED"; booking: BookingRecord }
  | { type: "SET_INTENT"; intentId: string }
  | { type: "PAYMENT_STATUS"; status: PaymentStatus }
  | { type: "PAYMENT_SUCCEEDED"; booking: BookingRecord }
  | { type: "PAYMENT_FAILED"; message: string }
  | { type: "RETURN_TO"; step: Step; message: string; clearSlot?: boolean }
  | { type: "RESET" };

function randomChunk(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** ≥16 chars, unguessable enough for a session idempotency key. */
export function createIdempotencyKey(): string {
  const base =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${randomChunk()}-${randomChunk()}`;
  return `ck-${base}-${randomChunk()}`;
}

export function emptySelection(serviceId: string): Selection {
  return { serviceId, itemQuantities: {}, addonIds: [], answers: {} };
}

export function createFreshState(): CheckoutState {
  return {
    step: "service",
    selection: null,
    slot: null,
    customerDraft: emptyCustomerDraft(),
    customer: null,
    address: null,
    attempted: {},
    idempotencyKey: createIdempotencyKey(),
    booking: null,
    intentId: null,
    paymentStatus: "idle",
    stepMessage: null,
  };
}

/**
 * Discard any in-flight booking/payment because the request is changing.
 * If a booking was ALREADY created under the current key, the key must
 * rotate — otherwise idempotent creation would resurrect the stale booking
 * for the old slot/selection. If nothing was created yet, the key is kept
 * (retries and slot-unavailable recoveries reuse it, by design).
 */
function invalidateBooking(state: CheckoutState): Pick<
  CheckoutState,
  "booking" | "intentId" | "paymentStatus" | "idempotencyKey"
> {
  return {
    booking: null,
    intentId: null,
    paymentStatus: "idle",
    idempotencyKey: state.booking != null ? createIdempotencyKey() : state.idempotencyKey,
  };
}

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case "SELECT_SERVICE": {
      const nextStep: Step = hasConfiguration(action.service) ? "configure" : "summary";
      if (state.selection?.serviceId === action.service.id) {
        // Same service re-chosen: keep configuration and slot.
        return { ...state, step: nextStep, stepMessage: null };
      }
      return {
        ...state,
        step: nextStep,
        selection: emptySelection(action.service.id),
        slot: null,
        attempted: {},
        stepMessage: null,
        ...invalidateBooking(state),
      };
    }
    case "SET_SELECTION":
      // Stale-availability guard: any selection change clears the chosen slot.
      return {
        ...state,
        selection: action.selection,
        slot: null,
        ...invalidateBooking(state),
      };
    case "SET_SLOT":
      return {
        ...state,
        slot: action.slot,
        stepMessage: state.stepMessage?.step === "slot" ? null : state.stepMessage,
        ...invalidateBooking(state),
      };
    case "SET_CUSTOMER_DRAFT":
      return { ...state, customerDraft: { ...state.customerDraft, ...action.patch } };
    case "CONFIRM_CUSTOMER": {
      const changed =
        JSON.stringify({ c: state.customer, a: state.address }) !==
        JSON.stringify({ c: action.customer, a: action.address });
      return {
        ...state,
        customer: action.customer,
        address: action.address,
        ...(changed ? invalidateBooking(state) : {}),
      };
    }
    case "GOTO":
      return { ...state, step: action.step, stepMessage: null };
    case "ATTEMPT":
      return { ...state, attempted: { ...state.attempted, [action.step]: true } };
    case "BOOKING_CREATED":
      return { ...state, booking: action.booking };
    case "SET_INTENT":
      return { ...state, intentId: action.intentId };
    case "PAYMENT_STATUS":
      return { ...state, paymentStatus: action.status };
    case "PAYMENT_SUCCEEDED":
      return {
        ...state,
        booking: action.booking,
        paymentStatus: "succeeded",
        step: "confirmation",
        stepMessage: null,
      };
    case "PAYMENT_FAILED":
      return {
        ...state,
        paymentStatus: "failed",
        stepMessage: { step: "payment", text: action.message },
      };
    case "RETURN_TO":
      // Recoverable engine error: same idempotencyKey, no booking was kept.
      return {
        ...state,
        step: action.step,
        stepMessage: { step: action.step, text: action.message },
        slot: action.clearSlot ? null : state.slot,
        booking: null,
        intentId: null,
        paymentStatus: "idle",
      };
    case "RESET":
      return createFreshState();
    default:
      return state;
  }
}

export const PERSIST_KEY = "lumin.checkout.session.v1";

/** Guarded restore: bad/missing/corrupt storage falls back to null. */
export function loadPersistedState(): CheckoutState | null {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutState> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.idempotencyKey !== "string" || parsed.idempotencyKey.length < 16) return null;
    if (!STEP_ORDER.includes(parsed.step as Step)) return null;
    const base = createFreshState();
    return {
      ...base,
      ...parsed,
      idempotencyKey: parsed.idempotencyKey,
      customerDraft: { ...base.customerDraft, ...(parsed.customerDraft ?? {}) },
      // Never restore a mid-flight or failed payment as anything but idle.
      paymentStatus: parsed.paymentStatus === "succeeded" ? "succeeded" : "idle",
      stepMessage: null,
    };
  } catch {
    return null;
  }
}

export function persistState(state: CheckoutState): void {
  try {
    sessionStorage.setItem(PERSIST_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — checkout still works.
  }
}

interface CheckoutContextValue {
  state: CheckoutState;
  dispatch: Dispatch<CheckoutAction>;
}

const CheckoutCtx = createContext<CheckoutContextValue | null>(null);

export function CheckoutProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  /** For tests; production restores from sessionStorage or starts fresh. */
  initialState?: CheckoutState;
}) {
  const [state, dispatch] = useReducer(
    checkoutReducer,
    undefined,
    () => initialState ?? loadPersistedState() ?? createFreshState(),
  );

  useEffect(() => {
    persistState(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <CheckoutCtx.Provider value={value}>{children}</CheckoutCtx.Provider>;
}

export function useCheckout(): CheckoutContextValue {
  const value = useContext(CheckoutCtx);
  if (!value) throw new Error("useCheckout must be used inside <CheckoutProvider>");
  return value;
}
