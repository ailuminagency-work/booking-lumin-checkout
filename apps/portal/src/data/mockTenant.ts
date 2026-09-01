/**
 * Deterministic in-memory dataset for the Business Portal shell.
 *
 * IMPORTANT: this store is a stand-in for the future Supabase-backed API.
 * The DATABASE (RLS, deny-by-default) is the real tenant boundary — the
 * filtering done in src/data/api.ts merely mirrors the shape of that
 * boundary so the UI is already written against tenant-scoped access.
 *
 * All records are generated with a seeded PRNG (mulberry32) so the dataset
 * is identical on every run — tests depend on this determinism.
 */

import type {
  AuditEvent,
  AvailabilityOverride,
  AvailabilityRule,
  BookingRecord,
  BookingState,
  BookingStateChange,
  CustomerDetails,
  EventName,
  IntegrationConnection,
  IntegrationKind,
  PriceBreakdown,
  PriceLine,
  SchedulingPolicy,
  Service,
  Tenant,
  TenantContext,
  TenantRole,
} from "@lumin/contracts";
import { money } from "@lumin/contracts";

/* ------------------------------------------------------------------ */
/* Seeded PRNG                                                         */
/* ------------------------------------------------------------------ */

/** Tiny deterministic PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const HEX = "0123456789abcdef";

/** Deterministic uuid-shaped id from the PRNG. */
function uuid(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += HEX[Math.floor(rng() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function bookingReference(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[Math.floor(rng() * REF_ALPHABET.length)];
  return `LMN-${s}`;
}

/* ------------------------------------------------------------------ */
/* Local (portal-only) record shapes                                   */
/* ------------------------------------------------------------------ */

export interface CustomerRecord {
  id: string;
  tenantId: string;
  details: CustomerDetails;
  createdAt: string;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: TenantRole;
}

export interface CheckoutSettings {
  tenantId: string;
  businessName: string;
  logoText: string;
  accentColor: string;
}

/* ------------------------------------------------------------------ */
/* Time anchor                                                         */
/* ------------------------------------------------------------------ */

export const DAY_MS = 86_400_000;

/**
 * Fixed "now" anchor: the whole dataset (past/upcoming bookings, the
 * dashboard week window) is computed relative to this instant, never the
 * wall clock, so the data and the tests are stable forever. Engines in this
 * platform always receive `now` injected — the portal mock mirrors that.
 */
export const STORE_NOW = "2026-09-01T12:00:00.000Z";

/* ------------------------------------------------------------------ */
/* Fixed identities                                                    */
/* ------------------------------------------------------------------ */

export const DEMO_TENANT_ID = "11111111-1111-4111-a111-111111111111";
export const DEMO_OWNER_USER_ID = "22222222-2222-4222-a222-222222222222";

/** A second tenant existing in the same store ONLY to prove isolation. */
export const OTHER_TENANT_ID = "99999999-9999-4999-a999-999999999999";
export const OTHER_OWNER_USER_ID = "88888888-8888-4888-a888-888888888888";

export const demoContext: TenantContext = {
  tenantId: DEMO_TENANT_ID,
  role: "BUSINESS_OWNER",
  userId: DEMO_OWNER_USER_ID,
};

export const otherContext: TenantContext = {
  tenantId: OTHER_TENANT_ID,
  role: "BUSINESS_OWNER",
  userId: OTHER_OWNER_USER_ID,
};

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface PortalStore {
  now: string;
  tenants: Tenant[];
  services: Service[];
  bookings: BookingRecord[];
  /** bookingId → ordered state history */
  history: Map<string, BookingStateChange[]>;
  customers: CustomerRecord[];
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  policies: Map<string, SchedulingPolicy>;
  integrations: IntegrationConnection[];
  checkoutSettings: CheckoutSettings[];
  members: TenantMember[];
  events: AuditEvent[];
  /** Reactivity: bump on every mutation. */
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  notify(): void;
}

/* ------------------------------------------------------------------ */
/* Seed helpers                                                        */
/* ------------------------------------------------------------------ */

function demoServices(tenantId: string): Service[] {
  const svc = (partial: Omit<Service, "tenantId" | "currency">): Service => ({
    ...partial,
    tenantId,
    currency: "USD",
  });
  return [
    svc({
      id: "5e601001-0000-4000-a000-000000000001",
      archetype: "simple",
      name: "Standard Consultation",
      description: "A one-hour on-site consultation with a specialist.",
      basePrice: 9500,
      durationMinutes: 60,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 0,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000002",
      archetype: "configurable",
      name: "Premium Detail Package",
      description: "Full interior and exterior detail, sized to the vehicle.",
      basePrice: 14900,
      durationMinutes: 120,
      items: [],
      addons: [{ id: "ad-ceramic", name: "Ceramic top coat", price: 6000 }],
      questions: [
        {
          id: "q-size",
          prompt: "Vehicle size",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "c-compact", label: "Compact", priceDelta: 0, priceMultiplierBp: 10000 },
            { id: "c-suv", label: "SUV", priceDelta: 3000, priceMultiplierBp: 11000 },
            { id: "c-truck", label: "Truck / Van", priceDelta: 5000, priceMultiplierBp: 12000 },
          ],
        },
      ],
      taxRateBp: 825,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000003",
      archetype: "cart",
      name: "Bulk Item Pickup",
      description: "Pick-and-price removal of large items.",
      basePrice: 0,
      durationMinutes: 90,
      items: [
        { id: "it-small", name: "Small item", unitPrice: 4500, minQty: 0, maxQty: 10 },
        { id: "it-medium", name: "Medium item", unitPrice: 9500, minQty: 0, maxQty: 10 },
        { id: "it-large", name: "Large item", unitPrice: 15500, minQty: 0, maxQty: 5 },
      ],
      addons: [{ id: "ad-stairs", name: "Stair carry", price: 2500 }],
      questions: [],
      taxRateBp: 825,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000004",
      archetype: "configurable",
      name: "Deep Clean Visit",
      description: "Whole-home deep clean, priced by bedroom count.",
      basePrice: 12000,
      durationMinutes: 180,
      items: [],
      addons: [
        { id: "ad-fridge", name: "Inside fridge", price: 3000 },
        { id: "ad-oven", name: "Inside oven", price: 3500 },
      ],
      questions: [
        {
          id: "q-bedrooms",
          prompt: "Bedrooms",
          kind: "quantity",
          required: true,
          choices: [],
          unitPrice: 3500,
          minQty: 1,
          maxQty: 6,
        },
      ],
      taxRateBp: 0,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000005",
      archetype: "rental",
      name: "Floor Sander Rental",
      description: "Professional floor sander, rented per day.",
      basePrice: 0,
      durationMinutes: 60,
      items: [],
      addons: [],
      questions: [],
      rental: {
        periodMinutes: 1440,
        pricePerPeriod: 6500,
        minPeriods: 1,
        maxPeriods: 14,
        depositAmount: 10000,
      },
      taxRateBp: 825,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000006",
      archetype: "simple",
      name: "Express Appointment",
      description: "A quick 30-minute visit for small jobs.",
      basePrice: 4500,
      durationMinutes: 30,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 0,
      active: true,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000007",
      archetype: "simple",
      name: "Seasonal Maintenance",
      description: "Twice-a-year maintenance visit. Currently paused.",
      basePrice: 8900,
      durationMinutes: 90,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 0,
      active: false,
    }),
    svc({
      id: "5e601001-0000-4000-a000-000000000008",
      archetype: "simple",
      name: "On-site Assessment",
      description: "Walkthrough and written estimate.",
      basePrice: 2500,
      durationMinutes: 45,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 0,
      active: true,
    }),
  ];
}

const FIRST_NAMES = [
  "Avery", "Jordan", "Riley", "Morgan", "Casey", "Quinn", "Rowan", "Skyler",
  "Harper", "Emerson", "Finley", "Dakota", "Reese", "Sage", "Elliot", "Marlow",
] as const;
const LAST_NAMES = [
  "Alvarez", "Brooks", "Carter", "Delgado", "Ellis", "Fischer", "Grant",
  "Hayes", "Ibarra", "Jensen", "Keller", "Lund", "Moreno", "Nakamura", "Osei", "Petrov",
] as const;

function makeCustomers(rng: Rng, tenantId: string, count: number, domain: string): CustomerRecord[] {
  const out: CustomerRecord[] = [];
  const used = new Set<string>();
  while (out.length < count) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
    if (used.has(email)) continue;
    used.add(email);
    out.push({
      id: uuid(rng),
      tenantId,
      details: {
        name: `${first} ${last}`,
        email,
        phone: `+1-555-${String(int(rng, 1000, 9999)).padStart(4, "0")}`,
      },
      createdAt: new Date(Date.parse(STORE_NOW) - int(rng, 20, 200) * DAY_MS).toISOString(),
    });
  }
  return out;
}

