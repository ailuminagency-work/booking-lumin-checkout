import { describe, expect, it } from "vitest";
import { createWorkflowEngine } from "../src/engine";
import { WorkflowConfig } from "../src/types";

const engine = createWorkflowEngine();

describe("engine.validate: structural checks", () => {
  it("accepts a well-formed config", () => {
    const ok: WorkflowConfig = {
      key: "ok",
      steps: [
        { key: "a", questionKey: "size", required: true },
        {
          key: "b",
          questionKey: "detail",
          visibleWhen: { field: "size", op: "eq", value: "large" },
          requiredWhen: { field: "size", op: "eq", value: "large" },
        },
      ],
    };
    expect(engine.validate(ok)).toEqual([]);
  });

  it("catches duplicate step keys", () => {
    const config: WorkflowConfig = {
      key: "dup",
      steps: [
        { key: "a", questionKey: "q1" },
        { key: "a", questionKey: "q2" },
      ],
    };
    const issues = engine.validate(config);
    expect(issues.some((i) => i.code === "duplicate_step_key" && i.stepKey === "a")).toBe(true);
  });

  it("catches unknown field references in a condition", () => {
    const config: WorkflowConfig = {
      key: "unknown-field",
      steps: [
        { key: "a", questionKey: "size" },
        {
          key: "b",
          questionKey: "detail",
          // 'ghost' is answered by no step
          visibleWhen: { field: "ghost", op: "eq", value: "x" },
        },
      ],
    };
    const issues = engine.validate(config);
    const issue = issues.find((i) => i.code === "unknown_field_ref");
    expect(issue).toBeDefined();
    expect(issue?.field).toBe("ghost");
    expect(issue?.stepKey).toBe("b");
  });

  it("catches a forward-hidden required step (visibility depends on a later answer)", () => {
    const config: WorkflowConfig = {
      key: "forward",
      steps: [
        {
          key: "early",
          questionKey: "early_q",
          required: true,
          // depends on 'late_q', which is only answered at a later step → can never show
          visibleWhen: { field: "late_q", op: "eq", value: "yes" },
        },
        { key: "late", questionKey: "late_q" },
      ],
    };
    const issues = engine.validate(config);
    const issue = issues.find((i) => i.code === "forward_hidden_required");
    expect(issue).toBeDefined();
    expect(issue?.stepKey).toBe("early");
    expect(issue?.field).toBe("late_q");
  });

  it("does NOT flag a forward-hidden step when it is not required", () => {
    const config: WorkflowConfig = {
      key: "forward-optional",
      steps: [
        { key: "early", questionKey: "early_q", visibleWhen: { field: "late_q", op: "eq", value: "yes" } },
        { key: "late", questionKey: "late_q" },
      ],
    };
    const issues = engine.validate(config);
    expect(issues.some((i) => i.code === "forward_hidden_required")).toBe(false);
  });

  it("catches a duplicate question key across two steps", () => {
    const config: WorkflowConfig = {
      key: "dup-q",
      steps: [
        { key: "a", questionKey: "size" },
        { key: "b", questionKey: "size" },
      ],
    };
    const issues = engine.validate(config);
    expect(issues.some((i) => i.code === "duplicate_question_key" && i.field === "size")).toBe(true);
  });

  it("reports multiple independent issues at once", () => {
    const config: WorkflowConfig = {
      key: "multi",
      steps: [
        { key: "x", questionKey: "q1" },
        { key: "x", questionKey: "q2", visibleWhen: { field: "nope", op: "answered" } },
      ],
    };
    const codes = engine.validate(config).map((i) => i.code);
    expect(codes).toContain("duplicate_step_key");
    expect(codes).toContain("unknown_field_ref");
  });
});
