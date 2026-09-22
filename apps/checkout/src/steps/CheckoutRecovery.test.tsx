import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BookingRecord, Slot } from "@lumin/contracts";
import { simpleService, TENANT_ID } from "../config/demoTenant";
import * as engines from "../engines";
import { WizardControls } from "../components/WizardControls";
import { CheckoutProvider, createFreshState, emptySelection, useCheckout } from "../state/checkout";
import { SlotPicker } from "./SlotPicker";
import { Payment } from "./Payment";
import { Confirmation } from "./Confirmation";

const first: Slot = { start: "2030-02-04T16:00:00.000Z", end: "2030-02-04T17:00:00.000Z", remainingCapacity: 1 };
const second: Slot = { ...first, start: "2030-02-05T16:00:00.000Z", end: "2030-02-05T17:00:00.000Z" };
function Probe() {
  const { state } = useCheckout();
  return <output data-testid="checkout-state">{JSON.stringify({ step: state.step, slot: state.slot })}</output>;
}
function ConditionalSlotStep() {
  const { state } = useCheckout();
  return <>{state.step === "slot" ? <SlotPicker /> : <p>Customer details</p>}<WizardControls /><Probe /></>;
}
afterEach(() => vi.restoreAllMocks());

describe("checkout recovery", () => {
  it.each([false, true])("blocks Continue during delayed availability, then honors checked slot validity=%s", async valid => {
    let finish!: () => void;
    vi.spyOn(engines, "listExistingHolds").mockImplementation(() => new Promise(resolve => { finish = () => resolve([]); }));
    vi.spyOn(engines.availabilityEngine, "getSlots").mockReturnValue(valid ? [first] : []);
    render(<CheckoutProvider initialState={{ ...createFreshState(), step: "slot", selection: emptySelection(simpleService.id), slot: first }}><ConditionalSlotStep /></CheckoutProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(screen.getByTestId("checkout-state").textContent!).step).toBe("slot");
    await act(async () => finish());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(screen.getByTestId("checkout-state").textContent!)).toEqual(valid ? { step: "customer", slot: first } : { step: "slot", slot: null });
  });

  it("clears the previous day's hidden slot when choosing another date", async () => {
    vi.spyOn(engines, "listExistingHolds").mockResolvedValue([]);
    vi.spyOn(engines.availabilityEngine, "getSlots").mockReturnValue([first, second]);
    render(<CheckoutProvider initialState={{ ...createFreshState(), step: "slot", selection: emptySelection(simpleService.id), slot: first }}><SlotPicker /><WizardControls /><Probe /></CheckoutProvider>);
    const dates = await screen.findByRole("group", { name: "Choose a date" });
    fireEvent.click(within(dates).getAllByRole("button")[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(screen.getByTestId("checkout-state").textContent!)).toEqual({ step: "slot", slot: null });
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a time/i);
    fireEvent.click(within(screen.getByRole("group", { name: "Choose a start time" })).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(screen.getByTestId("checkout-state").textContent!)).toEqual({ step: "customer", slot: second });
  });

  it("clears a restored slot that refreshed availability no longer contains", async () => {
    vi.spyOn(engines, "listExistingHolds").mockResolvedValue([]);
    vi.spyOn(engines.availabilityEngine, "getSlots").mockReturnValue([]);
    render(<CheckoutProvider initialState={{ ...createFreshState(), step: "slot", selection: emptySelection(simpleService.id), slot: first }}><SlotPicker /><WizardControls /><Probe /></CheckoutProvider>);
    await screen.findByText("No times available");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(JSON.parse(screen.getByTestId("checkout-state").textContent!)).toEqual({ step: "slot", slot: null });
  });

  it("offers a working retry after booking preparation fails without a booking", async () => {
    const create = vi.spyOn(engines.bookingEngine, "createBooking").mockRejectedValue(new Error("temporary failure"));
    render(<CheckoutProvider initialState={{ ...createFreshState(), step: "payment", selection: emptySelection(simpleService.id), slot: first, customer: { name: "Test", email: "test@example.test" } }}><Payment /></CheckoutProvider>);
    const retry = await screen.findByRole("button", { name: "Retry payment setup" });
    fireEvent.click(retry);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Retry payment setup" })).toBeEnabled();
  });

  it("includes the deposit in the receipt's paid amount, matching the payment button", () => {
    const state = createFreshState();
    const booking: BookingRecord = { id: "11111111-1111-4111-8111-111111111111", tenantId: TENANT_ID, reference: "LMN-TEST01", state: "confirmed", selection: emptySelection(simpleService.id), pricing: { lines: [], subtotal: { amount: 10000, currency: "USD" }, tax: { amount: 0, currency: "USD" }, deposit: { amount: 2500, currency: "USD" }, total: { amount: 10000, currency: "USD" } }, slotStart: first.start, slotEnd: first.end, customer: { name: "Test", email: "test@example.test" }, paymentId: null, idempotencyKey: state.idempotencyKey, createdAt: first.start, updatedAt: first.start };
    render(<CheckoutProvider initialState={{ ...state, step: "confirmation", booking }}><Confirmation /></CheckoutProvider>);
    expect(screen.getByText("Paid").parentElement).toHaveTextContent("$125.00");
  });
});
