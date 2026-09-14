import { z } from "zod";

/**
 * BusinessProfileContract v1
 *
 * ONE tenant → ONE activated business profile. A profile is the per-tenant
 * lens that turns the vertical-blind platform into a single coherent business:
 * it declares WHICH template archetypes this tenant may use, WHAT its people
 * and customers are called, WHICH engine capabilities are switched on, and the
 * ordered embed flow its checkout renders.
 *
 * This module is CONFIGURATION — the same shape the template archetypes are:
 * pure data + rules, zero I/O. It imports nothing internal and never reaches
 * into an engine, a database, or a template. `allowedTemplateKeys` are plain
 * string keys into @lumin/templates' `templateRegistry`; the coupling is
 * one-directional and checked by tests (no dangling archetype), never by an
 * import here (contracts depends on nothing).
 *
 * The audit's P1 PROFILE-MISSING gap was exactly the absence of this lens:
 * with no per-tenant profile, every vertical was exposed to every tenant. A
 * profile closes it — a cleaning tenant sees a cleaning menu, a rental tenant
 * a rental menu — while the engines below stay vertical-blind.
 */

/** The six activ(at)able business profiles. Set-once per tenant. */
export const BusinessProfile = z.enum([
  "CLEANING",
  "DETAILING",
  "VEHICLE_RENTAL",
  "EQUIPMENT_RENTAL",
  "JUNK_REMOVAL",
  "EVENT_RENTAL",
]);
export type BusinessProfile = z.infer<typeof BusinessProfile>;

/** The ordered checkout/embed step keys a profile's flow may render. */
export const EmbedStep = z.enum([
  "service",
  "configure",
  "summary",
  "slot",
  "customer",
  "payment",
  "confirmation",
]);
export type EmbedStep = z.infer<typeof EmbedStep>;

/**
 * Which shared engine capabilities a profile switches on. Booleans only — the
 * engines never learn the profile's name; the portal reads these to decide
 * which surfaces to show. `resourceExclusive` = a specific unit is held for the
 * whole booking (a named vehicle); `resourcePooled` = drawn from a fungible
 * pool (identical tools / tents); `quantity` = per-unit line items;
 * `serviceArea` = zone/travel pricing; `worker` = a person is dispatched.
 */
export const ProfileCapabilities = z.object({
  scheduling: z.boolean(),
  resourceExclusive: z.boolean(),
  resourcePooled: z.boolean(),
  quantity: z.boolean(),
  serviceArea: z.boolean(),
  worker: z.boolean(),
});
export type ProfileCapabilities = z.infer<typeof ProfileCapabilities>;

/** Customer-facing and worker-facing vocabulary for this vertical. */
export const ProfileTerminology = z.object({
  /** What a buyer is called ("Customer", "Renter"). */
  customer: z.string().min(1),
  /** What the dispatched person is called ("Cleaner", "Hauler"), or "" if none. */
  worker: z.string().min(1),
  /** What a unit of work is called ("Cleaning", "Rental"). */
  service: z.string().min(1),
  /** What a committed order is called ("Appointment", "Reservation"). */
  booking: z.string().min(1),
});
export type ProfileTerminology = z.infer<typeof ProfileTerminology>;

/**
 * The full per-profile configuration. `allowedTemplateKeys` must each resolve
 * to a real `templateRegistry` key (tests assert this — no dangling archetype).
 */
export const ProfileConfig = z.object({
  key: BusinessProfile,
  /** Human-facing label for nav / activation. */
  label: z.string().min(1),
  terminology: ProfileTerminology,
  /** Non-empty: which @lumin/templates archetypes this vertical may adopt. */
  allowedTemplateKeys: z.array(z.string().min(1)).min(1),
  capabilities: ProfileCapabilities,
  /** Ordered step keys the embed renders — always begins service, ends confirmation. */
  embedFlow: z.array(EmbedStep).min(1),
  /** Ordered onboarding hints shown while the profile is being set up. */
  onboarding: z.array(z.string().min(1)).min(1),
});
export type ProfileConfig = z.infer<typeof ProfileConfig>;

const CLEANING: ProfileConfig = {
  key: "CLEANING",
  label: "Cleaning",
  terminology: { customer: "Customer", worker: "Cleaner", service: "Cleaning", booking: "Appointment" },
  allowedTemplateKeys: ["housekeeping", "pressure-washing", "landscaping"],
  capabilities: {
    scheduling: true,
    resourceExclusive: false,
    resourcePooled: false,
    quantity: true,
    serviceArea: true,
    worker: true,
  },
  embedFlow: ["service", "configure", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Confirm your cleaning service area and travel zones.",
    "Set room / depth pricing on your housekeeping template.",
    "Add your cleaners so visits can be dispatched.",
  ],
};

