/**
 * S1 — dependency-graph checks for a template's steps, as pure logic.
 *
 * A run's steps stay `blocked` until their dependencies are `done` (S3), so
 * the graph has to be acyclic before a template can ever be run — a cycle
 * here means a run that can never fully unblock. Checked at author time,
 * not run time, so a broken template is caught before anyone starts a run
 * from it.
 */

export type SopStepNode = { id: string; dependsOn: string[] };

/**
 * Whether setting `stepId`'s dependencies to `newDependsOn` would create a
 * cycle, given the rest of the template's steps as they stand. Pure DFS
 * over the hypothetical graph — `stepId` itself is never trusted from
 * `steps`, only from the proposed `newDependsOn`, so a step editing its own
 * row doesn't see its stale dependency list.
 */
export function wouldCreateCycle(
  steps: SopStepNode[],
  stepId: string,
  newDependsOn: string[],
): boolean {
  const graph = new Map(steps.map((s) => [s.id, s.dependsOn]));
  graph.set(stepId, newDependsOn);

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true; // back-edge = cycle
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return dfs(stepId);
}

/**
 * Dependency ids that don't refer to a step in this template. A dropdown
 * only ever offers real steps, but a stale form submission (a step deleted
 * mid-edit in another tab) can still name one — callers drop these rather
 * than failing the whole save over a reference that's already gone.
 */
export function unknownDependencies(
  steps: SopStepNode[],
  dependsOn: string[],
): string[] {
  const known = new Set(steps.map((s) => s.id));
  return dependsOn.filter((id) => !known.has(id));
}
