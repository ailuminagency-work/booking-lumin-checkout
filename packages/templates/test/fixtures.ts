import { Selection, Service } from "@lumin/contracts";
import { getTemplate } from "../src/registry";

/** Deterministic valid UUIDs for fixtures (mirrors the core test helper). */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Neutral demo tenant — never a real business name (contamination invariant). */
export const DEMO_TENANT = uuid(7001);
export const DEMO_CURRENCY = "USD";
export const DEMO_TIMEZONE = "America/Chicago";

export interface TemplateCase {
  key: string;
  service: Service;
  selection: Selection;
  /** Hand-computed expectations, all integer minor units. */
  subtotal: number;
  tax: number;
  deposit: number;
  total: number;
  /** What the booking engine charges now = total + deposit. */
  charge: number;
}

/** Build a template's Service for the demo tenant with a fixed id. */
function build(key: string, idN: number): Service {
  return getTemplate(key).build({
    tenantId: DEMO_TENANT,
    currency: DEMO_CURRENCY,
    timezone: DEMO_TIMEZONE,
    serviceId: uuid(idN),
  });
}

/**
 * One representative selection per template with a fully hand-computed total.
 * These same cases drive both the pricing tests and the end-to-end booking
 * tests, proving every vertical runs on the shared engines unchanged.
 */
export function templateCases(): TemplateCase[] {
  const cases: TemplateCase[] = [];

  // 1. junk-removal (cart): 2×sofa + 1×fridge + north zone addon.
  {
    const service = build("junk-removal", 101);
    // 2×7500 + 9000 + 2000 = 26000; tax round(26000×825/10000)=2145
    cases.push({
      key: "junk-removal",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: { sofa: 2, fridge: 1 },
        addonIds: ["zone-north"],
        answers: {},
      },
      subtotal: 26_000,
      tax: 2_145,
      deposit: 0,
      total: 28_145,
      charge: 28_145,
    });
  }

  // 2. car-detailing (configurable): deluxe package + SUV multiplier + pet-hair.
  {
    const service = build("car-detailing", 102);
    // (15000 + 3000) × 1.25 = 22500; tax round(22500×825/10000)=1856
    cases.push({
      key: "car-detailing",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: {},
        addonIds: ["pet-hair"],
        answers: { package: { choiceIds: ["deluxe"] }, vehicle: { choiceIds: ["suv"] } },
      },
      subtotal: 22_500,
      tax: 1_856,
      deposit: 0,
      total: 24_356,
      charge: 24_356,
    });
  }

  // 3. housekeeping (configurable): 3 bed / 2 bath, deep clean, one-time, fridge.
  {
    const service = build("housekeeping", 103);
    // (8000 + 3×2500 + 2×3000 + 2000) × 1.5 × 1.0 = 23500 × 1.5 = 35250; no tax
    cases.push({
      key: "housekeeping",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: {},
        addonIds: ["inside-fridge"],
        answers: {
          bedrooms: { choiceIds: [], quantity: 3 },
          bathrooms: { choiceIds: [], quantity: 2 },
          depth: { choiceIds: ["deep"] },
          frequency: { choiceIds: ["one-time"] },
        },
      },
      subtotal: 35_250,
      tax: 0,
      deposit: 0,
      total: 35_250,
      charge: 35_250,
    });
  }

  // 4. vehicle-rental (rental): 3 × 4-hour blocks + 20000 deposit.
  {
    const service = build("vehicle-rental", 104);
    // 3 × 6000 = 18000 subtotal; deposit 20000; charge 38000
    cases.push({
      key: "vehicle-rental",
      service,
      selection: { serviceId: service.id, itemQuantities: {}, addonIds: [], answers: {}, rentalPeriods: 3 },
      subtotal: 18_000,
      tax: 0,
      deposit: 20_000,
      total: 18_000,
      charge: 38_000,
    });
  }

  // 5. equipment-rental (rental): 4 hourly periods + 5000 deposit.
  {
    const service = build("equipment-rental", 105);
    // 4 × 1500 = 6000 subtotal; deposit 5000; charge 11000
    cases.push({
      key: "equipment-rental",
      service,
      selection: { serviceId: service.id, itemQuantities: {}, addonIds: [], answers: {}, rentalPeriods: 4 },
      subtotal: 6_000,
      tax: 0,
      deposit: 5_000,
      total: 6_000,
      charge: 11_000,
    });
  }

  // 6. tent-event-rental (cart): 1×20x20 + 2×10x10 + delivery addon.
  {
    const service = build("tent-event-rental", 106);
    // 28000 + 2×12000 + 5000 = 57000; tax round(57000×700/10000)=3990
    cases.push({
      key: "tent-event-rental",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: { "tent-20x20": 1, "tent-10x10": 2 },
        addonIds: ["delivery"],
        answers: {},
      },
      subtotal: 57_000,
      tax: 3_990,
      deposit: 0,
      total: 60_990,
      charge: 60_990,
    });
  }

  // 7. pressure-washing (configurable): brick multiplier + 500 sqft + sealant.
  {
    const service = build("pressure-washing", 107);
    // (4000 + 500×50 + 6000) × 1.2 = 35000 × 1.2 = 42000; no tax
    cases.push({
      key: "pressure-washing",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: {},
        addonIds: ["sealant"],
        answers: { surface: { choiceIds: ["brick"] }, area: { choiceIds: [], quantity: 500 } },
      },
      subtotal: 42_000,
      tax: 0,
      deposit: 0,
      total: 42_000,
      charge: 42_000,
    });
  }

  // 8. landscaping (configurable): mowing + mulching (multi) + 1000 sqft + haul.
  {
    const service = build("landscaping", 108);
    // 3000 + 8000 + 1000×20 + 4500 = 35500; tax round(35500×825/10000)=2929
    cases.push({
      key: "landscaping",
      service,
      selection: {
        serviceId: service.id,
        itemQuantities: {},
        addonIds: ["haul-away"],
        answers: { services: { choiceIds: ["mowing", "mulching"] }, area: { choiceIds: [], quantity: 1000 } },
      },
      subtotal: 35_500,
      tax: 2_929,
      deposit: 0,
      total: 38_429,
      charge: 38_429,
    });
  }

  return cases;
}
