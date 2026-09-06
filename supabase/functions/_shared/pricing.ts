// _shared/pricing.ts — Deno-native mirror of packages/core/src/pricing.ts.
//
// ⚠️ DELIBERATE DUPLICATION. Supabase Edge Functions run under Deno and cannot
// ergonomically import the @lumin/core workspace package (which is authored for
// the Node/browser bundle and depends on @lumin/contracts). To keep the edge
// runtime self-contained while honoring SI-1 (server-authoritative repricing),
// the pricing algorithm is ported here VERBATIM in behavior. Any change to
// packages/core/src/pricing.ts MUST be mirrored here; a divergence would let the
// server charge a different amount than the domain engine computes. The
// paymentConsistency tests (packages/core) are the source-of-truth for the
// numbers this must reproduce.

export type Money = { amount: number; currency: string };
export type PriceLine = { code: string; label: string; amount: Money; quantity: number };
export type PriceBreakdown = {
  lines: PriceLine[];
  subtotal: Money;
  tax: Money;
  deposit: Money;
  total: Money;
};

// Structural subset of ServiceConfigContract / Selection used by pricing.
export type Service = {
  id: string;
  archetype: "simple" | "cart" | "configurable" | "rental";
  name: string;
  currency: string;
  basePrice: number;
  items: { id: string; name: string; unitPrice: number; minQty: number; maxQty: number }[];
  addons: { id: string; name: string; price: number }[];
  questions: {
    id: string;
    prompt: string;
    kind: "single_choice" | "multi_choice" | "quantity";
    required: boolean;
    choices: { id: string; label: string; priceDelta: number; priceMultiplierBp: number }[];
    unitPrice?: number;
    minQty?: number;
    maxQty?: number;
  }[];
  rental?: {
    periodMinutes: number;
    pricePerPeriod: number;
    minPeriods: number;
    maxPeriods: number;
    depositAmount: number;
  };
  taxRateBp: number;
};

export type Selection = {
  serviceId: string;
  itemQuantities?: Record<string, number>;
  addonIds?: string[];
  answers?: Record<string, { choiceIds: string[]; quantity?: number }>;
  rentalPeriods?: number;
};

export class PricingError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PricingError";
  }
}

const DEFAULT_QUANTITY_MAX = 10_000;

function invalid(reason: string): never {
  throw new PricingError("INVALID_SELECTION", reason);
}

function assertSafe(n: number): void {
  if (!Number.isSafeInteger(n)) invalid("amount exceeds safe integer range");
}

