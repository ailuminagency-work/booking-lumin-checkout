import { Service } from "@lumin/contracts";
import { serviceId, validate, X1 } from "./helpers";
import { ServiceTemplate, TemplateBuildInput } from "./types";

/**
 * Eight verticals, zero engines.
 *
 * Every builder below returns a plain contracts `Service`. They are the entire
 * definition of their vertical — there is no matching branch in the pricing,
 * availability or booking engines. Add a vertical by adding data here; the
 * engines never learn its name. All money is integer minor units; currency and
 * timezone come from the caller so one template serves USD/EUR/MXN/… alike.
 */

// --- cart: junk removal ------------------------------------------------------
// Items with per-unit quantities plus a flat service-area (zone) add-on.
export const junkRemoval: ServiceTemplate = {
  key: "junk-removal",
  title: "Junk Removal",
  archetype: "cart",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "cart",
      name: "Junk Removal",
      description: "Per-item haul-away pickup with service-area pricing.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 120,
      items: [
        { id: "sofa", name: "Sofa", unitPrice: 7_500, minQty: 0, maxQty: 10 },
        { id: "mattress", name: "Mattress", unitPrice: 6_000, minQty: 0, maxQty: 10 },
        { id: "fridge", name: "Refrigerator", unitPrice: 9_000, minQty: 0, maxQty: 5 },
        { id: "hot-tub", name: "Hot tub", unitPrice: 22_000, minQty: 0, maxQty: 2 },
      ],
      addons: [
        { id: "zone-north", name: "North service area", price: 2_000 },
        { id: "zone-far", name: "Extended service area", price: 4_500 },
        { id: "stairs", name: "Stairs / walk-up fee", price: 1_500 },
      ],
      questions: [],
      taxRateBp: 825,
      active: true,
    });
  },
};

// --- configurable: car detailing --------------------------------------------
// Package as a fixed surcharge (single_choice delta) + vehicle-type as a
// price MULTIPLIER (single_choice bp) + flat add-ons.
export const carDetailing: ServiceTemplate = {
  key: "car-detailing",
  title: "Car Detailing",
  archetype: "configurable",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "configurable",
      name: "Car Detailing",
      description: "Choose a package and vehicle type; size multiplies the price.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 120,
      items: [],
      addons: [
        { id: "pet-hair", name: "Pet hair removal", price: 3_000 },
        { id: "engine-bay", name: "Engine bay cleaning", price: 4_000 },
        { id: "ceramic", name: "Ceramic sealant", price: 9_500 },
      ],
      questions: [
        {
          id: "package",
          prompt: "Detail package",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "basic", label: "Basic wash & vac", priceDelta: 8_000, priceMultiplierBp: X1 },
            { id: "deluxe", label: "Deluxe interior + exterior", priceDelta: 15_000, priceMultiplierBp: X1 },
            { id: "showroom", label: "Showroom full detail", priceDelta: 24_000, priceMultiplierBp: X1 },
          ],
        },
        {
          id: "vehicle",
          prompt: "Vehicle type",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "sedan", label: "Sedan", priceDelta: 0, priceMultiplierBp: X1 },
            { id: "suv", label: "SUV", priceDelta: 0, priceMultiplierBp: 12_500 },
            { id: "truck", label: "Truck / van", priceDelta: 0, priceMultiplierBp: 15_000 },
          ],
        },
      ],
      taxRateBp: 825,
      active: true,
    });
  },
};

// --- configurable: housekeeping ---------------------------------------------
// Bedrooms/bathrooms as quantity questions + a cleaning-type multiplier +
// a one-time/recurring multiplier (recurring visits discount) + add-ons.
export const housekeeping: ServiceTemplate = {
  key: "housekeeping",
  title: "Housekeeping",
  archetype: "configurable",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "configurable",
      name: "Housekeeping",
      description: "Home cleaning priced by rooms, cleaning depth and frequency.",
      currency: input.currency,
      basePrice: 8_000,
      durationMinutes: 180,
      items: [],
      addons: [
        { id: "inside-fridge", name: "Inside fridge", price: 2_000 },
        { id: "inside-oven", name: "Inside oven", price: 2_500 },
        { id: "interior-windows", name: "Interior windows", price: 3_500 },
      ],
      questions: [
        {
          id: "bedrooms",
          prompt: "Bedrooms",
          kind: "quantity",
          required: true,
          choices: [],
          unitPrice: 2_500,
          minQty: 0,
          maxQty: 10,
        },
        {
          id: "bathrooms",
          prompt: "Bathrooms",
          kind: "quantity",
          required: true,
          choices: [],
          unitPrice: 3_000,
          minQty: 1,
          maxQty: 8,
        },
        {
          id: "depth",
          prompt: "Cleaning type",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "standard", label: "Standard clean", priceDelta: 0, priceMultiplierBp: X1 },
            { id: "deep", label: "Deep clean", priceDelta: 0, priceMultiplierBp: 15_000 },
            { id: "move-out", label: "Move-out clean", priceDelta: 0, priceMultiplierBp: 18_000 },
          ],
        },
        {
          id: "frequency",
          prompt: "How often?",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "one-time", label: "One-time", priceDelta: 0, priceMultiplierBp: X1 },
            { id: "biweekly", label: "Every two weeks", priceDelta: 0, priceMultiplierBp: 9_000 },
            { id: "weekly", label: "Weekly", priceDelta: 0, priceMultiplierBp: 8_000 },
          ],
        },
      ],
      taxRateBp: 0,
      active: true,
    });
  },
};

