import { z } from "zod";
import { Money } from "./money";
import { Selection, Service } from "./service";

/**
 * PricingContract v1
 *
 * Pricing is deterministic and server-authoritative. The same engine runs in
 * the browser (display) and on the server (authority); the server's result is
 * the only one that may be charged. Client totals are hints, never inputs.
 */

export const PriceLine = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  amount: Money,
  quantity: z.number().int().min(1).default(1),
});
export type PriceLine = z.infer<typeof PriceLine>;

export const PriceBreakdown = z.object({
  lines: z.array(PriceLine),
  subtotal: Money,
  tax: Money,
  deposit: Money,
  /** subtotal + tax. The amount to charge now includes deposit where applicable. */
  total: Money,
});
export type PriceBreakdown = z.infer<typeof PriceBreakdown>;

export interface PricingEngine {
  /**
   * Compute the full breakdown for a selection against its service config.
   * MUST throw PricingError (code: "INVALID_SELECTION") on any selection that
   * violates the service configuration (unknown item, qty out of range,
   * missing required answer) rather than pricing it permissively.
   */
  price(service: Service, selection: Selection): PriceBreakdown;
}
