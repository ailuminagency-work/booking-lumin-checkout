import type {
  AvailabilityOverride,
  AvailabilityRule,
  SchedulingPolicy,
  Service,
  Tenant,
} from "@lumin/contracts";

/**
 * Neutral demo tenant used by the checkout in development.
 * White-label: the UI reads ONLY from this module (branding + services),
 * so swapping this config restyles and re-stocks the whole checkout.
 */

export const TENANT_ID = "b7e6f3c2-8d41-4c6a-9f0e-5a2d7c1b9e44";

export interface Branding {
  businessName: string;
  accentColor: string;
  logoText: string;
}

export const branding: Branding = {
  businessName: "Demo Services Co",
  accentColor: "#4f46e5",
  logoText: "DS",
};

export const tenant: Tenant = {
  id: TENANT_ID,
  name: "Demo Services Co",
  slug: "demo-services-co",
  timezone: "America/Chicago",
  currency: "USD",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Archetype: simple — flat-fee consultation, nothing to configure. */
export const simpleService: Service = {
  id: "0d9c1f2e-6a3b-4f5c-8d7e-101010101001",
  tenantId: TENANT_ID,
  archetype: "simple",
  name: "Standard Consultation",
  description: "A flat-fee, 60-minute consultation with one of our specialists.",
  currency: "USD",
  basePrice: 7500,
  durationMinutes: 60,
  items: [],
  addons: [],
  questions: [],
  taxRateBp: 0,
  active: true,
};

/** Archetype: cart — pick items with quantities, plus optional add-ons. */
export const cartService: Service = {
  id: "1e8b2a3c-7d4f-4a6b-9c5d-202020202002",
  tenantId: TENANT_ID,
  archetype: "cart",
  name: "Item Pickup",
  description: "Tell us what you need collected and we price it per item.",
  currency: "USD",
  basePrice: 0,
  durationMinutes: 90,
  items: [
    {
      id: "item-small",
      name: "Small item",
      description: "Fits in one hand — boxes, bags, small appliances.",
      unitPrice: 2500,
      minQty: 0,
      maxQty: 10,
    },
    {
      id: "item-standard",
      name: "Standard item",
      description: "Chairs, side tables, medium appliances.",
      unitPrice: 4500,
      minQty: 0,
      maxQty: 10,
    },
    {
      id: "item-large",
      name: "Large item",
      description: "Sofas, mattresses, large appliances.",
      unitPrice: 7500,
      minQty: 0,
      maxQty: 5,
    },
  ],
  addons: [
    {
      id: "addon-carry",
      name: "Curbside carry-out",
      description: "We bring items from inside to the curb.",
      price: 1500,
    },
    {
      id: "addon-priority",
      name: "Priority scheduling",
      description: "Jump the queue for the earliest crew.",
      price: 2000,
    },
  ],
  questions: [],
  taxRateBp: 825,
  active: true,
};

/** Archetype: configurable — choices with multipliers, a quantity question, add-ons. */
export const configurableService: Service = {
  id: "2f7a3b4d-8e5c-4b7a-a1e2-303030303003",
  tenantId: TENANT_ID,
  archetype: "configurable",
  name: "Deep Clean Package",
  description: "A configurable deep-clean visit sized to your space.",
  currency: "USD",
  basePrice: 12000,
  durationMinutes: 120,
  items: [],
  addons: [
    {
      id: "addon-eco",
      name: "Eco-friendly products",
      description: "Plant-based, fragrance-free supplies.",
      price: 1000,
    },
    {
      id: "addon-windows",
      name: "Interior windows",
      description: "All reachable interior glass.",
      price: 2500,
    },
  ],
  questions: [
    {
      id: "q-package-size",
      prompt: "How large is the space?",
      kind: "single_choice",
      required: true,
      choices: [
        { id: "size-small", label: "Small (up to 1 bed)", priceDelta: 0, priceMultiplierBp: 10000 },
        { id: "size-medium", label: "Medium (2–3 beds)", priceDelta: 0, priceMultiplierBp: 12500 },
        { id: "size-large", label: "Large (4+ beds)", priceDelta: 0, priceMultiplierBp: 15000 },
      ],
    },
    {
      id: "q-extra-rooms",
      prompt: "Extra rooms beyond the standard package",
      kind: "quantity",
      required: false,
      choices: [],
      unitPrice: 3000,
      minQty: 0,
      maxQty: 5,
    },
  ],
  taxRateBp: 825,
  active: true,
};

export const services: Service[] = [simpleService, cartService, configurableService];

export function getService(serviceId: string | undefined | null): Service | null {
  if (!serviceId) return null;
  return services.find((s) => s.id === serviceId) ?? null;
}

/** Mon–Fri, 9:00–17:00 in tenant time, two concurrent bookings. */
export const rules: AvailabilityRule[] = [1, 2, 3, 4, 5].map((weekday, i) => ({
  id: `3a1b2c3d-9f6e-4c8b-b2f3-40404040400${i + 1}`,
  tenantId: TENANT_ID,
  serviceId: null,
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  capacity: 2,
}));

/** One closed day a week out — the demo's "we're at a trade show" day. */
function isoDateInTenantTz(date: Date): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tenant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const overrides: AvailabilityOverride[] = [
  {
    id: "4b2c3d4e-0a7f-4d9c-8a1b-505050505005",
    tenantId: TENANT_ID,
    serviceId: null,
    date: isoDateInTenantTz(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    kind: "closed",
  },
];

export const policy: SchedulingPolicy = {
  leadTimeMinutes: 120,
  horizonDays: 30,
  slotIntervalMinutes: 60,
};
