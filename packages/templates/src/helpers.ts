import { Service } from "@lumin/contracts";
import { TemplateBuildInput } from "./types";

/** Basis-point identity multiplier (×1.0). Multipliers are integers: 10000 = ×1. */
export const X1 = 10_000;

/** Resolve the service id for a build — caller-supplied for determinism, else random. */
export function serviceId(input: TemplateBuildInput): string {
  return input.serviceId ?? crypto.randomUUID();
}

/**
 * Validate a produced configuration against the contracts `Service` schema.
 * A malformed template (bad multiplier, negative price, missing field) fails
 * loudly HERE rather than mispricing silently downstream.
 */
export function validate(candidate: unknown): Service {
  return Service.parse(candidate);
}
