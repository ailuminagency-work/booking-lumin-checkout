import { describe, expect, it } from "vitest";
import { FlowDraft, PublicationWorkflowConfig, snapshotFlowPublication, validateFlowSessionBinding } from "../src/publication";
const tenantId = "11111111-1111-4111-8111-111111111111";
const flowId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const installationId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";
const foreignId = "66666666-6666-4666-8666-666666666666";
function fixture() {
  return { flow: { tenantId, flowId, name: "Cleaning", status: "draft", publishedVersionId: null },
    draft: { tenantId, flowId, revision: 2, config: { key: "cleaning", steps: [{ key: "rooms", questionKey: "rooms", required: true }] } },
    expectedRevision: 2, versionId, requiredQuestionKeys: ["rooms"] };
}
function bound() {
  return { version: snapshotFlowPublication(fixture()), installation: { tenantId, flowId, versionId, installationId, allowedOrigins: ["https://business.example"] }, session: { tenantId, flowId, versionId, installationId, sessionId } };
}
describe("publication contracts", () => {
  it("copies and deeply freezes a supported immutable customer projection", () => {
    const source = fixture(); const version = snapshotFlowPublication(source);
    source.draft.config.steps[0]!.required = false;
    expect(version.config.steps[0]!.required).toBe(true);
    expect(Object.isFrozen(version.config.steps[0])).toBe(true);
    expect(() => { (version.config.steps as unknown as unknown[]).push({}); }).toThrow();
    expect(Object.keys(version).sort()).toEqual(["tenantId", "flowId", "versionId", "schemaVersion", "sourceRevision", "config", "submissionMode"].sort());
    expect(version.submissionMode).toBe("unconfirmed_request");
  });
  it("rejects stale revision and foreign draft ownership", () => {
    expect(() => snapshotFlowPublication({ ...fixture(), expectedRevision: 1 })).toThrow("revision conflict");
    for (const key of ["tenantId", "flowId"] as const) {
      const input = fixture(); input.draft[key] = foreignId;
      expect(() => snapshotFlowPublication(input)).toThrow("binding");
    }
  });
  it.each(["tenantId", "flowId", "versionId", "installationId"] as const)("rejects mixed session %s", key => {
    const b = bound(); b.session[key] = foreignId;
    expect(() => validateFlowSessionBinding(b.version, b.installation, b.session)).toThrow("binding");
  });
  it.each(["tenantId", "flowId", "versionId"] as const)("rejects substituted installation %s", key => {
    const b = bound(); b.installation[key] = foreignId;
    expect(() => validateFlowSessionBinding(b.version, b.installation, b.session)).toThrow("binding");
  });
  it("accepts matching pinned session without following a new published alias", () => {
    const b = bound(); expect(validateFlowSessionBinding(b.version, b.installation, b.session)).toEqual(b.session);
  });
  it("rejects unknown and internal properties at every authoring level", () => {
    const input = fixture();
    expect(() => snapshotFlowPublication({ ...input, flow: { ...input.flow, secret: "private" } })).toThrow();
    expect(FlowDraft.safeParse({ ...input.draft, internal: "private" }).success).toBe(false);
    expect(PublicationWorkflowConfig.safeParse({ ...input.draft.config, secret: "private" }).success).toBe(false);
    for (const extra of [{ fieldType: "signature" }, { paid: true }, { confirmed: true }, { pricingEffect: { target: "item", itemId: "x", quantity: 1, total: 1 } }, { visibleWhen: { field: "rooms", op: "eq", value: 1, secret: "private" } }]) {
      expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: [{ ...input.draft.config.steps[0], ...extra }] }).success).toBe(false);
    }
  });
  it("rejects unsupported steps, missing operands and invalid references", () => {
    for (const step of [{ key: "x", kind: "payment" }, { key: "x", kind: "question" }, { key: "x", questionKey: "x", visibleWhen: { field: "missing", op: "answered" } }, { key: "x", questionKey: "x", visibleWhen: { field: "x", op: "eq" } }]) {
      expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: [step] }).success).toBe(false);
    }
  });
  it("rejects author bypass of trusted required questions", () => {
    const missing = fixture(); missing.requiredQuestionKeys = ["customer"];
    expect(() => snapshotFlowPublication(missing)).toThrow("Server-required");
    const optional = fixture(); optional.draft.config.steps[0]!.required = false;
    expect(() => snapshotFlowPublication(optional)).toThrow("Server-required");
    const hidden = fixture();
    expect(() => snapshotFlowPublication({ ...hidden, draft: { ...hidden.draft, config: { key: "x", steps: [{ key: "selector", questionKey: "selector" }, { key: "rooms", questionKey: "rooms", required: true, visibleWhen: { field: "selector", op: "answered" } }] } } })).toThrow("Server-required");
  });
  it("does not accept financial completion through a published object", () => {
    const b = bound();
    expect(() => validateFlowSessionBinding({ ...b.version, submissionMode: "confirmed" }, b.installation, b.session)).toThrow();
    expect(() => validateFlowSessionBinding({ ...b.version, paid: true }, b.installation, b.session)).toThrow();
  });
  it("rejects excessive expression depth and wildcard/non-origin installation URLs", () => {
    let expr: unknown = { field: "rooms", op: "answered" };
    for (let i = 0; i < 6; i++) expr = { not: expr };
    expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: [{ key: "rooms", questionKey: "rooms", visibleWhen: expr }] }).success).toBe(false);
    for (const origin of ["*", "http://business.example", "https://business.example/path", "https://user:pass@business.example"]) {
      const b = bound(); b.installation.allowedOrigins = [origin];
      expect(() => validateFlowSessionBinding(b.version, b.installation, b.session)).toThrow();
    }
  });
});


it("bounds parse work, revisions and operands before publication", () => {
  const f = fixture();
  expect(FlowDraft.safeParse({ ...f.draft, revision: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: [{ key: "x", kind: "info", title: "x".repeat(65537) }] }).success).toBe(false);
  expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: Array(10001).fill({}) }).success).toBe(false);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(PublicationWorkflowConfig.safeParse(cycle).success).toBe(false);
  for (const [op, value] of [["gt", "3"], ["gte", null], ["in", 2], ["includes", []], ["answered", true]]) {
    expect(PublicationWorkflowConfig.safeParse({ key: "x", steps: [{ key: "x", questionKey: "x", visibleWhen: { field: "x", op, value } }] }).success).toBe(false);
  }
});
