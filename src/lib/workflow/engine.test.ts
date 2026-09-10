import { describe, expect, it } from "vitest";
import {
  decideTransition,
  findTransition,
  initialState,
  isLegalTransition,
  isOverWipLimit,
  orderedStates,
  stateByKey,
  transitionOptions,
  type EngineState,
  type EngineTransition,
  type LoadedWorkflow,
} from "./engine";

const state = (
  key: string,
  position: number,
  over: Partial<EngineState> = {},
): EngineState => ({
  id: `s_${key}`,
  key,
  name: key.replace(/_/g, " "),
  category: "doing",
  colorKey: "slate",
  position,
  wipLimit: null,
  legacyStage: null,
  ...over,
});

const transition = (
  over: Omit<EngineTransition, "conditions" | "validators" | "postActions">,
): EngineTransition => ({
  ...over,
  conditions: [],
  validators: [],
  postActions: [],
});

/** Mirrors the seeded default: a fork at internal_review, a loop back from
 *  revision, and done terminal. */
const workflow: LoadedWorkflow = {
  id: "wf_1",
  name: "Content production",
  states: [
    state("brief", 0, { category: "todo", legacyStage: "brief" }),
    state("in_progress", 1, { legacyStage: "in_progress" }),
    state("internal_review", 2, { legacyStage: "internal_review" }),
    state("revision", 3, { legacyStage: "revision" }),
    state("done", 4, { category: "done", legacyStage: "done" }),
  ],
  transitions: [
    transition({ id: "t0", fromStateId: null, toStateId: "s_brief", name: "Create", position: 0 }),
    transition({ id: "t1", fromStateId: "s_brief", toStateId: "s_in_progress", name: "Start", position: 1 }),
    transition({ id: "t2", fromStateId: "s_in_progress", toStateId: "s_internal_review", name: "Submit for review", position: 2 }),
    transition({ id: "t3", fromStateId: "s_internal_review", toStateId: "s_done", name: "Mark done", position: 3 }),
    transition({ id: "t4", fromStateId: "s_internal_review", toStateId: "s_revision", name: "Send back", position: 4 }),
    transition({ id: "t5", fromStateId: "s_revision", toStateId: "s_internal_review", name: "Resubmit", position: 5 }),
  ],
};

describe("initialState", () => {
  it("is the target of the transition with no source", () => {
    expect(initialState(workflow)?.key).toBe("brief");
  });

  /**
   * Selecting by "from is null" rather than by position means reordering
   * the board can't silently change where new work starts.
   */
  it("does not follow board order when the two disagree", () => {
    const reordered: LoadedWorkflow = {
      ...workflow,
      states: workflow.states.map((s) =>
        s.key === "brief" ? { ...s, position: 99 } : s,
      ),
    };
    expect(initialState(reordered)?.key).toBe("brief");
  });

  /** A workflow whose initial transition was deleted must still be able to
   *  create work rather than refusing outright. */
  it("falls back to the first state by position when there is no initial transition", () => {
    const orphaned: LoadedWorkflow = {
      ...workflow,
      transitions: workflow.transitions.filter((t) => t.fromStateId !== null),
    };
    expect(initialState(orphaned)?.key).toBe("brief");
  });
});

describe("isLegalTransition", () => {
  it("allows the edges the graph defines", () => {
    expect(isLegalTransition(workflow, "s_brief", "s_in_progress")).toBe(true);
    expect(isLegalTransition(workflow, "s_internal_review", "s_revision")).toBe(true);
    expect(isLegalTransition(workflow, "s_revision", "s_internal_review")).toBe(true);
  });

  it("refuses a skip past a state", () => {
    expect(isLegalTransition(workflow, "s_brief", "s_done")).toBe(false);
  });

  it("refuses any move out of a terminal state", () => {
    for (const target of workflow.states) {
      expect(isLegalTransition(workflow, "s_done", target.id)).toBe(false);
    }
  });

  it("refuses a self-move", () => {
    expect(isLegalTransition(workflow, "s_brief", "s_brief")).toBe(false);
  });
});