const DETAILING: ProfileConfig = {
  key: "DETAILING",
  label: "Auto Detailing",
  terminology: { customer: "Customer", worker: "Detailer", service: "Detail", booking: "Appointment" },
  allowedTemplateKeys: ["car-detailing"],
  capabilities: {
    scheduling: true,
    resourceExclusive: false,
    resourcePooled: false,
    quantity: false,
    serviceArea: true,
    worker: true,
  },
  embedFlow: ["service", "configure", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Pick your detail packages and vehicle-size multipliers.",
    "Set your mobile service area, if you travel to the customer.",
    "Add your detailers so appointments can be assigned.",
  ],
};

const VEHICLE_RENTAL: ProfileConfig = {
  key: "VEHICLE_RENTAL",
  label: "Vehicle Rental",
  terminology: { customer: "Renter", worker: "Fleet manager", service: "Rental", booking: "Reservation" },
  allowedTemplateKeys: ["vehicle-rental"],
  capabilities: {
    scheduling: true,
    resourceExclusive: true,
    resourcePooled: false,
    quantity: false,
    serviceArea: false,
    worker: false,
  },
  embedFlow: ["service", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Set your per-period rate, minimum periods and deposit.",
    "Register each vehicle as an exclusive resource.",
    "Confirm pickup / return scheduling and deposit hold.",
  ],
};

const EQUIPMENT_RENTAL: ProfileConfig = {
  key: "EQUIPMENT_RENTAL",
  label: "Equipment Rental",
  terminology: { customer: "Renter", worker: "Yard staff", service: "Rental", booking: "Reservation" },
  allowedTemplateKeys: ["equipment-rental"],
  capabilities: {
    scheduling: true,
    resourceExclusive: false,
    resourcePooled: true,
    quantity: true,
    serviceArea: false,
    worker: false,
  },
  embedFlow: ["service", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Set hourly / daily rates, minimum periods and deposit.",
    "Stock the pooled inventory count for each item.",
    "Confirm pickup / return scheduling.",
  ],
};

const JUNK_REMOVAL: ProfileConfig = {
  key: "JUNK_REMOVAL",
  label: "Junk Removal",
  terminology: { customer: "Customer", worker: "Hauler", service: "Pickup", booking: "Appointment" },
  allowedTemplateKeys: ["junk-removal"],
  capabilities: {
    scheduling: true,
    resourceExclusive: false,
    resourcePooled: false,
    quantity: true,
    serviceArea: true,
    worker: true,
  },
  embedFlow: ["service", "configure", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Set per-item haul prices and quantity limits.",
    "Define your service-area zones and surcharges.",
    "Add your crew so pickups can be dispatched.",
  ],
};

const EVENT_RENTAL: ProfileConfig = {
  key: "EVENT_RENTAL",
  label: "Event Rental",
  terminology: { customer: "Customer", worker: "Setup crew", service: "Rental", booking: "Reservation" },
  allowedTemplateKeys: ["tent-event-rental"],
  capabilities: {
    scheduling: true,
    resourceExclusive: false,
    resourcePooled: true,
    quantity: true,
    serviceArea: true,
    worker: true,
  },
  embedFlow: ["service", "configure", "summary", "slot", "customer", "payment", "confirmation"],
  onboarding: [
    "Set inventory counts and prices for tents and extras.",
    "Configure delivery / setup zones and fees.",
    "Add your setup crew so deliveries can be scheduled.",
  ],
};

/**
 * The activation menu: profile key → validated, frozen config. Parsed once
 * through `ProfileConfig` at module load so a malformed entry fails fast.
 */
export const PROFILE_REGISTRY: Readonly<Record<BusinessProfile, ProfileConfig>> = Object.freeze({
  CLEANING: ProfileConfig.parse(CLEANING),
  DETAILING: ProfileConfig.parse(DETAILING),
  VEHICLE_RENTAL: ProfileConfig.parse(VEHICLE_RENTAL),
  EQUIPMENT_RENTAL: ProfileConfig.parse(EQUIPMENT_RENTAL),
  JUNK_REMOVAL: ProfileConfig.parse(JUNK_REMOVAL),
  EVENT_RENTAL: ProfileConfig.parse(EVENT_RENTAL),
});

/** Look up a profile config by key, or throw if the key is not a BusinessProfile. */
export function getProfile(key: string): ProfileConfig {
  const parsed = BusinessProfile.safeParse(key);
  if (!parsed.success) throw new Error(`unknown business profile: ${key}`);
  return PROFILE_REGISTRY[parsed.data];
}

/** Every profile config, in enum order (fresh array each call). */
export function listProfiles(): ProfileConfig[] {
  return BusinessProfile.options.map((k) => PROFILE_REGISTRY[k]);
}
