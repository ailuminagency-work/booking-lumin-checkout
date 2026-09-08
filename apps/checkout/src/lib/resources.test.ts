import { describe, expect, it } from "vitest";
import { carDetailingService, cartService } from "../config/demoTenant";
import { isResourceBacked, resourceStatusForSlot } from "./resources";

/**
 * resources wiring: the app composes the (untouched) availability engine's slots
 * with the resource reservation picture. The mock holds both bays for ~20h, so
 * near slots are constrained and far slots are free.
 */
describe("checkout resource-backed availability", () => {
  const now = new Date();
  const nowIso = now.toISOString();
  const at = (hours: number): string => new Date(now.getTime() + hours * 3_600_000).toISOString();

  it("marks the car-detailing service resource-backed and the cart service not", () => {
    expect(isResourceBacked(carDetailingService.id)).toBe(true);
    expect(isResourceBacked(cartService.id)).toBe(false);
  });

  it("reflects a fully-consumed pool on near slots and a free pool on far slots", () => {
    const early = resourceStatusForSlot(
      carDetailingService.id,
      { start: at(1), end: at(2) },
      nowIso,
    );
    expect(early.capacity).toBe(2);
    expect(early.remaining).toBe(0);
    expect(early.satisfiable).toBe(false);
    expect(early.shortfalls.length).toBeGreaterThan(0);

    const later = resourceStatusForSlot(
      carDetailingService.id,
      { start: at(48), end: at(49) },
      nowIso,
    );
    expect(later.remaining).toBe(2);
    expect(later.satisfiable).toBe(true);
  });

  it("returns a not-backed status for services with no resource requirements", () => {
    const status = resourceStatusForSlot(cartService.id, { start: at(1), end: at(2) }, nowIso);
    expect(status.resourceBacked).toBe(false);
    expect(status.satisfiable).toBe(true);
  });
});
