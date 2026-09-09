import { z } from "zod";
import { Comparison, WorkflowConfig, WorkflowStep, type Condition } from "./types";
import { createWorkflowEngine } from "./engine";

// Publication is deliberately stricter than legacy in-memory authoring.
function conditionAt(depth: number): z.ZodType<Condition> {
  const leaf = Comparison.strict().superRefine((c, ctx) => {
    if ((c.op === "answered" && c.value !== undefined) || (["gt", "gte", "lt", "lte"].includes(c.op) && (typeof c.value !== "number" || !Number.isFinite(c.value))) || (c.op === "in" && !Array.isArray(c.value)) || (c.op === "includes" && typeof c.value !== "string") || (c.op !== "answered" && c.value === undefined)) ctx.addIssue({ code: "custom", message: "Invalid condition operand" });
  });
  if (!depth) return leaf;
  const child = conditionAt(depth - 1);
  return z.union([leaf,
    z.object({ and: z.array(child).min(1).max(20) }).strict(),
    z.object({ or: z.array(child).min(1).max(20) }).strict(),
    z.object({ not: child }).strict(),
  ]);
}
const condition = conditionAt(4);
const effect = z.discriminatedUnion("target", [
  z.object({ target: z.literal("addon"), when: condition.optional(), addonId: z.string().min(1) }).strict(),
  z.object({ target: z.literal("item"), when: condition.optional(), itemId: z.string().min(1), quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ target: z.literal("choice"), when: condition.optional(), questionKey: z.string().min(1), choiceIds: z.array(z.string().min(1)).min(1) }).strict(),
]);
const step = WorkflowStep.extend({
  visibleWhen: condition.optional(), requiredWhen: condition.optional(),
  disqualify: z.object({ when: condition, message: z.string().min(1) }).strict().optional(),
  warn: z.object({ when: condition, message: z.string().min(1) }).strict().optional(),
  recommend: z.object({ when: condition, text: z.string().min(1), addonKey: z.string().min(1).optional() }).strict().optional(),
  pricingEffect: effect.optional(),
}).strict().superRefine((s, ctx) => {
  if (s.kind === "question" && !s.questionKey) ctx.addIssue({ code: "custom", message: "Question step requires questionKey" });
  if (s.kind !== "question" && (s.questionKey || s.required || s.requiredWhen)) ctx.addIssue({ code: "custom", message: "Only question steps may require answers" });
});
const publicationConfigShape = WorkflowConfig.extend({ steps: z.array(step).min(1).max(100) }).strict().superRefine((config, ctx) => {
  for (const issue of createWorkflowEngine().validate(config)) ctx.addIssue({ code: "custom", message: issue.code });
});
// Bound work before recursive schema parsing, including cyclic non-JSON inputs.
const boundedConfig = z.unknown().superRefine((value, ctx) => {
  const pending: unknown[] = [value]; const seen = new Set<object>();
  let nodes = 0; let characters = 0;
  while (pending.length) {
    const next = pending.pop(); nodes++;
    if (nodes > 10000 || characters > 65536) { ctx.addIssue({ code: "custom", message: "Publication configuration exceeds budget" }); return; }
    if (typeof next === "string") characters += next.length;
    if (next && typeof next === "object") {
      if (seen.has(next)) { ctx.addIssue({ code: "custom", message: "Publication configuration must be a JSON tree" }); return; }
      seen.add(next);
      const keys = Object.keys(next);
      if (keys.length + pending.length + nodes > 10000) { ctx.addIssue({ code: "custom", message: "Publication configuration exceeds budget" }); return; }
      for (const key of keys) { characters += key.length; pending.push((next as Record<string, unknown>)[key]); }
    }
  }
  if (characters > 65536) ctx.addIssue({ code: "custom", message: "Publication configuration exceeds budget" });
});
export const PublicationWorkflowConfig = boundedConfig.pipe(publicationConfigShape);
const id = z.string().uuid();
const identity = { tenantId: id, flowId: id };
export const Flow = z.object({ ...identity, name: z.string().min(1).max(200), status: z.enum(["draft", "active", "archived"]), publishedVersionId: id.nullable() }).strict();
export type Flow = z.infer<typeof Flow>;
export const FlowDraft = z.object({ ...identity, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), config: PublicationWorkflowConfig }).strict();
export type FlowDraft = z.infer<typeof FlowDraft>;
export const PublishedFlowVersion = z.object({
  ...identity, versionId: id, schemaVersion: z.literal(1), sourceRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  config: PublicationWorkflowConfig,
  // Configuration grants no booking, capacity or financial authority.
  submissionMode: z.literal("unconfirmed_request"),
}).strict();
export type PublishedFlowVersion = z.infer<typeof PublishedFlowVersion>;
const origin = z.string().url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; } catch { return false; }
}, "Expected exact HTTPS origin");
export const FlowInstallation = z.object({ ...identity, installationId: id, versionId: id, allowedOrigins: z.array(origin).min(1).max(20) }).strict();
export type FlowInstallation = z.infer<typeof FlowInstallation>;
export const FlowSessionBinding = z.object({ ...identity, installationId: id, versionId: id, sessionId: id }).strict();
export type FlowSessionBinding = z.infer<typeof FlowSessionBinding>;
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as DeepReadonly<T>;
}

/** Pure validation/snapshot creation, NOT publisher authorization or atomic persistence.
 * requiredQuestionKeys must come from trusted server policy, never an author payload.
 */
export function snapshotFlowPublication(input: {
  flow: unknown; draft: unknown; expectedRevision: number; versionId: string; requiredQuestionKeys: readonly string[];
}): DeepReadonly<PublishedFlowVersion> {
  const flow = Flow.parse(input.flow);
  const draft = FlowDraft.parse(input.draft);
  if (flow.status === "archived" || flow.tenantId !== draft.tenantId || flow.flowId !== draft.flowId) throw new Error("Invalid flow draft binding");
  if (input.expectedRevision !== draft.revision) throw new Error("Draft revision conflict");
  for (const key of input.requiredQuestionKeys) {
    const required = draft.config.steps.find(s => s.questionKey === key);
    if (!required || !required.required || required.visibleWhen) throw new Error("Server-required question cannot be skipped");
  }
  // Explicit projection prevents author metadata or future internal fields leaking.
  return freeze(PublishedFlowVersion.parse({ tenantId: flow.tenantId, flowId: flow.flowId,
    versionId: input.versionId, schemaVersion: 1, sourceRevision: draft.revision,
    config: draft.config, submissionMode: "unconfirmed_request" }));
}

/** Caller must load these records from trusted storage and authenticate/authorize
 * the session. Matching caller-supplied records alone is NOT authorization.
 */
export function validateFlowSessionBinding(versionInput: unknown, installationInput: unknown, sessionInput: unknown): DeepReadonly<FlowSessionBinding> {
  const version = PublishedFlowVersion.parse(versionInput);
  const installation = FlowInstallation.parse(installationInput);
  const session = FlowSessionBinding.parse(sessionInput);
  for (const key of ["tenantId", "flowId", "versionId"] as const) {
    if (version[key] !== installation[key] || version[key] !== session[key]) throw new Error("Invalid publication session binding");
  }
  if (installation.installationId !== session.installationId) throw new Error("Invalid installation session binding");
  return freeze(session);
}
