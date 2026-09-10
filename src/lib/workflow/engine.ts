import type { ProductionStage } from "@/lib/production";
import type { WorkflowRule } from "@/db/schema";

/**
 * W2 — the workflow engine, as pure logic.
 *
 * Everything here operates on plain rows handed in by the caller, with no
 * database access of its own. That is deliberate: the transition graph is
 * the single most consequential rule in the product (it is what stands
 * between "someone typed a word" and "this went to a client"), so it has to
 * be exhaustively testable without a database, a session, or a request.
 *
 * The DB-touching half lives in db/queries/workflow.ts, which loads a
 * workflow, calls in here to decide, and writes the result under a
 * guard-in-WHERE.
 */

export type EngineState = {
  id: string;
  key: string;
  name: string;
  category: "todo" | "doing" | "done";
  colorKey: string;
  position: number;
  wipLimit: number | null;
  legacyStage: ProductionStage | null;
};

export type EngineTransition = {
  id: string;
  fromStateId: string | null;
  toStateId: string;
  name: string;
  position: number;
  /** W5 — carried through decideTransition so the caller can evaluate them
   *  against a real content row without a second lookup. */
  conditions: WorkflowRule[];
  validators: WorkflowRule[];
  postActions: WorkflowRule[];
};

export type LoadedWorkflow = {
  id: string;
  name: string;
  states: EngineState[];
  transitions: EngineTransition[];
};

/** A destination offered to the UI, legal or not. */
export type TransitionOption = {
  transitionId: string | null;
  state: EngineState;
  /** The verb ("Send back"), falling back to the state's own name. */
  label: string;
  allowed: boolean;
  /** Present whenever allowed is false — why this move isn't on the table. */
  reason?: string;
};

export function stateById(
  workflow: LoadedWorkflow,
  stateId: string,
): EngineState | undefined {
  return workflow.states.find((s) => s.id === stateId);
}

export function stateByKey(
  workflow: LoadedWorkflow,
  key: string,
): EngineState | undefined {
  return workflow.states.find((s) => s.key === key);
}

/**
 * The state a brand-new row adopts: the target of the transition with no
 * source. Falls back to the first state by position so a workflow whose
 * initial transition was deleted still starts somewhere sane rather than
 * refusing to create work.
 */
export function initialState(
  workflow: LoadedWorkflow,
): EngineState | undefined {
  const initial = workflow.transitions.find((t) => t.fromStateId === null);
  if (initial) {
    const target = stateById(workflow, initial.toStateId);
    if (target) return target;
  }
  return [...workflow.states].sort((a, b) => a.position - b.position)[0];
}

export function findTransition(
  workflow: LoadedWorkflow,
  fromStateId: string,
  toStateId: string,
): EngineTransition | undefined {
  return workflow.transitions.find(
    (t) => t.fromStateId === fromStateId && t.toStateId === toStateId,
  );
}

/** Whether the graph permits this move. The single source of truth for
 *  legality — every other check in the engine defers to it. */
export function isLegalTransition(
  workflow: LoadedWorkflow,
  fromStateId: string,
  toStateId: string,
): boolean {
  return findTransition(workflow, fromStateId, toStateId) !== undefined;
}

/**
 * Every state, flagged for whether `currentStateId` may move to it.
 *
 * Illegal destinations are returned DISABLED WITH A REASON, never omitted.
 * A greyed transition teaches the workflow ("revision only resubmits to
 * internal review"); a hidden one just leaves someone wondering where the
 * option went. `allowed` is always derived from isLegalTransition, so this
 * can never offer a move the graph rejects.
 */
export function transitionOptions(
  workflow: LoadedWorkflow,
  currentStateId: string,
): TransitionOption[] {
  const current = stateById(workflow, currentStateId);
  const ordered = [...workflow.states].sort((a, b) => a.position - b.position);

  return ordered.map((state) => {
    if (state.id === currentStateId) {
      return {
        transitionId: null,
        state,
        label: state.name,
        allowed: false,
        reason: "this is the current state",
      };
    }

    const transition = findTransition(workflow, currentStateId, state.id);
    if (transition) {
      return {
        transitionId: transition.id,
        state,
        label: transition.name || state.name,
        allowed: true,
      };
    }

    return {
      transitionId: null,
      state,
      label: state.name,
      allowed: false,
      reason: current
        ? `not reachable from ${current.name.toLowerCase()}`
        : "not reachable",
    };
  });
}

export type TransitionDecision =
  | {
      ok: true;
      transition: EngineTransition;
      to: EngineState;
      /** Non-null only when the target mirrors a production_stage — this is
       *  what the caller dual-writes. A custom state yields null and the
       *  legacy column is left alone rather than guessed at. */
      legacyStage: ProductionStage | null;
    }
  | { ok: false; error: string };

/**
 * Decides one move. Pure: it reports what should happen, and the caller
 * performs the write under a guard so a raced move fails loudly rather than
 * silently applying twice.
 */
export function decideTransition(input: {
  workflow: LoadedWorkflow;
  fromStateId: string;
  toStateId: string;
}): TransitionDecision {
  const { workflow, fromStateId, toStateId } = input;

  const to = stateById(workflow, toStateId);
  if (!to) {
    return { ok: false, error: "That state isn't part of this workflow." };
  }

  if (fromStateId === toStateId) {
    return { ok: false, error: `This is already in ${to.name}.` };
  }

  const transition = findTransition(workflow, fromStateId, toStateId);
  if (!transition) {
    const from = stateById(workflow, fromStateId);
    return {
      ok: false,
      error: from
        ? `${to.name} isn't reachable from ${from.name}.`
        : "That move isn't allowed by this workflow.",
    };
  }

  return { ok: true, transition, to, legacyStage: to.legacyStage };
}

/**
 * Whether a column is over its limit. Returns false when no limit is set —
 * a WIP limit is opt-in, and treating "unset" as zero would flag every
 * column in a workspace that never configured one.
 */
export function isOverWipLimit(state: EngineState, count: number): boolean {
  return state.wipLimit !== null && count > state.wipLimit;
}

/** Board columns in display order. */
export function orderedStates(workflow: LoadedWorkflow): EngineState[] {
  return [...workflow.states].sort((a, b) => a.position - b.position);
}