// --- rental: vehicle rental --------------------------------------------------
// Priced per 4-hour block with a refundable deposit.
export const vehicleRental: ServiceTemplate = {
  key: "vehicle-rental",
  title: "Vehicle Rental",
  archetype: "rental",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "rental",
      name: "Vehicle Rental",
      description: "Self-drive vehicle hire billed per 4-hour block, deposit held.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 240,
      items: [],
      addons: [],
      questions: [],
      rental: {
        periodMinutes: 240,
        pricePerPeriod: 6_000,
        minPeriods: 1,
        maxPeriods: 12,
        depositAmount: 20_000,
      },
      taxRateBp: 0,
      active: true,
    });
  },
};

// --- rental: equipment rental -----------------------------------------------
// Different period/deposit params than vehicle rental — proves rental is a
// parameterization, not a bespoke vertical: hourly billing, smaller deposit.
export const equipmentRental: ServiceTemplate = {
  key: "equipment-rental",
  title: "Equipment Rental",
  archetype: "rental",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "rental",
      name: "Equipment Rental",
      description: "Tool and equipment hire billed hourly, refundable deposit.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 60,
      items: [],
      addons: [],
      questions: [],
      rental: {
        periodMinutes: 60,
        pricePerPeriod: 1_500,
        minPeriods: 2,
        maxPeriods: 24,
        depositAmount: 5_000,
      },
      taxRateBp: 0,
      active: true,
    });
  },
};

// --- cart: tent & event rental ----------------------------------------------
// Items = tent sizes (each a line with a quantity) + a delivery add-on.
export const tentEventRental: ServiceTemplate = {
  key: "tent-event-rental",
  title: "Tent & Event Rental",
  archetype: "cart",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "cart",
      name: "Tent & Event Rental",
      description: "Event tents and extras by size, with delivery & setup.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 240,
      items: [
        { id: "tent-10x10", name: "10x10 tent", unitPrice: 12_000, minQty: 0, maxQty: 20 },
        { id: "tent-20x20", name: "20x20 tent", unitPrice: 28_000, minQty: 0, maxQty: 10 },
        { id: "tent-20x40", name: "20x40 tent", unitPrice: 52_000, minQty: 0, maxQty: 6 },
        { id: "table", name: "Banquet table", unitPrice: 900, minQty: 0, maxQty: 100 },
        { id: "chair", name: "Folding chair", unitPrice: 200, minQty: 0, maxQty: 500 },
      ],
      addons: [
        { id: "delivery", name: "Delivery & setup", price: 5_000 },
        { id: "lighting", name: "String lighting", price: 3_500 },
      ],
      questions: [],
      taxRateBp: 700,
      active: true,
    });
  },
};

// --- configurable: pressure washing -----------------------------------------
// Surface-type multiplier + an area (quantity) question priced per unit.
export const pressureWashing: ServiceTemplate = {
  key: "pressure-washing",
  title: "Pressure Washing",
  archetype: "configurable",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "configurable",
      name: "Pressure Washing",
      description: "Exterior surface cleaning priced by area and surface type.",
      currency: input.currency,
      basePrice: 4_000,
      durationMinutes: 120,
      items: [],
      addons: [{ id: "sealant", name: "Surface sealant", price: 6_000 }],
      questions: [
        {
          id: "surface",
          prompt: "Surface type",
          kind: "single_choice",
          required: true,
          choices: [
            { id: "concrete", label: "Concrete / driveway", priceDelta: 0, priceMultiplierBp: X1 },
            { id: "brick", label: "Brick / masonry", priceDelta: 0, priceMultiplierBp: 12_000 },
            { id: "wood-deck", label: "Wood deck (soft wash)", priceDelta: 0, priceMultiplierBp: 13_500 },
          ],
        },
        {
          id: "area",
          prompt: "Area (sq ft)",
          kind: "quantity",
          required: true,
          choices: [],
          unitPrice: 50,
          minQty: 100,
          maxQty: 5_000,
        },
      ],
      taxRateBp: 0,
      active: true,
    });
  },
};

// --- configurable: landscaping ----------------------------------------------
// Service-type as a MULTI-choice list of add-on deltas + an area question.
export const landscaping: ServiceTemplate = {
  key: "landscaping",
  title: "Landscaping",
  archetype: "configurable",
  build(input: TemplateBuildInput): Service {
    return validate({
      id: serviceId(input),
      tenantId: input.tenantId,
      archetype: "configurable",
      name: "Landscaping",
      description: "Bundle any lawn services and price the yard by area.",
      currency: input.currency,
      basePrice: 0,
      durationMinutes: 120,
      items: [],
      addons: [{ id: "haul-away", name: "Green-waste haul-away", price: 4_500 }],
      questions: [
        {
          id: "services",
          prompt: "Services requested",
          kind: "multi_choice",
          required: true,
          choices: [
            { id: "mowing", label: "Mowing & edging", priceDelta: 3_000, priceMultiplierBp: X1 },
            { id: "mulching", label: "Mulch beds", priceDelta: 8_000, priceMultiplierBp: X1 },
            { id: "hedge-trim", label: "Hedge trimming", priceDelta: 5_000, priceMultiplierBp: X1 },
            { id: "leaf-removal", label: "Leaf removal", priceDelta: 4_000, priceMultiplierBp: X1 },
          ],
        },
        {
          id: "area",
          prompt: "Yard area (sq ft)",
          kind: "quantity",
          required: true,
          choices: [],
          unitPrice: 20,
          minQty: 0,
          maxQty: 20_000,
        },
      ],
      taxRateBp: 825,
      active: true,
    });
  },
};

/** Every template, in catalog order. */
export const allTemplates: ServiceTemplate[] = [
  junkRemoval,
  carDetailing,
  housekeeping,
  vehicleRental,
  equipmentRental,
  tentEventRental,
  pressureWashing,
  landscaping,
];
