import { z } from "zod";
import { CurrencyCode, MinorUnits } from "./money";
import { TenantId } from "./tenant";

/**
 * ServiceConfigContract v1
 *
 * One generalized service model powers every vertical. The four archetypes
 * (simple, cart, configurable, rental) are FLOW PRESETS over shared
 * primitives — items, add-ons, questions, resources — never separate engines.
 * A junk-removal load, a car-detailing package, and a house-cleaning visit
 * are all just configurations of this schema.
 */

export const ServiceArchetype = z.enum(["simple", "cart", "configurable", "rental"]);
export type ServiceArchetype = z.infer<typeof ServiceArchetype>;

/** A selectable line item (cart archetype), priced per quantity. */
export const ServiceItem = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  unitPrice: MinorUnits,
  minQty: z.number().int().min(0).default(0),
  maxQty: z.number().int().min(1).default(99),
});
export type ServiceItem = z.infer<typeof ServiceItem>;

/** Optional extra applied on top of the base/items total. */
export const ServiceAddon = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  price: MinorUnits,
});
export type ServiceAddon = z.infer<typeof ServiceAddon>;

/**
 * A configuration question (configurable archetype). Each choice may carry a
 * price effect: a fixed surcharge and/or a multiplier applied to the running
 * subtotal. Multipliers are basis points (10000 = x1.0) to stay in integers.
 */
export const QuestionChoice = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  priceDelta: MinorUnits.default(0),
  priceMultiplierBp: z.number().int().min(0).default(10000),
});
export type QuestionChoice = z.infer<typeof QuestionChoice>;

export const ServiceQuestion = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["single_choice", "multi_choice", "quantity"]),
  required: z.boolean().default(true),
  choices: z.array(QuestionChoice).default([]),
  /** For kind=quantity: price per unit and allowed range. */
  unitPrice: MinorUnits.optional(),
  minQty: z.number().int().min(0).optional(),
  maxQty: z.number().int().min(1).optional(),
});
export type ServiceQuestion = z.infer<typeof ServiceQuestion>;

/** Rental pricing (rental archetype): per period, with optional deposit. */
export const RentalConfig = z.object({
  periodMinutes: z.number().int().min(1),
  pricePerPeriod: MinorUnits,
  minPeriods: z.number().int().min(1).default(1),
  maxPeriods: z.number().int().min(1).default(30),
  depositAmount: MinorUnits.default(0),
});
export type RentalConfig = z.infer<typeof RentalConfig>;

export const Service = z.object({
  id: z.string().uuid(),
  tenantId: TenantId,
  archetype: ServiceArchetype,
  name: z.string().min(1),
  description: z.string().default(""),
  currency: CurrencyCode,
  /** Base price; 0 for pure-cart services. */
  basePrice: MinorUnits.default(0),
  /** Appointment duration for scheduling (non-rental archetypes). */
  durationMinutes: z.number().int().min(5).default(60),
  items: z.array(ServiceItem).default([]),
  addons: z.array(ServiceAddon).default([]),
  questions: z.array(ServiceQuestion).default([]),
  rental: RentalConfig.optional(),
  /** Tax rate in basis points applied to the taxable subtotal. */
  taxRateBp: z.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
});
export type Service = z.infer<typeof Service>;

/**
 * What the customer chose. This is INPUT ONLY — it never carries prices.
 * Totals are always recomputed server-side from the service configuration
 * (Security Invariant 1: never trust client-submitted prices).
 */
export const Selection = z.object({
  serviceId: z.string().uuid(),
  itemQuantities: z.record(z.string(), z.number().int().min(0)).default({}),
  addonIds: z.array(z.string()).default([]),
  answers: z
    .record(
      z.string(),
      z.object({
        choiceIds: z.array(z.string()).default([]),
        quantity: z.number().int().min(0).optional(),
      }),
    )
    .default({}),
  /** Rental archetype: requested period count. */
  rentalPeriods: z.number().int().min(1).optional(),
});
export type Selection = z.infer<typeof Selection>;
