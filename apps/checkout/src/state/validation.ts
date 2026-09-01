import {
  Address as AddressSchema,
  CustomerDetails as CustomerDetailsSchema,
  type Address,
  type CustomerDetails,
  type Selection,
  type Service,
} from "@lumin/contracts";

/** True when the service has anything for the Configurator step to show. */
export function hasConfiguration(service: Service): boolean {
  return service.items.length > 0 || service.addons.length > 0 || service.questions.length > 0;
}

export interface SelectionIssue {
  /** "items" for the cart as a whole, otherwise the question id. */
  id: string;
  message: string;
}

/**
 * Client-side gate for the wizard only. The pricing engine remains the
 * authority (it throws INVALID_SELECTION); this mirrors the rules so the UI
 * can block Continue with inline messages instead of a late failure.
 */
export function validateSelection(service: Service, selection: Selection): SelectionIssue[] {
  const issues: SelectionIssue[] = [];

  if (service.items.length > 0) {
    let total = 0;
    for (const item of service.items) {
      const qty = selection.itemQuantities[item.id] ?? 0;
      total += qty;
      if (qty < item.minQty || qty > item.maxQty) {
        issues.push({
          id: "items",
          message: `${item.name}: choose between ${item.minQty} and ${item.maxQty}.`,
        });
      }
    }
    if (total === 0 && !issues.some((i) => i.id === "items")) {
      issues.push({ id: "items", message: "Choose at least one item." });
    }
  }

  for (const q of service.questions) {
    const answer = selection.answers[q.id];
    if (q.kind === "quantity") {
      const min = q.minQty ?? 0;
      const qty = answer?.quantity ?? 0;
      if (q.required && min > 0 && qty < min) {
        issues.push({ id: q.id, message: `Please enter at least ${min}.` });
      }
      continue;
    }
    const chosen = answer?.choiceIds ?? [];
    if (q.required && chosen.length === 0) {
      issues.push({
        id: q.id,
        message: q.kind === "multi_choice" ? "Please choose at least one option." : "Please choose an option.",
      });
    }
  }

  return issues;
}

export interface CustomerDraft {
  name: string;
  email: string;
  phone: string;
  wantsAddress: boolean;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export function emptyCustomerDraft(): CustomerDraft {
  return {
    name: "",
    email: "",
    phone: "",
    wantsAddress: false,
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "US",
  };
}

export interface CustomerValidation {
  ok: boolean;
  customer: CustomerDetails | null;
  address: Address | null;
  /** Field name → display message, tied to inputs via aria-describedby. */
  issues: Record<string, string>;
}

const FIELD_MESSAGES: Record<string, string> = {
  name: "Please enter your name.",
  email: "Please enter a valid email address.",
  phone: "Please enter a valid phone number.",
  line1: "Please enter a street address.",
  city: "Please enter a city.",
  country: "Use a 2-letter country code (e.g. US).",
};

/** Validates the raw form draft with the contracts' zod schemas. */
export function validateCustomerDraft(draft: CustomerDraft): CustomerValidation {
  const issues: Record<string, string> = {};

  const candidate = {
    name: draft.name.trim(),
    email: draft.email.trim(),
    ...(draft.phone.trim() === "" ? {} : { phone: draft.phone.trim() }),
  };
  const parsed = CustomerDetailsSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "name");
      if (!issues[key]) issues[key] = FIELD_MESSAGES[key] ?? "Please check this field.";
    }
  }

  let address: Address | null = null;
  if (draft.wantsAddress) {
    const addressCandidate = {
      line1: draft.line1.trim(),
      ...(draft.line2.trim() === "" ? {} : { line2: draft.line2.trim() }),
      city: draft.city.trim(),
      ...(draft.region.trim() === "" ? {} : { region: draft.region.trim() }),
      ...(draft.postalCode.trim() === "" ? {} : { postalCode: draft.postalCode.trim() }),
      country: draft.country.trim().toUpperCase(),
    };
    const parsedAddress = AddressSchema.safeParse(addressCandidate);
    if (!parsedAddress.success) {
      for (const issue of parsedAddress.error.issues) {
        const key = String(issue.path[0] ?? "line1");
        if (!issues[key]) issues[key] = FIELD_MESSAGES[key] ?? "Please check this field.";
      }
    } else {
      address = parsedAddress.data;
    }
  }

  const ok = Object.keys(issues).length === 0;
  return {
    ok,
    customer: ok && parsed.success ? parsed.data : null,
    address: ok ? address : null,
    issues,
  };
}