export function price(service: Service, selection: Selection): PriceBreakdown {
  const currency = service.currency;
  const m = (amount: number): Money => ({ amount, currency });

  if (selection.serviceId !== service.id) invalid("selection.serviceId does not match service");

  const itemQuantities = selection.itemQuantities ?? {};
  const addonIds = selection.addonIds ?? [];
  const answers = selection.answers ?? {};

  if (service.archetype === "rental") {
    if (!service.rental) invalid("rental service is missing rental configuration");
    if (selection.rentalPeriods === undefined) invalid("rentalPeriods is required for rental services");
  } else if (selection.rentalPeriods !== undefined) {
    invalid("rentalPeriods is not valid for a non-rental service");
  }

  const lines: PriceLine[] = [];

  if (service.basePrice > 0) {
    lines.push({ code: "base", label: service.name, amount: m(service.basePrice), quantity: 1 });
  }

  const itemById = new Map(service.items.map((i) => [i.id, i]));
  for (const id of Object.keys(itemQuantities)) {
    if (!itemById.has(id)) invalid(`unknown item id: ${id}`);
  }
  for (const item of service.items) {
    const qty = itemQuantities[item.id] ?? 0;
    if (!Number.isInteger(qty) || qty < 0) invalid(`invalid quantity for item ${item.id}`);
    if (qty < item.minQty || qty > item.maxQty) {
      invalid(`quantity ${qty} out of range [${item.minQty}, ${item.maxQty}] for item ${item.id}`);
    }
    if (qty > 0) {
      lines.push({ code: `item:${item.id}`, label: item.name, amount: m(item.unitPrice), quantity: qty });
    }
  }

  const addonById = new Map(service.addons.map((a) => [a.id, a]));
  const seenAddons = new Set<string>();
  for (const id of addonIds) {
    const addon = addonById.get(id);
    if (!addon) invalid(`unknown addon id: ${id}`);
    if (seenAddons.has(id)) invalid(`duplicate addon id: ${id}`);
    seenAddons.add(id);
    lines.push({ code: `addon:${addon.id}`, label: addon.name, amount: m(addon.price), quantity: 1 });
  }

  const questionById = new Map(service.questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) {
    if (!questionById.has(id)) invalid(`unknown question id: ${id}`);
  }

  const multipliers: { questionId: string; choiceId: string; bp: number; label: string }[] = [];

  for (const question of service.questions) {
    const answer = answers[question.id];
    if (question.kind === "quantity") {
      if (answer && answer.choiceIds.length > 0) invalid(`question ${question.id} takes a quantity, not choices`);
      const qty = answer?.quantity;
      if (qty === undefined) {
        if (question.required) invalid(`missing required answer for question ${question.id}`);
        continue;
      }
      if (!Number.isInteger(qty) || qty < 0) invalid(`invalid quantity for question ${question.id}`);
      const min = question.minQty ?? 0;
      const max = question.maxQty ?? DEFAULT_QUANTITY_MAX;
      if (qty < min || qty > max) invalid(`quantity ${qty} out of range [${min}, ${max}] for question ${question.id}`);
      const unitPrice = question.unitPrice ?? 0;
      if (qty > 0 && unitPrice !== 0) {
        lines.push({ code: `question:${question.id}`, label: question.prompt, amount: m(unitPrice), quantity: qty });
      }
      continue;
    }

    if (answer?.quantity !== undefined) invalid(`question ${question.id} takes choices, not a quantity`);
    const choiceIds = answer?.choiceIds ?? [];
    if (choiceIds.length === 0) {
      if (question.required) invalid(`missing required answer for question ${question.id}`);
      continue;
    }
    if (question.kind === "single_choice" && choiceIds.length !== 1) {
      invalid(`question ${question.id} requires exactly one choice`);
    }
    const seenChoices = new Set<string>();
    const choiceById = new Map(question.choices.map((c) => [c.id, c]));
    for (const choiceId of choiceIds) {
      if (seenChoices.has(choiceId)) invalid(`duplicate choice ${choiceId} for question ${question.id}`);
      seenChoices.add(choiceId);
      if (!choiceById.has(choiceId)) invalid(`unknown choice ${choiceId} for question ${question.id}`);
    }
    for (const choice of question.choices) {
      if (!seenChoices.has(choice.id)) continue;
      if (choice.priceDelta !== 0) {
        lines.push({
          code: `question:${question.id}:${choice.id}`,
          label: `${question.prompt}: ${choice.label}`,
          amount: m(choice.priceDelta),
          quantity: 1,
        });
      }
      if (choice.priceMultiplierBp !== 10000) {
        multipliers.push({
          questionId: question.id,
          choiceId: choice.id,
          bp: choice.priceMultiplierBp,
          label: `${question.prompt}: ${choice.label}`,
        });
      }
    }
  }

  let deposit = 0;
  if (service.archetype === "rental" && service.rental) {
    const rental = service.rental;
    const periods = selection.rentalPeriods as number;
    if (periods < rental.minPeriods || periods > rental.maxPeriods) {
      invalid(`rentalPeriods ${periods} out of range [${rental.minPeriods}, ${rental.maxPeriods}]`);
    }
    if (rental.pricePerPeriod !== 0) {
      lines.push({ code: "rental", label: `${service.name} rental`, amount: m(rental.pricePerPeriod), quantity: periods });
    }
    deposit = rental.depositAmount;
  }

  let subtotal = 0;
  for (const line of lines) {
    const product = line.amount.amount * line.quantity;
    assertSafe(product);
    subtotal += product;
    assertSafe(subtotal);
  }
  for (const mul of multipliers) {
    const next = Math.round((subtotal * mul.bp) / 10000);
    assertSafe(next);
    const delta = next - subtotal;
    if (delta !== 0) {
      lines.push({ code: `multiplier:${mul.questionId}:${mul.choiceId}`, label: mul.label, amount: m(delta), quantity: 1 });
    }
    subtotal = next;
  }

  if (subtotal < 0) invalid("selection subtotal is negative");

  const tax = Math.round((subtotal * service.taxRateBp) / 10000);
  assertSafe(tax);
  const total = subtotal + tax;
  assertSafe(total);
  if (total < 0) invalid("selection total is negative");

  return { lines, subtotal: m(subtotal), tax: m(tax), deposit: m(deposit), total: m(total) };
}

/** Amount to charge now = total + deposit (mirrors booking engine). Positive, safe integer. */
export function chargeAmount(breakdown: PriceBreakdown): Money {
  const amount = breakdown.total.amount + breakdown.deposit.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PricingError("PAYMENT_AMOUNT_MISMATCH", "charge amount must be a positive integer");
  }
  return { amount, currency: breakdown.total.currency };
}
