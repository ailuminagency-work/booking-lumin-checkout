import {
  Money,
  PriceBreakdown,
  PriceLine,
  PricingEngine,
  PricingError,
  Selection,
  Service,
  ServiceQuestion,
} from "@lumin/contracts";

/**
 * Deterministic, pure pricing engine. No I/O, no clock, no randomness.
 *
 * Line model: `amount` is the UNIT price of the line and `quantity` the count;
 * the line's contribution to the subtotal is amount × quantity. Multiplier
 * effects (basis-point choice multipliers) are materialized as explicit
 * adjustment lines so that Σ(amount × quantity) always equals the subtotal.
 *
 * Order of operations:
 *   1. additive lines: base, items, addons, question deltas / quantities, rental
 *   2. multiplier lines: for each selected choice with priceMultiplierBp ≠ 10000
 *      (in service question/choice order) subtotal = round(subtotal × bp / 10000)
 *   3. tax = round(subtotal × taxRateBp / 10000); total = subtotal + tax
 * Deposit is never taxed and never part of subtotal/total.
 */
export function createPricingEngine(): PricingEngine {
  return { price };
}

function invalid(reason: string): never {
  throw new PricingError("INVALID_SELECTION", reason);
}

function price(service: Service, selection: Selection): PriceBreakdown {
  const currency = service.currency;
  const m = (amount: number): Money => ({ amount, currency });

  if (selection.serviceId !== service.id) {
    invalid("selection.serviceId does not match service");
  }

  const itemQuantities = selection.itemQuantities ?? {};
  const addonIds = selection.addonIds ?? [];
  const answers = selection.answers ?? {};

  // ---- archetype field validation -----------------------------------------
  if (service.archetype === "rental") {
    if (!service.rental) invalid("rental service is missing rental configuration");
    if (selection.rentalPeriods === undefined) invalid("rentalPeriods is required for rental services");
  } else if (selection.rentalPeriods !== undefined) {
    invalid("rentalPeriods is not valid for a non-rental service");
  }

  const lines: PriceLine[] = [];

  // ---- base ---------------------------------------------------------------
  if (service.basePrice > 0) {
    lines.push({ code: "base", label: service.name, amount: m(service.basePrice), quantity: 1 });
  }

  // ---- items --------------------------------------------------------------
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

  // ---- addons -------------------------------------------------------------
  const addonById = new Map(service.addons.map((a) => [a.id, a]));
  const seenAddons = new Set<string>();
  for (const id of addonIds) {
    const addon = addonById.get(id);
    if (!addon) invalid(`unknown addon id: ${id}`);
    if (seenAddons.has(id)) invalid(`duplicate addon id: ${id}`);
    seenAddons.add(id);
    lines.push({ code: `addon:${addon.id}`, label: addon.name, amount: m(addon.price), quantity: 1 });
  }

  // ---- questions (additive effects now, multipliers collected for later) --
  const questionById = new Map(service.questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) {
    if (!questionById.has(id)) invalid(`unknown question id: ${id}`);
  }

  const multipliers: { question: ServiceQuestion; choiceId: string; bp: number; label: string }[] = [];

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
      const max = question.maxQty ?? Number.MAX_SAFE_INTEGER;
      if (qty < min || qty > max) {
        invalid(`quantity ${qty} out of range [${min}, ${max}] for question ${question.id}`);
      }
      const unitPrice = question.unitPrice ?? 0;
      if (qty > 0 && unitPrice !== 0) {
        lines.push({ code: `question:${question.id}`, label: question.prompt, amount: m(unitPrice), quantity: qty });
      }
      continue;
    }

    // choice kinds
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
    // deterministic order: service configuration order, not client order
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
          question,
          choiceId: choice.id,
          bp: choice.priceMultiplierBp,
          label: `${question.prompt}: ${choice.label}`,
        });
      }
    }
  }

  // ---- rental -------------------------------------------------------------
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

  // ---- subtotal + multipliers ---------------------------------------------
  let subtotal = lines.reduce((sum, line) => sum + line.amount.amount * line.quantity, 0);
  for (const mul of multipliers) {
    const next = Math.round((subtotal * mul.bp) / 10000);
    const delta = next - subtotal;
    if (delta !== 0) {
      lines.push({
        code: `multiplier:${mul.question.id}:${mul.choiceId}`,
        label: mul.label,
        amount: m(delta),
        quantity: 1,
      });
    }
    subtotal = next;
  }

  const tax = Math.round((subtotal * service.taxRateBp) / 10000);

  return {
    lines,
    subtotal: m(subtotal),
    tax: m(tax),
    deposit: m(deposit),
    total: m(subtotal + tax),
  };
}