/** Integer-only price breakdown for a seeded booking. No floats anywhere. */
function makeBreakdown(rng: Rng, service: Service): PriceBreakdown {
  const currency = service.currency;
  const lines: PriceLine[] = [];
  if (service.archetype === "cart" && service.items.length > 0) {
    const item = pick(rng, service.items);
    const qty = int(rng, 1, 3);
    lines.push({
      code: `item:${item.id}`,
      label: item.name,
      amount: money(item.unitPrice * qty, currency),
      quantity: qty,
    });
  } else if (service.archetype === "rental" && service.rental) {
    const periods = int(rng, service.rental.minPeriods, 4);
    lines.push({
      code: "rental",
      label: `${service.name} × ${periods} day(s)`,
      amount: money(service.rental.pricePerPeriod * periods, currency),
      quantity: periods,
    });
  } else {
    lines.push({ code: "base", label: service.name, amount: money(service.basePrice, currency), quantity: 1 });
  }
  if (service.addons.length > 0 && rng() < 0.4) {
    const addon = pick(rng, service.addons);
    lines.push({ code: `addon:${addon.id}`, label: addon.name, amount: money(addon.price, currency), quantity: 1 });
  }
  const subtotal = lines.reduce((sum, l) => sum + l.amount.amount, 0);
  const tax = Math.floor((subtotal * service.taxRateBp) / 10000); // integer math only
  const deposit = service.rental ? service.rental.depositAmount : 0;
  return {
    lines,
    subtotal: money(subtotal, currency),
    tax: money(tax, currency),
    deposit: money(deposit, currency),
    total: money(subtotal + tax, currency),
  };
}

