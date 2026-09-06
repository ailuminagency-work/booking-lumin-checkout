import { describe, expect, it } from "vitest";
import { Selection } from "@lumin/contracts";
import { answersFromSelection, createWorkflowEngine } from "../src/engine";
import { WorkflowConfig } from "../src/types";

const engine = createWorkflowEngine();

/**
 * A representative multi-step flow:
 *   A  gate       — "do you have pets?"          (required)
 *   B  followup   — visible only when A = 'yes'  (required when visible)
 *   C  disqualify — surfaces when B says a snake  (blocks completion)
 *   D  info+warn  — warns when count is high      (non-blocking)
 *   E  recommend  — offers an addon when A = 'yes'
 */
const config: WorkflowConfig = {
  key: "pet-cleaning",
  steps: [
    { key: "A", questionKey: "has_pets", kind: "question", required: true },
    {
      key: "B",
      questionKey: "pet_type",
      kind: "question",
      visibleWhen: { field: "has_pets", op: "eq", value: "yes" },
      requiredWhen: { field: "has_pets", op: "eq", value: "yes" },
      disqualify: { when: { field: "pet_type", op: "eq", value: "snake" }, message: "We can't service homes with snakes." },
    },
    {
      key: "D",
      questionKey: "count",
      kind: "question",
      warn: { when: { field: "count", op: "gte", value: 4 }, message: "Large jobs may need extra time." },
    },
    {
      key: "E",
      kind: "info",
      recommend: {
        when: { field: "has_pets", op: "eq", value: "yes" },
        text: "Add pet-hair treatment",
        addonKey: "pet_hair",
      },
    },
  ],
};

function sel(extra: Partial<Selection> = {}): Selection {
  return {
    serviceId: "00000000-0000-4000-8000-000000000001",
    itemQuantities: {},
    addonIds: [],
    answers: {},
    ...extra,
  };
}

describe("engine.nextState: conditional visibility", () => {
  it("hides step B until A = 'yes'", () => {
    const noPets = engine.nextState(config, answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["no"] } } })));
    expect(noPets.visibleSteps).toEqual(["A", "D", "E"]);
    expect(noPets.recommendations).toEqual([]);

    const withPets = engine.nextState(config, answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["yes"] } } })));
    expect(withPets.visibleSteps).toEqual(["A", "B", "D", "E"]);
  });
});

describe("engine.nextState: required-when-visible blocks completion", () => {
  it("B is required only once visible; unanswered B blocks completion", () => {
    const st = engine.nextState(config, answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["yes"] } } })));
    expect(st.requiredUnanswered).toEqual(["B"]);
    expect(st.complete).toBe(false);
  });

  it("answering the required, visible steps completes the flow", () => {
    const st = engine.nextState(
      config,
      answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["yes"] }, pet_type: { choiceIds: ["dog"] } } })),
    );
    expect(st.requiredUnanswered).toEqual([]);
    expect(st.disqualified).toEqual([]);
    expect(st.complete).toBe(true);
  });

  it("A alone (no pets) completes — hidden B never becomes required", () => {
    const st = engine.nextState(config, answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["no"] } } })));
    expect(st.requiredUnanswered).toEqual([]);
    expect(st.complete).toBe(true);
  });
});

describe("engine.nextState: disqualification", () => {
  it("a disqualifying answer surfaces disqualified and forces complete=false", () => {
    const st = engine.nextState(
      config,
      answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["yes"] }, pet_type: { choiceIds: ["snake"] } } })),
    );
    expect(st.disqualified).toEqual([{ stepKey: "B", message: "We can't service homes with snakes." }]);
    expect(st.requiredUnanswered).toEqual([]); // B is answered…
    expect(st.complete).toBe(false); // …but disqualification still blocks completion
  });
});

describe("engine.nextState: hidden step's stale answer is ignored", () => {
  it("a snake answer left over from before A flipped to 'no' does not disqualify", () => {
    // B is hidden because has_pets='no'; its stale 'snake' answer must be ignored.
    const st = engine.nextState(
      config,
      answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["no"] }, pet_type: { choiceIds: ["snake"] } } })),
    );
    expect(st.visibleSteps).toEqual(["A", "D", "E"]);
    expect(st.disqualified).toEqual([]);
    expect(st.complete).toBe(true);
  });
});

describe("engine.nextState: warnings and recommendations", () => {
  it("warns on a high count without blocking completion", () => {
    const st = engine.nextState(
      config,
      answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["no"] }, count: { choiceIds: [], quantity: 5 } } })),
    );
    expect(st.warnings).toEqual([{ stepKey: "D", message: "Large jobs may need extra time." }]);
    expect(st.complete).toBe(true);
  });

  it("fires the recommendation only when its condition holds", () => {
    const st = engine.nextState(config, answersFromSelection(sel({ answers: { has_pets: { choiceIds: ["yes"] }, pet_type: { choiceIds: ["dog"] } } })));
    expect(st.recommendations).toEqual([{ stepKey: "E", text: "Add pet-hair treatment", addonKey: "pet_hair" }]);
  });
});

describe("engine.nextState: deterministic ordering", () => {
  it("visibleSteps follow config order regardless of answer insertion order", () => {
    const a1 = answersFromSelection(sel({ answers: { pet_type: { choiceIds: ["dog"] }, has_pets: { choiceIds: ["yes"] }, count: { choiceIds: [], quantity: 4 } } }));
    const a2 = answersFromSelection(sel({ answers: { count: { choiceIds: [], quantity: 4 }, has_pets: { choiceIds: ["yes"] }, pet_type: { choiceIds: ["dog"] } } }));
    const s1 = engine.nextState(config, a1);
    const s2 = engine.nextState(config, a2);
    expect(s1.visibleSteps).toEqual(["A", "B", "D", "E"]);
    expect(s1).toEqual(s2);
  });
});
