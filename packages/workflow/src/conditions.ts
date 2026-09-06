import {
  Answers,
  AnswerValue,
  CONDITION_OPS,
  Comparison,
  Condition,
  ConditionOp,
} from "./types";

/**
 * Pure evaluator for the serializable condition DSL. Deterministic, no I/O.
 *
 * Contract:
 *   - Unknown operators are REJECTED (throws), so a malformed config fails loud.
 *   - A missing field never throws: `answered` → false, and every comparison
 *     over a missing field → false (this is the platform's deliberate default;
 *     a `ne` on a missing field is therefore false, not true).
 */

const OP_SET: ReadonlySet<string> = new Set(CONDITION_OPS);

/** Narrow an unknown object to one of the combinator shapes, else a Comparison. */
function isAnd(c: Condition): c is { and: Condition[] } {
  return typeof c === "object" && c !== null && "and" in c;
}
function isOr(c: Condition): c is { or: Condition[] } {
  return typeof c === "object" && c !== null && "or" in c;
}
function isNot(c: Condition): c is { not: Condition } {
  return typeof c === "object" && c !== null && "not" in c;
}

/** Present = the field exists with a non-null, non-undefined value. */
function isPresent(v: AnswerValue): v is string | number | boolean | string[] {
  return v !== undefined && v !== null;
}

/** "Answered" = present AND not an empty string / empty array. */
function isAnswered(v: AnswerValue): boolean {
  if (!isPresent(v)) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  return false;
}

function toNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function evalComparison(cmp: Comparison, answers: Answers): boolean {
  const op = cmp.op as ConditionOp | string;
  if (!OP_SET.has(op)) {
    throw new Error(`workflow: unknown condition operator "${String(op)}"`);
  }

  const has = Object.prototype.hasOwnProperty.call(answers, cmp.field);
  const raw: AnswerValue = has ? answers[cmp.field] : undefined;

  if (op === "answered") {
    return isAnswered(raw);
  }

  // Every remaining comparison over a missing/null field is false (never throw).
  if (!isPresent(raw)) return false;
  const value = cmp.value;

  switch (op as Exclude<ConditionOp, "answered">) {
    case "eq":
      return deepEqual(raw, value);
    case "ne":
      return !deepEqual(raw, value);
    case "in": {
      // membership: field is one of the listed values
      if (!Array.isArray(value)) return false;
      return value.some((candidate) => deepEqual(raw, candidate));
    }
    case "includes": {
      // array-contains, or substring for string fields
      if (Array.isArray(raw)) {
        return raw.some((el) => deepEqual(el, value));
      }
      if (typeof raw === "string" && typeof value === "string") {
        return raw.includes(value);
      }
      return false;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(raw);
      const b = toNumber(value);
      if (a === undefined || b === undefined) return false;
      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
    default: {
      // Exhaustiveness guard; unreachable because OP_SET gated above.
      const never: never = op as never;
      throw new Error(`workflow: unhandled operator ${String(never)}`);
    }
  }
}

/**
 * Evaluate a condition against a flattened answers map. Pure & total (except
 * for the deliberate unknown-operator rejection).
 */
export function evaluate(condition: Condition, answers: Answers): boolean {
  if (isAnd(condition)) return condition.and.every((c) => evaluate(c, answers));
  if (isOr(condition)) return condition.or.some((c) => evaluate(c, answers));
  if (isNot(condition)) return !evaluate(condition.not, answers);
  return evalComparison(condition as Comparison, answers);
}