/** A legal path through BOOKING_TRANSITIONS ending at `state`. */
function historyPath(state: BookingState): BookingState[] {
  switch (state) {
    case "draft":
      return ["draft"];
    case "pending_payment":
      return ["draft", "pending_payment"];
    case "confirmed":
      return ["draft", "pending_payment", "confirmed"];
    case "completed":
      return ["draft", "pending_payment", "confirmed", "completed"];
    case "cancelled":
      return ["draft", "pending_payment", "confirmed", "cancelled"];
    case "refunded":
      return ["draft", "pending_payment", "confirmed", "refunded"];
    case "failed":
      return ["draft", "pending_payment", "failed"];
  }
}

const STATE_EVENT: Partial<Record<BookingState, EventName>> = {
  pending_payment: "booking.pending_payment",
  confirmed: "booking.confirmed",
  completed: "booking.completed",
  cancelled: "booking.cancelled",
  refunded: "booking.refunded",
  failed: "booking.failed",
};

interface SeedBookingsResult {
  bookings: BookingRecord[];
  history: Map<string, BookingStateChange[]>;
  events: AuditEvent[];
}

function makeBookings(
  rng: Rng,
  tenantId: string,
  services: Service[],
  customers: CustomerRecord[],
  count: number,
): SeedBookingsResult {
  const nowMs = Date.parse(STORE_NOW);
  const bookings: BookingRecord[] = [];
  const history = new Map<string, BookingStateChange[]>();
  const events: AuditEvent[] = [];
  const activeServices = services.filter((s) => s.active);

  for (let i = 0; i < count; i++) {
    const service = pick(rng, activeServices);
    const customer = pick(rng, customers);
    // Spread bookings from 30 days back to 21 days ahead of the anchor.
    const offsetDays = int(rng, -30, 21);
    const hour = int(rng, 9, 16);
    const slotStartMs = nowMs - (nowMs % DAY_MS) + offsetDays * DAY_MS + hour * 3_600_000;
    const slotEndMs = slotStartMs + service.durationMinutes * 60_000;

    let state: BookingState;
    if (slotStartMs < nowMs - DAY_MS) {
      state = pick(rng, [
        "completed", "completed", "completed", "completed",
        "cancelled", "refunded", "failed",
      ] as const);
    } else if (slotStartMs < nowMs) {
      state = pick(rng, ["completed", "confirmed"] as const);
    } else {
      state = pick(rng, [
        "confirmed", "confirmed", "confirmed", "confirmed", "confirmed",
        "pending_payment", "pending_payment", "draft", "failed",
      ] as const);
    }

    const id = uuid(rng);
    const createdAtMs = Math.min(slotStartMs, nowMs) - int(rng, 2, 10) * DAY_MS;
    const pricing = makeBreakdown(rng, service);
    const path = historyPath(state);
    const changes: BookingStateChange[] = [];
    for (let p = 1; p < path.length; p++) {
      const at = new Date(createdAtMs + p * 15 * 60_000).toISOString();
      changes.push({ bookingId: id, from: path[p - 1]!, to: path[p]!, at });
      const eventName = STATE_EVENT[path[p]!];
      if (eventName) {
        events.push({
          id: uuid(rng),
          tenantId,
          name: eventName,
          data: { bookingId: id, reference: "", state: path[p]! },
          at,
        });
      }
    }
    const reference = bookingReference(rng);
    for (const ev of events) if (ev.data["bookingId"] === id) ev.data["reference"] = reference;
    events.push({
      id: uuid(rng),
      tenantId,
      name: "booking.created",
      data: { bookingId: id, reference },
      at: new Date(createdAtMs).toISOString(),
    });
    history.set(id, changes);

    bookings.push({
      id,
      tenantId,
      reference,
      state,
      selection: { serviceId: service.id, itemQuantities: {}, addonIds: [], answers: {} },
      pricing,
      slotStart: new Date(slotStartMs).toISOString(),
      slotEnd: new Date(slotEndMs).toISOString(),
      customer: customer.details,
      paymentId: state === "draft" || state === "failed" || state === "pending_payment" ? null : uuid(rng),
      idempotencyKey: `seed-${tenantId.slice(0, 8)}-${i}-${uuid(rng).slice(0, 8)}`,
      createdAt: new Date(createdAtMs).toISOString(),
      updatedAt: changes.length > 0 ? changes[changes.length - 1]!.at : new Date(createdAtMs).toISOString(),
    });
  }
  return { bookings, history, events };
}

