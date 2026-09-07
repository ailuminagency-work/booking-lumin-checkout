import { z } from "zod";
import { CurrencyCode, MinorUnits } from "@lumin/contracts";

/**
 * PlatformBilling — Plans & Add-ons (provider-neutral)
 *
 * This is how BUSINESSES pay Lumin for the platform (subscription tiers,
 * usage add-ons) — NOT how a business's customers pay for a booking (that is
 * @lumin/contracts PaymentProviderContract). The two are deliberately separate.
 *
 * Everything here is DATA. A `Plan` is a priced tier plus the feature keys it
 * unlocks; entitlement (see ./entitlement) is derived from this data and a
 * provider-neutral Subscription — never from any provider's own objects.
 *
 * Money is integer minor units + an explicit ISO-4217 currency, exactly as
 * MoneyContract v1 mandates. No floats, no platform-global default currency.
 */

export const BillingInterval = z.enum(["monthly", "annual"]);
export type BillingInterval = z.infer<typeof BillingInterval>;

/**
 * A metered/optional capability a tenant can attach to a subscription on top
 * of its plan (e.g. extra staff seats, SMS reminders). Priced per interval in
 * the same currency as the plan it attaches to.
 */
export const AddOn = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** Recurring price per billing interval, in minor units. */
  amount: MinorUnits,
  currency: CurrencyCode,
});
export type AddOn = z.infer<typeof AddOn>;

/**
 * A subscription tier. `features` are opaque capability keys the product layer
 * checks against (never money, never provider ids). `addonKeys` enumerates the
 * add-ons this plan is ALLOWED to carry — a subscription may only activate
 * add-ons drawn from this set.
 */
export const Plan = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  interval: BillingInterval,
  /** Recurring price per interval, in minor units (0 = free tier). */
  amount: MinorUnits,
  currency: CurrencyCode,
  /** Length of the free trial in days (0 = no trial). */
  trialDays: z.number().int().nonnegative(),
  /** Capability keys unlocked by this plan. */
  features: z.array(z.string().min(1)).readonly(),
  /** Add-on keys this plan permits (allow-list for subscription add-ons). */
  addonKeys: z.array(z.string().min(1)).readonly(),
});
export type Plan = z.infer<typeof Plan>;

/** A validated catalog: named plans + named add-ons, all one currency. */
export const PlanCatalog = z.object({
  currency: CurrencyCode,
  plans: z.array(Plan).min(1),
  addons: z.array(AddOn),
});
export type PlanCatalog = z.infer<typeof PlanCatalog>;

/**
 * Build & validate a catalog. Enforces catalog-level invariants that the
 * per-object schemas cannot:
 *  - unique plan keys and unique add-on keys,
 *  - a single currency across every plan and add-on (a catalog is quoted in
 *    one currency; multi-currency is modelled as separate catalogs),
 *  - every `plan.addonKeys` entry resolves to a defined add-on.
 *
 * This is a data helper, not business logic — it decides nothing about who is
 * entitled to what; it only guarantees the catalog is internally consistent.
 */
export function makePlanCatalog(input: {
  currency: CurrencyCode;
  plans: Plan[];
  addons: AddOn[];
}): PlanCatalog {
  const catalog = PlanCatalog.parse(input);

  const planKeys = new Set<string>();
  for (const p of catalog.plans) {
    if (planKeys.has(p.key)) throw new Error(`duplicate plan key: ${p.key}`);
    planKeys.add(p.key);
    if (p.currency !== catalog.currency) {
      throw new Error(`plan ${p.key} currency ${p.currency} != catalog ${catalog.currency}`);
    }
  }

  const addonKeys = new Set<string>();
  for (const a of catalog.addons) {
    if (addonKeys.has(a.key)) throw new Error(`duplicate add-on key: ${a.key}`);
    addonKeys.add(a.key);
    if (a.currency !== catalog.currency) {
      throw new Error(`add-on ${a.key} currency ${a.currency} != catalog ${catalog.currency}`);
    }
  }

  for (const p of catalog.plans) {
    for (const k of p.addonKeys) {
      if (!addonKeys.has(k)) throw new Error(`plan ${p.key} references unknown add-on: ${k}`);
    }
  }

  return catalog;
}

/** Look up a plan by key, or throw. */
export function getPlan(catalog: PlanCatalog, planKey: string): Plan {
  const plan = catalog.plans.find((p) => p.key === planKey);
  if (!plan) throw new Error(`unknown plan: ${planKey}`);
  return plan;
}

/** Look up an add-on by key, or throw. */
export function getAddOn(catalog: PlanCatalog, addonKey: string): AddOn {
  const addon = catalog.addons.find((a) => a.key === addonKey);
  if (!addon) throw new Error(`unknown add-on: ${addonKey}`);
  return addon;
}

/**
 * A SAMPLE catalog — illustrative data used by tests and local dev, not a
 * pricing decision baked into the platform. Real deployments build their own
 * catalog with `makePlanCatalog`. Prices are USD minor units (cents).
 */
export function sampleCatalog(): PlanCatalog {
  return makePlanCatalog({
    currency: "USD",
    plans: [
      {
        key: "starter",
        name: "Starter",
        interval: "monthly",
        amount: 0,
        currency: "USD",
        trialDays: 0,
        features: ["booking", "single_service"],
        addonKeys: [],
      },
      {
        key: "pro",
        name: "Pro",
        interval: "monthly",
        amount: 4900,
        currency: "USD",
        trialDays: 14,
        features: ["booking", "multi_service", "reminders", "analytics"],
        addonKeys: ["extra_seats", "sms"],
      },
      {
        key: "pro_annual",
        name: "Pro (Annual)",
        interval: "annual",
        amount: 49000,
        currency: "USD",
        trialDays: 14,
        features: ["booking", "multi_service", "reminders", "analytics"],
        addonKeys: ["extra_seats", "sms"],
      },
      {
        key: "scale",
        name: "Scale",
        interval: "monthly",
        amount: 14900,
        currency: "USD",
        trialDays: 14,
        features: ["booking", "multi_service", "reminders", "analytics", "api_access", "priority_support"],
        addonKeys: ["extra_seats", "sms", "usage_bookings"],
      },
    ],
    addons: [
      { key: "extra_seats", name: "Extra staff seats", amount: 900, currency: "USD" },
      { key: "sms", name: "SMS reminders", amount: 1500, currency: "USD" },
      { key: "usage_bookings", name: "Metered bookings overage", amount: 0, currency: "USD" },
    ],
  });
}
