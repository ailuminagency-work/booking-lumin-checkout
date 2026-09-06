import { Selection } from "@lumin/contracts";
import { evaluate } from "./conditions";
import {
  Answers,
  AnswerValue,
  Condition,
  Comparison,
  WorkflowConfig,
  WorkflowState,
  WorkflowStep,
  ValidationIssue,
} from "./types";

/**
 * The Workflow engine — pure, deterministic, no I/O. `createWorkflowEngine`
 * returns the two entry points the platform needs: `nextState` (what to show /
 * require / warn / block right now, given the answers so far) and `validate`
 * (structural checks on a config). One engine instance serves every template.
 */
export interface WorkflowEngine {
  nextState(config: WorkflowConfig, answers: Answers): WorkflowState;
  validate(config: WorkflowConfig): ValidationIssue[];
}

/**
 * Flatten a `Selection.answers` map into the `Answers` view conditions read:
 *   - quantity present            → the number
 *   - exactly one choice          → the choice id (string)
 *   - zero or many choices        → the choice id array (string[])
 * Never mutates the selection; unanswered questions are simply absent.
 */
export function answersFromSelection(selection: Selection): Answers {
  const out: Answers = {};
  const answers = selection.answers ?? {};
  for (const [key, a] of Object.entries(answers)) {
    if (a.quantity !== undefined) {
      out[key] = a.quantity;
      continue;
    }
    const ids = a.choiceIds ?? [];
    if (ids.length === 1) out[key] = ids[0] as string;
    else out[key] = ids;
  }
  return out;
}

function isStepRequired(step: WorkflowStep, answers: Answers): boolean {
  if (step.required) return true;
  if (step.requiredWhen) return evaluate(step.requiredWhen, answers);
  return false;
}

function isAnswered(v: AnswerValue): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function nextState(config: WorkflowConfig, answers: Answers): WorkflowState {
  const visibleSteps: string[] = [];
  const requiredUnanswered: string[] = [];
  const disqualified: WorkflowState["disqualified"] = [];
  const warnings: WorkflowState["warnings"] = [];
  const recommendations: WorkflowState["recommendations"] = [];

  for (const step of config.steps) {
    const visible = !step.visibleWhen || evaluate(step.visibleWhen, answers);
    if (!visible) continue; // hidden step: its (possibly stale) answer is ignored entirely
    visibleSteps.push(step.key);

    // required-when-visible → unanswered?
    if (step.questionKey && isStepRequired(step, answers)) {
      const has = Object.prototype.hasOwnProperty.call(answers, step.questionKey);
      if (!has || !isAnswered(answers[step.questionKey])) {
        requiredUnanswered.push(step.key);
      }
    }

    if (step.disqualify && evaluate(step.disqualify.when, answers)) {
      disqualified.push({ stepKey: step.key, message: step.disqualify.message });
    }
    if (step.warn && evaluate(step.warn.when, answers)) {
      warnings.push({ stepKey: step.key, message: step.warn.message });
    }
    if (step.recommend && evaluate(step.recommend.when, answers)) {
      recommendations.push({
        stepKey: step.key,
        text: step.recommend.text,
        ...(step.recommend.addonKey ? { addonKey: step.recommend.addonKey } : {}),
      });
    }
  }

  const complete = requiredUnanswered.length === 0 && disqualified.length === 0;
  return { visibleSteps, requiredUnanswered, disqualified, warnings, recommendations, complete };
}

/** Collect every `field` referenced by comparisons anywhere in a condition. */
function collectFields(condition: Condition, into: Set<string>): void {
  if ("and" in condition) {
    for (const c of condition.and) collectFields(c, into);
    return;
  }
  if ("or" in condition) {
    for (const c of condition.or) collectFields(c, into);
    return;
  }
  if ("not" in condition) {
    collectFields(condition.not, into);
    return;
  }
  into.add((condition as Comparison).field);
}

function conditionsOf(step: WorkflowStep): Condition[] {
  const out: Condition[] = [];
  if (step.visibleWhen) out.push(step.visibleWhen);
  if (step.requiredWhen) out.push(step.requiredWhen);
  if (step.disqualify) out.push(step.disqualify.when);
  if (step.warn) out.push(step.warn.when);
  if (step.recommend) out.push(step.recommend.when);
  if (step.pricingEffect?.when) out.push(step.pricingEffect.when);
  return out;
}

function validate(config: WorkflowConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. duplicate step keys
  const seenStepKeys = new Set<string>();
  for (const step of config.steps) {
    if (seenStepKeys.has(step.key)) {
      issues.push({
        code: "duplicate_step_key",
        stepKey: step.key,
        message: `duplicate step key "${step.key}"`,
      });
    }
    seenStepKeys.add(step.key);
  }

  // known question keys → the FIRST step index that defines each. Used for both
  // unknown-field-ref detection and forward-hidden-required detection.
  const questionStepIndex = new Map<string, number>();
  config.steps.forEach((step, i) => {
    if (step.questionKey && !questionStepIndex.has(step.questionKey)) {
      questionStepIndex.set(step.questionKey, i);
    }
  });

  // duplicate question keys across steps (two steps driving the same question)
  const seenQuestionKeys = new Set<string>();
  for (const step of config.steps) {
    if (!step.questionKey) continue;
    if (seenQuestionKeys.has(step.questionKey)) {
      issues.push({
        code: "duplicate_question_key",
        stepKey: step.key,
        field: step.questionKey,
        message: `question key "${step.questionKey}" is driven by more than one step`,
      });
    }
    seenQuestionKeys.add(step.questionKey);
  }

  config.steps.forEach((step, index) => {
    // 2. unknown field references — any condition field that no step answers
    const fields = new Set<string>();
    for (const cond of conditionsOf(step)) collectFields(cond, fields);
    for (const field of fields) {
      if (!questionStepIndex.has(field)) {
        issues.push({
          code: "unknown_field_ref",
          stepKey: step.key,
          field,
          message: `step "${step.key}" references unknown answer field "${field}"`,
        });
      }
    }

    // 3. forward-hidden required step: a required step whose visibility depends
    //    on an answer that only becomes available at/after this step's own
    //    position. It can never be shown → its requirement can never be met.
    if (step.visibleWhen && isPotentiallyRequired(step)) {
      const visFields = new Set<string>();
      collectFields(step.visibleWhen, visFields);
      for (const field of visFields) {
        const defIndex = questionStepIndex.get(field);
        if (defIndex !== undefined && defIndex >= index) {
          issues.push({
            code: "forward_hidden_required",
            stepKey: step.key,
            field,
            message:
              `required step "${step.key}" is only visible when "${field}" is answered, ` +
              `but that answer is not available until step index ${defIndex} (>= this step at ${index}); ` +
              `it can never be shown`,
          });
        }
      }
    }
  });

  return issues;
}

/** A step whose requirement could ever bind (static required, or requiredWhen). */
function isPotentiallyRequired(step: WorkflowStep): boolean {
  return Boolean(step.required || step.requiredWhen);
}

export function createWorkflowEngine(): WorkflowEngine {
  return { nextState, validate };
}