interface ProviderDef {
  kind: IntegrationKind;
  provider: string;
}

const PROVIDERS: ProviderDef[] = [
  { kind: "payment", provider: "mock" },
  { kind: "payment", provider: "stripe" },
  { kind: "payment", provider: "mercado_pago" },
  { kind: "payment", provider: "mollie" },
  { kind: "calendar", provider: "mock" },
  { kind: "calendar", provider: "google_calendar" },
  { kind: "notification", provider: "mock" },
  { kind: "notification", provider: "email_smtp" },
  { kind: "notification", provider: "sms_gateway" },
  { kind: "webhook", provider: "mock" },
  { kind: "webhook", provider: "custom_endpoint" },
];

function makeIntegrations(rng: Rng, tenantId: string): IntegrationConnection[] {
  // Program requirement (SI-12/SI-13 & clean-environment rules): EVERY
  // integration connection begins NOT CONNECTED. No inherited credentials.
  return PROVIDERS.map((p) => ({
    id: uuid(rng),
    tenantId,
    kind: p.kind,
    provider: p.provider,
    status: "not_connected" as const,
    lastCheckAt: null,
    lastError: null,
  }));
}

/* ------------------------------------------------------------------ */
/* Store factory                                                       */
/* ------------------------------------------------------------------ */

