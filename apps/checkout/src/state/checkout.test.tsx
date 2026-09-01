import { beforeEach, describe, expect, it } from "vitest";
import type { BookingRecord, Slot } from "@lumin/contracts";
import { cartService, configurableService, TENANT_ID } from "../config/demoTenant";
import {
  checkoutReducer,
  createFreshState,
  emptySelection,
  loadPersistedState,
  PERSIST_KEY,
  persistState,
  type CheckoutState,
} from "./checkout";

const slot: Slot = {
  start: "2026-09-10T14:00:00.000Z",
  end: "2026-09-10T15:30:00.000Z",
  remainingCapacity: 2,
};

function fakeBooking(state: CheckoutState): BookingRecord {
  return {
    id: "9c8b7a6d-5e4f-4a3b-8c2d-606060606006",
    tenantId: TENANT_ID,
    reference: "LMN-TEST01",
    state: "pending_payment",
    selection: state.selection ?? emptySelection(cartService.id),
    pricing: {
      lines: [],
      subtotal: { amount: 14000, currency: "USD" },
      tax: { amount: 1155, currency: "USD" },
      deposit: { amount: 0, currency: "USD" },
      total: { amount: 15155, currency: "USD" },
    },
    slotStart: slot.start,
    slotEnd: slot.end,
    customer: { name: "Test Person", email: "test@example.com" },
    paymentId: null,
    idempotencyKey: state.idempotencyKey,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("checkoutReducer", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("clears the chosen slot when the selection changes (stale-availability guard)", () => {
    let state = createFreshState();
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, { type: "SET_SLOT", slot });
    expect(state.slot).toEqual(slot);

    state = checkoutReducer(state, {
      type: "SET_SELECTION",
      selection: {
        serviceId: cartService.id,
        itemQuantities: { "item-small": 3 },
        addonIds: [],
        answers: {},
      },
    });
    expect(state.slot).toBeNull();
    expect(state.booking).toBeNull();
    expect(state.intentId).toBeNull();
  });

  it("clears the slot when a different service is selected, but keeps it for the same one", () => {
    let state = createFreshState();
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, { type: "SET_SLOT", slot });

    const same = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    expect(same.slot).toEqual(slot);

    const different = checkoutReducer(state, {
      type: "SELECT_SERVICE",
      service: configurableService,
    });
    expect(different.slot).toBeNull();
    expect(different.selection?.serviceId).toBe(configurableService.id);
  });

  it("generates an idempotency key of at least 16 chars, stable across retries", () => {
    let state = createFreshState();
    const key = state.idempotencyKey;
    expect(key.length).toBeGreaterThanOrEqual(16);

    // Retry path 1: payment failed → same key.
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, { type: "SET_SLOT", slot });
    state = checkoutReducer(state, { type: "GOTO", step: "payment" });
    state = checkoutReducer(state, { type: "PAYMENT_FAILED", message: "declined" });
    expect(state.idempotencyKey).toBe(key);

    // Retry path 2: slot lost → returned to slot step, key still reused.
    state = checkoutReducer(state, {
      type: "RETURN_TO",
      step: "slot",
      message: "slot gone",
      clearSlot: true,
    });
    expect(state.idempotencyKey).toBe(key);
    state = checkoutReducer(state, { type: "SET_SLOT", slot });
    expect(state.idempotencyKey).toBe(key);
  });

  it("rotates the key only when an already-created booking's request changes", () => {
    let state = createFreshState();
    const key = state.idempotencyKey;
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, { type: "SET_SLOT", slot });
    state = checkoutReducer(state, { type: "BOOKING_CREATED", booking: fakeBooking(state) });
    expect(state.idempotencyKey).toBe(key);

    // Changing the slot after a booking exists is a NEW request, not a retry.
    state = checkoutReducer(state, {
      type: "SET_SLOT",
      slot: { ...slot, start: "2026-09-11T14:00:00.000Z", end: "2026-09-11T15:30:00.000Z" },
    });
    expect(state.booking).toBeNull();
    expect(state.idempotencyKey).not.toBe(key);
    expect(state.idempotencyKey.length).toBeGreaterThanOrEqual(16);
  });

  it("RESET issues a brand-new idempotency key", () => {
    const state = createFreshState();
    const next = checkoutReducer(state, { type: "RESET" });
    expect(next.idempotencyKey).not.toBe(state.idempotencyKey);
    expect(next.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(next.step).toBe("service");
  });
});

describe("sessionStorage persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("restores a persisted mid-flow session (refresh recovery)", () => {
    let state = createFreshState();
    state = checkoutReducer(state, { type: "SELECT_SERVICE", service: cartService });
    state = checkoutReducer(state, {
      type: "SET_SELECTION",
      selection: {
        serviceId: cartService.id,
        itemQuantities: { "item-large": 1 },
        addonIds: ["addon-carry"],
        answers: {},
      },
    });
    state = checkoutReducer(state, { type: "SET_SLOT", slot });
    state = checkoutReducer(state, { type: "GOTO", step: "customer" });
    persistState(state);

    const restored = loadPersistedState();
    expect(restored).not.toBeNull();
    expect(restored?.idempotencyKey).toBe(state.idempotencyKey);
    expect(restored?.step).toBe("customer");
    expect(restored?.selection).toEqual(state.selection);
    expect(restored?.slot).toEqual(slot);
    expect(restored?.paymentStatus).toBe("idle");
  });

  it("returns null for missing storage", () => {
    expect(loadPersistedState()).toBeNull();
  });

  it("survives corrupted storage without throwing", () => {
    sessionStorage.setItem(PERSIST_KEY, "{ not: json !!");
    expect(loadPersistedState()).toBeNull();

    sessionStorage.setItem(PERSIST_KEY, JSON.stringify({ idempotencyKey: "short", step: "slot" }));
    expect(loadPersistedState()).toBeNull();

    sessionStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ idempotencyKey: "long-enough-key-123456", step: "not-a-step" }),
    );
    expect(loadPersistedState()).toBeNull();
  });
});