describe("transitionOptions", () => {
  it("returns every state, never a subset", () => {
    const options = transitionOptions(workflow, "s_brief");
    expect(options.map((o) => o.state.key)).toEqual(
      orderedStates(workflow).map((s) => s.key),
    );
  });

  it("carries the transition verb, not the destination name", () => {
    const options = transitionOptions(workflow, "s_internal_review");
    expect(options.find((o) => o.state.key === "revision")?.label).toBe(
      "Send back",
    );
    expect(options.find((o) => o.state.key === "done")?.label).toBe(
      "Mark done",
    );
  });

  it("disables the current state with its own clearer reason", () => {
    const self = transitionOptions(workflow, "s_brief").find(
      (o) => o.state.key === "brief",
    );
    expect(self?.allowed).toBe(false);
    expect(self?.reason).toBe("this is the current state");
  });

  it("disables unreachable states with a reason naming the source", () => {
    const done = transitionOptions(workflow, "s_brief").find(
      (o) => o.state.key === "done",
    );
    expect(done?.allowed).toBe(false);
    expect(done?.reason).toContain("brief");
  });

  it("every allowed option carries the transition id that authorises it", () => {
    for (const from of workflow.states) {
      for (const option of transitionOptions(workflow, from.id)) {
        if (option.allowed) expect(option.transitionId).toBeTruthy();
        else expect(option.transitionId).toBeNull();
      }
    }
  });

  /**
   * The load-bearing guarantee: the menu can never offer a move the graph
   * rejects. Exhaustive over every (from, to) pair, not just what the
   * function happens to enumerate.
   */
  it("property: allowed exactly matches isLegalTransition over every state pair", () => {
    for (const from of workflow.states) {
      for (const to of workflow.states) {
        const option = transitionOptions(workflow, from.id).find(
          (o) => o.state.id === to.id,
        );
        expect(option).toBeDefined();
        expect(option?.allowed).toBe(
          isLegalTransition(workflow, from.id, to.id),
        );
      }
    }
  });
});

describe("decideTransition", () => {
  it("approves a legal move and reports the legacy stage to dual-write", () => {
    const decision = decideTransition({
      workflow,
      fromStateId: "s_brief",
      toStateId: "s_in_progress",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.to.key).toBe("in_progress");
    expect(decision.legacyStage).toBe("in_progress");
    expect(decision.transition.name).toBe("Start");
  });

  /**
   * A custom state has no enum word, so the decision reports null and the
   * caller leaves production_stage alone rather than guessing.
   */
  it("reports null legacyStage for a custom state", () => {
    const custom: LoadedWorkflow = {
      ...workflow,
      states: [...workflow.states, state("shoot", 5)],
      transitions: [
        ...workflow.transitions,
        transition({ id: "t6", fromStateId: "s_brief", toStateId: "s_shoot", name: "Schedule shoot", position: 6 }),
      ],
    };
    const decision = decideTransition({
      workflow: custom,
      fromStateId: "s_brief",
      toStateId: "s_shoot",
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.legacyStage).toBeNull();
  });

  it("refuses an illegal move, naming both ends", () => {
    const decision = decideTransition({
      workflow,
      fromStateId: "s_brief",
      toStateId: "s_done",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toContain("done");
    expect(decision.error).toContain("brief");
  });

  it("refuses a self-move with a message that reads like a human wrote it", () => {
    const decision = decideTransition({
      workflow,
      fromStateId: "s_brief",
      toStateId: "s_brief",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toMatch(/already in brief/i);
  });

  it("refuses a state from another workflow", () => {
    const decision = decideTransition({
      workflow,
      fromStateId: "s_brief",
      toStateId: "s_from_somewhere_else",
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toMatch(/isn't part of this workflow/i);
  });
});

describe("isOverWipLimit", () => {
  it("is false when no limit is set, however many cards there are", () => {
    expect(isOverWipLimit(state("x", 0), 999)).toBe(false);
  });

  it("flags only past the limit, not at it", () => {
    const limited = state("x", 0, { wipLimit: 3 });
    expect(isOverWipLimit(limited, 3)).toBe(false);
    expect(isOverWipLimit(limited, 4)).toBe(true);
  });

  it("treats a zero limit as a real limit, not as unset", () => {
    expect(isOverWipLimit(state("x", 0, { wipLimit: 0 }), 1)).toBe(true);
  });
});

describe("lookup helpers", () => {
  it("finds a state by key and a transition by both ends", () => {
    expect(stateByKey(workflow, "revision")?.id).toBe("s_revision");
    expect(
      findTransition(workflow, "s_revision", "s_internal_review")?.name,
    ).toBe("Resubmit");
  });

  it("sorts board columns by position regardless of row order", () => {
    const shuffled: LoadedWorkflow = {
      ...workflow,
      states: [...workflow.states].reverse(),
    };
    expect(orderedStates(shuffled).map((s) => s.key)).toEqual([
      "brief",
      "in_progress",
      "internal_review",
      "revision",
      "done",
    ]);
  });
});