export function createStore(): PortalStore {
  const listeners = new Set<() => void>();
  let version = 0;

  const store: PortalStore = {
    now: STORE_NOW,
    tenants: [],
    services: [],
    bookings: [],
    history: new Map(),
    customers: [],
    rules: [],
    overrides: [],
    policies: new Map(),
    integrations: [],
    checkoutSettings: [],
    members: [],
    events: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion() {
      return version;
    },
    notify() {
      version += 1;
      for (const l of listeners) l();
    },
  };

  /* ---- Tenant 1: Demo Services Co (the portal's tenant) ---- */
  const r1 = mulberry32(20260901);
  store.tenants.push({
    id: DEMO_TENANT_ID,
    name: "Demo Services Co",
    slug: "demo-services-co",
    timezone: "America/Chicago",
    currency: "USD",
    status: "active",
    createdAt: "2026-05-14T15:00:00.000Z",
  });
  const demoSvcs = demoServices(DEMO_TENANT_ID);
  store.services.push(...demoSvcs);
  const demoCustomers = makeCustomers(r1, DEMO_TENANT_ID, 15, "example.com");
  store.customers.push(...demoCustomers);
  const seeded = makeBookings(r1, DEMO_TENANT_ID, demoSvcs, demoCustomers, 25);
  store.bookings.push(...seeded.bookings);
  for (const [k, v] of seeded.history) store.history.set(k, v);
  store.events.push(...seeded.events);

  store.rules.push(
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 1, startMinute: 540, endMinute: 1020, capacity: 2 },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 2, startMinute: 540, endMinute: 1020, capacity: 2 },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 3, startMinute: 540, endMinute: 1020, capacity: 2 },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 4, startMinute: 540, endMinute: 1080, capacity: 3 },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 5, startMinute: 540, endMinute: 1080, capacity: 3 },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, weekday: 6, startMinute: 600, endMinute: 840, capacity: 1 },
    {
      id: uuid(r1),
      tenantId: DEMO_TENANT_ID,
      serviceId: "5e601001-0000-4000-a000-000000000006",
      weekday: 3,
      startMinute: 1020,
      endMinute: 1200,
      capacity: 1,
    },
  );
  store.overrides.push(
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, date: "2026-09-07", kind: "closed" },
    { id: uuid(r1), tenantId: DEMO_TENANT_ID, serviceId: null, date: "2026-11-26", kind: "closed" },
    {
      id: uuid(r1),
      tenantId: DEMO_TENANT_ID,
      serviceId: null,
      date: "2026-09-13",
      kind: "open",
      startMinute: 600,
      endMinute: 900,
      capacity: 1,
    },
  );
  store.policies.set(DEMO_TENANT_ID, { leadTimeMinutes: 120, horizonDays: 30, slotIntervalMinutes: 30 });
  store.integrations.push(...makeIntegrations(r1, DEMO_TENANT_ID));
  store.checkoutSettings.push({
    tenantId: DEMO_TENANT_ID,
    businessName: "Demo Services Co",
    logoText: "DS",
    accentColor: "#4f46e5",
  });
  store.members.push(
    {
      id: DEMO_OWNER_USER_ID,
      tenantId: DEMO_TENANT_ID,
      name: "Alex Demo",
      email: "owner@demo-services.example.com",
      role: "BUSINESS_OWNER",
    },
    {
      id: uuid(r1),
      tenantId: DEMO_TENANT_ID,
      name: "Sam Field",
      email: "sam@demo-services.example.com",
      role: "BUSINESS_STAFF",
    },
    {
      id: uuid(r1),
      tenantId: DEMO_TENANT_ID,
      name: "Jo Office",
      email: "jo@demo-services.example.com",
      role: "BUSINESS_STAFF",
    },
  );

  /* ---- Tenant 2: exists only to prove tenant isolation in api.ts ---- */
  const r2 = mulberry32(777001);
  store.tenants.push({
    id: OTHER_TENANT_ID,
    name: "Second Beta Co",
    slug: "second-beta-co",
    timezone: "Europe/Amsterdam",
    currency: "EUR",
    status: "active",
    createdAt: "2026-06-02T09:00:00.000Z",
  });
  const otherSvcs: Service[] = [
    {
      id: "0e601001-0000-4000-a000-00000000000a",
      tenantId: OTHER_TENANT_ID,
      archetype: "simple",
      name: "Beta Basic Visit",
      description: "",
      currency: "EUR",
      basePrice: 8000,
      durationMinutes: 60,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 2100,
      active: true,
    },
    {
      id: "0e601001-0000-4000-a000-00000000000b",
      tenantId: OTHER_TENANT_ID,
      archetype: "simple",
      name: "Beta Extended Visit",
      description: "",
      currency: "EUR",
      basePrice: 14000,
      durationMinutes: 120,
      items: [],
      addons: [],
      questions: [],
      taxRateBp: 2100,
      active: true,
    },
  ];
  store.services.push(...otherSvcs);
  const otherCustomers = makeCustomers(r2, OTHER_TENANT_ID, 5, "beta.example.org");
  store.customers.push(...otherCustomers);
  const otherSeed = makeBookings(r2, OTHER_TENANT_ID, otherSvcs, otherCustomers, 6);
  store.bookings.push(...otherSeed.bookings);
  for (const [k, v] of otherSeed.history) store.history.set(k, v);
  store.events.push(...otherSeed.events);
  store.rules.push({
    id: uuid(r2),
    tenantId: OTHER_TENANT_ID,
    serviceId: null,
    weekday: 2,
    startMinute: 480,
    endMinute: 960,
    capacity: 1,
  });
  store.policies.set(OTHER_TENANT_ID, { leadTimeMinutes: 0, horizonDays: 60, slotIntervalMinutes: 30 });
  store.integrations.push(...makeIntegrations(r2, OTHER_TENANT_ID));
  store.checkoutSettings.push({
    tenantId: OTHER_TENANT_ID,
    businessName: "Second Beta Co",
    logoText: "SB",
    accentColor: "#0e7490",
  });
  store.members.push({
    id: OTHER_OWNER_USER_ID,
    tenantId: OTHER_TENANT_ID,
    name: "Beta Owner",
    email: "owner@beta.example.org",
    role: "BUSINESS_OWNER",
  });

  return store;
}

/** The singleton store the running app uses. Tests create their own. */
export const appStore = createStore();
