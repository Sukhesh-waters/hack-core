import type { EngineState, EngineTransition, LoadedWorkflow } from "@/lib/workflow/engine";
import { initialState, stateById } from "@/lib/workflow/engine";

/**
 * D1 — derive a human-readable pipeline path from a workflow graph.
 *
 * Walks from the initial state to a done-category state, preferring the
 * "happy path" at each fork: an edge whose target is closer to `done`
 * (higher category rank) wins over a same-category detour like the
 * revision loop. Cycles are broken by a visited set.
 *
 * Pure: no IO, no database. Tested against the default workflow and
 * against custom-state fixtures.
 */

/** Category rank — higher = closer to done. */
function categoryRank(category: EngineState["category"]): number {
  switch (category) {
    case "todo":
      return 0;
    case "doing":
      return 1;
    case "done":
      return 2;
  }
}

/**
 * From a given state, find the "best" outgoing transition: prefer edges
 * into a higher-rank category, then prefer lower position (earlier in
 * the admin's ordering). This skips conditional loops (revision) when a
 * forward edge exists.
 */
function bestForwardEdge(
  workflow: LoadedWorkflow,
  fromStateId: string,
): EngineTransition | null {
  const candidates = workflow.transitions.filter(
    (t) => t.fromStateId === fromStateId,
  );
  if (candidates.length === 0) return null;

  // Rank each candidate by the target state's category (higher = better),
  // then by position (lower = preferred).
  return candidates.reduce<EngineTransition | null>((best, t) => {
    const target = stateById(workflow, t.toStateId);
    if (!target) return best;
    if (!best) return t;
    const bestTarget = stateById(workflow, best.toStateId);
    if (!bestTarget) return t;

    const rankDiff =
      categoryRank(target.category) - categoryRank(bestTarget.category);
    if (rankDiff > 0) return t; // higher category wins
    if (rankDiff < 0) return best;
    // Same category: prefer lower position
    return target.position < bestTarget.position ? t : best;
  }, null);
}

/**
 * Walk the workflow graph from the initial state to produce a pipeline
 * path like: "Accept → AI draft → Studio → Compliance → Approvals → Calendar"
 *
 * Returns the ordered state names along the happy path. An empty array
 * means the workflow has no initial state or no reachable done state.
 */
export function deriveHappyPath(workflow: LoadedWorkflow): string[] {
  const start = initialState(workflow);
  if (!start) return [];

  const path: string[] = [start.name];
  const visited = new Set<string>([start.id]);
  let current = start;

  // Walk until we hit a done-category state or exhaust edges
  while (current.category !== "done") {
    const edge = bestForwardEdge(workflow, current.id);
    if (!edge) break;

    const target = stateById(workflow, edge.toStateId);
    if (!target || visited.has(target.id)) break;

    visited.add(target.id);
    path.push(target.name);
    current = target;
  }

  return path;
}

/**
 * The chip text shown on a plan card: a condensed pipeline summary.
 *
 * For the default workflow: "Brief → In progress → Internal review → Done"
 * For a custom workflow: whatever the graph says.
 */
export function nextStepChipText(workflow: LoadedWorkflow): string {
  const path = deriveHappyPath(workflow);
  if (path.length === 0) return "No pipeline configured";
  return path.join(" → ");
}

/**
 * Given a specific current state, return the remaining pipeline steps
 * from that point forward. Useful for showing "what happens next" on
 * a card that's already partway through the pipeline.
 */
export function remainingSteps(
  workflow: LoadedWorkflow,
  currentStateId: string,
): string[] {
  const current = stateById(workflow, currentStateId);
  if (!current) return [];
  if (current.category === "done") return [];

  const path: string[] = [];
  const visited = new Set<string>([currentStateId]);
  let cursor = current;

  while (cursor.category !== "done") {
    const edge = bestForwardEdge(workflow, cursor.id);
    if (!edge) break;

    const target = stateById(workflow, edge.toStateId);
    if (!target || visited.has(target.id)) break;

    visited.add(target.id);
    path.push(target.name);
    cursor = target;
  }

  return path;
}
