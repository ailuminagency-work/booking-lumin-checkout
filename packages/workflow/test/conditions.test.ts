import { describe, expect, it } from "vitest";
import { evaluate } from "../src/conditions";
import { Answers, Condition } from "../src/types";

const answers: Answers = {
  size: "large",
  count: 3,
  rooms: ["kitchen", "bath"],
  note: "has stairs",
  empty_choice: [],
  blank: "",
  zero: 0,
};

describe("conditions: comparison operators", () => {
  it("eq / ne on scalars", () => {
    expect(evaluate({ field: "size", op: "eq", value: "large" }, answers)).toBe(true);
    expect(evaluate({ field: "size", op: "eq", value: "small" }, answers)).toBe(false);
    expect(evaluate({ field: "size", op: "ne", value: "small" }, answers)).toBe(true);
    expect(evaluate({ field: "size", op: "ne", value: "large" }, answers)).toBe(false);
  });

  it("eq compares arrays element-wise", () => {
    expect(evaluate({ field: "rooms", op: "eq", value: ["kitchen", "bath"] }, answers)).toBe(true);
    expect(evaluate({ field: "rooms", op: "eq", value: ["bath", "kitchen"] }, answers)).toBe(false);
  });

  it("in — membership in a value list", () => {
    expect(evaluate({ field: "size", op: "in", value: ["small", "large"] }, answers)).toBe(true);
    expect(evaluate({ field: "size", op: "in", value: ["small", "medium"] }, answers)).toBe(false);
    // non-array operand → false, never throws
    expect(evaluate({ field: "size", op: "in", value: "large" }, answers)).toBe(false);
  });

  it("includes — array-contains and string substring", () => {
    expect(evaluate({ field: "rooms", op: "includes", value: "kitchen" }, answers)).toBe(true);
    expect(evaluate({ field: "rooms", op: "includes", value: "garage" }, answers)).toBe(false);
    expect(evaluate({ field: "note", op: "includes", value: "stairs" }, answers)).toBe(true);
    expect(evaluate({ field: "note", op: "includes", value: "elevator" }, answers)).toBe(false);
  });

  it("gt / gte / lt / lte — numeric only", () => {
    expect(evaluate({ field: "count", op: "gt", value: 2 }, answers)).toBe(true);
    expect(evaluate({ field: "count", op: "gt", value: 3 }, answers)).toBe(false);
    expect(evaluate({ field: "count", op: "gte", value: 3 }, answers)).toBe(true);
    expect(evaluate({ field: "count", op: "lt", value: 4 }, answers)).toBe(true);
    expect(evaluate({ field: "count", op: "lte", value: 3 }, answers)).toBe(true);
    expect(evaluate({ field: "count", op: "lte", value: 2 }, answers)).toBe(false);
    // non-numeric field vs numeric operand → false
    expect(evaluate({ field: "size", op: "gt", value: 2 }, answers)).toBe(false);
  });

  it("answered — present and non-empty", () => {
    expect(evaluate({ field: "size", op: "answered" }, answers)).toBe(true);
    expect(evaluate({ field: "zero", op: "answered" }, answers)).toBe(true); // 0 is answered
    expect(evaluate({ field: "empty_choice", op: "answered" }, answers)).toBe(false);
    expect(evaluate({ field: "blank", op: "answered" }, answers)).toBe(false);
    expect(evaluate({ field: "missing", op: "answered" }, answers)).toBe(false);
  });
});

describe("conditions: missing fields never throw", () => {
  it("all comparisons over a missing field are false (including ne)", () => {
    for (const op of ["eq", "ne", "in", "gt", "gte", "lt", "lte", "includes"] as const) {
      expect(evaluate({ field: "nope", op, value: 1 }, answers)).toBe(false);
    }
  });

  it("null-valued fields behave like missing", () => {
    const a: Answers = { x: null };
    expect(evaluate({ field: "x", op: "eq", value: null }, a)).toBe(false);
    expect(evaluate({ field: "x", op: "answered" }, a)).toBe(false);
  });
});

describe("conditions: AND / OR / NOT combinators", () => {
  it("and — all must hold", () => {
    const c: Condition = {
      and: [
        { field: "size", op: "eq", value: "large" },
        { field: "count", op: "gte", value: 3 },
      ],
    };
    expect(evaluate(c, answers)).toBe(true);
    expect(evaluate({ and: [c, { field: "count", op: "gt", value: 5 }] }, answers)).toBe(false);
  });

  it("or — any may hold", () => {
    const c: Condition = {
      or: [
        { field: "size", op: "eq", value: "small" },
        { field: "count", op: "gte", value: 3 },
      ],
    };
    expect(evaluate(c, answers)).toBe(true);
    expect(
      evaluate({ or: [{ field: "size", op: "eq", value: "small" }, { field: "count", op: "gt", value: 9 }] }, answers),
    ).toBe(false);
  });

  it("not — negation, and nested combinators", () => {
    expect(evaluate({ not: { field: "size", op: "eq", value: "small" } }, answers)).toBe(true);
    const nested: Condition = {
      and: [
        { or: [{ field: "size", op: "eq", value: "large" }, { field: "size", op: "eq", value: "xl" }] },
        { not: { field: "rooms", op: "includes", value: "garage" } },
      ],
    };
    expect(evaluate(nested, answers)).toBe(true);
  });
});

describe("conditions: unknown operator is rejected", () => {
  it("throws on an unknown op rather than evaluating permissively", () => {
    // Intentionally malformed op — bypass the type to simulate bad config data.
    const bad = { field: "size", op: "matches", value: "x" } as unknown as Condition;
    expect(() => evaluate(bad, answers)).toThrow(/unknown condition operator/);
  });
});
